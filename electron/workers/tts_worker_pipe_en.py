# -*- coding: utf-8 -*-
"""
로컬 IPC 워커 - Windows Named Pipe (영어 TTS)
- 파이프명: \\.\pipe\melo_tts_en
- main.js로부터 실행 인수를 받아 패키징 환경을 설정합니다.
- TTS 결과를 캐싱하여 반복적인 요청에 빠르게 응답합니다.
"""

import os, sys, re, time, json, queue, threading, tempfile, shutil, uuid
import numpy as np
import traceback
import nltk
from melo.api import TTS

import warnings
import logging
warnings.filterwarnings("ignore")  # pkg_resources, FutureWarning 등 모든 잡다한 경고 무시
logging.getLogger("transformers").setLevel(logging.ERROR) # Transformers 내부 로그 끄기



# --- 전역 변수 및 설정 ---
AUDIO_CACHE = {}
CACHE_LOCK = threading.Lock()
PIPE_NAME = r"\\.\pipe\melo_tts_en"
SPEED = 1.2
GAIN_MULTIPLIER = 1.8 # 영어 모델용 볼륨 조절
N_SYNTH_WORKERS = 2

# main.js에서 전달한 인수로 배포 모드(packaged) 여부 확인
IS_PACKAGED = (len(sys.argv) > 1 and sys.argv[1] == 'packaged')
print(f"[INIT] IS_PACKAGED flag set to: {IS_PACKAGED}", flush=True)

# NLTK 데이터 경로 설정 (패키징 환경 대응)
try:
    if IS_PACKAGED and len(sys.argv) > 2:
        BASE_PATH_EN = sys.argv[2] # resourcesPath
        NLTK_DATA_PATH = os.path.join(BASE_PATH_EN, 'nltk_data')
        if os.path.isdir(NLTK_DATA_PATH):
            nltk.data.path.append(NLTK_DATA_PATH)
            print(f"[INIT] NLTK Data Path added: {NLTK_DATA_PATH}", flush=True)
    else:
        print("[INIT] Debug Mode: Checking/Downloading NLTK data ('punkt')...", flush=True)
        nltk.download('punkt', quiet=True)
        print("[INIT] NLTK 'punkt' data is ready.", flush=True)
except Exception as e:
    print(f"[INIT][WARN] Failed to configure NLTK data path: {e}", flush=True)

# HuggingFace 라이브러리 설정
os.environ['HUGGINGFACE_HUB_DISABLE_SYMLINKS'] = '1'

# 모델 경로 설정 (패키징/개발 환경 분기)
COMMIT_ID_HASH = 'bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef'
LOCAL_MODEL_COMMIT_PATH = None

if IS_PACKAGED:
    if len(sys.argv) > 2:
        BASE_PATH = sys.argv[2] # main.js에서 전달한 resourcesPath
        LOCAL_MODEL_COMMIT_PATH = os.path.join(BASE_PATH, 'melo-en-model', 'snapshots', COMMIT_ID_HASH)
        print(f"[INIT] Packaged model path set to: {LOCAL_MODEL_COMMIT_PATH}", flush=True)
    else:
        print("[INIT][FATAL] Packaged mode but BASE_PATH (sys.argv[2]) not provided.", flush=True)
        sys.exit(1)
else: # 개발 모드
    try:
        local_app_data = os.environ.get('LOCALAPPDATA', '.')
        hf_cache_path = os.path.join(local_app_data, 'MeloTTS_Cache', 'huggingface', 'hub')
        MODEL_NAME = 'models--myshell-ai--MeloTTS-English'
        LOCAL_MODEL_COMMIT_PATH = os.path.join(hf_cache_path, MODEL_NAME, 'snapshots', COMMIT_ID_HASH)
        print(f"[INIT] Debug Mode: Using external model path: {LOCAL_MODEL_COMMIT_PATH}", flush=True)
    except Exception as e:
        print(f"[FATAL] Failed to set script cache env: {e}", flush=True)
        sys.exit(1)

