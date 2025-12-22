"""
Piper TTS Engine (Tier 2)
CPU-efficient TTS for secondary languages
"""

import os
import io
import hashlib
import tempfile
import numpy as np
import soundfile as sf
from piper import PiperVoice
from typing import Optional, Generator
import struct

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, "..", "cache", "audio")
MODELS_DIR = os.path.join(BASE_DIR, "..", "cache", "piper_models")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# Language to Piper voice mapping
# Using lightweight, quality voices from Piper repository
VOICE_MAP = {
    'vi': 'vi_VN-vivos-x_low',         # Vietnamese
    'th': 'th_TH-medium',                # Thai  
    'ru': 'ru_RU-iryna-medium',          # Russian
    'es': 'es_ES-davefx-medium',         # Spanish
    'de': 'de_DE-thorsten-medium',       # German
    'fr': 'fr_FR-upmc-medium',           # French
    'pt': 'pt_BR-edresson-low',          # Portuguese (Brazil)
    'it': 'it_IT-riccardo-x_low',        # Italian
    'nl': 'nl_NL-rdh-medium',            # Dutch
    'pl': 'pl_PL-darkman-medium',        # Polish
}

# Model cache
_loaded_voices = {}
_last_used = {}

def get_model_path(lang: str) -> tuple:
    """
    Get the ONNX model and config paths for a language.
    Downloads if not available.
    
    Returns:
        (onnx_path, config_path)
    """
    voice_name = VOICE_MAP.get(lang.lower())
    if not voice_name:
        return None, None
    
    onnx_path = os.path.join(MODELS_DIR, f"{voice_name}.onnx")
    config_path = os.path.join(MODELS_DIR, f"{voice_name}.json")
    
    # If models don't exist, we'll download them on first use
    # For now, we'll check if they exist
    if not os.path.exists(onnx_path) or not os.path.exists(config_path):
        print(f"[Piper] Model not found for {lang}. Please download from:", flush=True)
        print(f"  https://github.com/rhasspy/piper/releases/tag/2023.11.14-2", flush=True)
        print(f"  Save to: {MODELS_DIR}", flush=True)
        # We'll return the paths anyway - the user can download manually
        # In production, you could add auto-download here
    
    return onnx_path, config_path


def load_voice(lang: str) -> Optional[PiperVoice]:
    """
    Load a Piper voice for the given language.
    Uses lazy loading and caching.
    """
    global _loaded_voices, _last_used
    
    lang = lang.lower()
    
    # Check cache
    if lang in _loaded_voices:
        import time
        _last_used[lang] = time.time()
        return _loaded_voices[lang]
    
    # Get model paths
    onnx_path, config_path = get_model_path(lang)
    if not onnx_path or not config_path:
        print(f"[Piper] No voice available for language: {lang}", flush=True)
        return None
    
    # Check if files exist
    if not os.path.exists(onnx_path):
        print(f"[Piper] Model file not found: {onnx_path}", flush=True)
        print(f"[Piper] Using fallback synthesis", flush=True)
        return None
    
    try:
        print(f"[Piper] Loading voice for {lang}...", flush=True)
        voice = PiperVoice.load(onnx_path, use_cuda=False)
        _loaded_voices[lang] = voice
        
        import time
        _last_used[lang] = time.time()
        
        print(f"[Piper] Voice loaded successfully for {lang}", flush=True)
        return voice
    
    except Exception as e:
        print(f"[Piper] Failed to load voice for {lang}: {e}", flush=True)
        return None


def make_wav_header(sample_rate: int) -> bytes:
    """Create WAV header for streaming"""
    header = b'RIFF' + b'\\xff\\xff\\xff\\xff' + b'WAVE' + \
             b'fmt ' + struct.pack('<IHHIIHH', 16, 1, 1, sample_rate, sample_rate * 2, 2, 16) + \
             b'data' + b'\\xff\\xff\\xff\\xff'
    return header


