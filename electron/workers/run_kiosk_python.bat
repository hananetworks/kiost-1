@echo off
setlocal

:: 1. 현재 배치 파일이 있는 경로의 상위, 상위 폴더의 python-env 경로를 잡습니다.
:: (구조: resources/main/run_kiosk_python.bat -> ../../python-env)
set PYTHON_DIR=%~dp0..\..\python-env

:: 2. PATH 환경변수를 내 파이썬 폴더가 제일 먼저 오도록 강제로 덮어씁니다.
:: (SystemRoot는 윈도우 기본 명령어 사용을 위해 필요)
set PATH=%PYTHON_DIR%;%PYTHON_DIR%\Scripts;%SystemRoot%\system32;%SystemRoot%

:: 3. 파이썬 관련 환경변수 초기화 (혹시 모를 간섭 차단)
set PYTHONPATH=
set PYTHONHOME=

:: 4. 내 파이썬 실행
:: %1: 실행할 스크립트 파일명, %2~%9: 전달받은 인자들
"%PYTHON_DIR%\kiosk_python.exe" %*

endlocal