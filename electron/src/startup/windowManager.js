const { BrowserWindow, app, dialog } = require('electron');
const path = require('path');
const { log } = require('../logging/logger');

// 윈도우 생성 함수
function createWindow() {
    log.info("[Window] createWindow 호출됨.");

    const win = new BrowserWindow({
        // [임시 수정] 배포/개발 상관없이 무조건 창 모드로 고정
        kiosk: false,       // 키오스크 모드 해제 (전체화면 X)
        frame: true,        // 창틀(X버튼, 최소화) 표시 (이동 가능하게)

        // 화면 크기도 작게 고정 (1080x1920의 절반)
        width: 540,
        height: 960,

        show: false, // 로딩 전까지 숨김
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "../preload.js"),
            contextIsolation: true,
            sandbox: false,
            webSecurity: false,
            allowRunningInsecureContent: true
        },
    });

    const urlToLoad = app.isPackaged
        ? "http://localhost:3000/#/"
        : "http://localhost:4000/#/";

    log.info(`[Window] URL 로드: ${urlToLoad}`);

    win.loadURL(urlToLoad).catch(err => {
        log.error(`[Window] 로드 실패: ${err}`);
        dialog.showErrorBox('로드 오류', `페이지 로드 실패:\n${err}`);
    });

    win.once('ready-to-show', () => {
        log.info("[Window] 화면 표시 준비 완료.");
        win.show();
        if (!app.isPackaged) win.webContents.openDevTools({ mode: "detach" });
    });

    return win;
}

// React 로딩 대기 함수 (Promise)
function waitForUI(win) {
    return new Promise(resolve => {
        if (!win.webContents.isLoading()) {
            resolve();
        } else {
            win.webContents.once('did-finish-load', resolve);
        }
    });
}

module.exports = { createWindow, waitForUI };