# -*- coding: utf-8 -*-
"""
로컬 IPC 워커 - Windows Named Pipe (한국어 TTS)
- 파이프명: \\.\pipe\melo_tts
- MeCab 형태소 분석기 경로를 패키징 환경에 맞게 동적으로 설정합니다.
- TTS 결과를 캐싱하여 반복적인 요청에 빠르게 응답합니다.
"""

import os, sys, re, time, json, queue, threading, tempfile, shutil, uuid
import numpy as np
import traceback



# --- 전역 변수 및 설정 ---
AUDIO_CACHE = {}
CACHE_LOCK = threading.Lock()
PIPE_NAME = r"\\.\pipe\melo_tts"
SPEED = 1.3
N_SYNTH_WORKERS = 2

# main.js에서 전달한 인수로 배포 모드(packaged) 여부 확인
IS_PACKAGED = (len(sys.argv) > 1 and sys.argv[1] == 'packaged')
print(f"[INIT] IS_PACKAGED flag set to: {IS_PACKAGED}", flush=True)

# MeCab (한국어 형태소 분석기) 경로 설정
try:
    if IS_PACKAGED:
        if len(sys.argv) > 2:
            BASE_PATH = sys.argv[2] # main.js에서 전달한 resourcesPath
            mecab_dic_path = os.path.join(BASE_PATH, 'mecab_ko_dic')
            mecabrc_path = os.path.join(mecab_dic_path, 'dicdir', 'mecabrc')
            eunjeon_dic_path = os.path.join(mecab_dic_path, 'dicdir')

            if os.path.exists(mecabrc_path):
                # eunjeon 라이브러리가 내장된 mecabrc 대신, 패키징된 사전 경로를 사용하도록 강제
                import eunjeon
                eunjeon_mecabrc_path = os.path.join(os.path.dirname(eunjeon.__file__), 'data', 'mecabrc')
                mecabrc_content = f'dicdir = {eunjeon_dic_path}\n'
                os.makedirs(os.path.dirname(eunjeon_mecabrc_path), exist_ok=True)
                with open(eunjeon_mecabrc_path, 'w', encoding='utf-8') as f:
                    f.write(mecabrc_content)
                print(f"[INIT] Patched 'eunjeon/data/mecabrc' to use packaged dictionary.", flush=True)
        else:
            print("[INIT][FATAL] Packaged mode but BASE_PATH not provided.", flush=True)
            sys.exit(1)
    else: # 개발 모드
        print("[INIT] Debug Mode. Relying on default 'mecab-ko-dic' package.", flush=True)
except Exception as e:
    print(f"[INIT][WARN] Failed to configure MeCab for Korean TTS: {e}", flush=True)


# HuggingFace 라이브러리 설정
os.environ['HUGGINGFACE_HUB_DISABLE_SYMLINKS'] = '1'
try: # 캐시 폴더 설정
    local_app_data = os.environ.get('LOCALAPPDATA', '.')
    hf_cache_path = os.path.join(local_app_data, 'MeloTTS_Cache', 'huggingface', 'hub')
    os.makedirs(hf_cache_path, exist_ok=True)
    os.environ['HF_HOME'] = hf_cache_path
    os.environ['HUGGINGFACE_HUB_CACHE'] = hf_cache_path
except Exception as e:
    print(f"[FATAL] Failed to set cache env: {e}", flush=True)
    sys.exit(1)

# 필수 라이브러리 임포트
try:
    import win32pipe, win32file, win32con, pywintypes
    import simpleaudio as sa
    from melo.api import TTS
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
    TMP_PATH = os.path.join(base_temp_dir, f"melo_tts_worker_{os.getpid()}")
    os.makedirs(TMP_PATH, exist_ok=True)
    print(f"[INIT] Using temporary directory: {TMP_PATH}", flush=True)
except Exception as e:
    print(f"FATAL: Failed to create temporary directory: {e}", flush=True)
    sys.exit(1)

# --- 오디오 처리 유틸리티 함수들 ---
def pick_speaker_id(tts):
    spk2id = getattr(tts.hps.data, "spk2id", {})
    for k, v in spk2id.items():
        if any(tag in str(k).upper() for tag in ("KR", "KO")): return int(v)
    return int(next(iter(spk2id.values()), 0))

