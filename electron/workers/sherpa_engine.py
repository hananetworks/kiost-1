"""
Sherpa-ONNX Engine (Tier 3)
Meta MMS TTS for rare/unsupported languages
Runtime synthesis without pre-recorded files
"""

import os
import hashlib
import struct
import numpy as np
import soundfile as sf
from typing import Optional, Generator
import sherpa_onnx
import sys # sys 추가 필요

# ==============================================================================
# [SMART PATH] 개발 모드 vs 배포 모드(kiosk_python.exe) 경로 자동 감지
# ==============================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, "..", "cache", "audio")

if 'kiosk_python.exe' in sys.executable:
    # [배포 모드]
    # 모델 위치: .../python-env/tts_models/sherpa_models
    base_env_dir = os.path.dirname(sys.executable)
    MODELS_DIR = os.path.join(base_env_dir, 'tts_models', 'sherpa_models')
    print(f"[Sherpa] 배포 모드 감지: 모델 경로 -> {MODELS_DIR}", flush=True)
else:
    # [개발 모드]
    MODELS_DIR = os.path.join(BASE_DIR, "..", "cache", "sherpa_models")
    print(f"[Sherpa] 개발 모드 감지: 모델 경로 -> {MODELS_DIR}", flush=True)

os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# Sherpa-ONNX uses VITS models
# Language code mapping (ISO 639-1 to model identifiers)
LANG_MAP = {
    'tl': 'tl',      # Tagalog
    'fil': 'tl',     # Filipino (same as Tagalog)
    'uz': 'uz',      # Uzbek
    'id': 'id',      # Indonesian
    'ms': 'ms',      # Malay
    'ar': 'ar',      # Arabic
    'hi': 'hi',      # Hindi
    'bn': 'bn',      # Bengali
    'ta': 'ta',      # Tamil
    'te': 'te',      # Telugu
}

# Model cache
_tts_engine = None
_last_used = {}


def get_model_config():
    """
    Get Sherpa-ONNX TTS model configuration.
    For now, we'll use a simple VITS model.
    In production, you'd download from:
    https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
    """
    # Example: Using VITS model (you'll need to download this)
    model_dir = os.path.join(MODELS_DIR, "vits-piper-en_US-lessac-medium")
    
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=os.path.join(model_dir, "model.onnx"),
                lexicon=os.path.join(model_dir, "lexicon.txt"),
                tokens=os.path.join(model_dir, "tokens.txt"),
            ),
            num_threads=2,
            debug=False,
        ),
        max_num_sentences=1,
    )
    
    return config


def load_engine() -> Optional[sherpa_onnx.OfflineTts]:
    """
    Load Sherpa-ONNX TTS engine with MMS models.
    Uses singleton pattern for efficiency.
    
    NOTE: Now using VITS-MMS Tagalog model
    from willwade/mms-tts-multilingual-models-onnx
    """
    global _tts_engine
    
    if _tts_engine is not None:
        return _tts_engine
    
    try:
        print(f"[Sherpa] Loading Filipino TTS engine...", flush=True)
        
        # Check if MMS model exists
        model_dir = os.path.join(MODELS_DIR, "vits-mms-tgl")  # Tagalog MMS model
        model_path = os.path.join(model_dir, "model.onnx")
        
        if not os.path.exists(model_path):
            print(f"[Sherpa] Filipino model not found: {model_path}", flush=True)
            print(f"[Sherpa] Run: python electron/workers/download_filipino_model.py", flush=True)
            return None
        
        # MMS models use tokens.txt (but it might be empty)
        tokens_path = os.path.join(model_dir, "tokens.txt")
        lexicon_path = os.path.join(model_dir, "lexicon.txt")
        
        # Create empty files if they don't exist
        if not os.path.exists(tokens_path):
            open(tokens_path, 'w', encoding='utf-8').close()
        if not os.path.exists(lexicon_path):
            open(lexicon_path, 'w', encoding='utf-8').close()
        
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=model_path,
                    tokens=tokens_path,
                    lexicon=lexicon_path,
                ),
                num_threads=2,
                debug=False,
            ),
            max_num_sentences=1,
        )
        
        _tts_engine = sherpa_onnx.OfflineTts(config)
        
        print(f"[Sherpa] Filipino TTS engine loaded successfully!", flush=True)
        return _tts_engine
    
    except Exception as e:
        print(f"[Sherpa] Failed to load TTS engine: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return None


def make_wav_header(sample_rate: int) -> bytes:
    """Create WAV header for streaming"""
    header = b'RIFF' + b'\\xff\\xff\\xff\\xff' + b'WAVE' + \
             b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16) + \
             b'data' + b'\\xff\\xff\\xff\\xff'
    return header


