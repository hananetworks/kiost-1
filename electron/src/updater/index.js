const { autoUpdater } = require('electron-updater');
const { log } = require('../logging'); // 로깅 모듈 사용

let win;
let isInactivityMode = true; // 앱 시작 시 유휴 상태로 가정

/**
 * [업데이트] 업데이트 리스너 및 로직 초기화
 */
function initializeUpdater(mainWindow) {
    win = mainWindow;
    log.info("[Updater] 업데이트 모듈 초기화.");

    autoUpdater.autoDownload = true; // 업데이트 발견 시 자동 다운로드

    autoUpdater.on('checking-for-update', () => {
        log.info('[Updater] 업데이트 확인 중...');
    });
    autoUpdater.on('update-available', (info) => {
        log.info(`[Updater] 새 업데이트 발견: ${info.version}`);
    });
    autoUpdater.on('update-not-available', (info) => {
        log.info('[Updater] 현재 최신 버전입니다.');
    });
    autoUpdater.on('error', (err) => {
        log.error(`[Updater Error] 업데이트 중 오류 발생: ${err}`);
    });
    autoUpdater.on('download-progress', (progressObj) => {
        // 로그 파일 용량을 아끼기 위해 debug 레벨로 하향
        log.debug(`[Updater] 다운로드 속도: ${progressObj.bytesPerSecond} - ${progressObj.percent}%`);
    });

    // [핵심] 다운로드가 완료됐을 때
    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Updater] 업데이트 다운로드 완료. 유휴 상태 시 설치 및 재시작합니다.');

        // 1. 유휴 상태(isInactivityMode)가 맞는지 확인
        if (isInactivityMode) {
            log.info('[Updater] 유휴 상태이므로 즉시 업데이트 설치.');
            // 2. (Silent Install) 사용자 확인 없이 즉시 설치 및 재시작
            autoUpdater.quitAndInstall(true, true);
        } else {
            // 3. 사용 중이라면, 설치를 '대기'
            log.info('[Updater] 사용 중이므로 업데이트 설치 대기.');
            // (필요시) React(UI)에 "업데이트 준비됨" 신호를 보낼 수 있음
            // win.webContents.send('update-ready-to-install');
        }
    });

    // 지능형 스케줄링 시작
    scheduleUpdateChecks();
}

/**
 * [운영] React(UI)로부터 유휴 상태를 받습니다. (ipcHandlers가 호출)
 */
function setInactivityStatus(status) {
    // 상태가 변경될 때만 로그를 남김
    if (isInactivityMode !== status) {
        isInactivityMode = status;
        log.info(`[Updater] 유휴 상태 변경: ${isInactivityMode}`);
    }

    // 만약 유휴 상태가 되었고(true), 이미 다운로드된 업데이트가 있다면
    if (isInactivityMode && autoUpdater.downloadedUpdatePath) {
        log.info('[Updater] 유휴 상태 진입, 대기 중이던 업데이트 설치.');
        autoUpdater.quitAndInstall(true, true);
    }
}

/**
 * [운영] 서버 부하 분산을 위한 랜덤 시간 업데이트 스케줄링
 */
function scheduleUpdateChecks() {
    // (예) 매일 새벽 4시 0분 ~ 30분 사이 랜덤한 시간에 확인
    const hour = 4;
    const minuteStart = 0;
    const minuteEnd = 30;

    const now = new Date();
    let targetTime = new Date();
    targetTime.setHours(hour, minuteStart, 0, 0);

    // 이미 시간이 지났으면 다음 날로
    if (now > targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
    }

    // 랜덤 시간 추가
    const randomMinutes = Math.floor(Math.random() * (minuteEnd - minuteStart));
    targetTime.setMinutes(targetTime.getMinutes() + randomMinutes);

    const delay = targetTime.getTime() - now.getTime();

    log.info(`[Updater] 다음 자동 업데이트 확인 예약: ${targetTime.toLocaleString()}`);

    setTimeout(() => {
        log.info('[Updater] 예약된 업데이트 확인 시작.');
        autoUpdater.checkForUpdates();

        // 24시간마다 다시 스케줄링
        setInterval(() => {
            log.info('[Updater] 24시간 주기 업데이트 확인 시작.');
            autoUpdater.checkForUpdates();
        }, 24 * 60 * 60 * 1000);

    }, delay);
}

module.exports = {
    initializeUpdater,
    setInactivityStatus // ◀ IPC 핸들러에서 이 함수를 호출할 수 있도록 export
};