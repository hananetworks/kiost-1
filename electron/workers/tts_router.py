"""
TTS Router: Language to Engine Mapping
3-Tier Architecture:
- Tier 1: MeloTTS (High quality, pre-warmed)
- Tier 2: Piper TTS (CPU efficient)
- Tier 3: Sherpa-ONNX (Rare languages)
"""

# Language to Engine Routing Table
ENGINE_ROUTING = {
    # Tier 1: MeloTTS (High Quality, Pre-warmed)
    'ko': 'melotts',
    'kr': 'melotts',
    'en': 'melotts',
    'english': 'melotts',
    'ja': 'melotts',
    'jp': 'melotts',
    'zh': 'melotts',
    'cn': 'melotts',
    
    # Tier 2: Piper TTS (CPU Efficient)
    'vi': 'piper',      # Vietnamese
    'th': 'piper',      # Thai
    'ru': 'piper',      # Russian
    'es': 'piper',      # Spanish
    'de': 'piper',      # German
    'fr': 'piper',      # French
    'pt': 'piper',      # Portuguese
    'it': 'piper',      # Italian
    'nl': 'piper',      # Dutch
    'pl': 'piper',      # Polish
    
    # Tier 3: Sherpa-ONNX (VITS-MMS for Filipino!)
    'tl': 'sherpa',     # Tagalog (Filipino) 🇵🇭
    'fil': 'sherpa',    # Filipino 🇵🇭
}

# Fallback chain: melotts -> piper -> sherpa
FALLBACK_CHAIN = ['melotts', 'piper', 'sherpa']


def get_engine_for_language(lang: str) -> str:
    """
    Get the appropriate TTS engine for a given language code.
    
    Args:
        lang: Language code (e.g., 'ko', 'en', 'vi')
    
    Returns:
        Engine name: 'melotts', 'piper', or 'sherpa'
    """
    lang = lang.lower().strip()
    
    # Direct match
    engine = ENGINE_ROUTING.get(lang)
    if engine:
        print(f"[Router] {lang} -> {engine.upper()}", flush=True)
        return engine
    
    # Default to MeloTTS for unknown languages
    print(f"[Router] Unknown language '{lang}', defaulting to MeloTTS", flush=True)
    return 'melotts'


def get_tier_info(lang: str) -> dict:
    """
    Get tier information for a language.
    
    Returns:
        dict with tier number, engine name, and quality level
    """
    engine = get_engine_for_language(lang)
    
    tier_map = {
        'melotts': {'tier': 1, 'quality': 'Premium', 'cpu': 'High'},
        'piper': {'tier': 2, 'quality': 'Good', 'cpu': 'Low'},
        'sherpa': {'tier': 3, 'quality': 'Basic', 'cpu': 'Medium'},
    }
    
    info = tier_map.get(engine, tier_map['melotts'])
    info['engine'] = engine
    return info


def get_next_fallback(current_engine: str) -> str:
    """
    Get the next engine in the fallback chain.
    
    Args:
        current_engine: Current engine that failed
    
    Returns:
        Next engine to try, or None if no fallback available
    """
    try:
        current_idx = FALLBACK_CHAIN.index(current_engine)
        if current_idx < len(FALLBACK_CHAIN) - 1:
            next_engine = FALLBACK_CHAIN[current_idx + 1]
            print(f"[Router] Fallback: {current_engine} -> {next_engine}", flush=True)
            return next_engine
    except ValueError:
        pass
    
    print(f"[Router] No fallback available for {current_engine}", flush=True)
    return None
