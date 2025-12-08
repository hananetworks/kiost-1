# -*- coding: utf-8 -*-
"""
로컬 IPC 워커 - Windows Named Pipe (영어 TTS)
- 파이프명: \\.\pipe\melo_tts_en
- main.js로부터 실행 인수를 받아 패키징 환경을 설정합니다.
- TTS 결과를 캐싱하여 반복적인 요청에 빠르게 응답합니다.
- [Update] SimpleAudio 제거 -> SoundDevice 적용 (고속 재생)
"""

import os, sys, re, time, json, queue, threading, tempfile, shutil, uuid
import numpy as np
import traceback
import nltk
from melo.api import TTS

import warnings
import logging
warnings.filterwarnings("ignore")
logging.getLogger("transformers").setLevel(logging.ERROR)

# ==================================================================================
# ✅ NLTK 데이터 강제 확보 로직
# ==================================================================================
def ensure_nltk_resources():
    required_resources = [
        'taggers/averaged_perceptron_tagger',
        'taggers/averaged_perceptron_tagger_eng',
        'corpora/cmudict',
        'tokenizers/punkt'
    ]
    app_data = os.environ.get('APPDATA')
    if app_data:
        default_path = os.path.join(app_data, 'nltk_data')
        if default_path not in nltk.data.path:
            nltk.data.path.append(default_path)

    print("[INIT] Checking NLTK resources...", flush=True)
    for resource in required_resources:
        try:
            nltk.data.find(resource)
        except LookupError:
            resource_name = resource.split('/')[-1]
            try:
                nltk.download(resource_name, quiet=True)
            except Exception: pass
ensure_nltk_resources()


# --- 전역 변수 및 설정 ---
AUDIO_CACHE = {}
CACHE_LOCK = threading.Lock()
PIPE_NAME = r"\\.\pipe\melo_tts_en"
SPEED = 1.2
GAIN_MULTIPLIER = 1.8
N_SYNTH_WORKERS = 2

IS_PACKAGED = (len(sys.argv) > 1 and sys.argv[1] == 'packaged')
print(f"[INIT] IS_PACKAGED flag set to: {IS_PACKAGED}", flush=True)

try:
    if IS_PACKAGED and len(sys.argv) > 2:
        BASE_PATH_EN = sys.argv[2]
        NLTK_DATA_PATH = os.path.join(BASE_PATH_EN, 'nltk_data')
        if os.path.isdir(NLTK_DATA_PATH):
            nltk.data.path.append(NLTK_DATA_PATH)
    else:
        nltk.download('punkt', quiet=True)
except Exception as e:
    print(f"[INIT][WARN] Failed to configure NLTK data path: {e}", flush=True)

os.environ['HUGGINGFACE_HUB_DISABLE_SYMLINKS'] = '1'
COMMIT_ID_HASH = 'bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef'

if IS_PACKAGED:
    if len(sys.argv) > 2:
        BASE_PATH = sys.argv[2]
        LOCAL_MODEL_COMMIT_PATH = os.path.join(BASE_PATH, 'melo-en-model', 'snapshots', COMMIT_ID_HASH)
    else:
        sys.exit(1)
else:
    try:
        local_app_data = os.environ.get('LOCALAPPDATA', '.')
        hf_cache_path = os.path.join(local_app_data, 'MeloTTS_Cache', 'huggingface', 'hub')
        MODEL_NAME = 'models--myshell-ai--MeloTTS-English'
        LOCAL_MODEL_COMMIT_PATH = os.path.join(hf_cache_path, MODEL_NAME, 'snapshots', COMMIT_ID_HASH)
    except Exception:
        sys.exit(1)

# [수정] 필수 라이브러리: SimpleAudio 제거 -> SoundDevice 추가
try:
    import win32pipe, win32file, win32con, pywintypes
    import sounddevice as sd
    from scipy.io import wavfile as sci_wav
except ImportError as e:
    print(f"FATAL: 필수 라이브러리 로딩 실패: {e}", flush=True)
    sys.exit(1)

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception: pass

try:
    base_temp_dir = os.environ.get('LOCALAPPDATA', tempfile.gettempdir())
    TMP_PATH = os.path.join(base_temp_dir, f"melo_tts_worker_en_{os.getpid()}")
    os.makedirs(TMP_PATH, exist_ok=True)
except Exception:
    sys.exit(1)

# --- 유틸리티 함수 ---
def pick_speaker_id(tts):
    spk2id = getattr(tts.hps.data, "spk2id", {})
    for k, v in spk2id.items():
        if "EN-US" in str(k).upper(): return int(v)
    return int(next(iter(spk2id.values()), 0))

