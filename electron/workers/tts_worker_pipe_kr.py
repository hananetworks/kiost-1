# -*- coding: utf-8 -*-
"""
로컬 IPC 워커 - Windows Named Pipe (한국어 TTS)
- 파이프명: \\.\pipe\melo_tts
- MeCab 형태소 분석기 경로 동적 설정
- [Update] SimpleAudio 제거 -> SoundDevice 적용 (고속 재생)
- [Update] Eunjeon 제거 -> Mecab-ko로 런타임 교체 (Monkey Patch)
"""

import os, sys, re, time, json, queue, threading, tempfile, shutil, uuid
import numpy as np
import traceback
import warnings
import logging

# 경고 및 로그 끄기
warnings.filterwarnings("ignore")
logging.getLogger("transformers").setLevel(logging.ERROR)

# ==============================================================================
# ✅ [긴급 패치] MeloTTS가 Eunjeon을 찾을 때 Mecab으로 바꿔치기 (Monkey Patch v2)
# ==============================================================================
try:
    import types
    import sys
    import importlib.util

    # 1. Mecab 라이브러리(mecab-python3) 임포트
    import MeCab

    # 2. Eunjeon의 Mecab 클래스를 흉내내는 어댑터 클래스 정의
    class DummyMecab:
        def __init__(self, dicpath=None):
            # mecab-python3는 dicpath를 -d 옵션으로 받습니다.
            arg = f'-d "{dicpath}"' if dicpath else ''
            try:
                self.tagger = MeCab.Tagger(arg)
            except Exception:
                # 인자가 실패하면 기본값으로 재시도
                self.tagger = MeCab.Tagger('')

        def pos(self, text):
            # Mecab의 parse 결과를 Eunjeon의 pos 결과[(단어, 품사), ...]로 변환
            if not text: return []
            try:
                nodes = self.tagger.parse(text)
                result = []
                if not nodes: return []

                for line in nodes.split('\n'):
                    if '\t' in line:
                        word, feature = line.split('\t')
                        pos_tag = feature.split(',')[0]
                        result.append((word, pos_tag))
                return result
            except Exception:
                return []

        def morphs(self, text):
            return [p[0] for p in self.pos(text)]

    # 3. 더 완벽한 가짜 모듈 생성 (spec 포함)
    spec = importlib.util.spec_from_loader("eunjeon", loader=None)
    dummy_eunjeon = importlib.util.module_from_spec(spec)

    # 4. 필수 속성 채워넣기 (에러 방지용)
    dummy_eunjeon.__spec__ = spec
    dummy_eunjeon.__file__ = "dummy_eunjeon.py" # 가짜 파일 경로
    dummy_eunjeon.__path__ = [] # 패키지처럼 보이게 함
    dummy_eunjeon.__name__ = "eunjeon"
    dummy_eunjeon.Mecab = DummyMecab

    # 5. 시스템 모듈 목록에 등록
    sys.modules["eunjeon"] = dummy_eunjeon
    print("[INIT] Patched 'eunjeon' module with 'mecab-python3' (Full Spec)", flush=True)

except Exception as e:
    print(f"[INIT][WARN] Failed to patch eunjeon: {e}", flush=True)
# ==============================================================================


AUDIO_CACHE = {}
CACHE_LOCK = threading.Lock()
PIPE_NAME = r"\\.\pipe\melo_tts"
SPEED = 1.3
N_SYNTH_WORKERS = 2

# main.js에서 전달한 인수로 배포 모드(packaged) 여부 확인
IS_PACKAGED = (len(sys.argv) > 1 and sys.argv[1] == 'packaged')
print(f"[INIT] IS_PACKAGED flag set to: {IS_PACKAGED}", flush=True)

# MeCab 사전 경로 설정
try:
    if IS_PACKAGED:
        if len(sys.argv) > 2:
            BASE_PATH = sys.argv[2] # resourcesPath
            mecab_dic_path = os.path.join(BASE_PATH, 'mecab_ko_dic')
            print(f"[INIT] Configured MeCab path: {mecab_dic_path}", flush=True)

            # 환경 변수에 사전 경로 등록 (mecab-python3가 참조할 수도 있음)
            os.environ["MECAB_KO_DIC_PATH"] = mecab_dic_path

            # [중요] 위에서 만든 Monkey Patch 클래스가 이 경로를 쓰도록 유도하려면
            # MeloTTS 초기화 시점에 경로가 잘 전달되어야 함.
        else:
            sys.exit(1)
except Exception as e:
    print(f"[INIT][WARN] MeCab Config Error: {e}", flush=True)

