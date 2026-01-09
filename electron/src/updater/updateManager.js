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
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// [설정] 자동 다운로드 활성화
autoUpdater.autoDownload = true;
autoUpdater.allowPrerelease = false;

// [설정] 최대 재시도 횟수
const MAX_RETRIES = 3;

/**
 * 앱 시작 최우선 순위: 업데이트 확인 (재시도 로직 포함)
 * win 객체를 받아 UI에 상태를 알림
 */
async function checkForUpdatesBlocking(win) {
    log.info("[Updater] 🔍 시작 전 업데이트 확인 중... (Blocking Check + Retry)");

    // 1. 인증 설정
    setupAuth();

    // 2. 재시도 루프
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log.info(`[Updater] 업데이트 시도 ${attempt}/${MAX_RETRIES}...`);
            if (win) win.webContents.send('update-checking');

            const result = await runUpdateCheck(win);

            if (result === 'UPDATE_FOUND') return true; // 설치 중 -> 앱 시작 중단
            if (result === 'NO_UPDATE') return false; // 없음 -> 앱 시작

        } catch (err) {
            log.warn(`[Updater] ${attempt}회차 실패: ${err.message}`);

            if (attempt < MAX_RETRIES) {
                log.info("[Updater] 2초 후 재시도합니다...");
                await new Promise(r => setTimeout(r, 2000));
            } else {
                log.error("[Updater] ❌ 업데이트 실패 (최대 재시도 초과). 현재 버전으로 앱을 시작합니다.");
                if (win) win.webContents.send('update-error', err.message);
                return false;
            }
        }
    }
    return false;
}

/**
 * 인증 설정
 */
function setupAuth() {
    try {
        const envPath = app.isPackaged
            ? path.join(process.resourcesPath, '.env')
            : path.join(__dirname, '../../.env');

        if (fs.existsSync(envPath)) {
            const envConfig = dotenv.parse(fs.readFileSync(envPath));
            if (envConfig.GH_TOKEN) {
                process.env.GH_TOKEN = envConfig.GH_TOKEN;
                autoUpdater.setFeedURL({
                    provider: 'github',
                    owner: 'hananetworks',
                    repo: 'kiost-1',
                    private: true,
                    token: envConfig.GH_TOKEN
                });
                autoUpdater.requestHeaders = { "Authorization": `token ${envConfig.GH_TOKEN}` };
                log.info("[Updater] Private Repo 인증(setFeedURL) 설정 완료.");
            }
        }
    } catch (e) {
        log.error(`[Updater] 인증 설정 중 오류: ${e.message}`);
    }
}

/**
 * 실제 업데이트 체크 및 이벤트 핸들링
 */
function runUpdateCheck(win) {
    return new Promise((resolve, reject) => {
        // [추가] 현재 설치된 앱 버전 가져오기
        const currentVersion = app.getVersion();
        log.info(`[Updater] 현재 키오스크 버전: v${currentVersion}`); // 시작 시 버전 명시

        // 1. 타임아웃 설정 (15초)
        let timer = setTimeout(() => {
            cleanup();
            reject(new Error("Check Timeout (15s)"));
        }, 15000);

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            autoUpdater.removeAllListeners('update-available');
            autoUpdater.removeAllListeners('update-not-available');
            autoUpdater.removeAllListeners('update-downloaded');
            autoUpdater.removeAllListeners('error');
            autoUpdater.removeAllListeners('download-progress');
        };

        // 2. 업데이트 발견됨
        autoUpdater.once('update-available', (info) => {
            if (timer) clearTimeout(timer);
            timer = null;
            log.info(`[Updater] 🚀 새 버전 발견! (v${currentVersion} -> v${info.version}). 다운로드 시작...`);
            if (win) win.webContents.send('update-available', info);
        });

        // 3. 다운로드 진행률 전송
        autoUpdater.on('download-progress', (progressObj) => {
            if (win) win.webContents.send('download-progress', progressObj);
        });

        // 4. 다운로드 완료 -> 설치
        autoUpdater.once('update-downloaded', (info) => {
            cleanup();
            log.info(`[Updater] ✅ v${info.version} 다운로드 완료. 재시작 및 설치를 진행합니다.`);
            if (win) win.webContents.send('update-downloaded', info);

            setTimeout(() => {
                autoUpdater.quitAndInstall(false, true);
            }, 3000);
            resolve('UPDATE_FOUND');
        });

        // 5. 업데이트 없음 -> 종료
        autoUpdater.once('update-not-available', (info) => {
            cleanup();
            // [수정] 버전 번호를 포함하여 로그 출력
            log.info(`[Updater] 현재 최신 버전(v${currentVersion})을 사용 중입니다.`);
            if (win) win.webContents.send('update-not-available');
            resolve('NO_UPDATE');
        });

        // 6. 에러 발생
        autoUpdater.once('error', (err) => {
            cleanup();
            reject(err);
        });

        // 체크 시작
        autoUpdater.checkForUpdates();
    });
}

function initializeUpdater(mainWindow) {
    log.info("[Updater] 백그라운드 업데이트 모듈 초기화.");
    // 1시간마다 백그라운드 체크
    setInterval(() => { autoUpdater.checkForUpdates().catch(e => {}); }, 60 * 60 * 1000);
}

function setInactivityStatus(status) {}

module.exports = {
    initializeUpdater,
    setInactivityStatus,
    checkForUpdatesBlocking
};