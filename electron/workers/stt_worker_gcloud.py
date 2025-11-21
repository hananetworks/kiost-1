# -*- coding: utf-8 -*-
"""
로컬 IPC 워커 (STT) - Windows Named Pipe - [Google Cloud Speech-to-Text]
- 파이프명: \\.\pipe\stt_whisper
- main.js로부터 GOOGLE_APPLICATION_CREDENTIALS 환경 변수를 상속받아 사용합니다.
"""

import os, sys, time, json, queue, threading, base64, traceback
import pywintypes, win32pipe, win32file, win32con



# 구글 클라이언트 라이브러리 임포트
try:
    from google.cloud import speech
except ImportError:
    print("FATAL: google-cloud-speech 라이브러리가 필요합니다.", flush=True)
    sys.exit(1)

# --- 설정 ---
PIPE_NAME = r"\\.\pipe\stt_whisper"
SAMPLE_RATE = 16000

# UTF-8 인코딩 설정
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception: pass


def google_stt_worker(transcribe_q: queue.Queue, signal_q: queue.Queue, stop_evt: threading.Event):
    """오디오 청크/명령을 받아 Google STT 스트림을 관리하는 워커 스레드"""
    print(f"[STT] Worker started.", flush=True)
    stt_thread = None
    audio_chunk_queue = None

    def _stt_generator(q: queue.Queue):
        """오디오 청크 큐에서 데이터를 뽑아 Google STT API로 yield하는 제너레이터"""
        while True:
            chunk = q.get()
            if chunk is None: return # 스트림 종료 신호
            yield speech.StreamingRecognizeRequest(audio_content=chunk)

    def _run_stt_stream(q: queue.Queue, sig_q: queue.Queue, lang_code: str):
        """실제 Google STT API를 호출하고 응답을 처리하는 내부 스레드"""
        print(f"[STT] Internal STT thread started for language: {lang_code}", flush=True)
        try:
            client = speech.SpeechClient()
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=SAMPLE_RATE,
                language_code=lang_code,
                enable_automatic_punctuation=True,
                model="latest_long"
            )
            streaming_config = speech.StreamingRecognitionConfig(
                config=config,
                interim_results=True # 중간 결과 받기
            )
            responses = client.streaming_recognize(streaming_config, _stt_generator(q))

            # 응답 처리 루프
            for response in responses:
                if not response.results or not response.results[0].alternatives:
                    continue
                result = response.results[0]
                transcript = result.alternatives[0].transcript.strip()

                if result.is_final:
                    response_data = {"type": "result", "text": transcript}
                    sig_q.put(json.dumps(response_data, ensure_ascii=False).encode("utf-8") + b"\n")
                else:
                    response_data = {"type": "interim", "text": transcript}
                    sig_q.put(json.dumps(response_data, ensure_ascii=False).encode("utf-8") + b"\n")
        except Exception as e:
            print(f"[STT ERR] Streaming failed: {e}", flush=True)
            response_data = {"type": "error", "message": str(e)}
            sig_q.put(json.dumps(response_data, ensure_ascii=False).encode("utf-8") + b"\n")
        print(f"[STT] Internal STT thread finished for {lang_code}.", flush=True)

    # STT 워커 메인 루프
    while not stop_evt.is_set():
        try:
            item = transcribe_q.get(timeout=0.1)
            if isinstance(item, dict):
                command = item.get("command")
                if command == "START":
                    lang_code = item.get("language", "ko-KR")
                    print(f"[STT] /start command. Initializing for {lang_code}...", flush=True)
                    if stt_thread and stt_thread.is_alive():
                        if audio_chunk_queue: audio_chunk_queue.put(None)
                        stt_thread.join(timeout=0.5)
                    audio_chunk_queue = queue.Queue()
                    stt_thread = threading.Thread(target=_run_stt_stream, args=(audio_chunk_queue, signal_q, lang_code), daemon=True)
                    stt_thread.start()
                elif command == "STOP":
                    print("[STT] /stop command. Finalizing stream.", flush=True)
                    if stt_thread and stt_thread.is_alive() and audio_chunk_queue:
                        audio_chunk_queue.put(None)
                        stt_thread.join(timeout=1.0)
                    stt_thread = audio_chunk_queue = None
            elif isinstance(item, bytes): # 오디오 청크
                if audio_chunk_queue:
                    audio_chunk_queue.put(item)
            elif item is None: break
        except queue.Empty: continue
        except Exception as e:
            print(f"[STT][ERR] Worker loop error: {e}", flush=True)

    # 뒷정리
    if stt_thread and stt_thread.is_alive():
        if audio_chunk_queue: audio_chunk_queue.put(None)
        stt_thread.join(timeout=0.5)
    print(f"[STT] Worker stopped.", flush=True)