# HuggingFace 설정
os.environ['HUGGINGFACE_HUB_DISABLE_SYMLINKS'] = '1'
try:
    local_app_data = os.environ.get('LOCALAPPDATA', '.')
    hf_cache_path = os.path.join(local_app_data, 'MeloTTS_Cache', 'huggingface', 'hub')
    os.makedirs(hf_cache_path, exist_ok=True)
    os.environ['HF_HOME'] = hf_cache_path
except Exception:
    sys.exit(1)

# [필수 라이브러리] simpleaudio -> sounddevice 교체 완료
try:
    import win32pipe, win32file, win32con, pywintypes
    import sounddevice as sd
    from melo.api import TTS
    from scipy.io import wavfile as sci_wav
except ImportError as e:
    print(f"FATAL: 필수 라이브러리 로딩 실패: {e}", flush=True)
    sys.exit(1)

# 인코딩 설정
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception: pass

# 임시 폴더
try:
    base_temp_dir = os.environ.get('LOCALAPPDATA', tempfile.gettempdir())
    TMP_PATH = os.path.join(base_temp_dir, f"melo_tts_worker_kr_{os.getpid()}")
    os.makedirs(TMP_PATH, exist_ok=True)
except Exception:
    sys.exit(1)

# --- 유틸리티 함수 ---
def pick_speaker_id(tts):
    spk2id = getattr(tts.hps.data, "spk2id", {})
    for k, v in spk2id.items():
        if any(tag in str(k).upper() for tag in ("KR", "KO")): return int(v)
    return int(next(iter(spk2id.values()), 0))

def split_chunks(text: str, first_len=50, rest_len=250):
    chunks = []
    cur_text = text.strip()

    # 1. 시작은 반응 속도를 위해 아주 짧게 (50자)
    current_target_len = first_len

    while cur_text:
        # 남은 텍스트가 목표보다 짧으면 그냥 처리
        if len(cur_text) <= current_target_len:
            if cur_text: chunks.append(cur_text)
            break

        candidate = cur_text[:current_target_len]
        min_threshold = int(current_target_len * 0.4) # 최소 40%는 채우기
        split_idx = -1

        # [우선순위 1] 문장 종결 부호
        match = re.search(r'[.?!。？！\n](?=[^.?!。？！\n]*$)', candidate)
        if match and match.end() > min_threshold: split_idx = match.end()

        # [우선순위 2] 쉼표 (중간 호흡)
        if split_idx == -1:
            match = re.search(r'[,;、，](?=[^,;、，]*$)', candidate)
            if match and match.end() > min_threshold: split_idx = match.end()

        # [우선순위 3] 공백
        if split_idx == -1:
            last_space = candidate.rfind(' ')
            if last_space > min_threshold: split_idx = last_space

        # 못 찾으면 강제 절단
        if split_idx == -1: split_idx = current_target_len

        chunk = cur_text[:split_idx].strip()
        if chunk: chunks.append(chunk)

        cur_text = cur_text[split_idx:].strip()

        # ▼▼▼ [핵심 변경] 다음 청크 길이를 계단식으로 늘림 (급발진 방지) ▼▼▼
        # 예: 50 -> 100 -> 150 -> 200 -> 250 (최대)
        # 이렇게 해야 앞부분 재생하는 동안 뒷부분을 여유 있게 만들 수 있음
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
    tmp_path = os.path.join(tmpdir, f"melo_kr_{uuid.uuid4().hex}.wav")
    try:
        tts.tts_to_file(text, speaker_id, tmp_path, speed=speed)
        src_sr, audio = read_wav_as_float(tmp_path)
    finally:
        if os.path.exists(tmp_path): os.remove(tmp_path)
    audio = resample_if_needed(audio, src_sr, target_sr)
    return target_sr, fade_in_out(audio, target_sr)

# --- 워커 스레드 ---

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

                    # [최적화] int16 변환 없이 float32 원본 그대로 전달 (SoundDevice용)
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
    current_sr = 44100
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
                                sd.stop()
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
                                    sd.stop()
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
    print("[INIT] Starting TTS KR Worker (SoundDevice & MecabPatch)...", flush=True)
    in_q, play_q, signal_q = queue.Queue(), queue.Queue(), queue.Queue(maxsize=10)
    stop_evt, interrupt_evt = threading.Event(), threading.Event()
    th_pipe = threading.Thread(target=run_pipe_loop, args=(in_q, stop_evt, interrupt_evt, signal_q), daemon=True)
    th_pipe.start()

    try:
        print("[INIT] Loading MeloTTS KR model...", flush=True)
        # 패치 덕분에 eunjeon 없이도 Mecab을 써서 로딩됨
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