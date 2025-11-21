/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');

// [모듈 로드]
const { log, initializeLogging, startResourceLogging } = require('./logging/logger');
const { initializeConfig } = require('./config/setup');
// [수정] 업데이트 매니저에서 차단(Blocking) 함수와 초기화 함수 둘 다 가져오기
const { initializeUpdater, checkForUpdatesBlocking } = require('./updater/updateManager');
const { initializePythonServices, cleanupPythonServices } = require('./services/python/python-server');
const { registerIpcHandlers } = require('./ipcHandlers');

// 파이썬 다운로더 모듈
const { ensurePythonEnvironment } = require('./pythonBootstrap');

let win; // BrowserWindow 인스턴스

// [중복 실행 방지]
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
}

// [GPU 설정]
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");

function createWindow() {
    log.info("[Main] createWindow 호출됨.");
    win = new BrowserWindow({
        kiosk: true,
        frame: false,
        width: 1080,
        height: 1920,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: false
        },
    });

    const urlToLoad = app.isPackaged
        ? "http://localhost:3000/#/"
        : "http://localhost:4000/#/";

    log.info(`[Main] URL 로드 시도: ${urlToLoad}`);
    win.loadURL(urlToLoad).catch(err => {
        log.error(`[Main] URL 로드 실패: ${err}`);
        dialog.showErrorBox('로드 오류', `애플리케이션 페이지 로드에 실패했습니다:\n${err}`);
    });

    win.once('ready-to-show', () => {
        log.info("[Main] Window가 표시 준비됨.");
        win.show();
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
        return;
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

// --- [핵심] 앱 실행 로직 ---
app.whenReady().then(async () => {

    // 1. 로깅 모듈 초기화
    initializeLogging();
    log.info("=============================================");
    log.info(`[Main] App 시작. Version: ${app.getVersion()}`);
    log.info(`[Main] OS: ${process.platform} ${process.arch}`);
    log.info("=============================================");

    // 2. 설정 초기화
    try {
        await initializeConfig();
    } catch (err) {
        log.error(`[Main FATAL] 설정 초기화 실패: ${err.message}`);
        dialog.showErrorBox("치명적인 오류", `설정 파일 로드에 실패했습니다:\n${err.message}\n\n앱을 종료합니다.`);
        app.quit();
        return;
    }

    // 3. Watchdog 설정
    process.on('unhandledRejection', (reason, promise) => {
        log.error(`[Watchdog] 처리되지 않은 Promise 거부: ${reason}`, promise);
    });
    app.on('render-process-gone', (event, webContents, details) => {
        log.error(`[Watchdog FATAL] 렌더러 프로세스 충돌: ${details.reason}`);
        dialog.showErrorBox("치명적인 오류", `UI 프로세스가 예기치 않게 종료되었습니다: ${details.reason}\n앱을 재시작합니다.`);
        app.relaunch();
        app.quit();
    });

    // ==========================================================================
    // [0순위] 앱 자체 업데이트 확인 (Electron 앱 업데이트)
    // ==========================================================================
    if (app.isPackaged) {
        try {
            const isUpdating = await checkForUpdatesBlocking();
            if (isUpdating) {
                log.info("[Main] ⛔ 업데이트가 감지되어 앱 구동을 중단하고 설치를 대기합니다.");
                return; // 업데이트 중이면 여기서 멈춤
            }
        } catch (err) {
            log.error(`[Main] 초기 업데이트 확인 중 오류 (무시하고 진행): ${err.message}`);
        }
    }

    // 4. 로컬 서버 시작 (패키징 시)
    if (app.isPackaged) {
        startLocalServer();
    }

    // 5. 메인 윈도우 생성 (여기서 win이 생성됨)
    createWindow();

    // ==========================================================================
    // [핵심 변경] 6. Python 환경 점검 및 서비스 초기화
    // ==========================================================================
    try {
        let pythonExePath;

        if (app.isPackaged) {
            // [배포 모드] 버전 체크 및 다운로드 수행 (win이 있어야 진행률 표시 가능)
            pythonExePath = await ensurePythonEnvironment(win);
        } else {
            // [개발 모드] 다운로드 로직 생략하고 로컬 경로 강제 지정
            log.info("[Main] 개발 모드: Python 다운로드 점검을 생략합니다.");

            // 개발 중 받아둔 python-env 폴더 경로 사용
            pythonExePath = path.join(app.getPath('userData'), 'python-env', 'kiosk_python.exe');
        }

        // 경로 유효성 검사 (개발 모드일 때 파일이 없으면 경고)
        if (!fs.existsSync(pythonExePath) && !app.isPackaged) {
            log.warn(`[Main Warning] 개발 모드인데 Python 파일이 없습니다: ${pythonExePath}`);
            log.warn("최초 1회는 배포 모드로 빌드하여 실행하거나, 수동으로 파일을 해당 위치에 복사해야 합니다.");
        }

        // 서비스 시작
        initializePythonServices(win, pythonExePath);

    } catch (err) {
        log.error(`[Main FATAL] AI 엔진 초기화 실패: ${err.message}`);
        dialog.showErrorBox("오류", "AI 엔진 초기화에 실패했습니다.");
    }
    // ==========================================================================

    // 7. IPC 핸들러 등록
    registerIpcHandlers(win);
    log.info("[Main] IPC 핸들러 등록 완료.");

    // 8. 시스템 리소스 로깅 시작
    startResourceLogging();

    // 9. 백그라운드 업데이트 모듈 초기화 (주기적 체크용)
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

// 예외 처리
process.on('uncaughtException', (error) => {
    log.error(`[Watchdog FATAL] 처리되지 않은 예외: ${error.message}\n${error.stack}`);
    dialog.showErrorBox("예상치 못한 오류", `오류가 발생했습니다: ${error.message}`);
});