# 필수 라이브러리 임포트
try:
    import win32pipe, win32file, win32con, pywintypes
    import simpleaudio as sa
    from scipy.io import wavfile as sci_wav
except ImportError as e:
    print(f"FATAL: 필수 라이브러리 로딩 실패: {e}", flush=True)
    sys.exit(1)

# UTF-8 인코딩 설정
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception: pass

# 임시 디렉토리 설정
try:
    base_temp_dir = os.environ.get('LOCALAPPDATA', tempfile.gettempdir())
    TMP_PATH = os.path.join(base_temp_dir, f"melo_tts_worker_en_{os.getpid()}")
    os.makedirs(TMP_PATH, exist_ok=True)
    print(f"[INIT] Using temporary directory: {TMP_PATH}", flush=True)
except Exception as e:
    print(f"FATAL: Failed to create temporary directory: {e}", flush=True)
    sys.exit(1)

# --- 오디오 처리 유틸리티 함수들 ---
def pick_speaker_id(tts):
    spk2id = getattr(tts.hps.data, "spk2id", {})
    for k, v in spk2id.items():
        if "EN-US" in str(k).upper(): return int(v)
    return int(next(iter(spk2id.values()), 0))

import re

def split_chunks(text: str, first_len=60, rest_len=300):
    chunks = []
    cur_text = text.strip()

    # 1. 초기 반응 속도를 위해 첫 청크는 짧게 설정
    target_len = first_len

    while cur_text:
        # 남은 텍스트가 목표 길이보다 짧으면 그대로 반환
        if len(cur_text) <= target_len:
            if cur_text:
                chunks.append(cur_text)
            break

        candidate = cur_text[:target_len]

        # [핵심] 최소 길이 안전장치 (목표 길이의 40% 이상 진행 후 자르기)
        # 영어는 단어 길이가 다양하므로 이 안전장치가 더 중요합니다.
        min_threshold = int(target_len * 0.4)
        split_idx = -1

        # --- 스마트 자르기 로직 (영어 전용) ---

        # (1순위) 문장 종결 부호 (. ? ! 개행)
        # 영어는 : (콜론)도 문장의 큰 휴지부로 쓰일 때가 많아 포함하면 좋습니다.
        # 단, Mr. Dr. 등을 피하기 위해 뒤에 공백이나 끝이 오는 경우를 선호하게 하면 좋지만,
        # 일단 40% 룰이 막아주므로 단순화하여 처리합니다.
        match = re.search(r'[.?!:\n](?=[^.?!:\n]*$)', candidate)
        if match and match.end() > min_threshold:
            split_idx = match.end()

        # (2순위) 중간 부호 (, ;)
        if split_idx == -1:
            match = re.search(r'[,;](?=[^,;]*$)', candidate)
            if match and match.end() > min_threshold:
                split_idx = match.end()

        # (3순위) 공백 (단어 단위) - 영어는 띄어쓰기가 명확해서 이게 아주 잘 먹힙니다.
        if split_idx == -1:
            last_space = candidate.rfind(' ')
            if last_space > min_threshold:
                split_idx = last_space

        # (4순위) 강제 절단
        if split_idx == -1:
            split_idx = target_len

        # --- 로직 끝 ---

        # 조각 저장
        chunk = cur_text[:split_idx].strip()
        if chunk:
            chunks.append(chunk)

        cur_text = cur_text[split_idx:].strip()

        # 첫 턴 이후에는 긴 버퍼(300자)로 전환
        target_len = rest_len

    return chunks

def read_wav_as_float(path: str):
    sr, data = sci_wav.read(path)
    if data.ndim > 1: data = data[:, 0]
    if data.dtype == np.int16: data = data.astype(np.float32) / 32767.0
    return sr, np.nan_to_num(np.clip(data, -1.0, 1.0))

def resample_if_needed(audio, src_sr, tgt_sr):
    if src_sr == 0 or audio.size == 0 or src_sr == tgt_sr: return audio
    new_len = int(round(len(audio) * (tgt_sr / float(src_sr))))
    return np.interp(np.linspace(0, 1, new_len), np.linspace(0, 1, len(audio)), audio)

