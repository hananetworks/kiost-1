const { app, globalShortcut, dialog } = require('electron');
const { log } = require('../logging/logger');
const { cleanupPythonServices } = require('../services/python/python-server');

function setupAppEvents() {
    // 1. 중복 실행 방지 (Lock)
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return false; // 실행 중단 신호
    }

    // 2. GPU 및 성능 설정
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    app.commandLine.appendSwitch("enable-zero-copy");
    app.commandLine.appendSwitch("ignore-gpu-blacklist");
    app.commandLine.appendSwitch("disable-frame-rate-limit");
    app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");

    // 3. 렌더러 프로세스 충돌 감시 (Watchdog)
    app.on('render-process-gone', (event, webContents, details) => {
        log.error(`[Watchdog] 렌더러 충돌: ${details.reason}`);
        dialog.showErrorBox("오류", "UI 프로세스 충돌. 재시작합니다.");
        app.relaunch();
        app.quit();
    });

    // 4. 앱 종료 시 정리
    app.on("will-quit", () => {
        log.info("[Main] 앱 종료. 리소스 정리 중...");
        cleanupPythonServices();
        globalShortcut.unregisterAll();
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });

    // 5. 예외 처리 (Uncaught Exception)
    process.on('uncaughtException', (error) => {
        log.error(`[Fatal Error] ${error.message}`);
        log.error(error.stack);

        const runTime = process.uptime();
        if (runTime < 10) {
            app.exit(1); // 10초 내 충돌은 재시작 안 함
        } else {
            setTimeout(() => { app.relaunch(); app.exit(0); }, 1000);
        }
    });

    return true; // 정상 진행
}

module.exports = { setupAppEvents };