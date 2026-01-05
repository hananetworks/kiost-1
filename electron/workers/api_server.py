# api_server.py (통합 서버)
import sys
import os
import asyncio
import json
import uuid
import threading
import time
import urllib.parse
import numpy as np

# ▼▼▼ [필수] 현재 경로 추가 ▼▼▼
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

# ==================================================================
# [FastAPI & Utils]
# ==================================================================
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# ==================================================================
# [TTS Engine Imports]
# ==================================================================
# ★★★ [HotFix] 한국어 G2P 완벽 호환 패치 (Fake Eunjeon + Spec Fix) ★★★
try:
    import types
    import MeCab
    import mecab_ko_dic
    from importlib.machinery import ModuleSpec

    DIC_PATH = mecab_ko_dic.DICDIR
    if 'eunjeon' not in sys.modules:
        fake_eunjeon = types.ModuleType("eunjeon")
        fake_eunjeon.__spec__ = ModuleSpec(name="eunjeon", loader=None)
        class FakeEunjeonMecab:
            def __init__(self, dicpath=None): pass
            def pos(self, text): return []
            def morphs(self, text): return []
        fake_eunjeon.Mecab = FakeEunjeonMecab
        sys.modules["eunjeon"] = fake_eunjeon

    class MecabWrapper:
        def __init__(self, dic_path):
            self.tagger = MeCab.Tagger(f'-d "{dic_path}" -r NUL')
        def pos(self, text):
            nodes = self.tagger.parseToNode(text)
            result = []
            while nodes:
                if nodes.surface:
                    try:
                        pos_tag = nodes.feature.split(',')[0]
                        result.append((nodes.surface, pos_tag))
                    except: pass
                nodes = nodes.next
            return result
        def morphs(self, text):
            return [x[0] for x in self.pos(text)]

    from g2pkk import G2p
    original_init = G2p.__init__
    def new_init(self, *args, **kwargs):
        if 'mecab_path' in kwargs: del kwargs['mecab_path']
        real_tagger = MeCab.Tagger
        MeCab.Tagger = lambda *a, **k: MecabWrapper(DIC_PATH)
        try:
            original_init(self, *args, **kwargs)
        finally:
            MeCab.Tagger = real_tagger
    G2p.__init__ = new_init
except ImportError:
    pass
except Exception:
    pass

import engine_core  # TTS Core Engine

# ==================================================================
# [STT Engine Imports]
# ==================================================================
import sherpa_onnx
from faster_whisper import WhisperModel
from vosk import Model, KaldiRecognizer

# ==================================================================
# [Global Config]
# ==================================================================
print("[System] 통합 AI 서버 시작... (TTS + STT)", flush=True)

app = FastAPI()

# TTS 요청 저장소
request_store = {}

class TTSRequest(BaseModel):
    text: str
    lang: str = "KR"

# STT Global Variables
stt_models = {
    "sherpa_kr": None,
    "sherpa_bilingual": None,
    "vosk_ja": None,
    "whisper": None
}

# Whisper Settings
WHISPER_ENGINE = os.getenv('WHISPER_ENGINE', 'faster-whisper')
PROMPTS = {
    'ko': "안녕하세요. 행정복지센터 민원 키오스크입니다. 등본, 초본, 인감, 전입, 증명서",
    'ja': "住民票、戸籍証明書、印鑑証明書、転入届、住所変更、証明書発行",
    'zh': "户口本、证明书、身份证明、住址变更、户籍证明、印章证明",
    'en': "resident registration, certificate, seal certificate, address change, family register"
}
MAX_AUDIO_BUFFER_SECONDS = 30
MAX_AUDIO_SAMPLES = 16000 * MAX_AUDIO_BUFFER_SECONDS

