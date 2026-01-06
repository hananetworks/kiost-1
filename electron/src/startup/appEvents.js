const { app, globalShortcut, dialog } = require('electron');
const { log } = require('../logging/logger');
const { cleanupPythonServices } = require('../services/python/python-server');

function setupAppEvents() {
    // 1. 중복 실행 방지
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return false;
    }

    // 2. GPU 없음/저사양 환경을 위한 성능 설정 수정
    // GPU 관련 강제 스위치를 제거하고 소프트웨어 렌더링을 유도합니다.
    app.disableHardwareAcceleration(); // 하드웨어 가속 완전히 끄기 (CPU 자원 확보)
    app.commandLine.appendSwitch("disable-gpu"); // GPU 사용 안 함
    app.commandLine.appendSwitch("disable-software-rasterizer"); // 소프트웨어 래스터라이저 비활성화
    app.commandLine.appendSwitch("disable-gpu-compositing"); // GPU 합성 비활성화
    app.commandLine.appendSwitch("disable-gpu-rasterization"); // GPU 래스터화 비활성화

    // 추가 성능 팁: 애니메이션 및 백그라운드 제한 완화
    app.commandLine.appendSwitch("disable-background-timer-throttling");
    app.commandLine.appendSwitch("disable-renderer-backgrounding");

    // 3. 렌더러 프로세스 충돌 감시
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

    // 5. 예외 처리
    process.on('uncaughtException', (error) => {
        log.error(`[Fatal Error] ${error.message}`);
        log.error(error.stack);
        const runTime = process.uptime();
        if (runTime < 10) {
            app.exit(1);
        } else {
            setTimeout(() => { app.relaunch(); app.exit(0); }, 1000);
        }
    });

    return true;
}

module.exports = { setupAppEvents };