def fade_in_out(audio, sr, ms=3.0):
    k = int(sr * (ms / 1000.0))
    if k <= 1 or len(audio) <= 2 * k: return audio
    w = np.linspace(0.0, 1.0, k, dtype=np.float32)
    audio[:k] *= w
    audio[-k:] *= w[::-1]
    return audio

def synth_to_numpy(tts, text, speaker_id, speed, tmpdir, target_sr):
    tmp_path = os.path.join(tmpdir, f"melo_en_{uuid.uuid4().hex}.wav")
    try:
        tts.tts_to_file(text, speaker_id, tmp_path, speed=speed)
        src_sr, audio = read_wav_as_float(tmp_path)
    finally:
        if os.path.exists(tmp_path): os.remove(tmp_path)
    audio = resample_if_needed(audio, src_sr, target_sr)
    return target_sr, fade_in_out(audio, target_sr)

# --- 스레드 워커 함수들 ---

def synth_worker(tts, spk_id, in_q, play_q, stop_evt, interrupt_evt, tmpdir, target_sr, wid, cache, lock):
    """TTS 합성을 수행하고 결과를 play_q에 넣는 워커"""
    print(f"[SYNTH-{wid}] Worker started.", flush=True)
    while not stop_evt.is_set():
        try:
            text = in_q.get(timeout=0.1)
            if text is None: break
            text = text.strip()
            if not text: continue
            chunks = split_chunks(text)

            for seg in chunks:
                if stop_evt.is_set() or interrupt_evt.is_set(): break
                cache_key = f"{seg}|{spk_id}|{SPEED}|{GAIN_MULTIPLIER}"
                with lock:
                    cached_audio = cache.get(cache_key)

                if cached_audio:
                    print(f"[SYNTH-{wid}][CACHE] HIT «{seg}»", flush=True)
                    play_q.put(cached_audio)
                    continue

                print(f"[SYNTH-{wid}][CACHE] MISS «{seg}». Synthesizing...", flush=True)
                try:
                    sr, audio = synth_to_numpy(tts, seg, spk_id, SPEED, tmpdir, target_sr)
                    if audio.size == 0: continue
                    audio = audio * GAIN_MULTIPLIER
                    audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
                    audio_data_tuple = (target_sr, audio_int16.tobytes())
                    with lock:
                        cache[cache_key] = audio_data_tuple
                    play_q.put(audio_data_tuple)
                except Exception as e:
                    print(f"[SYNTH-{wid}][ERR] Synth failed for «{seg}»:\n{traceback.format_exc()}", flush=True)
        except queue.Empty:
            continue
    print(f"[SYNTH-{wid}] Worker stopped.", flush=True)

def play_worker(play_q, stop_evt, interrupt_evt, signal_q):
    """play_q에서 오디오 데이터를 받아 재생하고 main.js로 신호를 보내는 워커"""
    print("[PLAY] Worker started.", flush=True)
    done_signal_sent = True
    start_signal_sent = False
    interrupt_handled = False
    while not stop_evt.is_set():
        if interrupt_evt.is_set():
            if not interrupt_handled:
                sa.stop_all()
                while not play_q.empty(): play_q.get_nowait()
                if not done_signal_sent:
                    signal_q.put(b"DONE\n")
                done_signal_sent, start_signal_sent, interrupt_handled = True, False, True
                print("[PLAY] Interrupt handled.", flush=True)
            time.sleep(0.02)
            continue
        if interrupt_handled:
            print("[PLAY] Interrupt cleared.", flush=True)
            interrupt_handled = False
        try:
            sr, audio_bytes = play_q.get(timeout=0.05)
            if audio_bytes is None: break
            done_signal_sent = False
            if not start_signal_sent:
                signal_q.put(b"START\n")
                start_signal_sent = True
            play_obj = sa.play_buffer(audio_bytes, 1, 2, sr)
            while play_obj.is_playing():
                if interrupt_evt.is_set():
                    sa.stop_all()
                    break
                time.sleep(0.01)
            if not interrupt_evt.is_set() and play_q.empty():
                signal_q.put(b"DONE\n")
                done_signal_sent, start_signal_sent = True, False
        except queue.Empty:
            continue
    sa.stop_all()
    print("[PLAY] Worker stopped.", flush=True)

