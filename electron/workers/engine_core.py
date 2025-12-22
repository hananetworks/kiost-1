import os
import time
import io
import re
import numpy as np
import torch
import struct
import tempfile
import soundfile as sf
import hashlib
import multiprocessing

# 속도 최적화: CPU 코어 설정
try:
    num_cores = multiprocessing.cpu_count()
    # 코어가 4개 이상이면 2개 정도는 남겨두고 씁니다. (시스템 멈춤 방지)
    safe_cores = max(1, num_cores - 2)
    torch.set_num_threads(safe_cores)
except:
    pass

from melo.api import TTS

# Multi-tier TTS imports
import tts_router
try:
    import piper_engine
    PIPER_AVAILABLE = True
except Exception as e:
    print(f"[Engine] Piper TTS not available: {e}", flush=True)
    PIPER_AVAILABLE = False

try:
    import sherpa_engine
    SHERPA_AVAILABLE = True
    print(f"[Engine] Sherpa-ONNX available ✅", flush=True)
except Exception as e:
    print(f"[Engine] Sherpa-ONNX not available: {e}", flush=True)
    SHERPA_AVAILABLE = False


# ==================================================================
# [설정] 경로 및 모델
# ==================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, "..", "cache", "audio")
os.makedirs(CACHE_DIR, exist_ok=True)

_models = {}

def load_model(lang_code):
    global _models
    if lang_code in _models: return _models[lang_code]
    try:
        model = TTS(language=lang_code, device='cpu')
        _models[lang_code] = model
        return model
    except:
        return None

def split_text(text):
    # ★ 쉼표(,) 일본어 쉼표(、) 중국어 쉼표(，) 포함해서 자르기 (속도 향상)
    chunks = re.split(r'([.?!。？！\n,、，])', text)
    results = []
    current = ""
    for chunk in chunks:
        current += chunk
        # 문장 부호가 있거나 30글자가 넘으면 자르기
        if re.search(r'[.?!。？！\n,、，]', chunk) or len(current) > 30:
            if current.strip():
                # 너무 짧은 조각(5글자 미만)은 그냥 앞문장에 붙임 (부자연스러움 방지)
                if len(current) < 5 and len(results) > 0:
                    results[-1] += current
                else:
                    results.append(current.strip())
            current = ""

    if current.strip(): results.append(current.strip())
    return results

def make_wav_header(sample_rate):
    """스트리밍용 WAV 헤더"""
    header = b'RIFF' + b'\xff\xff\xff\xff' + b'WAVE' + \
             b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16) + \
             b'data' + b'\xff\xff\xff\xff'
    return header

def stream_generator(text: str, lang: str = "KR", speed: float = 1.0):
    """
    [캐시 + 스트리밍 + 쉼표 분리]
    """
    lang = lang.upper()
    lang_map = {'KO': 'KR', 'CN': 'ZH', 'JA': 'JP', 'ENGLISH': 'EN'}
    lang_code = lang_map.get(lang, lang)

    # 1. 캐시 확인
    raw_str = f"{text}_{speed}_{lang_code}"
    key = hashlib.md5(raw_str.encode()).hexdigest()
    cache_path = os.path.join(CACHE_DIR, f"tts_{key}.wav")

    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        print(f"[Stream] 캐시 히트! 파일 재생: {key}", flush=True)
        with open(cache_path, 'rb') as f:
            while True:
                data = f.read(4096)
                if not data: break
                yield data
        return

    # 2. 모델 로딩
    model = load_model(lang_code)
    if model is None: return

    # 3. 텍스트 분리 (쉼표 포함)
    chunks = split_text(text)
    print(f"[Stream] 생성 시작: {len(chunks)}개 조각 (쉼표 분리됨)", flush=True)

    speaker_id = 0
    if hasattr(model.hps.data, 'spk2id'):
        for key, val in model.hps.data.spk2id.items():
            if lang_code in key:
                speaker_id = val
                break

    sr = model.hps.data.sampling_rate

    # 헤더 전송
    yield make_wav_header(sr)

    full_audio_pieces = []

    # 4. 조각별 생성 및 전송
    for i, chunk_text in enumerate(chunks):
        temp_path = None
        try:
            t0 = time.time()

            # 임시 파일 생성
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                temp_path = tf.name

            # 생성 (quiet=True로 불필요한 로그 제거)
            model.tts_to_file(chunk_text, speaker_id, temp_path, speed=speed, quiet=True)

            # 읽기
            audio_data, _ = sf.read(temp_path)

            if len(audio_data) == 0: continue

            # 무음 패딩 (쉼표는 짧게 쉬어야 자연스러움 0.1s)
            silence = np.zeros(int(sr * 0.1), dtype=np.float32)

            if len(audio_data.shape) > 1:
                audio_data = audio_data[:, 0]

            segment_float = np.concatenate((audio_data, silence))
            full_audio_pieces.append(segment_float)

            final_audio = segment_float * 32767
            final_audio = final_audio.astype(np.int16)

            # 전송
            yield final_audio.tobytes()

            print(f"[Stream] {i+1}/{len(chunks)} 전송 ({time.time()-t0:.2f}s)", flush=True)

        except Exception as e:
            print(f"[Stream] 에러: {e}", flush=True)

        finally:
            if temp_path and os.path.exists(temp_path):
                try: os.remove(temp_path)
                except: pass

    # 5. 캐시 저장
    if len(full_audio_pieces) > 0:
        try:
            complete_audio = np.concatenate(full_audio_pieces)
            sf.write(cache_path, complete_audio, sr)
            print(f"[Stream] 캐시 저장 완료: {cache_path}", flush=True)
        except Exception as e:
            print(f"[Stream] 캐시 저장 실패: {e}", flush=True)

