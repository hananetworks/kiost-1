const { app, dialog } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');
const { log } = require('../../logging/logger'); // 경로 확인 필요

let ttsKrShell, ttsEnShell, sttShell;
let ttsPipeClient, ttsPipeClientEN, sttPipeClient;
let win;

/**
 * [서비스] PythonShell을 생성하고 초기화합니다.
 * @param {BrowserWindow} mainWindow
 * @param {string} pythonExePath - 다운로드 받은 파이썬 실행 파일 경로 (필수)
 */
function initializePythonServices(mainWindow, pythonExePath) {
    win = mainWindow;
    log.info("[Python] PythonShell 초기화 중...");

    // 1. 파이썬 경로 확인 (필수)
    if (!pythonExePath) {
        log.error("[Python FATAL] 파이썬 실행 경로가 전달되지 않았습니다.");
        dialog.showErrorBox("초기화 오류", "AI 엔진 경로를 찾을 수 없습니다.");
        return;
    }

    // 2. 스크립트 경로 설정
    let scriptPath;
    if (app.isPackaged) {
        scriptPath = path.join(process.resourcesPath, 'main');
    } else {
        scriptPath = path.join(__dirname, '..', '..', 'workers');
    }

    log.info(`[Python] ScriptPath: ${scriptPath}`);
    log.info(`[Python] PythonPath (External): ${pythonExePath}`);

    // [중요] 환경변수 격리 설정 (Anaconda 충돌 방지)
    const baseEnv = {
        ...process.env,   // 윈도우 기본 설정은 가져옴
        PYTHONPATH: '',   // 로컬 파이썬 라이브러리 경로 무시
        PYTHONHOME: '', // 로컬 파이썬 설치 경로 무시
        PATH: `${path.dirname(pythonExePath)};${path.join(path.dirname(pythonExePath), 'Scripts')};${process.env.PATH}`

    };

    const shellOptions = {
        mode: 'text',
        pythonOptions: ['-u'],
        pythonPath: pythonExePath, // 다운로드 받은 순정 파이썬 사용
        scriptPath: scriptPath,
        args: [app.isPackaged ? 'packaged' : 'dev', process.resourcesPath],
        env: baseEnv // [수정] 격리된 환경변수 적용
    };

    try {
        // PythonShell 실행 (TTS)
        ttsKrShell = new PythonShell('tts_worker_pipe_kr.py', shellOptions);
        ttsEnShell = new PythonShell('tts_worker_pipe_en.py', shellOptions);

        // STT용 환경변수 설정 (baseEnv를 복사해서 사용해야 함)
        const sttEnv = { ...baseEnv };
        if (process.env.GCLOUD_KEY_PATH) {
            sttEnv['GOOGLE_APPLICATION_CREDENTIALS'] = process.env.GCLOUD_KEY_PATH;
        }

        // PythonShell 실행 (STT) - 격리된 env에 구글 키만 추가됨
        sttShell = new PythonShell('stt_worker_gcloud.py', {
            ...shellOptions,
            env: sttEnv
        });

        setupPythonListeners();
        log.info("[Python] 프로세스 시작 성공 (환경변수 격리 적용됨)");

    } catch (e) {
        log.error(`[Python FATAL] PythonShell 생성 실패: ${e.message}`);
        dialog.showErrorBox("시작 오류", `Python 프로세스를 시작하지 못했습니다: ${e.message}`);
        app.quit();
        return;
    }

    loadPipeClients();
    connectPipeClients();
}

/**
 * [서비스] Python 스크립트의 표준 출력/오류를 로깅합니다.
 */
function setupPythonListeners() {
    ttsKrShell.on('message', (message) => log.info(`[TTS_KR_MSG] ${message}`));
    ttsKrShell.on('stderr', (stderr) => log.warn(`[TTS_KR_ERR] ${stderr}`));

    ttsEnShell.on('message', (message) => log.info(`[TTS_EN_MSG] ${message}`));
    ttsEnShell.on('stderr', (stderr) => log.warn(`[TTS_EN_ERR] ${stderr}`));

    sttShell.on('message', (message) => log.info(`[STT_MSG] ${message}`));
    sttShell.on('stderr', (stderr) => log.warn(`[STT_ERR] ${stderr}`));
}

/**
 * [서비스] 파이프 클라이언트 모듈을 로드합니다.
 */
function loadPipeClients() {
    try {
        ttsPipeClient = require('../voice/ttsPipeClient');
        ttsPipeClientEN = require('../voice/ttsPipeClientEN');
        sttPipeClient = require('../voice/sttPipeClient');
        log.info("[Python] 모든 파이프 클라이언트 모듈 로드 완료.");
        setupPipeListeners();
    } catch (e) {
        log.error(`[Python FATAL] 파이프 클라이언트 로드 실패: ${e.message}`);
    }
}

/**
 * [서비스] 파이프 클라이언트를 Python 서버에 연결합니다.
 */
function connectPipeClients() {
    setTimeout(() => {
        if (ttsPipeClient) ttsPipeClient.connect();
        if (ttsPipeClientEN) ttsPipeClientEN.connect();
        if (sttPipeClient) sttPipeClient.connect();
        log.info("[Python] 모든 파이프 클라이언트 연결 시도.");
    }, 1500);
}

/**
 * [서비스] 파이프 클라이언트 이벤트 리스너
 */
function setupPipeListeners() {
    if (ttsPipeClient) {
        ttsPipeClient.on('playback-finished', () => { if (win) win.webContents.send('tts:playback-finished'); });
        ttsPipeClient.on('connected', () => log.info("[Main] TTS (KR) 파이프 연결됨."));
        ttsPipeClient.on('error', (err) => log.error(`[Main ERROR] TTS (KR) 파이프 오류: ${err.message}`));
    }
    if (ttsPipeClientEN) {
        ttsPipeClientEN.on('playback-finished', () => { if (win) win.webContents.send('tts:playback-finished'); });
        ttsPipeClientEN.on('connected', () => log.info("[Main] TTS (EN) 파이프 연결됨."));
        ttsPipeClientEN.on('error', (err) => log.error(`[Main ERROR] TTS (EN) 파이프 오류: ${err.message}`));
    }
    if (sttPipeClient) {
        sttPipeClient.on('stt:data', (jsonData) => {
            if (win) {
                if (jsonData.type === 'result') win.webContents.send('speech:result', jsonData.text);
                else if (jsonData.type === 'interim') win.webContents.send('speech:interim-result', jsonData.text);
                else if (jsonData.type === 'error') win.webContents.send('speech:error', jsonData.message);
            }
        });
        sttPipeClient.on('connected', () => log.info("[Main] STT 파이프 연결됨."));
        sttPipeClient.on('error', (err) => log.error(`[Main ERROR] STT 파이프 오류: ${err.message}`));
    }
}

function cleanupPythonServices() {
    log.info("[Python] PythonShell 프로세스 종료 시도.");
    try {
        if (ttsKrShell) ttsKrShell.terminate();
        if (ttsEnShell) ttsEnShell.terminate();
        if (sttShell) sttShell.terminate();
        log.info("[Python] 모든 PythonShell 프로세스가 종료되었습니다.");
    } catch (e) {
        log.error(`[Python] 종료 중 오류: ${e.message}`);
    }
}

module.exports = { initializePythonServices, cleanupPythonServices };