def run_pipe_loop(in_q, stop_evt, interrupt_evt, signal_q):
    """Windows Named Pipe 통신 (영어용 스마트 버퍼링 추가)"""
    print("[PIPE] Worker started with Smart Buffering (EN).", flush=True)

    # 영어 문장 종결 패턴 (마침표, 물음표, 느낌표, 개행, 콜론)
    # 한국어 부호(。？！)는 제거하고 영어에 자주 쓰이는 콜론(:) 추가
    re_end = re.compile(r'[.?!:\n]')
    # 쉼표 패턴
    re_comma = re.compile(r'[,;]')

    text_buffer = ""

    while not stop_evt.is_set():
        handle = None
        try:
            handle = win32pipe.CreateNamedPipe(PIPE_NAME, win32con.PIPE_ACCESS_DUPLEX,
                                               win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
                                               1, 65536, 65536, 0, None)
            print(f"[PIPE] Ready on {PIPE_NAME}", flush=True)
            win32pipe.ConnectNamedPipe(handle, None)
            print("[PIPE] Client Connected", flush=True)

            buf = b""
            while not stop_evt.is_set():
                try:
                    try:
                        signal = signal_q.get_nowait()
                        win32file.WriteFile(handle, signal)
                    except queue.Empty: pass
                except pywintypes.error: break

                try:
                    _, data = win32file.ReadFile(handle, 4096)
                    buf += data

                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.decode("utf-8", errors="ignore").strip()
                        if not line: continue

                        try:
                            obj = json.loads(line)
                            command = obj.get("command", "")
                            text = obj.get("text", "")

                            # 1. 명시적 Stop 명령 처리
                            if command == "stop":
                                while not in_q.empty(): in_q.get_nowait()
                                interrupt_evt.set()
                                text_buffer = ""

                            elif command == "quit":
                                stop_evt.set()
                                break

                            elif command == "flush":
                                if text_buffer:
                                    in_q.put(text_buffer)
                                    text_buffer = ""

                            elif text:
                                if interrupt_evt.is_set(): interrupt_evt.clear()

                                # ★ [핵심 수정] "stop"이라는 텍스트가 들어오면 읽지 말고 멈춤 명령으로 처리
                                if text.strip().lower() == "stop":
                                    print("[PIPE] 'stop' text detected -> Converting to COMMAND.", flush=True)
                                    while not in_q.empty(): in_q.get_nowait()
                                    interrupt_evt.set()
                                    text_buffer = ""
                                    continue

                                # --- 버퍼링 로직 (기존 유지) ---
                                text_buffer += text

                                # (KR/EN 파일에 맞춰 기존 정규식 re_end, re_comma 사용)
                                matches = list(re_end.finditer(text_buffer))
                                if matches:
                                    last_idx = matches[-1].end()
                                    to_send = text_buffer[:last_idx]
                                    text_buffer = text_buffer[last_idx:]
                                    in_q.put(to_send)
                                    continue

                                if len(text_buffer) > 300:
                                    matches = list(re_comma.finditer(text_buffer))
                                    if matches:
                                        last_idx = matches[-1].end()
                                        to_send = text_buffer[:last_idx]
                                        text_buffer = text_buffer[last_idx:]
                                        in_q.put(to_send)
                                        continue

                                if len(text_buffer) > 500:
                                    in_q.put(text_buffer)
                                    text_buffer = ""

                        except json.JSONDecodeError:
                            pass

                except pywintypes.error as e:
                    if e.winerror in [109, 232]: break
                    else: raise
        except Exception as e:
            print(f"[PIPE] Error: {e}", flush=True)
            time.sleep(1)
        finally:
            if handle: win32file.CloseHandle(handle)
            print("[PIPE] Connection loop reset.", flush=True)

