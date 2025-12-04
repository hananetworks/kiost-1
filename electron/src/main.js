/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut } = require('electron');
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

    // (B) 윈도우 생성 (React 앱 실행 - 초기 상태 'startup')
    win = createWindow();
    registerAllIpcHandlers(win);

    // (C) React UI 로딩 대기
    log.info("[Main] UI 로딩 대기 중...");
    await waitForUI(win);
    log.info("[Main] UI 로딩 완료. 시스템 점검 시작.");

    // ============================================================
    // [핵심 수정] 전체 로직을 try-finally로 감싸서 무조건 앱이 켜지게 보장
    // ============================================================
    let shouldOpenApp = true; // 앱을 열지 말지 결정하는 플래그

    try {
        // (D) 앱 업데이트 확인 (Blocking)
        if (app.isPackaged) {
            try {
                win.webContents.send('update-checking'); // 오버레이: "업데이트 확인 중"
                const isUpdating = await checkForUpdatesBlocking(win);

                // 업데이트가 진행 중이면(재시작 대기 중이면) 앱을 열면 안 됨!
                if (isUpdating) {
                    shouldOpenApp = false;
                    return;
                }
            } catch (err) {
                log.error(`[Main] 업데이트 확인 중 오류 (무시하고 진행): ${err.message}`);
                // 에러 나면 오버레이를 다시 '초기화 중'으로 돌려놓으라고 신호
                win.webContents.send('update-not-available');
            }
        }

        // (E) Python 환경 점검 & 실행
        try {
            let pyPath;
            if (app.isPackaged) {
                // 다운로드 필요 시 내부에서 오버레이 이벤트 발생
                pyPath = await ensurePythonEnvironment(win);
            } else {
                pyPath = path.join(app.getPath('userData'), 'python-env', 'kiosk_python.exe');
            }
            // 파이썬 서버 시작
            initializePythonServices(win, pyPath);

        } catch (err) {
            log.error(`[Main] 파이썬/서버 초기화 오류: ${err.message}`);
            // 에러가 나도 앱은 켜져야 하므로 catch만 하고 넘어감
        }

    } finally {
        // [여기가 해결책!]
        // 중간에 에러가 나든, 업데이트가 없든, 무슨 일이 있어도 여기는 실행됨.
        // 단, 업데이트 설치 중(shouldOpenApp === false)일 때는 실행 안 함.
        if (shouldOpenApp) {
            log.info("[Main] 모든 점검 종료. 메인 화면 진입 신호 전송.");
            startResourceLogging();
            if (app.isPackaged) initializeUpdater(win);

            if (!app.isPackaged) {
                globalShortcut.register("F12", () => win.webContents.toggleDevTools());
            }

            // 아주 짧은 텀을 주고 문을 엽니다.
            setTimeout(() => {
                if (!win.isDestroyed()) {
                    win.webContents.send('app-ready');
                }
            }, 500);
        }
    }
});