# ==================================================================
# [Startup Event] - TTS & STT 모델 로드
# ==================================================================
def load_stt_models():
    print("[STT] 🚀 STT 모델 로딩 시작...", flush=True)
    current_file_path = os.path.dirname(os.path.abspath(__file__))

    # 후보군 확장 (더 상위 폴더까지 탐색)
    candidates = [
        os.path.join(current_file_path, "models"),                # 같은 폴더
        os.path.join(current_file_path, "..", "models"),           # 부모 폴더
        os.path.join(current_file_path, "..", "..", "models"),      # 조부모 폴더 (배포 환경)
        os.path.join(current_file_path, "..", "..", "..", "models") # 증조부모 폴더 (Electron 환경)
    ]

    models_dir = None
    for cand in candidates:
        if os.path.exists(cand):
            models_dir = cand
            break

    if not models_dir:
        # 못 찾았을 때만 최후의 보루 (절대 경로로 변환해서 출력)
        models_dir = os.path.abspath("./models")

    print(f"[STT] 모델 탐색 확정 경로: {os.path.abspath(models_dir)}")

    # [A] Sherpa Korean
    try:
        path = os.path.join(models_dir, "sherpa-onnx-streaming-zipformer-korean-2024-06-16")
        stt_models["sherpa_kr"] = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=os.path.join(path, "tokens.txt"),
            encoder=os.path.join(path, "encoder-epoch-99-avg-1.int8.onnx"),
            decoder=os.path.join(path, "decoder-epoch-99-avg-1.int8.onnx"),
            joiner=os.path.join(path, "joiner-epoch-99-avg-1.int8.onnx"),
            num_threads=3, sample_rate=16000,
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.0, rule2_min_trailing_silence=1.0, rule3_min_utterance_length=30.0,
        )
        print("   ✅ [Sherpa] 한국어 엔진 로드 완료")
    except Exception as e:
        print(f"   ❌ [Sherpa] 한국어 실패: {e}")

    # [B] Sherpa Bilingual
    try:
        path = os.path.join(models_dir, "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20")
        stt_models["sherpa_bilingual"] = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=os.path.join(path, "tokens.txt"),
            encoder=os.path.join(path, "encoder-epoch-99-avg-1.int8.onnx"),
            decoder=os.path.join(path, "decoder-epoch-99-avg-1.int8.onnx"),
            joiner=os.path.join(path, "joiner-epoch-99-avg-1.int8.onnx"),
            num_threads=3, sample_rate=16000,
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.0, rule2_min_trailing_silence=1.0, rule3_min_utterance_length=30.0,
        )
        print("   ✅ [Sherpa] 중영 엔진 로드 완료")
    except Exception:
        print("   ⚠️ [Sherpa] 중영 엔진 실패 (기능 비활성화)")

    # [C] Vosk Japanese
    try:
        path = os.path.join(models_dir, "vosk-model-small-ja-0.22")
        stt_models["vosk_ja"] = Model(path)
        print("   ✅ [Vosk] 일본어 엔진 로드 완료")
    except Exception:
        print("   ⚠️ [Vosk] 일본어 엔진 실패 (기능 비활성화)")

    # [D] Whisper (Faster-Whisper)
    try:
        stt_models["whisper"] = WhisperModel("small", device="cpu", compute_type="int8", num_workers=2)
        print("   ✅ [Whisper] 다국어 엔진 로드 완료")
    except Exception as e:
        print(f"   ❌ [Whisper] 로드 실패: {e}")

    print("[STT] ✅ 모든 STT 모델 준비 완료", flush=True)

def preload_tts_models():
    """TTS 모델 예열"""
    print("[TTS] 🚀 TTS 모델 예열 시작...", flush=True)

    # Tier 1: MeloTTS
    for lang in ['KR', 'EN', 'JP', 'ZH']:
        engine_core.warmup_model(lang)

    # Tier 2: Piper
    if engine_core.PIPER_AVAILABLE:
        try:
            for lang in ['vi', 'es', 'fr']:
                engine_core.piper_engine.warmup(lang)
            print("   ✅ [Piper] 예열 완료")
        except: pass

    # Tier 3: Sherpa
    if engine_core.SHERPA_AVAILABLE:
        try:
            engine_core.sherpa_engine.warmup('tl')
            print("   ✅ [Sherpa-TTS] 예열 완료")
        except: pass

    print("[TTS] ✅ TTS 예열 완료", flush=True)