def synthesize_multi_tier(text: str, lang: str = "KR", speed: float = 1.0):
    """
    Multi-tier TTS synthesis with automatic engine routing.
    
    Routes to:
    - Tier 1 (MeloTTS): Korean, English, Japanese, Chinese
    - Tier 2 (Piper): Vietnamese, Thai, Russian, Spanish, German, etc.
    - Tier 3 (Sherpa-ONNX): Tagalog, Uzbek, Indonesian, etc.
    
    Args:
        text: Text to synthesize
        lang: Language code (e.g., 'ko', 'vi', 'tl')
        speed: Speech speed multiplier
    
    Yields:
        Audio bytes (WAV format)
    """
    # Get engine for this language
    engine_type = tts_router.get_engine_for_language(lang)
    tier_info = tts_router.get_tier_info(lang)
    
    print(f"[Multi-Tier] Language={lang}, Engine={engine_type}, Tier={tier_info['tier']}", flush=True)
    
    # Try primary engine
    try:
        if engine_type == 'melotts':
            # Use existing MeloTTS implementation
            yield from stream_generator(text, lang, speed)
            return
        
        elif engine_type == 'piper' and PIPER_AVAILABLE:
            # Use Piper TTS
            yield from piper_engine.stream_generator(text, lang, speed)
            return
        
        elif engine_type == 'sherpa' and SHERPA_AVAILABLE:
            # Use Sherpa-ONNX
            yield from sherpa_engine.stream_generator(text, lang, speed)
            return
        
        else:
            # Engine not available, try fallback
            print(f"[Multi-Tier] {engine_type} not available, trying fallback", flush=True)
            raise Exception(f"{engine_type} not available")
    
    except Exception as e:
        print(f"[Multi-Tier] Primary engine failed: {e}", flush=True)
        
        # Try fallback
        fallback_engine = tts_router.get_next_fallback(engine_type)
        
        if fallback_engine == 'piper' and PIPER_AVAILABLE:
            try:
                yield from piper_engine.stream_generator(text, lang, speed)
                return
            except Exception as e2:
                print(f"[Multi-Tier] Piper fallback failed: {e2}", flush=True)
        
        elif fallback_engine == 'gtts' and GTTS_AVAILABLE:
            try:
                yield from gtts_engine.stream_generator(text, lang, speed)
                return
            except Exception as e2:
                print(f"[Multi-Tier] gTTS fallback failed: {e2}", flush=True)
        
        elif fallback_engine == 'sherpa' and SHERPA_AVAILABLE:
            try:
                yield from sherpa_engine.stream_generator(text, lang, speed)
                return
            except Exception as e2:
                print(f"[Multi-Tier] Sherpa fallback failed: {e2}", flush=True)
        
        # If all else fails, try MeloTTS with English
        print(f"[Multi-Tier] All engines failed, using MeloTTS English as last resort", flush=True)
        try:
            yield from stream_generator(text, 'EN', speed)
        except Exception as e3:
            print(f"[Multi-Tier] Final fallback failed: {e3}", flush=True)



def warmup_model(lang_code):
    print(f"[Engine] 🔥 {lang_code} 엔진 예열 중...", flush=True)
    try:
        model = load_model(lang_code)
        if model is None: return

        speaker_id = 0
        if hasattr(model.hps.data, 'spk2id'):
            for key, val in model.hps.data.spk2id.items():
                if lang_code in key:
                    speaker_id = val
                    break

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            temp_path = tf.name

        model.tts_to_file("Hi", speaker_id, temp_path, speed=1.5, quiet=True)

        if os.path.exists(temp_path):
            try: os.remove(temp_path)
            except: pass

        print(f"[Engine] 🔥 {lang_code} 예열 완료!", flush=True)
    except Exception as e:
        print(f"[Engine] ⚠️ 예열 실패: {e}", flush=True)