def split_chunks(text: str, first_len=50, rest_len=250):
    """
    [수정] 영어 문장도 끊김 방지를 위해 '계단식 증가(Ramp-up)' 적용.
    50자 -> 100자 -> 150자... 순서로 늘려가며 버퍼링을 없앱니다.
    """
    chunks = []
    cur_text = text.strip()

    # 1. 가변 목표 길이 (초기값은 짧게)
    current_target_len = first_len

    while cur_text:
        # 남은 텍스트가 목표보다 짧으면 통째로 처리
        if len(cur_text) <= current_target_len:
            if cur_text: chunks.append(cur_text)
            break

        candidate = cur_text[:current_target_len]
        min_threshold = int(current_target_len * 0.4)
        split_idx = -1

        # --- 영어 전용 자르기 로직 ---

        # [1순위] 문장 종결 (. ? ! : 개행)
        # 영어는 콜론(:)도 중요한 휴지부입니다.
        match = re.search(r'[.?!:\n](?=[^.?!:\n]*$)', candidate)
        if match and match.end() > min_threshold: split_idx = match.end()

        # [2순위] 중간 쉼표 (, ;)
        if split_idx == -1:
            match = re.search(r'[,;](?=[^,;]*$)', candidate)
            if match and match.end() > min_threshold: split_idx = match.end()

        # [3순위] 공백 (단어 단위 절단)
        if split_idx == -1:
            last_space = candidate.rfind(' ')
            if last_space > min_threshold: split_idx = last_space

        # [4순위] 강제 절단
        if split_idx == -1: split_idx = current_target_len

        # --- 조각 저장 ---
        chunk = cur_text[:split_idx].strip()
        if chunk: chunks.append(chunk)

        cur_text = cur_text[split_idx:].strip()

        # ▼▼▼ [핵심] 다음 청크 길이를 서서히 늘림 (급발진 방지) ▼▼▼
        # 이렇게 해야 AI가 생성하는 시간을 벌어줄 수 있습니다.
        if current_target_len < rest_len:
            current_target_len = min(rest_len, current_target_len + 50)

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

# --- 워커 함수 ---

def synth_worker(tts, spk_id, in_q, play_q, stop_evt, interrupt_evt, tmpdir, target_sr, wid, cache, lock):
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

                    # [수정] int16 변환 제거 -> float32 원본 그대로 사용 (SoundDevice 최적화)
                    audio_data_tuple = (target_sr, audio)

                    with lock:
                        cache[cache_key] = audio_data_tuple
                    play_q.put(audio_data_tuple)
                except Exception as e:
                    print(f"[SYNTH-{wid}][ERR] Synth failed: {e}", flush=True)
        except queue.Empty:
            continue
    print(f"[SYNTH-{wid}] Worker stopped.", flush=True)

def play_worker(play_q, stop_evt, interrupt_evt, signal_q):
    """
    [Gapless Streaming + Instant Stop]
    OutputStream을 쓰되, 멈춤 신호에 즉각 반응하도록 데이터를 잘게 쪼개서 씁니다.
    """
    print("[PLAY] Worker started (Responsive Stream).", flush=True)

    # 44100Hz (영어는 24000으로 수정 필요), float32, 블록사이즈 최적화
    # 영어 파일 수정 시에는 아래 44100을 24000으로 바꾸세요!
    current_sr = 24000
    stream = sd.OutputStream(samplerate=current_sr, channels=1, dtype='float32', blocksize=1024)
    stream.start()

    start_signal_sent = False

    # 한 번에 스피커로 밀어넣을 조각 크기 (프레임 수)
    # 2048 프레임은 44.1kHz 기준 약 0.046초 -> 0.05초마다 멈춤 체크함 (반응 속도 매우 빠름)
    WRITE_CHUNK_SIZE = 2048

    try:
        while not stop_evt.is_set():
            # [1] 대기 상태에서 중단 체크
            if interrupt_evt.is_set():
                # 즉시 정지 로직 실행
                stream.stop()
                while not play_q.empty():
                    try: play_q.get_nowait()
                    except queue.Empty: break
                signal_q.put(b"DONE\n")
                interrupt_evt.clear()
                start_signal_sent = False
                stream.start() # 재시작
                time.sleep(0.01)
                continue

            try:
                item = play_q.get(timeout=0.02)
                if item is None: break

                target_sr, audio_data = item

                # 샘플레이트 변경 시 스트림 재설정
                if target_sr != current_sr:
                    current_sr = target_sr
                    stream.stop()
                    stream.close()
                    stream = sd.OutputStream(samplerate=current_sr, channels=1, dtype='float32', blocksize=1024)
                    stream.start()

                if not start_signal_sent:
                    signal_q.put(b"START\n")
                    start_signal_sent = True

                # ▼▼▼ [핵심 수정] 데이터를 잘게 쪼개서 쓰며 감시하기 ▼▼▼
                total_len = len(audio_data)
                current_pos = 0

                stop_detected = False

                while current_pos < total_len:
                    # 1. 도중에 멈춤 신호가 왔는지 체크
                    if interrupt_evt.is_set():
                        stop_detected = True
                        break # 내부 루프 탈출 -> 즉시 멈춤 로직으로 이동

                    # 2. 작은 조각만큼만 재생
                    end_pos = min(current_pos + WRITE_CHUNK_SIZE, total_len)
                    chunk = audio_data[current_pos:end_pos]
                    stream.write(chunk) # 0.05초만큼만 블로킹됨
                    current_pos = end_pos

                # 멈춤 신호가 감지되었다면, 위쪽의 메인 루프 [1]번 로직이 처리하도록 continue
                if stop_detected:
                    continue
                    # ▲▲▲ [수정 끝] ▲▲▲

                # 큐가 비었고 재생이 끝났다면 완료 신호
                if play_q.empty():
                    signal_q.put(b"DONE\n")
                    start_signal_sent = False

            except queue.Empty:
                continue
            except Exception as e:
                print(f"[PLAY] Error: {e}", flush=True)
                try:
                    stream.stop()
                    stream.close()
                    stream = sd.OutputStream(samplerate=current_sr, channels=1, dtype='float32', blocksize=1024)
                    stream.start()
                except: pass

    finally:
        try:
            stream.stop()
            stream.close()
        except: pass
        print("[PLAY] Worker stopped.", flush=True)

