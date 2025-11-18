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

def split_chunks(text: str, first_len=60, rest_len=250):
    text = text.strip()
    if not text: return []
    if len(text) <= first_len: return [text]
    chunks = [text[:first_len]]
    remain = text[first_len:]
    parts = [p for p in re.split(r'([.?!。？！,;、，])', remain) if p]
    buf, out = "", []
    for p in parts:
        buf += p
        if re.search(r'[.?!。？！,;、，]$', p) or len(buf) >= rest_len:
            out.append(buf.strip())
            buf = ""
    if buf.strip(): out.append(buf.strip())
    return [c for c in chunks + out if c]

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
    """Windows Named Pipe를 통해 main.js와 통신하는 메인 루프"""
    print("[PIPE] Worker started.", flush=True)
    while not stop_evt.is_set():
        handle = None
        try:
            handle = win32pipe.CreateNamedPipe(PIPE_NAME, win32con.PIPE_ACCESS_DUPLEX,
                                               win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
                                               1, 65536, 65536, 0, None)
            print(f"[PIPE] Pipe created. Waiting for client on {PIPE_NAME}...", flush=True)
            win32pipe.ConnectNamedPipe(handle, None)
            print("[PIPE] Client Connected", flush=True)
            buf = b""
            while not stop_evt.is_set():
                try: # 신호 전송
                    signal = signal_q.get_nowait()
                    win32file.WriteFile(handle, signal)
                except queue.Empty: pass
                except pywintypes.error: break
                try: # 데이터 수신
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
                                while not in_q.empty(): in_q.get_nowait()
                                interrupt_evt.set()
                            elif command == "quit":
                                stop_evt.set()
                                break
                            elif text:
                                if interrupt_evt.is_set(): interrupt_evt.clear()
                                in_q.put(text)
                        except json.JSONDecodeError:
                            if line == "/quit": stop_evt.set()
                except pywintypes.error as e:
                    if e.winerror in [109, 232]: break # 클라이언트 연결 끊김
                    else: raise
        except Exception as e:
            print(f"[PIPE] Error: {e}", flush=True)
            time.sleep(1)
        finally:
            if handle: win32file.CloseHandle(handle)
            print("[PIPE] Connection loop reset.", flush=True)
    print("[PIPE] Worker stopped.", flush=True)

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