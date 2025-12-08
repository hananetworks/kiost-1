# -*- coding: utf-8 -*-
"""
로컬 IPC 워커 - Windows Named Pipe (한국어 TTS)
- 파이프명: \\.\pipe\melo_tts
- MeCab 형태소 분석기 경로 동적 설정
- [Update] SimpleAudio 제거 -> SoundDevice 적용
- [Update] Eunjeon 제거 -> mecab-ko-dic 단독 사용
"""

import os, sys, re, time, json, queue, threading, tempfile, shutil, uuid
import numpy as np
import traceback
import warnings
import logging
warnings.filterwarnings("ignore")
logging.getLogger("transformers").setLevel(logging.ERROR)

AUDIO_CACHE = {}
CACHE_LOCK = threading.Lock()
PIPE_NAME = r"\\.\pipe\melo_tts"
SPEED = 1.3
N_SYNTH_WORKERS = 2

IS_PACKAGED = (len(sys.argv) > 1 and sys.argv[1] == 'packaged')
print(f"[INIT] IS_PACKAGED flag set to: {IS_PACKAGED}", flush=True)

try:
    if IS_PACKAGED:
        if len(sys.argv) > 2:
            BASE_PATH = sys.argv[2]
            # [수정] Eunjeon 관련 로직 제거하고 표준 Mecab 경로만 설정
            mecab_dic_path = os.path.join(BASE_PATH, 'mecab_ko_dic')
            print(f"[INIT] Configured MeCab path: {mecab_dic_path}", flush=True)
            # MeloTTS는 내부적으로 mecab-python3를 쓰며, mecab_ko_dic이 설치되어 있으면 자동으로 찾습니다.
            # 만약 환경변수 설정이 필요하다면 여기에 추가합니다.
            os.environ["MECAB_KO_DIC_PATH"] = mecab_dic_path
        else:
            sys.exit(1)
except Exception as e:
    print(f"[INIT][WARN] MeCab Config Error: {e}", flush=True)

os.environ['HUGGINGFACE_HUB_DISABLE_SYMLINKS'] = '1'
try:
    local_app_data = os.environ.get('LOCALAPPDATA', '.')
    hf_cache_path = os.path.join(local_app_data, 'MeloTTS_Cache', 'huggingface', 'hub')
    os.makedirs(hf_cache_path, exist_ok=True)
    os.environ['HF_HOME'] = hf_cache_path
except Exception:
    sys.exit(1)

# [수정] SimpleAudio 제거 -> SoundDevice 추가
try:
    import win32pipe, win32file, win32con, pywintypes
    import sounddevice as sd
    from melo.api import TTS
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
    TMP_PATH = os.path.join(base_temp_dir, f"melo_tts_worker_kr_{os.getpid()}")
    os.makedirs(TMP_PATH, exist_ok=True)
except Exception:
    sys.exit(1)

def pick_speaker_id(tts):
    spk2id = getattr(tts.hps.data, "spk2id", {})
    for k, v in spk2id.items():
        if any(tag in str(k).upper() for tag in ("KR", "KO")): return int(v)
    return int(next(iter(spk2id.values()), 0))

def split_chunks(text: str, first_len=60, rest_len=300):
    chunks = []
    cur_text = text.strip()
    target_len = first_len

    while cur_text:
        if len(cur_text) <= target_len:
            if cur_text: chunks.append(cur_text)
            break

        candidate = cur_text[:target_len]
        min_threshold = int(target_len * 0.4)
        split_idx = -1

        match = re.search(r'[.?!。？！\n](?=[^.?!。？！\n]*$)', candidate)
        if match and match.end() > min_threshold: split_idx = match.end()

        if split_idx == -1:
            match = re.search(r'[,;、，](?=[^,;、，]*$)', candidate)
            if match and match.end() > min_threshold: split_idx = match.end()

        if split_idx == -1:
            last_space = candidate.rfind(' ')
            if last_space > min_threshold: split_idx = last_space

        if split_idx == -1: split_idx = target_len

        chunk = cur_text[:split_idx].strip()
        if chunk: chunks.append(chunk)
        cur_text = cur_text[split_idx:].strip()
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
                    # [수정] int16 변환 제거 -> float32 원본 사용
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
    """[수정] SoundDevice 기반 재생 워커"""
    print("[PLAY] Worker started (SoundDevice).", flush=True)
    start_signal_sent = False

    while not stop_evt.is_set():
        if interrupt_evt.is_set():
            sd.stop() # [핵심] 즉시 중단
            while not play_q.empty(): play_q.get_nowait()
            signal_q.put(b"DONE\n")
            interrupt_evt.clear()
            start_signal_sent = False
            time.sleep(0.02)
            continue

        try:
            item = play_q.get(timeout=0.05)
            if item is None: break
            sr, audio_data = item

            if not start_signal_sent:
                signal_q.put(b"START\n")
                start_signal_sent = True

            sd.play(audio_data, sr)
            sd.wait() # 재생 끝날 때까지 대기

            if not interrupt_evt.is_set() and play_q.empty():
                signal_q.put(b"DONE\n")
                start_signal_sent = False
        except queue.Empty:
            continue
        except Exception as e:
            print(f"[PLAY] Error: {e}", flush=True)

    sd.stop()
    print("[PLAY] Worker stopped.", flush=True)

def run_pipe_loop(in_q, stop_evt, interrupt_evt, signal_q):
    print("[PIPE] Worker started with Smart Buffering (KR).", flush=True)
    re_end = re.compile(r'[.?!。？！\n]')
    re_comma = re.compile(r'[,;、，]')
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
        sr, audio_float = synth_to_numpy(tts, "워밍업입니다.", spk_id, 1.0, tmpdir, target_sr)
        if audio_float.size > 0:
            sd.play(audio_float * 0.5, sr)
            sd.wait()
        print("[WARMUP] 완료", flush=True)
    except Exception as e:
        print(f"[WARMUP][WARN] {e}", flush=True)

def main():
    print("[INIT] Starting TTS KR Worker (SoundDevice)...", flush=True)
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
        sd.stop()
        shutil.rmtree(TMP_PATH, ignore_errors=True)
        print("[EXIT] Shutdown complete.", flush=True)

if __name__ == "__main__":
    main()