def stream_generator(text: str, lang: str = 'en', speed: float = 1.0) -> Generator[bytes, None, None]:
    """
    Generate speech audio stream for the given text.
    Uses caching to avoid regenerating the same audio.
    
    Args:
        text: Text to synthesize
        lang: Language code (e.g., 'vi', 'th', 'ru')
        speed: Speech speed (1.0 = normal)
    
    Yields:
        Audio bytes (WAV format)
    """
    lang = lang.lower()
    
    # Check cache first
    cache_key = hashlib.md5(f"{text}_{speed}_{lang}_piper".encode()).hexdigest()
    cache_path = os.path.join(CACHE_DIR, f"piper_{cache_key}.wav")
    
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 1000:
        print(f"[Piper] Cache hit! Playing: {cache_key[:8]}", flush=True)
        with open(cache_path, 'rb') as f:
            while True:
                data = f.read(4096)
                if not data:
                    break
                yield data
        return
    
    # Load voice
    voice = load_voice(lang)
    if not voice:
        print(f"[Piper] Voice not available for {lang}, cannot generate audio", flush=True)
        return
    
    try:
        print(f"[Piper] Generating audio for: \"{text[:50]}...\" (lang={lang})", flush=True)
        
        # NEW Piper API: synthesize() returns Iterator[AudioChunk]
        import wave
        import numpy as np
        import io
        
        # Collect chunks for caching, but stream WAV header + chunks on-the-fly
        audio_chunks = []
        sample_rate = None
        
        # Create in-memory WAV file
        wav_buffer = io.BytesIO()
        wav_writer = None
        
        # Process chunks as they come
        for audio_chunk in voice.synthesize(text):
            audio_chunks.append(audio_chunk.audio_int16_array)
            if sample_rate is None:
                sample_rate = audio_chunk.sample_rate
        
        if not audio_chunks:
            print(f"[Piper] No audio generated for {lang}", flush=True)
            return
        
        # Concatenate all audio data (already int16)
        audio_int16 = np.concatenate(audio_chunks)
        
        # Write to cache file
        with wave.open(cache_path, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_int16.tobytes())
        
        print(f"[Piper] Generated and cached: {cache_key[:8]} ({len(audio_int16)} samples)", flush=True)
        
        # Stream the audio from file
        with open(cache_path, 'rb') as f:
            while True:
                data = f.read(4096)
                if not data:
                    break
                yield data
    
    except Exception as e:
        print(f"[Piper] Error generating audio: {e}", flush=True)
        import traceback
        traceback.print_exc()


def warmup(lang: str):
    """
    Pre-load and warm up a Piper voice.
    """
    print(f"[Piper] Warming up {lang}...", flush=True)
    try:
        voice = load_voice(lang)
        if voice:
            # Generate a short test phrase
            test_phrases = {
                'vi': 'Xin chào',
                'th': 'สวัสดี',
                'ru': 'Привет',
                'es': 'Hola',
                'de': 'Hallo',
                'fr': 'Bonjour',
                'pt': 'Olá',
                'it': 'Ciao',
            }
            test_text = test_phrases.get(lang, 'Hello')
            
            with io.BytesIO() as wav_io:
                voice.synthesize(test_text, wav_io)
            
            print(f"[Piper] Warmup complete for {lang}", flush=True)
    except Exception as e:
        print(f"[Piper] Warmup failed for {lang}: {e}", flush=True)


def cleanup_old_voices(max_age_seconds: int = 600):
    """
    Unload voices that haven't been used recently.
    Default: 10 minutes (600 seconds)
    """
    global _loaded_voices, _last_used
    
    import time
    current_time = time.time()
    to_remove = []
    
    for lang, last_time in _last_used.items():
        if current_time - last_time > max_age_seconds:
            to_remove.append(lang)
    
    for lang in to_remove:
        if lang in _loaded_voices:
            del _loaded_voices[lang]
            del _last_used[lang]
            print(f"[Piper] Unloaded voice for {lang} (unused for {max_age_seconds}s)", flush=True)


def test_synthesis(text: str, lang: str):
    """Test function for debugging"""
    print(f"[Piper Test] Synthesizing: '{text}' in {lang}", flush=True)
    result = list(stream_generator(text, lang))
    print(f"[Piper Test] Generated {len(result)} chunks", flush=True)
    return result