def split_chunks(text: str, first_len=60, rest_len=300):
    chunks = []
    cur_text = text.strip()

    # 1. 처음 목표 길이는 짧게(60자) 잡아서 반응 속도 확보
    target_len = first_len

    while cur_text:
        # 남은 텍스트가 목표 길이보다 짧으면 통째로 넣고 끝냄
        if len(cur_text) <= target_len:
            if cur_text:
                chunks.append(cur_text)
            break

        # 목표 길이만큼 후보군을 가져옴
        candidate = cur_text[:target_len]

        # [핵심] 최소 길이 안전장치 (목표 길이의 40% 이상은 말하고 끊기)
        # 예: 300자 설정이면 적어도 120자는 말한 뒤에 나오는 쉼표에서 끊음
        min_threshold = int(target_len * 0.4)
        split_idx = -1

        # --- 스마트 자르기 로직 (모든 구간에 적용) ---

        # (1순위) 문장 종결 부호 (. ? ! \n)
        match = re.search(r'[.?!。？！\n](?=[^.?!。？！\n]*$)', candidate)
        if match and match.end() > min_threshold:
            split_idx = match.end()

        # (2순위) 중간 부호 (, ; 등) - 종결 부호가 없으면 여기서 자름
        if split_idx == -1:
            match = re.search(r'[,;、，](?=[^,;、，]*$)', candidate)
            if match and match.end() > min_threshold:
                split_idx = match.end()

        # (3순위) 공백 (어절 단위) - 부호가 아예 없으면 공백에서라도 자름
        if split_idx == -1:
            last_space = candidate.rfind(' ')
            if last_space > min_threshold:
                split_idx = last_space

        # (4순위) 아무것도 못 찾으면 강제로 자름 (매우 드문 케이스)
        if split_idx == -1:
            split_idx = target_len

        # --- 스마트 자르기 로직 끝 ---

        # 잘린 조각 저장
        chunk = cur_text[:split_idx].strip()
        if chunk:
            chunks.append(chunk)

        # 남은 텍스트 업데이트 (처리한 앞부분 날리기)
        cur_text = cur_text[split_idx:].strip()

        # ★ 핵심: 첫 턴(60자)이 끝나면 그 다음부터는 목표 길이를 300(rest_len)으로 늘림
        # 이렇게 해야 뒷부분은 길게 길게 생성해서 끊김(버퍼링)을 방지함
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
    tmp_path = os.path.join(tmpdir, f"melo_kr_{uuid.uuid4().hex}.wav")
    try:
        tts.tts_to_file(text, speaker_id, tmp_path, speed=speed)
        src_sr, audio = read_wav_as_float(tmp_path)
    finally:
        if os.path.exists(tmp_path): os.remove(tmp_path)
    audio = resample_if_needed(audio, src_sr, target_sr)
    return target_sr, fade_in_out(audio, target_sr)

# --- 스레드 워커 함수들 (tts_worker_pipe_en.py와 로직 동일) ---

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
                cache_key = f"{seg}|{spk_id}|{SPEED}"
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
                    audio_int16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
                    audio_data_tuple = (target_sr, audio_int16.tobytes())
                    with lock:
                        cache[cache_key] = audio_data_tuple
                    play_q.put(audio_data_tuple)
                except Exception as e:
                    print(f"[SYNTH-{wid}][ERR] Synth failed for «{seg}»: {e}", flush=True)
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
    """Windows Named Pipe 통신 (조각난 텍스트 버퍼링 기능 추가)"""
    print("[PIPE] Worker started with Smart Buffering.", flush=True)

    # 문장 종결 패턴 (마침표, 물음표, 느낌표, 개행)
    re_end = re.compile(r'[.?!。？！\n]')
    # 쉼표 패턴 (보조 절단용)
    re_comma = re.compile(r'[,;、，]')

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
        sr, audio_float = synth_to_numpy(tts, "워밍업입니다.", spk_id, 1.0, tmpdir, target_sr)
        if audio_float.size > 0:
            # ⬇️ GAIN_MULTIPLIER가 없는 원본 0.5 사용
            audio_int16 = (np.clip(audio_float * 0.5, -1.0, 1.0) * 32767.0).astype(np.int16)
            sa.play_buffer(audio_int16.tobytes(), 1, 2, sr).wait_done()
        print("[WARMUP] 완료", flush=True)
    except Exception as e:
        print(f"[WARMUP][WARN] {e}", flush=True)

# --- 메인 실행 ---
def main():
    print("[INIT] Starting TTS KR Worker...", flush=True)

    in_q, play_q, signal_q = queue.Queue(), queue.Queue(), queue.Queue(maxsize=10)
    stop_evt, interrupt_evt = threading.Event(), threading.Event()
    th_pipe = threading.Thread(target=run_pipe_loop, args=(in_q, stop_evt, interrupt_evt, signal_q), daemon=True)
    th_pipe.start()

    try:
        print("[INIT] Loading MeloTTS KR model...", flush=True)
        tts = TTS(language="KR", device="auto")
        spk_id = pick_speaker_id(tts)
        target_sr = int(getattr(tts.hps.data, "sampling_rate", 44100))
        print(f"[INIT] Model loaded. SpkID={spk_id}, SR={target_sr}", flush=True)
    except Exception as e:
        print(f"[INIT][FATAL] Failed to load model: {e}", flush=True)
        stop_evt.set()
        sys.exit(1)

    warmup(tts, spk_id, target_sr, TMP_PATH)
    tmpdir = tempfile.mkdtemp(prefix="_melo_run_kr_", dir=TMP_PATH)

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
        for _ in workers: in_q.put(None)
        play_q.put((0, None))
        try:
            handle = win32file.CreateFile(PIPE_NAME, win32con.GENERIC_WRITE, 0, None, win32con.OPEN_EXISTING, 0, None)
            win32file.CloseHandle(handle)
        except Exception: pass
        for th in workers + [th_play, th_pipe]: th.join(timeout=2.0)
        shutil.rmtree(TMP_PATH, ignore_errors=True)
        print("[EXIT] Shutdown complete.", flush=True)

if __name__ == "__main__":
    main()