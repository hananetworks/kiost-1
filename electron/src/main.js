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
// [수정] 오타 방지를 위해 import한 이름 그대로 사용
const { registerAllIpcHandlers } = require('./ipc/ipcManager');
const { ensurePythonEnvironment } = require('./pythonBootstrap');

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

    // (B) 윈도우 생성 (React 앱 실행 - 초기 상태는 'startup' 오버레이 표시 중)
    win = createWindow();

    // [중요 1] IPC 핸들러는 윈도우 생성 직후, UI 로딩 전에 등록해야 안전합니다.
    registerAllIpcHandlers(win);

    // (C) React UI 로딩 대기
    log.info("[Main] UI 로딩 대기 중...");
    await waitForUI(win);

    // UI가 로딩되었으므로 오버레이가 떠 있을 것입니다.
    log.info("[Main] UI 로딩 완료. 시스템 점검 시작.");

    // (D) 앱 업데이트 확인 (Blocking)
    // - 배포 버전일 때만 확인
    if (app.isPackaged) {
        try {
            win.webContents.send('update-checking'); // 오버레이: "업데이트 확인 중"
            const isUpdating = await checkForUpdatesBlocking(win);

            if (isUpdating) return; // 설치 중이면 여기서 종료

        } catch (err) {
            // [수정] 에러가 나도 멈추지 말고 다음 단계로 넘어가게 처리
            log.error(`[Main] 업데이트 확인 실패 (무시하고 진행): ${err.message}`);
            // 에러 났으니 오버레이를 다시 '초기화 중'으로 돌려놓으라고 신호 보냄
            win.webContents.send('update-not-available');
        }
    }

    // (E) Python 환경 점검 & 실행
    try {
        let pyPath;
        if (app.isPackaged) {
            // [참고] ensurePythonEnvironment 내부에서 'python-download-start' 등의 이벤트를 보내 오버레이를 갱신함
            pyPath = await ensurePythonEnvironment(win);
        } else {
            log.info("[Main] 개발 모드: Python 다운로드 생략");
            pyPath = path.join(app.getPath('userData'), 'python-env', 'kiosk_python.exe');
        }

        // 파이썬 서버 시작
        initializePythonServices(win, pyPath);

    } catch (err) {
        log.error(`[Main] 파이썬 초기화 오류: ${err.message}`);
        // 파이썬 실패 시 사용자에게 알림을 띄우거나, 에러 오버레이 유지 가능
        // 여기서는 일단 진행하도록 둠 (필요 시 수정)
    }

    // (F) 나머지 기능 활성화
    startResourceLogging();
    if (app.isPackaged) initializeUpdater(win); // 백그라운드 주기적 감시 시작

    // 개발 모드 F12
    if (!app.isPackaged) {
        globalShortcut.register("F12", () => win.webContents.toggleDevTools());
    }

    // [핵심] 모든 점검 완료! React에게 "이제 메인 화면 보여줘" 신호 전송
    log.info("[Main] 모든 초기화 완료. 키오스크 메인 화면 진입.");

    // (선택사항) 사용자가 "완료" 문구를 0.5초라도 볼 수 있게 짧은 딜레이
    setTimeout(() => {
        win.webContents.send('app-ready');
    }, 500);
});