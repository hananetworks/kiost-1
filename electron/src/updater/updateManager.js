const { autoUpdater } = require('electron-updater');
const { log } = require('../logging/logger');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// [수정] 자동 다운로드 비활성화 (업데이트가 있어도 받지 않음)
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;

// [설정] 최대 재시도 횟수
const MAX_RETRIES = 3;

/**
 * [수정됨] 앱 시작 시 업데이트 확인 로직을 무력화함
 */
async function checkForUpdatesBlocking() {
    log.info("[Updater] 🚫 자동 업데이트 기능이 비활성화되어 있습니다. 업데이트 확인을 건너뜁니다.");

    // 강제로 '업데이트 없음'으로 처리하여 앱이 바로 실행되게 함
    return false;
}

/**
 * [내부 함수] 인증 설정 (사용 안 함)
 */
function setupAuth() {
    // ... 기존 코드 유지 (호출되지 않음) ...
}

/**
 * [내부 함수] 업데이트 체크 로직 (사용 안 함)
 */
function runUpdateCheck() {
    // ... 기존 코드 유지 (호출되지 않음) ...
}

function initializeUpdater(mainWindow) {
    log.info("[Updater] 백그라운드 업데이트 모듈이 비활성화 상태입니다.");
    // 주기적인 확인 로직(setInterval)도 주석 처리하여 백그라운드 체크 방지
    // setInterval(() => { autoUpdater.checkForUpdates().catch(e => {}); }, 60 * 60 * 1000);
}

function setInactivityStatus(status) {}

module.exports = {
    initializeUpdater,
    setInactivityStatus,
    checkForUpdatesBlocking
};