@app.on_event("startup")
async def startup_event():
    # 백그라운드 스레드에서 무거운 모델 로딩 수행
    t1 = threading.Thread(target=load_stt_models)
    t2 = threading.Thread(target=preload_tts_models)
    t1.start()
    t2.start()

# ==================================================================
# [Helper Functions] STT Audio Processing
# ==================================================================
def reduce_noise(audio, sample_rate=16000):
    try:
        from scipy import signal
        sos = signal.butter(3, 80, 'hp', fs=sample_rate, output='sos')
        return signal.sosfilt(sos, audio).astype(np.float32)
    except:
        return audio

def normalize_audio(audio):
    max_val = np.abs(audio).max()
    if max_val > 0:
        return audio / max_val * 0.95
    return audio

async def transcribe_async(audio, target_lang):
    """Whisper 비동기 처리"""
    def _run_whisper():
        model = stt_models["whisper"]
        if not model: return [], None
        return model.transcribe(
            audio,
            language=target_lang,
            beam_size=3,
            best_of=1,
            temperature=0.0,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            vad_filter=True,
            vad_parameters=dict(threshold=0.45, min_speech_duration_ms=350, min_silence_duration_ms=600),
            initial_prompt=PROMPTS.get(target_lang, None),
            condition_on_previous_text=False,
        )
    return await asyncio.to_thread(_run_whisper)

# ==================================================================
# [API Endpoints] TTS
# ==================================================================
@app.post("/synthesize")
def synthesize(req: TTSRequest):
    req_id = str(uuid.uuid4())
    request_store[req_id] = req
    return {"ok": True, "path": "STREAMING_MODE", "url": f"http://127.0.0.1:8000/live/{req_id}"}

@app.get("/live/{req_id}")
def live_stream(req_id: str):
    req = request_store.get(req_id)
    if not req: return {"error": "Expired"}
    generator = engine_core.synthesize_multi_tier(req.text, req.lang, speed=1.3)
    if req_id in request_store: del request_store[req_id]
    return StreamingResponse(generator, media_type="audio/wav")

