const { BrowserWindow, app, dialog } = require('electron');
const path = require('path');
const { log } = require('../logging/logger');

// 윈도우 생성 함수
function createWindow() {
    log.info("[Window] createWindow 호출됨.");

    const win = new BrowserWindow({
        kiosk: true,
        frame: false,
        width: 1080,
        height: 1920,
        show: false, // 로딩 전까지 숨김
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "../preload.js"), // 경로 주의 (상위 폴더)
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