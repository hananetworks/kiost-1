"""
TTS 모델 자동 다운로드 스크립트
Tier 2 (Piper), Tier 3 (Sherpa-ONNX) 모델 다운로드
"""

import os
import sys
import urllib.request
import tarfile
import zipfile
from pathlib import Path

# Windows 콘솔 인코딩 문제 해결
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR.parent / "cache"
PIPER_DIR = CACHE_DIR / "piper_models"
SHERPA_DIR = CACHE_DIR / "sherpa_models"

PIPER_DIR.mkdir(parents=True, exist_ok=True)
SHERPA_DIR.mkdir(parents=True, exist_ok=True)

# =============================================================================
# Piper TTS Models (Tier 2)
# =============================================================================
PIPER_MODELS = {
    # Vietnamese (x_low quality - medium not available)
    'vi_VN-vivos-x_low.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vivos/x_low/vi_VN-vivos-x_low.onnx',
    'vi_VN-vivos-x_low.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vivos/x_low/vi_VN-vivos-x_low.onnx.json',
    
    # Spanish
    'es_ES-davefx-medium.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
    'es_ES-davefx-medium.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json',
    
    # French
    'fr_FR-upmc-medium.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx',
    'fr_FR-upmc-medium.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx.json',
    
    # Russian
    'ru_RU-iryna-medium.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/iryna/medium/ru_RU-iryna-medium.onnx',
    'ru_RU-iryna-medium.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ru/ru_RU/iryna/medium/ru_RU-iryna-medium.onnx.json',
    
    # German
    'de_DE-thorsten-medium.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
    'de_DE-thorsten-medium.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json',
    
    # Portuguese (Brazil)
    'pt_BR-edresson-low.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/edresson/low/pt_BR-edresson-low.onnx',
    'pt_BR-edresson-low.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/pt/pt_BR/edresson/low/pt_BR-edresson-low.onnx.json',
    
    # Italian
    'it_IT-riccardo-x_low.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx',
    'it_IT-riccardo-x_low.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx.json',
}

# =============================================================================
# Sherpa-ONNX Models (Tier 3) - 영어 Piper 모델 사용
# =============================================================================
SHERPA_MODELS = {
    'vits-piper-en_US-lessac-medium': {
        'model.onnx': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
        'model.onnx.json': 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    }
}


def download_file(url: str, dest_path: Path, description: str):
    """파일 다운로드 with progress"""
    if dest_path.exists():
        print(f"  ✓ 이미 존재함: {dest_path.name}")
        return True
    
    try:
        print(f"  ⬇ 다운로드 중: {description}...")
        
        def reporthook(block_num, block_size, total_size):
            if total_size > 0:
                percent = min(block_num * block_size * 100 / total_size, 100)
                sys.stdout.write(f"\r    진행률: {percent:.1f}%")
                sys.stdout.flush()
        
        urllib.request.urlretrieve(url, dest_path, reporthook)
        print(f"\n  ✓ 완료: {dest_path.name}")
        return True
        
    except Exception as e:
        print(f"\n  ✗ 실패: {e}")
        if dest_path.exists():
            dest_path.unlink()
        return False


def download_piper_models():
    """Piper TTS 모델 다운로드"""
    print("\n" + "="*70)
    print("🎙️  Piper TTS 모델 다운로드 (Tier 2)")
    print("="*70)
    
    for filename, url in PIPER_MODELS.items():
        dest_path = PIPER_DIR / filename
        download_file(url, dest_path, filename)
    
    print(f"\n✅ Piper 모델 다운로드 완료!")
    print(f"   위치: {PIPER_DIR}")


def download_sherpa_models():
    """Sherpa-ONNX 모델 다운로드"""
    print("\n" + "="*70)
    print("🎙️  Sherpa-ONNX 모델 다운로드 (Tier 3)")
    print("="*70)
    
    for model_name, files in SHERPA_MODELS.items():
        model_dir = SHERPA_DIR / model_name
        model_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"\n📁 {model_name}")
        for filename, url in files.items():
            dest_path = model_dir / filename
            download_file(url, dest_path, filename)
        
        # Piper 모델을 Sherpa용으로 사용할 때 필요한 추가 파일들
        # lexicon.txt와 tokens.txt는 JSON에서 추출하거나 빈 파일 생성
        lexicon_path = model_dir / "lexicon.txt"
        tokens_path = model_dir / "tokens.txt"
        
        if not lexicon_path.exists():
            lexicon_path.write_text("", encoding="utf-8")
            print(f"  ✓ 생성: lexicon.txt (빈 파일)")
        
        if not tokens_path.exists():
            tokens_path.write_text("", encoding="utf-8")
            print(f"  ✓ 생성: tokens.txt (빈 파일)")
    
    print(f"\n✅ Sherpa 모델 다운로드 완료!")
    print(f"   위치: {SHERPA_DIR}")


def verify_installation():
    """설치 검증"""
    print("\n" + "="*70)
    print("✅ 설치 검증")
    print("="*70)
    
    # Piper 모델 확인
    piper_files = list(PIPER_DIR.glob("*.onnx"))
    print(f"\n📊 Piper 모델: {len(piper_files)}개")
    for f in piper_files:
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"  • {f.name} ({size_mb:.1f} MB)")
    
    # Sherpa 모델 확인
    sherpa_dirs = [d for d in SHERPA_DIR.iterdir() if d.is_dir()]
    print(f"\n📊 Sherpa 모델: {len(sherpa_dirs)}개")
    for d in sherpa_dirs:
        files = list(d.glob("*"))
        print(f"  • {d.name} ({len(files)} 파일)")
    
    # 지원 언어 출력
    print("\n🌍 지원 언어:")
    print("  Tier 1 (MeloTTS): 한국어, 영어, 일본어, 중국어")
    print("  Tier 2 (Piper): 베트남어, 스페인어, 프랑스어, 러시아어, 독일어, 포르투갈어, 이탈리아어")
    print("  Tier 3 (Sherpa): 영어 (fallback)")


def main():
    print("\n" + "="*70)
    print("🚀 TTS 모델 자동 다운로드 시작")
    print("="*70)
    print(f"Piper 저장 위치: {PIPER_DIR}")
    print(f"Sherpa 저장 위치: {SHERPA_DIR}")
    
    try:
        # Piper 모델 다운로드
        download_piper_models()
        
        # Sherpa 모델 다운로드
        download_sherpa_models()
        
        # 검증
        verify_installation()
        
        print("\n" + "="*70)
        print("🎉 모든 모델 다운로드 완료!")
        print("="*70)
        print("\n다음 단계:")
        print("  1. Python API 서버 재시작")
        print("  2. http://127.0.0.1:8000/tiers/status 에서 상태 확인")
        print("  3. 다국어 TTS 테스트")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  다운로드 중단됨")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
