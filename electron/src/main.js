/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express')
const dotenv = require('dotenv');

// [모듈 로드]
const { log, initializeLogging, startResourceLogging } = require('./logging/logger');
const { initializeConfig } = require('./config/setup');
const { initializeUpdater, checkForUpdatesBlocking } = require('./updater/updateManager');
const { initializePythonServices, cleanupPythonServices } = require('./services/python/python-server');
const { registerIpcHandlers } = require('./ipcHandlers');
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
            sandbox: false,
            webSecurity: false,
            allowRunningInsecureContent: true
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

app.whenReady().then(async () => {
    initializeLogging();
    log.info("=============================================");
    log.info(`[Main] App 시작. Version: ${app.getVersion()}`);

    try {
        const envPath = app.isPackaged
            ? path.join(process.resourcesPath, '.env')
            : path.join(__dirname, '../../.env');

        if (fs.existsSync(envPath)) {
            const envConfig = dotenv.parse(fs.readFileSync(envPath));
            if (envConfig.GH_TOKEN) {
                process.env.GH_TOKEN = envConfig.GH_TOKEN;
                log.info("[Main] .env에서 GH_TOKEN을 로드하여 process.env에 주입했습니다.");
            }
        }
    } catch (e) {
        log.error(`[Main] 토큰 로드 중 오류: ${e.message}`);
    }

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

    // 4. 로컬 서버 시작 (패키징 시) - *순서 변경됨 (먼저 실행)*
    if (app.isPackaged) {
        startLocalServer();
    }

    // 5. 메인 윈도우 생성 - *순서 변경됨 (먼저 실행)*
    createWindow();

    // 🛑 [수정] 단순 타임아웃 대신, 'did-finish-load' 이벤트를 기다림
    // React가 로딩되고 JS가 실행될 준비가 될 때까지 기다립니다.
    await new Promise(resolve => {
        // 이미 로드되었으면 즉시 진행
        if (!win.webContents.isLoading()) {
            resolve();
            return;
        }
        // 로딩 중이면 끝날 때까지 대기
        win.webContents.once('did-finish-load', resolve);
    });

    // 안전하게 1초만 더 여유를 줌 (React Hook 등록 시간 확보)
    await new Promise(r => setTimeout(r, 1500));


    // ==========================================================================
    // [0순위] 앱 자체 업데이트 확인 (화면에 진행바 뜸)
    // ==========================================================================
    if (app.isPackaged) {
        try {
            log.info("[Main] 📢 UI 로드 완료. 업데이트 체크 시작..."); // 로그 추가
            const isUpdating = await checkForUpdatesBlocking(win);

            if (isUpdating) {
                log.info("[Main] ⛔ 업데이트 설치 중... (앱 대기)");
                return;
            }
        } catch (err) {
            log.error(`[Main] 초기 업데이트 에러: ${err.message}`);
        }
    }

    // ==========================================================================
    // [1순위] Python 환경 점검 및 서비스 초기화 (화면에 진행바 뜸)
    // ==========================================================================
    try {
        let pythonExePath;

        if (app.isPackaged) {
            // win 객체를 전달하여 UI에 다운로드 진행률 표시
            pythonExePath = await ensurePythonEnvironment(win);
        } else {
            // 개발 모드
            log.info("[Main] 개발 모드: Python 다운로드 점검을 생략합니다.");
            pythonExePath = path.join(app.getPath('userData'), 'python-env', 'kiosk_python.exe');
        }

        // 경로 유효성 검사
        if (!fs.existsSync(pythonExePath) && !app.isPackaged) {
            log.warn(`[Main Warning] 개발 모드인데 Python 파일이 없습니다: ${pythonExePath}`);
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

app.on("will-quit", () => {
    log.info("[Main] will-quit: 앱 종료 시작.");
    cleanupPythonServices();
    globalShortcut.unregisterAll();
    log.info("[Main] 앱 종료 완료.");
});

process.on('uncaughtException', (error) => {
    log.error(`[Watchdog FATAL] 처리되지 않은 예외 발생: ${error.message}`);
    log.error(error.stack);

    const runTime = process.uptime();
    const MIN_UPTIME = 10;

    if (runTime < MIN_UPTIME) {
        log.error(`[Watchdog] 앱 실행 후 ${Math.floor(runTime)}초 만에 충돌. 재시작 중단.`);
        if (!app.isPackaged) {
            dialog.showErrorBox("치명적 오류", `앱 충돌 (${Math.floor(runTime)}초).\n${error.message}`);
        }
        app.exit(1);
        return;
    }

    log.info("[Watchdog] 1초 후 재시작합니다.");
    if (!app.isPackaged) {
        dialog.showErrorBox("오류 발생", `예기치 않은 오류가 발생했습니다.\n${error.message}`);
    }

    setTimeout(() => {
        app.relaunch();
        app.exit(0);
    }, 1000);
});