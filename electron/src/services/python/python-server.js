const { app, dialog } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');
const { log } = require('../../logging/logger');

let apiServerShell; // 우리의 유일한 희망 (API 서버)
let win;

/**
 * [서비스] Python FastAPI 서버를 실행합니다.
 * @param {BrowserWindow} mainWindow
 * @param {string} pythonExePath - 파이썬 실행 파일 경로 (필수)
 */
function initializePythonServices(mainWindow, pythonExePath) {
    win = mainWindow;
    log.info("[Python] API 서버 초기화 중...");

    // 1. 파이썬 경로 확인
    if (!pythonExePath) {
        log.error("[Python FATAL] 파이썬 경로 누락!");
        dialog.showErrorBox("오류", "AI 엔진 경로를 찾을 수 없습니다.");
        return;
    }

    // 2. 스크립트 경로 설정 (api_server.py 위치)
    let scriptPath;
    if (app.isPackaged) {
        // 배포 시: resources/main/workers/api_server.py (구조에 따라 다를 수 있음)
        scriptPath = path.join(process.resourcesPath, 'main', 'workers');
    } else {
        // 개발 시: 프로젝트루트/workers
        scriptPath = path.join(__dirname, '..', '..', '..', 'workers');
    }

    log.info(`[Python] Script Dir: ${scriptPath}`);
    log.info(`[Python] Python Exe: ${pythonExePath}`);

    // 3. 환경변수 설정 (Anaconda 등 외부 간섭 차단)
    const baseEnv = {
        ...process.env,
        PYTHONPATH: '',
        PYTHONHOME: '',
        PYTHONIOENCODING: 'utf-8', // ✅ 외계어 방지 (Windows 콘솔 UTF-8 출력)
        // 실행 파일이 있는 폴더와 Scripts 폴더를 PATH 최우선으로 등록
        PATH: `${path.dirname(pythonExePath)};${path.join(path.dirname(pythonExePath), 'Scripts')};${process.env.PATH}`
    };

    // 4. 실행 옵션
    const shellOptions = {
        mode: 'text',
        pythonOptions: ['-u'], // 버퍼링 없이 즉시 출력
        scriptPath: scriptPath,
        pythonPath: pythonExePath,
        env: baseEnv
    };

    try {
        // ★ 핵심: api_server.py 실행 (하나만 실행하면 됨!)
        log.info("[Python] api_server.py 실행 시도...");
        apiServerShell = new PythonShell('api_server.py', shellOptions);

        // 로그 연결
        apiServerShell.on('message', (message) => {
            log.info(`[API_SERVER] ${message}`);
            // 서버가 준비되었다는 특정 로그가 뜨면 UI에 알려줄 수도 있음 (선택사항)
        });

        apiServerShell.on('stderr', (stderr) => {
            // 경고나 에러 로그
            log.warn(`[API_SERVER_ERR] ${stderr}`);
        });

        apiServerShell.on('error', (err) => {
            log.error(`[API_SERVER_FAIL] ${err.message}`);
        });

        log.info("[Python] API 서버 프로세스 시작 성공!");

    } catch (e) {
        log.error(`[Python FATAL] 서버 시작 실패: ${e.message}`);
        dialog.showErrorBox("시작 오류", `AI 엔진 시작 실패: ${e.message}`);
    }
}

/**
 * [서비스] 앱 종료 시 파이썬 서버도 같이 끔
 */
function cleanupPythonServices() {
    log.info("[Python] API 서버 종료 시도...");
    if (apiServerShell) {
        apiServerShell.kill(); // kill이 더 확실함
        apiServerShell = null;
        log.info("[Python] 서버 프로세스 종료됨.");
    }
}

// 기존 exports 유지
module.exports = { initializePythonServices, cleanupPythonServices };