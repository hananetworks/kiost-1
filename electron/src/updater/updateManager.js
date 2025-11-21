// const { autoUpdater } = require('electron-updater');
// const { log } = require('../logging'); // 로깅 모듈 사용
//
// let win;
// let isInactivityMode = true; // 앱 시작 시 유휴 상태로 가정
//
// /**
//  * [업데이트] 업데이트 리스너 및 로직 초기화
//  */
// function initializeUpdater(mainWindow) {
//     win = mainWindow;
//     log.info("[Updater] 업데이트 모듈 초기화.");
//
//     autoUpdater.autoDownload = true; // 업데이트 발견 시 자동 다운로드
//
//     autoUpdater.on('checking-for-update', () => {
//         log.info('[Updater] 업데이트 확인 중...');
//     });
//     autoUpdater.on('update-available', (info) => {
//         log.info(`[Updater] 새 업데이트 발견: ${info.version}`);
//     });
//     autoUpdater.on('update-not-available', (info) => {
//         log.info('[Updater] 현재 최신 버전입니다.');
//     });
//     autoUpdater.on('error', (err) => {
//         log.error(`[Updater Error] 업데이트 중 오류 발생: ${err}`);
//     });
//     autoUpdater.on('download-progress', (progressObj) => {
//         // 로그 파일 용량을 아끼기 위해 debug 레벨로 하향
//         log.debug(`[Updater] 다운로드 속도: ${progressObj.bytesPerSecond} - ${progressObj.percent}%`);
//     });
//
//     // [핵심] 다운로드가 완료됐을 때
//     autoUpdater.on('update-downloaded', (info) => {
//         log.info('[Updater] 업데이트 다운로드 완료. 유휴 상태 시 설치 및 재시작합니다.');
//
//         // 1. 유휴 상태(isInactivityMode)가 맞는지 확인
//         if (isInactivityMode) {
//             log.info('[Updater] 유휴 상태이므로 즉시 업데이트 설치.');
//             // 2. (Silent Install) 사용자 확인 없이 즉시 설치 및 재시작
//             autoUpdater.quitAndInstall(true, true);
//         } else {
//             // 3. 사용 중이라면, 설치를 '대기'
//             log.info('[Updater] 사용 중이므로 업데이트 설치 대기.');
//             // (필요시) React(UI)에 "업데이트 준비됨" 신호를 보낼 수 있음
//             // win.webContents.send('update-ready-to-install');
//         }
//     });
//
//     // 지능형 스케줄링 시작
//     scheduleUpdateChecks();
// }
//
// /**
//  * [운영] React(UI)로부터 유휴 상태를 받습니다. (ipcHandlers가 호출)
//  */
// function setInactivityStatus(status) {
//     // 상태가 변경될 때만 로그를 남김
//     if (isInactivityMode !== status) {
//         isInactivityMode = status;
//         log.info(`[Updater] 유휴 상태 변경: ${isInactivityMode}`);
//     }
//
//     // 만약 유휴 상태가 되었고(true), 이미 다운로드된 업데이트가 있다면
//     if (isInactivityMode && autoUpdater.downloadedUpdatePath) {
//         log.info('[Updater] 유휴 상태 진입, 대기 중이던 업데이트 설치.');
//         autoUpdater.quitAndInstall(true, true);
//     }
// }
//
// /**
//  * [운영] 서버 부하 분산을 위한 랜덤 시간 업데이트 스케줄링
//  */
// function scheduleUpdateChecks() {
//     // (예) 매일 새벽 4시 0분 ~ 30분 사이 랜덤한 시간에 확인
//     const hour = 4;
//     const minuteStart = 0;
//     const minuteEnd = 30;
//
//     const now = new Date();
//     let targetTime = new Date();
//     targetTime.setHours(hour, minuteStart, 0, 0);
//
//     // 이미 시간이 지났으면 다음 날로
//     if (now > targetTime) {
//         targetTime.setDate(targetTime.getDate() + 1);
//     }
//
//     // 랜덤 시간 추가
//     const randomMinutes = Math.floor(Math.random() * (minuteEnd - minuteStart));
//     targetTime.setMinutes(targetTime.getMinutes() + randomMinutes);
//
//     const delay = targetTime.getTime() - now.getTime();
//
//     log.info(`[Updater] 다음 자동 업데이트 확인 예약: ${targetTime.toLocaleString()}`);
//
//     setTimeout(() => {
//         log.info('[Updater] 예약된 업데이트 확인 시작.');
//         autoUpdater.checkForUpdates();
//
//         // 24시간마다 다시 스케줄링
//         setInterval(() => {
//             log.info('[Updater] 24시간 주기 업데이트 확인 시작.');
//             autoUpdater.checkForUpdates();
//         }, 24 * 60 * 60 * 1000);
//
//     }, delay);
// }
//
// module.exports = {
//     initializeUpdater,
//     setInactivityStatus // ◀ IPC 핸들러에서 이 함수를 호출할 수 있도록 export
// }; => 유후 상태에서 업데이트.

