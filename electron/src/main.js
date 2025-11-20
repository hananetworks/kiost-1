/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');

// [신규] 모듈 로드
const { log, initializeLogging, startResourceLogging } = require('./logging/logger');
const { initializeConfig } = require('./config/setup');
const { initializeUpdater } = require('./updater/updateManager');
const { initializePythonServices, cleanupPythonServices } = require('./services/python');
const { registerIpcHandlers } = require('./ipcHandlers'); // IPC 핸들러

// [추가] 파이썬 다운로더 모듈 로드
const { ensurePythonEnvironment } = require('./pythonBootstrap');

let win; // BrowserWindow 인스턴스

// [신규] 중복 실행 방지 (키오스크 필수 기능)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // 두 번째 인스턴스가 실행되려고 하면, 기존 창을 활성화
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
}

// [신규] GPU 설정 (원본 유지 - AI 성능 최적화)
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");

// [신규] 작업 표시줄 숨기기 (키오스크 필수 기능 - 추후 구현 필요)
// const { hideTaskbar, showTaskbar } = require('./utils/taskbar'); // 예시


function createWindow() {
    log.info("[Main] createWindow 호출됨.");
    win = new BrowserWindow({
        kiosk: true,
        frame: false, // 키오스크 모드에서는 false가 일반적
        width: 1080,
        height: 1920,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"), // 경로 동일
            contextIsolation: true,
            sandbox: false
        },
    });

    const urlToLoad = app.isPackaged
        ? "http://localhost:3000/#/"
        // [수정] React Router(HashRouter)를 위해 '#' 추가
        : "http://localhost:4000/#/";

    log.info(`[Main] URL 로드 시도: ${urlToLoad}`);
    win.loadURL(urlToLoad).catch(err => {
        log.error(`[Main] URL 로드 실패: ${err}`);
        dialog.showErrorBox('로드 오류', `애플리케이션 페이지 로드에 실패했습니다:\n${err}`);
    });

    win.once('ready-to-show', () => {
        log.info("[Main] Window가 표시 준비됨.");
        win.show();
        // hideTaskbar(); // 키오스크 모드 시작
        if (!app.isPackaged) {
            win.webContents.openDevTools({ mode: "detach" });
        }
    });

    win.on('closed', () => {
        win = null;
    });
}

function startLocalServer() {
    const server = express();
    const distPath = path.join(app.getAppPath(), 'dist');
    log.info(`[Main] 로컬 서버 시작. dist 경로: ${distPath}`);

    if (!fs.existsSync(distPath)) {
        log.error(`[Main Error] dist 디렉토리를 찾을 수 없음: ${distPath}`);
        return; // 오류 발생 시 바로 리턴
    }

    server.use(express.static(distPath));
    server.get('/', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });

    const PORT = 3000;
    server.listen(PORT, 'localhost', () => {
        log.info(`✅ 로컬 서버가 http://localhost:${PORT} 에서 시작되었습니다.`);
    }).on('error', (err) => {
        log.error(`[Main Error] 로컬 서버 시작 실패: ${err}`);
    });
}

// --- [신규] 앱 실행 로직 (순서가 중요) ---
app.whenReady().then(async () => {

    // 1. 로깅 모듈 초기화 (가장 먼저)
    initializeLogging();
    log.info("=============================================");
    log.info(`[Main] App 시작. Version: ${app.getVersion()}`);
    log.info(`[Main] OS: ${process.platform} ${process.arch}`);
    log.info("=============================================");

    // 2. 보안 및 설정 모듈 초기화 (치명적)
    try {
        await initializeConfig(); // settings.txt, .env 로드
    } catch (err) {
        log.error(`[Main FATAL] 설정 초기화 실패: ${err.message}`);
        dialog.showErrorBox("치명적인 오류", `설정 파일 로드에 실패했습니다:\n${err.message}\n\n앱을 종료합니다.`);
        app.quit();
        return;
    }

    // 3. 안정성 Watchdog 추가
    process.on('unhandledRejection', (reason, promise) => {
        log.error(`[Watchdog] 처리되지 않은 Promise 거부: ${reason}`, promise);
    });
    app.on('render-process-gone', (event, webContents, details) => {
        log.error(`[Watchdog FATAL] 렌더러 프로세스 충돌: ${details.reason}`);
        dialog.showErrorBox("치명적인 오류", `UI 프로세스가 예기치 않게 종료되었습니다: ${details.reason}\n앱을 재시작합니다.`);
        app.relaunch(); // UI 충돌 시 앱 자동 재시작
        app.quit();
    });

    // 4. 로컬 서버 시작 (패키징 시)
    if (app.isPackaged) {
        startLocalServer();
    }

    // 5. 메인 윈도우 생성 (로딩 화면을 보여주기 위해 먼저 생성)
    createWindow();

    // 6. [수정] Python 환경 점검 및 서비스 초기화
    try {
        // 파이썬 환경이 없으면 다운로드 및 설치 (시간이 걸림)
        const pythonExePath = await ensurePythonEnvironment(win);

        // 확보된 파이썬 실행 파일 경로를 서비스에 전달
        initializePythonServices(win, pythonExePath);
    } catch (err) {
        log.error(`[Main FATAL] AI 엔진 초기화 실패: ${err.message}`);
        dialog.showErrorBox("오류", "AI 엔진 설치에 실패했습니다. 인터넷 연결을 확인해주세요.");
        // 필수 기능 실패 시 앱 종료 여부는 선택 (여기선 유지)
    }

    // 7. IPC 핸들러 등록
    registerIpcHandlers(win);
    log.info("[Main] IPC 핸들러 등록 완료.");

    // 8. 시스템 리소스 로깅 시작
    startResourceLogging();

    // 9. 자동 업데이트 모듈 초기화 (패키징 시)
    if (app.isPackaged) {
        initializeUpdater(win);
    }

    // 개발자 도구 토글
    if (!app.isPackaged) {
        globalShortcut.register("F12", () => {
            if (win) win.webContents.toggleDevTools();
        });
    }
});

app.on("window-all-closed", () => {
    // showTaskbar(); // 작업 표시줄 복구
    if (process.platform !== "darwin") app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 앱 종료 시 자원 정리
app.on("will-quit", () => {
    log.info("[Main] will-quit: 앱 종료 시작.");
    cleanupPythonServices(); // Python 프로세스 정리
    globalShortcut.unregisterAll();
    log.info("[Main] 앱 종료 완료.");
});

// 기존 uncaughtException 핸들러 (electron-log 사용)
process.on('uncaughtException', (error) => {
    log.error(`[Watchdog FATAL] 처리되지 않은 예외: ${error.message}\n${error.stack}`);
    dialog.showErrorBox("예상치 못한 오류", `오류가 발생했습니다: ${error.message}`);
    // process.exit(1); // 바로 종료보다는 로깅 후 종료 권장
});