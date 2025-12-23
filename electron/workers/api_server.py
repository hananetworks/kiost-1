import sys
import os

# ▼▼▼ [이 3줄이 반드시 추가되어야 합니다!] ▼▼▼
# 현재 파일(api_server.py)이 있는 폴더 위치를 알아내서, 파이썬 검색 경로에 강제로 집어넣습니다.
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)
# ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

import uuid
import threading
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# ==================================================================
# ★★★ [HotFix] 한국어 G2P (g2pkk) 초기화 로직 완전 대체 ★★★
# ==================================================================
try:
    import MeCab
    from g2pkk import G2p
    import mecab_ko_dic

    # 1. mecab-ko-dic 경로 확인
    DIC_PATH = mecab_ko_dic.DICDIR
    print(f"[HotFix] Mecab-ko-dic 경로: {DIC_PATH}", flush=True)

    # 2. G2p 생성자를 완전히 덮어쓰기 (기존 코드 실행 안 함)
    def new_init(self, *args, **kwargs):
        # mecab_path 인자 무시
        if 'mecab_path' in kwargs: del kwargs['mecab_path']

        # [핵심] 기존 초기화(original_init) 호출 없이 바로 강제 연결
        # 이렇게 해야 mecabrc 없음 에러를 피할 수 있음
        try:
            print(f"[HotFix] G2p 초기화: mecab-ko-dic으로 직접 연결 중...", flush=True)
            self.mecab = MeCab.Tagger(f'-d "{DIC_PATH}"')
            print("[HotFix] G2p 초기화 성공!", flush=True)
        except Exception as e:
            print(f"[HotFix] 초기화 실패 (심각): {e}", flush=True)
            raise e

    G2p.__init__ = new_init
    print("[HotFix] g2pkk 패치 적용 완료 (초기화 로직 대체)", flush=True)

except ImportError:
    print("[HotFix] 필수 라이브러리 누락 (mecab-ko-dic 등)", flush=True)
except Exception as e:
    print(f"[HotFix] 패치 적용 중 에러: {e}", flush=True)
# ==================================================================

import engine_core  # <--- 이 친구가 실행되기 전에 위 패치가 끝나야 합니다.

print("[API] 스트리밍 서버 시작...", flush=True)

app = FastAPI()

# 요청 저장소
request_store = {}

class TTSRequest(BaseModel):
    text: str
    lang: str = "KR"

# ==================================================================
# ★★★ [핵심] 서버 시작 시 '실전 예열' 실행 ★★★
# ==================================================================
def preload_models():
    print("[API] 🚀 모든 언어 모델 예열(Warm-up) 시작... (CPU가 바빠질 수 있습니다)", flush=True)

    # Tier 1: MeloTTS 예열
    langs = ['KR', 'EN', 'JP', 'ZH']
    for lang in langs:
        # load_model 대신 warmup_model을 호출하여 계산까지 미리 시킴
        engine_core.warmup_model(lang)


    # Tier 2: Piper TTS 예열 (Vietnamese 등)
    if engine_core.PIPER_AVAILABLE:
        print("[API] 🔥 Piper TTS 엔진 예열 중...", flush=True)
        try:
            # Piper 언어들 예열
            piper_langs = ['vi', 'es', 'fr']  # 대표 언어만
            for lang in piper_langs:
                engine_core.piper_engine.warmup(lang)
            print("[API] ✅ Piper TTS 예열 완료!", flush=True)
        except Exception as e:
            print(f"[API] ⚠️ Piper 예열 실패: {e}", flush=True)

    # Tier 3: Sherpa-ONNX 예열 (Filipino 등)
    if engine_core.SHERPA_AVAILABLE:
        print("[API] 🔥 Sherpa-ONNX 엔진 예열 중...", flush=True)
        try:
            # Sherpa 언어 예열 (Filipino)
            engine_core.sherpa_engine.warmup('tl')
            print("[API] ✅ Sherpa-ONNX 예열 완료!", flush=True)
        except Exception as e:
            print(f"[API] ⚠️ Sherpa 예열 실패: {e}", flush=True)

    print("[API] ✅ 모든 모델 예열 완료! 이제 첫 클릭도 0.5초 컷 가능합니다.", flush=True)

# 서버 시작 이벤트에 등록 (비동기 방해 안 되게 스레드로 실행)
@app.on_event("startup")
async def startup_event():
    thread = threading.Thread(target=preload_models)
    thread.start()

# ==================================================================

@app.post("/synthesize")
def synthesize(req: TTSRequest):
    # 중복 요청 방지 등
    req_id = str(uuid.uuid4())
    request_store[req_id] = req

    # URL 발급
    stream_url = f"http://127.0.0.1:8000/live/{req_id}"

    return {
        "ok": True,
        "path": "STREAMING_MODE",
        "url": stream_url
    }

@app.get("/live/{req_id}")
def live_stream(req_id: str):
    req = request_store.get(req_id)
    if not req:
        return {"error": "Expired"}

    # Use multi-tier synthesis (auto-routes to correct engine)
    generator = engine_core.synthesize_multi_tier(req.text, req.lang, speed=1.3)


    if req_id in request_store:
        del request_store[req_id]

    return StreamingResponse(generator, media_type="audio/wav")

@app.get("/tiers/status")
def tier_status():
    """Get status of all TTS tiers for debugging"""
    import tts_router

    # Tier 1 - MeloTTS (Always available)
    tier1_status = {
        "loaded_languages": list(engine_core._models.keys()),
        "available": True,
    }

    # Tier 2 - Piper TTS
    tier2_status = {
        "available": engine_core.PIPER_AVAILABLE,
        "loaded_voices": [],
    }
    try:
        if engine_core.PIPER_AVAILABLE and hasattr(engine_core, 'piper_engine'):
            tier2_status["loaded_voices"] = list(engine_core.piper_engine._loaded_voices.keys())
    except Exception as e:
        tier2_status["error"] = str(e)

    # Tier 3 - Sherpa-ONNX (Safe error handling)
    tier3_status = {
        "available": engine_core.SHERPA_AVAILABLE,
        "ready": False,
    }
    try:
        if engine_core.SHERPA_AVAILABLE and hasattr(engine_core, 'sherpa_engine'):
            tier3_status["ready"] = engine_core.sherpa_engine.is_ready()
    except Exception as e:
        tier3_status["available"] = False
        tier3_status["error"] = f"Sherpa engine error: {str(e)}"

    # Language routing
    language_routing = {}
    try:
        for lang in ['ko', 'en', 'ja', 'zh', 'vi', 'th', 'ru', 'es', 'de', 'fr', 'pt', 'it']:
            language_routing[lang] = tts_router.get_tier_info(lang)
    except Exception as e:
        language_routing["error"] = str(e)

    status = {
        "tier1_melotts": tier1_status,
        "tier2_piper": tier2_status,
        "tier3_sherpa": tier3_status,
        "language_routing": language_routing
    }

    return status


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)