def run_pipe_loop(in_q, stop_evt, interrupt_evt, signal_q):
    print("[PIPE] Worker started with Smart Buffering (EN).", flush=True)
    re_end = re.compile(r'[.?!:\n]')
    re_comma = re.compile(r'[,;]')
    text_buffer = ""

    while not stop_evt.is_set():
        handle = None
        try:
            handle = win32pipe.CreateNamedPipe(PIPE_NAME, win32con.PIPE_ACCESS_DUPLEX,
                                               win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
                                               1, 65536, 65536, 0, None)
            win32pipe.ConnectNamedPipe(handle, None)

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

                            if command == "stop":
                                sd.stop() # [추가] 즉시 소리 끔
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
                                if text.strip().lower() == "stop":
                                    sd.stop() # [추가] 즉시 소리 끔
                                    while not in_q.empty(): in_q.get_nowait()
                                    interrupt_evt.set()
                                    text_buffer = ""
                                    continue

                                text_buffer += text
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

                        except json.JSONDecodeError: pass

                except pywintypes.error as e:
                    if e.winerror in [109, 232]: break
                    else: raise
        except Exception as e:
            print(f"[PIPE] Error: {e}", flush=True)
            time.sleep(1)
        finally:
            if handle: win32file.CloseHandle(handle)

def warmup(tts, spk_id, target_sr, tmpdir):
    try:
        print("[WARMUP] 시작", flush=True)
        sr, audio_float = synth_to_numpy(tts, "Warming up.", spk_id, 1.0, tmpdir, target_sr)
        if audio_float.size > 0:
            # [수정] SoundDevice로 워밍업 재생
            sd.play(audio_float * GAIN_MULTIPLIER * 0.5, sr)
            sd.wait()
        print("[WARMUP] 완료", flush=True)
    except Exception as e:
        print(f"[WARMUP][WARN] {e}", flush=True)

def main():
    print("[INIT] Starting TTS EN Worker (SoundDevice)...", flush=True)
    in_q, play_q, signal_q = queue.Queue(), queue.Queue(), queue.Queue(maxsize=10)
    stop_evt, interrupt_evt = threading.Event(), threading.Event()
    th_pipe = threading.Thread(target=run_pipe_loop, args=(in_q, stop_evt, interrupt_evt, signal_q), daemon=True)
    th_pipe.start()

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

    th_play = threading.Thread(target=play_worker, args=(play_q, stop_evt, interrupt_evt, signal_q), daemon=True)
    th_play.start()
    workers = []
    for wid in range(N_SYNTH_WORKERS):
        th = threading.Thread(target=synth_worker, args=(tts, spk_id, in_q, play_q, stop_evt, interrupt_evt, tmpdir, target_sr, wid, AUDIO_CACHE, CACHE_LOCK), daemon=True)
        th.start()
        workers.append(th)

    try:
        while not stop_evt.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt: pass
    finally:
        stop_evt.set()
        for _ in workers: in_q.put(None)
        play_q.put(None)
        try:
            handle = win32file.CreateFile(PIPE_NAME, win32con.GENERIC_WRITE, 0, None, win32con.OPEN_EXISTING, 0, None)
            win32file.CloseHandle(handle)
        except Exception: pass
        sd.stop() # 최종 오디오 중단
        shutil.rmtree(TMP_PATH, ignore_errors=True)
        print("[EXIT] Shutdown complete.", flush=True)

if __name__ == "__main__":
    main()