const { autoUpdater } = require('electron-updater');
const { log } = require('../logging/logger');

let win;

// [설정] 자동 다운로드 활성화
autoUpdater.autoDownload = true;
autoUpdater.allowPrerelease = false;

/**
 * [신규] 앱 시작 최우선 순위: 업데이트 확인을 '기다리는' 함수
 * @returns {Promise<boolean>} true: 업데이트 있음(앱 시작 중단), false: 없음(계속 진행)
 */
function checkForUpdatesBlocking() {
    log.info("[Updater] 시작 전 업데이트 확인 중... (Blocking Check)");

    // [중요] Private 리포지토리 토큰 설정 (없으면 Public으로 동작)
    if (process.env.GH_TOKEN) {
        autoUpdater.requestHeaders = { "PRIVATE-TOKEN": process.env.GH_TOKEN };
    }

    return new Promise((resolve) => {
        // 1. 업데이트 발견됨 -> true 반환 (Main에서 Python 로드 중단시킴)
        autoUpdater.once('update-available', (info) => {
            log.info(`[Updater] 🚀 새 버전 발견! (${info.version}). 다운로드를 시작하며 앱 구동을 일시 중지합니다.`);
            resolve(true);
        });

        // 2. 업데이트 없음 -> false 반환 (Main이 Python 로드 진행)
        autoUpdater.once('update-not-available', (info) => {
            log.info('[Updater] 현재 최신 버전입니다. 앱 구동을 계속합니다.');
            resolve(false);
        });

        // 3. 에러 발생 -> false 반환 (키오스크는 켜져야 하므로)
        autoUpdater.once('error', (err) => {
            log.error(`[Updater] 초기 업데이트 확인 실패: ${err.message}`);
            resolve(false);
        });

        // [안전장치] 5초 동안 응답 없으면 무시하고 켬 (인터넷 느릴 때 멈춤 방지)
        setTimeout(() => {
            log.warn("[Updater] 업데이트 서버 응답 시간 초과. 일단 앱을 시작합니다.");
            resolve(false);
        }, 5000);

        autoUpdater.checkForUpdates();
    });
}

/**
 * [기존 로직] 업데이트 리스너 및 주기적 확인 초기화
 */
function initializeUpdater(mainWindow) {
    win = mainWindow;
    log.info("[Updater] 백그라운드 업데이트 모듈 초기화.");

    // 리스너 초기화 (중복 방지 위해 removeAllListeners 권장되지만 여기선 생략)

    autoUpdater.on('download-progress', (progressObj) => {
        log.info(`[Updater] 다운로드 속도: ${progressObj.bytesPerSecond} - ${progressObj.percent}%`);
    });

    // 다운로드 완료 시 무조건 설치
    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Updater] ✅ 다운로드 완료. 3초 후 재시작하여 설치합니다.');
        setTimeout(() => {
            autoUpdater.quitAndInstall(true, true);
        }, 3000);
    });

    // (Blocking Check에서 이미 확인했으므로, 여기서는 주기적 확인만 스케줄링)
    setInterval(() => {
        log.info('[Updater] 주기적 업데이트 확인 (1시간 경과)...');
        autoUpdater.checkForUpdates();
    }, 60 * 60 * 1000);
}

// 호환성 유지
function setInactivityStatus(status) {}

module.exports = {
    initializeUpdater,
    setInactivityStatus,
    checkForUpdatesBlocking // [추가] export 필수
};