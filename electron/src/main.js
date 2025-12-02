/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// [기존 모듈 로드]
const { log, initializeLogging, startResourceLogging } = require('./logging/logger');
const { initializeConfig } = require('./config/setup');
const { initializeUpdater, checkForUpdatesBlocking } = require('./updater/updateManager');
const { initializePythonServices, cleanupPythonServices } = require('./services/python/python-server');
const { registerIpcHandlers } = require('./ipcHandlers');
const { ensurePythonEnvironment } = require('./pythonBootstrap');

// 🛑 [경로 수정됨] core -> startup
const { startLocalServer } = require('./startup/localServer');
const { createWindow, waitForUI } = require('./startup/windowManager');
const { setupAppEvents } = require('./startup/appEvents');

// 1. 앱 이벤트 설정 (GPU, 중복실행방지, 에러핸들링 등)
if (!setupAppEvents()) return;

let win; // 전역 윈도우 객체

// 2. 두 번째 인스턴스 실행 시 기존 창 활성화
app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});

// 3. 앱 활성화 시 창 없으면 생성
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
});


// --- [메인 실행 흐름] ---
app.whenReady().then(async () => {
    initializeLogging();
    log.info("============== [ App Started ] ==============");

    // .env 로드
    try {
        const envPath = app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '../../.env');
        if (fs.existsSync(envPath)) {
            const env = dotenv.parse(fs.readFileSync(envPath));
            if (env.GH_TOKEN) process.env.GH_TOKEN = env.GH_TOKEN;
        }
    } catch (e) {}

    // 설정 초기화
    try { await initializeConfig(); } catch (err) { app.quit(); return; }

    // (A) 서버 시작
    startLocalServer();

    // (B) 윈도우 생성
    win = createWindow();

    // (C) React 로딩 대기 (안전장치: 3초)
    // 이 대기가 없으면 화면에 업데이트 바가 안 뜹니다!
    log.info("[Main] UI 로딩 대기 중...");
    await waitForUI(win);
    await new Promise(r => setTimeout(r, 3000));
    log.info("[Main] UI 준비 완료. 로직 시작.");

    // (D) 앱 업데이트 확인 (Blocking)
    if (app.isPackaged) {
        try {
            // win을 넘겨야 화면에 진행률이 나옵니다
            const isUpdating = await checkForUpdatesBlocking(win);
            if (isUpdating) return; // 업데이트 중이면 중단
        } catch (err) { log.error(err); }
    }

    // (E) Python 환경 점검 & 실행
    try {
        let pyPath;
        if (app.isPackaged) {
            // win을 넘겨야 화면에 다운로드 진행률이 나옵니다
            pyPath = await ensurePythonEnvironment(win);
        } else {
            log.info("[Main] 개발 모드: Python 다운로드 생략");
            pyPath = path.join(app.getPath('userData'), 'python-env', 'kiosk_python.exe');
        }
        initializePythonServices(win, pyPath);
    } catch (err) { log.error(err); }

    // (F) 나머지 기능 활성화
    registerIpcHandlers(win);
    startResourceLogging();
    if (app.isPackaged) initializeUpdater(win);

    // 개발 모드 F12
    if (!app.isPackaged) {
        globalShortcut.register("F12", () => win.webContents.toggleDevTools());
    }
});