# ==================================================================
# [API Endpoints] STT (WebSocket)
# ==================================================================
@app.websocket("/stt")
async def stt_endpoint(websocket: WebSocket):
    await websocket.accept()

    # URL 파라미터 파싱
    lang = websocket.query_params.get("lang", "ko")
    print(f"🔵 [STT Client] 연결됨 (언어: {lang})")

    # 언어별 Recognizer 선택
    current_recognizer = None
    vosk_recognizer = None

    if lang == 'ko':
        current_recognizer = stt_models["sherpa_kr"]
    elif lang in ['en', 'zh']:
        current_recognizer = stt_models.get("sherpa_bilingual")
    elif lang == 'ja':
        if stt_models["vosk_ja"]:
            vosk_recognizer = KaldiRecognizer(stt_models["vosk_ja"], 16000)
    else:
        current_recognizer = stt_models["sherpa_kr"] # Fallback

    # Sherpa Stream 생성
    stream = current_recognizer.create_stream() if current_recognizer else None

    audio_buffer = []
    total_samples = 0
    last_partial_text = ""

    try:
        while True:
            # WebSocket 데이터 수신 (bytes)
            message = await websocket.receive()

            if "bytes" in message:
                raw_bytes = message["bytes"]
                samples = np.frombuffer(raw_bytes, dtype=np.float32)

                # 1. Sherpa 실시간 처리
                if stream:
                    stream.accept_waveform(16000, samples)

                # 버퍼 관리
                if total_samples + len(samples) > MAX_AUDIO_SAMPLES:
                    while total_samples + len(samples) > MAX_AUDIO_SAMPLES and audio_buffer:
                        removed = audio_buffer.pop(0)
                        total_samples -= len(removed)
                audio_buffer.append(samples)
                total_samples += len(samples)

                # 2. [Sherpa] 실시간 텍스트 생성
                if current_recognizer and stream:
                    decode_start = time.time()
                    while current_recognizer.is_ready(stream):
                        current_recognizer.decode_stream(stream)

                    result = current_recognizer.get_result(stream)
                    partial_text = result.text if hasattr(result, 'text') else str(result)

                    if partial_text:
                        decode_ms = (time.time() - decode_start) * 1000
                        await websocket.send_json({
                            "type": "partial", "text": partial_text,
                            "lang": lang, "timestamp": time.time() * 1000,
                            "decode_ms": round(decode_ms, 1)
                        })

                # 2-B. [Vosk] 일본어 실시간 처리
                elif vosk_recognizer:
                    decode_start = time.time()
                    audio_int16 = (samples * 32767).astype(np.int16).tobytes()

                    if vosk_recognizer.AcceptWaveform(audio_int16):
                        res = json.loads(vosk_recognizer.Result())
                        txt = res.get('text', '')
                        if txt:
                            await websocket.send_json({
                                "type": "partial", "text": txt,
                                "lang": lang, "timestamp": time.time() * 1000,
                                "decode_ms": 0
                            })
                    else:
                        res = json.loads(vosk_recognizer.PartialResult())
                        txt = res.get('partial', '')
                        if txt and txt != last_partial_text:
                            last_partial_text = txt
                            await websocket.send_json({
                                "type": "partial", "text": txt,
                                "lang": lang, "timestamp": time.time() * 1000,
                                "decode_ms": 0
                            })

                # 3. [Sherpa VAD] 발화 종료 감지 -> Whisper 실행
                if current_recognizer and current_recognizer.is_endpoint(stream):
                    print(f"🛑 [VAD] 발화 종료 ({lang}) -> Whisper 실행")
                    current_recognizer.reset(stream)
                    last_partial_text = ""

                    if not audio_buffer: continue
                    full_audio = np.concatenate(audio_buffer)
                    audio_buffer = []
                    total_samples = 0

                    # 최소 길이 & 볼륨 체크
                    if len(full_audio) < 24000: continue # 1.5초 미만
                    if np.sqrt(np.mean(np.square(full_audio))) < 0.005: continue # 너무 조용함

                    # Whisper 실행
                    filtered = normalize_audio(reduce_noise(full_audio))
                    whisper_start = time.time()

                    segments, info = await transcribe_async(filtered, lang)
                    segments_list = list(segments)

                    if not segments_list: continue

                    # 품질 필터링
                    quality_segs = [s for s in segments_list if getattr(s, 'no_speech_prob', 0) < 0.6]
                    if not quality_segs: continue

                    final_text = " ".join([s.text for s in quality_segs]).strip()
                    if not final_text: continue

                    avg_prob = sum(getattr(s, 'avg_logprob', -1.0) for s in quality_segs) / len(quality_segs)
                    confidence = round((1 + avg_prob) * 100, 1)
                    whisper_ms = (time.time() - whisper_start) * 1000

                    print(f"🎯 [Whisper] 확정: {final_text} ({confidence}%)")

                    await websocket.send_json({
                        "type": "final", "text": final_text,
                        "lang": lang, "confidence": confidence,
                        "timestamp": time.time() * 1000,
                        "whisper_ms": round(whisper_ms, 1)
                    })

            elif "text" in message:
                if message["text"] == "RESET":
                    if current_recognizer: current_recognizer.reset(stream)
                    audio_buffer = []
                    total_samples = 0

    except WebSocketDisconnect:
        print(f"🔴 [STT Client] 연결 종료 ({lang})")
    except Exception as e:
        print(f"⚠️ [STT Error] {e}")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)