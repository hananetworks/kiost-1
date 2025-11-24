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
 * [신규] 앱 시작 최우선 순위: 업데이트 확인 (재시도 로직 포함)
 * @returns {Promise<boolean>} true: 업데이트 있음(앱 시작 중단), false: 없음(계속 진행)
 */
async function checkForUpdatesBlocking() {
    log.info("[Updater] 🔍 시작 전 업데이트 확인 중... (Blocking Check + Retry)");

    // 1. 인증 설정 (Private Repo 토큰 설정) - 기존에 잘 되던 코드 유지
    setupAuth();

    // 2. 재시도 루프 (최대 3회)
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            log.info(`[Updater] 업데이트 시도 ${attempt}/${MAX_RETRIES}...`);

            // 업데이트 체크 실행 (Promise)
            const result = await runUpdateCheck();

            // 결과 처리
            if (result === 'UPDATE_FOUND') {
                return true; // 업데이트 설치 중이므로 앱 시작 중단
            }
            if (result === 'NO_UPDATE') {
                return false; // 업데이트 없음 -> 앱 시작 계속
            }

        } catch (err) {
            log.warn(`[Updater] ${attempt}회차 실패: ${err.message}`);

            // 마지막 시도가 아니면 2초 대기 후 재시도
            if (attempt < MAX_RETRIES) {
                log.info("[Updater] 2초 후 재시도합니다...");
                await new Promise(r => setTimeout(r, 2000));
            } else {
                // 3번 다 실패하면 포기하고 앱 시작 (이게 롤백 효과)
                log.error("[Updater] ❌ 업데이트 실패 (최대 재시도 초과). 현재 버전으로 앱을 시작합니다.");
                return false;
            }
        }
    }
    return false;
}

/**
 * [내부 함수] 인증 설정 (사용자님의 기존 잘 되던 코드)
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

                // [핵심] Private Repo 설정 (setFeedURL)
                autoUpdater.setFeedURL({
                    provider: 'github',
                    owner: 'hananetworks',
                    repo: 'kiost-1',
                    private: true,
                    token: envConfig.GH_TOKEN
                });

                // [핵심] 헤더 강제 주입
                autoUpdater.requestHeaders = {
                    "Authorization": `token ${envConfig.GH_TOKEN}`
                };
                log.info("[Updater] Private Repo 인증(setFeedURL) 설정 완료.");
            } else {
                log.warn("[Updater] .env 파일은 있지만 GH_TOKEN이 없습니다.");
            }
        } else {
            log.warn(`[Updater] .env 파일을 찾을 수 없습니다: ${envPath}`);
        }
    } catch (e) {
        log.error(`[Updater] 인증 설정 중 오류: ${e.message}`);
    }
}

/**
 * [내부 함수] 실제 업데이트 체크 및 이벤트 핸들링
 * @returns {Promise<string>} 'UPDATE_FOUND', 'NO_UPDATE'
 */
function runUpdateCheck() {
    return new Promise((resolve, reject) => {
        // 10초 타임아웃 (무한 대기 방지)
        const timer = setTimeout(() => {
            reject(new Error("Timeout (10s)"));
        }, 10000);

        // 리스너 정리 함수
        const cleanUp = () => {
            clearTimeout(timer);
            autoUpdater.removeAllListeners('update-available');
            autoUpdater.removeAllListeners('update-not-available');
            autoUpdater.removeAllListeners('update-downloaded');
            autoUpdater.removeAllListeners('error');
            autoUpdater.removeAllListeners('download-progress');
        };

        // 1. 업데이트 발견 -> 다운로드 시작
        autoUpdater.once('update-available', (info) => {
            log.info(`[Updater] 🚀 새 버전 발견! (${info.version}). 다운로드를 시작합니다.`);
            // 여기서 resolve 하지 않고 download-progress/downloaded를 기다림
        });

        // 2. 다운로드 진행률
        autoUpdater.on('download-progress', (progressObj) => {
            log.info(`[Updater] 다운로드: ${parseInt(progressObj.percent)}% (${parseInt(progressObj.bytesPerSecond / 1024)} KB/s)`);
        });

        // 3. 다운로드 완료 -> 설치 및 재시작
        autoUpdater.once('update-downloaded', (info) => {
            cleanUp();
            log.info('[Updater] ✅ 다운로드 및 검증 완료. 설치를 위해 재시작합니다.');

            // 즉시 설치 및 재시작
            autoUpdater.quitAndInstall(true, true);

            resolve('UPDATE_FOUND');
        });

        // 4. 업데이트 없음
        autoUpdater.once('update-not-available', (info) => {
            cleanUp();
            log.info('[Updater] 현재 최신 버전입니다.');
            resolve('NO_UPDATE');
        });

        // 5. 에러 발생 (여기서 reject하면 위쪽 루프에서 잡아서 재시도함)
        autoUpdater.once('error', (err) => {
            cleanUp();
            log.error(`[Updater] 체크 중 에러: ${err.message}`);
            reject(err);
        });

        // 업데이트 체크 시작
        autoUpdater.checkForUpdates();
    });
}

/**
 * [기존 로직] 주기적 확인용 (앱이 켜진 뒤에 동작)
 */
function initializeUpdater(mainWindow) {
    log.info("[Updater] 백그라운드 업데이트 모듈 초기화.");
    // 주기적 확인 (에러나도 조용히 넘어감)
    setInterval(() => {
        autoUpdater.checkForUpdates().catch(e => {});
    }, 60 * 60 * 1000);
}

function setInactivityStatus(status) {}

module.exports = {
    initializeUpdater,
    setInactivityStatus,
    checkForUpdatesBlocking
};