def warmup(tts, spk_id, target_sr, tmpdir):
    """모델 로딩 후 초기 실행 속도 향상을 위한 워밍업"""
    try:
        print("[WARMUP] 시작", flush=True)
        # ⬇️ (sr, audio_float)로 받음
        sr, audio_float = synth_to_numpy(tts, "Warming up.", spk_id, 1.0, tmpdir, target_sr)
        if audio_float.size > 0:
            # ⬇️ GAIN_MULTIPLIER를 사용하는 코드
            audio_int16 = (np.clip(audio_float * GAIN_MULTIPLIER * 0.5, -1.0, 1.0) * 32767.0).astype(np.int16)
            sa.play_buffer(audio_int16.tobytes(), 1, 2, sr).wait_done()
        print("[WARMUP] 완료", flush=True)
    except Exception as e:
        print(f"[WARMUP][WARN] \n{traceback.format_exc()}", flush=True)

# --- 메인 실행 ---
def main():
    print("[INIT] Starting TTS EN Worker...", flush=True)

    # 큐, 이벤트 객체 및 파이프 스레드를 모델 로딩 전에 시작
    in_q, play_q, signal_q = queue.Queue(), queue.Queue(), queue.Queue(maxsize=10)
    stop_evt, interrupt_evt = threading.Event(), threading.Event()
    th_pipe = threading.Thread(target=run_pipe_loop, args=(in_q, stop_evt, interrupt_evt, signal_q), daemon=True)
    th_pipe.start()

    # 무거운 모델 로딩
    try:
        print("[INIT] Loading MeloTTS EN model...", flush=True)
        tts = TTS(language="EN", device="auto")
        spk_id = pick_speaker_id(tts)
        target_sr = int(getattr(tts.hps.data, "sampling_rate", 24000))
        print(f"[INIT] Model loaded. SpkID={spk_id}, SR={target_sr}", flush=True)
    except Exception as e:
        print(f"[INIT][FATAL] Failed to load model: {e}", flush=True)
        stop_evt.set()
        sys.exit(1)

    warmup(tts, spk_id, target_sr, TMP_PATH)
    tmpdir = tempfile.mkdtemp(prefix="_melo_run_en_", dir=TMP_PATH)

    # 모델 로딩 후 Play/Synth 워커 시작
    print("[INIT] Starting worker threads (Play, Synth)...", flush=True)
    th_play = threading.Thread(target=play_worker, args=(play_q, stop_evt, interrupt_evt, signal_q), daemon=True)
    th_play.start()
    workers = []
    for wid in range(N_SYNTH_WORKERS):
        th = threading.Thread(target=synth_worker, args=(tts, spk_id, in_q, play_q, stop_evt, interrupt_evt, tmpdir, target_sr, wid, AUDIO_CACHE, CACHE_LOCK), daemon=True)
        th.start()
        workers.append(th)

    print(f"[INIT] All threads started. Monitoring...", flush=True)
    try:
        while not stop_evt.is_set():
            if not all(t.is_alive() for t in workers + [th_play, th_pipe]):
                print("[ERROR] A worker thread died unexpectedly. Exiting.", flush=True)
                stop_evt.set()
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[EXIT] KeyboardInterrupt.", flush=True)
    finally:
        print("[EXIT] Shutting down...", flush=True)
        stop_evt.set()
        # 워커 스레드 종료 신호 전송 및 정리
        for _ in workers: in_q.put(None)
        play_q.put((0, None))
        try: # 파이프 스레드 종료를 위한 더미 연결
            handle = win32file.CreateFile(PIPE_NAME, win32con.GENERIC_WRITE, 0, None, win32con.OPEN_EXISTING, 0, None)
            win32file.CloseHandle(handle)
        except Exception: pass
        for th in workers + [th_play, th_pipe]: th.join(timeout=2.0)
        shutil.rmtree(TMP_PATH, ignore_errors=True)
        print("[EXIT] Shutdown complete.", flush=True)

if __name__ == "__main__":
    main()