def stream_generator(text: str, lang: str = 'en', speed: float = 1.0) -> Generator[bytes, None, None]:
    """
    Generate speech audio stream using Sherpa-ONNX.
    
    NOTE: This is a simplified implementation.
    Sherpa-ONNX with Meta MMS requires proper model setup.
    For production, you should:
    1. Download appropriate VITS models for each language
    2. Configure language-specific models
    3. Handle multi-speaker models if needed
    
    Args:
        text: Text to synthesize
        lang: Language code (e.g., 'tl', 'uz', 'id')
        speed: Speech speed (1.0 = normal)
    
    Yields:
        Audio bytes (WAV format)
    """
    lang = lang.lower()
    lang_id = LANG_MAP.get(lang, lang)
    
    # Check cache first
    cache_key = hashlib.md5(f"{text}_{speed}_{lang}_sherpa".encode()).hexdigest()
    cache_path = os.path.join(CACHE_DIR, f"sherpa_{cache_key}.wav")
    
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        print(f"[Sherpa] Cache hit! Playing: {cache_key[:8]}", flush=True)
        with open(cache_path, 'rb') as f:
            while True:
                data = f.read(4096)
                if not data:
                    break
                yield data
        return
    
    # Load engine
    engine = load_engine()
    if not engine:
        print(f"[Sherpa] Engine not available, cannot generate audio", flush=True)
        print(f"[Sherpa] This is expected if models haven't been downloaded yet", flush=True)
        return
    
    try:
        print(f"[Sherpa] Generating audio for: \"{text[:50]}...\" (lang={lang})", flush=True)
        
        # Split text into sentences for faster first-audio (최대 200자씩)
        sentences = []
        current = ""
        for char in text:
            current += char
            if char in '.!?' and len(current) > 50:
                sentences.append(current.strip())
                current = ""
        if current.strip():
            sentences.append(current.strip())
        
        # Limit to first 2 sentences for faster initial playback
        if len(sentences) > 2:
            sentences = sentences[:2]
        
        # Generate audio chunks
        all_samples = []
        sample_rate = engine.sample_rate
        
        for sentence in sentences:
            if not sentence.strip():
                continue
            audio = engine.generate(sentence, sid=0, speed=speed)
            samples = np.array(audio.samples)
            all_samples.append(samples)
        
        if not all_samples:
            print(f"[Sherpa] No audio generated", flush=True)
            return
        
        # Concatenate all chunks
        samples = np.concatenate(all_samples)

        # 볼륨 정규화
        max_val = np.max(np.abs(samples))
        if max_val > 0.0001:
            if max_val < 0.1:
                samples = samples / max_val * 0.5
            elif max_val > 0.9:
                samples = samples / max_val * 0.9

        # 변환
        audio_int16 = (samples * 32767).astype(np.int16)

        # Save and stream
        sf.write(cache_path, audio_int16, sample_rate)
        print(f"[Sherpa] Generated and cached: {cache_key[:8]}", flush=True)
        
        # Stream immediately
        with open(cache_path, 'rb') as f:
            while True:
                data = f.read(4096)
                if not data:
                    break
                yield data
    
    except Exception as e:
        print(f"[Sherpa] Error generating audio: {e}", flush=True)
        import traceback
        traceback.print_exc()
        
        # Generate a simple fallback message
        print(f"[Sherpa] Falling back to silent audio", flush=True)


def warmup(lang: str):
    """
    Pre-load and warm up Sherpa-ONNX engine.
    """
    print(f"[Sherpa] Warming up for {lang}...", flush=True)
    try:
        engine = load_engine()
        if engine:
            # Generate a short test phrase
            test_phrases = {
                'tl': 'Kamusta',
                'uz': 'Salom',
                'id': 'Halo',
                'ms': 'Hai',
                'ar': 'مرحبا',
                'hi': 'नमस्ते',
            }
            test_text = test_phrases.get(lang, 'Hello')
            
            # Test generation
            list(stream_generator(test_text, lang))
            
            print(f"[Sherpa] Warmup complete for {lang}", flush=True)
    except Exception as e:
        print(f"[Sherpa] Warmup failed for {lang}: {e}", flush=True)


def is_ready() -> bool:
    """Check if Sherpa-ONNX is ready to use"""
    engine = load_engine()
    return engine is not None


def test_synthesis(text: str, lang: str):
    """Test function for debugging"""
    print(f"[Sherpa Test] Synthesizing: '{text}' in {lang}", flush=True)
    result = list(stream_generator(text, lang))
    print(f"[Sherpa Test] Generated {len(result)} chunks", flush=True)
    return result