def run_pipe_loop(transcribe_q: queue.Queue, stop_evt: threading.Event, signal_q: queue.Queue):
    """Windows Named Pipe를 통해 main.js와 통신하는 메인 루프"""
    print("[PIPE] Worker started.", flush=True)
    while not stop_evt.is_set():
        handle = None
        try:
            handle = win32pipe.CreateNamedPipe(PIPE_NAME, win32con.PIPE_ACCESS_DUPLEX | win32file.FILE_FLAG_OVERLAPPED,
                                               win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
                                               1, 65536, 65536, 0, None)
            print(f"[PIPE] Pipe created. Waiting for client on {PIPE_NAME}...", flush=True)
            win32pipe.ConnectNamedPipe(handle, None)
            print("[PIPE] Client Connected", flush=True)
            buf = b""
            while not stop_evt.is_set():
                try: # STT 결과 전송
                    signal = signal_q.get_nowait()
                    win32file.WriteFile(handle, signal)
                except queue.Empty: pass
                except pywintypes.error: break
                try: # 오디오/명령 수신
                    _, data = win32file.ReadFile(handle, 4096)
                    buf += data
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.decode("utf-8", errors="ignore").strip()
                        if not line: continue
                        try:
                            obj = json.loads(line)
                            command, chunk_b64 = obj.get("command"), obj.get("chunk")
                            if command == "start":
                                lang = obj.get("language", "ko-KR")
                                transcribe_q.put({"command": "START", "language": lang})
                            elif command == "stop":
                                transcribe_q.put({"command": "STOP"})
                            elif chunk_b64:
                                transcribe_q.put(base64.b64decode(chunk_b64))
                            elif obj.get("text") == "/quit":
                                stop_evt.set(); break
                        except Exception as e: print(f"[PIPE][ERR] JSON/Data Error: {e}", flush=True)
                except pywintypes.error as e:
                    if e.winerror in [109, 232]: break
                    else: raise
        except Exception as e:
            print(f"[PIPE] Error: {e}", flush=True)
            time.sleep(1)
        finally:
            if handle: win32file.CloseHandle(handle)
            print("[PIPE] Connection loop reset. Signaling STT worker to stop.", flush=True)
            transcribe_q.put({"command": "STOP"}) # 연결 끊길 시 STT 스트림 중지
            while not signal_q.empty(): signal_q.get_nowait() # 큐 비우기
    print("[PIPE] Worker stopped.", flush=True)

# --- 메인 실행 ---
def main():
    print("[INIT] Starting Google STT Worker...", flush=True)
    transcribe_q, signal_q = queue.Queue(), queue.Queue(maxsize=20)
    stop_evt = threading.Event()

    print("[INIT] Starting worker threads...", flush=True)
    th_stt = threading.Thread(target=google_stt_worker, args=(transcribe_q, signal_q, stop_evt), daemon=True)
    th_pipe = threading.Thread(target=run_pipe_loop, args=(transcribe_q, stop_evt, signal_q), daemon=True)
    th_stt.start()
    th_pipe.start()

    print(f"[READY] Pipe server listening on {PIPE_NAME}", flush=True)
    try:
        while not stop_evt.is_set():
            if not all(t.is_alive() for t in [th_stt, th_pipe]):
                print("[ERROR] A worker thread died unexpectedly. Exiting.", flush=True)
                stop_evt.set()
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[EXIT] KeyboardInterrupt.", flush=True)
    finally:
        print("[EXIT] Shutting down...", flush=True)
        stop_evt.set()
        transcribe_q.put(None)
        try:
            handle = win32file.CreateFile(PIPE_NAME, win32con.GENERIC_WRITE, 0, None, win32con.OPEN_EXISTING, 0, None)
            win32file.CloseHandle(handle)
        except Exception: pass
        th_stt.join(timeout=2.0)
        th_pipe.join(timeout=2.0)
        print("[EXIT] Shutdown complete.", flush=True)

if __name__ == "__main__":
    main()