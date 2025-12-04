/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// [기존 모듈 로드]
const { log, initializeLogging, startResourceLogging } = require('./logging/logger');
const { initializeConfig } = require('./config/setup');
const { initializeUpdater, checkForUpdatesBlocking } = require('./updater/updateManager');
const { initializePythonServices } = require('./services/python/python-server');
const { registerAllIpcHandlers } = require('./ipc/ipcManager');
const { ensurePythonEnvironment } = require('./pythonBootstrap');

const { startLocalServer } = require('./startup/localServer');
const { createWindow, waitForUI } = require('./startup/windowManager');
const { setupAppEvents } = require('./startup/appEvents');

// 1. 앱 이벤트 설정
if (!setupAppEvents()) return;

let win;

app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
    }
});

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
    registerAllIpcHandlers(win);

    // (C) React UI 로딩 대기
    log.info("[Main] UI 로딩 대기 중...");
    await waitForUI(win);
    log.info("[Main] UI 로딩 완료. 시스템 점검 시작.");

    // ============================================================
    // [핵심] 최후의 안전장치: 10초 뒤에는 무조건 앱을 켭니다.
    // (로직이 중간에 멈추거나 에러가 나도 키오스크는 켜져야 하니까요)
    // ============================================================
    let safetyTimer = setTimeout(() => {
        log.warn("[Main] ⚠️ 초기화 시간이 너무 오래 걸려 강제로 앱을 실행합니다.");
        if (win && !win.isDestroyed()) {
            win.webContents.send('app-ready');
        }
    }, 60000); // 10초 타임아웃

    // 앱 여는 함수 (정상 종료 시 호출)
    const openApp = () => {
        if (safetyTimer) clearTimeout(safetyTimer); // 안전장치 해제

        log.info("[Main] 모든 점검 종료. 메인 화면 진입 신호 전송.");
        startResourceLogging();
        if (app.isPackaged) initializeUpdater(win);

        if (!app.isPackaged) {
            globalShortcut.register("F12", () => win.webContents.toggleDevTools());
        }

        setTimeout(() => {
            if (!win.isDestroyed()) win.webContents.send('app-ready');
        }, 500);
    };

    let shouldOpenApp = true;

    try {
        // (D) 앱 업데이트 확인 (Blocking)
        if (app.isPackaged) {
            try {
                win.webContents.send('update-checking');
                const isUpdating = await checkForUpdatesBlocking(win);

                // 업데이트 설치 중이면 앱을 열지 않음 (재시작 대기)
                if (isUpdating) {
                    shouldOpenApp = false;
                    if (safetyTimer) clearTimeout(safetyTimer); // 설치 중엔 타임아웃 해제
                    return;
                }
            } catch (err) {
                log.error(`[Main] 업데이트 확인 오류: ${err.message}`);
                win.webContents.send('update-not-available'); // UI 원복
            }
        }

        // (E) Python 환경 점검 & 실행
        try {
            log.info("[Main] Python/AI 엔진 점검 시작...");
            let pyPath;
            if (app.isPackaged) {
                pyPath = await ensurePythonEnvironment(win);
            } else {
                // 개발 모드 경로
                pyPath = path.join(app.getPath('userData'), 'python-env', 'kiosk_python.exe');
            }

            // 파이썬 서버 시작 (여기서 에러나도 catch로 넘어감)
            initializePythonServices(win, pyPath);
            log.info("[Main] Python 서비스 시작 완료.");

        } catch (err) {
            log.error(`[Main] 파이썬 초기화 실패 (앱 실행은 계속함): ${err.message}`);
        }

    } finally {
        // [결론] 업데이트 설치 중만 아니면 무조건 문을 연다!
        if (shouldOpenApp) {
            openApp();
        }
    }
});