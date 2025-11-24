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

/**
 * [신규] 앱 시작 최우선 순위: 업데이트 확인을 '기다리는' 함수
 * @returns {Promise<boolean>} true: 업데이트 있음(앱 시작 중단), false: 없음(계속 진행)
 */
function checkForUpdatesBlocking() {
    log.info("[Updater] 🔍 시작 전 업데이트 확인 중... (Blocking Check)");

    // =======================================================================
    // [디버깅] 토큰 로드 과정 추적 로그 (이걸로 원인을 잡습니다)
    // =======================================================================
    try {
        let envPath;
        if (app.isPackaged) {
            // 배포된 앱의 경우: resources 폴더 안의 .env
            envPath = path.join(process.resourcesPath, '.env');
            log.info(`[Updater Debug] 배포 모드 감지. .env 경로: ${envPath}`);
        } else {
            // 개발 모드
            envPath = path.join(__dirname, '../../.env');
            log.info(`[Updater Debug] 개발 모드 감지. .env 경로: ${envPath}`);
        }

        if (fs.existsSync(envPath)) {
            log.info(`[Updater Debug] ✅ .env 파일을 찾았습니다!`);

            const envContent = fs.readFileSync(envPath, 'utf8'); // 내용 읽기
            const envConfig = dotenv.parse(envContent);

            if (envConfig.GH_TOKEN) {
                // 토큰 앞 5자리만 로그에 찍어서 확인 (보안상 전체 출력 X)
                const tokenPreview = envConfig.GH_TOKEN.substring(0, 5) + "...";
                log.info(`[Updater Debug] 🔑 토큰 로드 성공: ${tokenPreview}`);

                // 1. 환경변수 주입
                process.env.GH_TOKEN = envConfig.GH_TOKEN;

                // 2. 헤더 강제 설정 (Private Repo 필수)
                autoUpdater.requestHeaders = {
                    "Authorization": `token ${envConfig.GH_TOKEN}`
                };
                log.info("[Updater Debug] 헤더 설정 완료. 이제 업데이트를 확인합니다.");
            } else {
                log.error("[Updater Debug] ❌ .env 파일은 있지만 'GH_TOKEN' 값이 없습니다.");
                log.error(`[Updater Debug] 파일 내용 미리보기: ${envContent.substring(0, 50)}...`);
            }
        } else {
            log.error(`[Updater Debug] ❌ .env 파일이 없습니다! 경로를 확인하세요: ${envPath}`);
            // 파일이 없으면 여기서 리턴하지 않고 일단 진행해봅니다 (결과는 404겠지만)
        }
    } catch (e) {
        log.error(`[Updater Debug] 💥 토큰 처리 중 에러 발생: ${e.message}`);
    }
    // =======================================================================

    return new Promise((resolve) => {
        const safetyTimer = setTimeout(() => {
            log.warn("[Updater] ⚠️ 서버 응답 시간 초과 (5초). 앱을 시작합니다.");
            resolve(false);
        }, 5000);

        autoUpdater.once('update-available', (info) => {
            clearTimeout(safetyTimer);
            log.info(`[Updater] 🚀 새 버전 발견! (${info.version})`);

            autoUpdater.once('update-downloaded', (info) => {
                log.info('[Updater] ✅ 다운로드 완료. 재시작하여 설치합니다.');
                autoUpdater.quitAndInstall(true, true);
            });

            autoUpdater.on('download-progress', (progressObj) => {
                log.info(`[Updater] 다운로드 속도: ${parseInt(progressObj.bytesPerSecond / 1024)} KB/s (${parseInt(progressObj.percent)}%)`);
            });

            resolve(true);
        });

        autoUpdater.once('update-not-available', (info) => {
            clearTimeout(safetyTimer);
            log.info('[Updater] ✅ 현재 최신 버전입니다.');
            resolve(false);
        });

        autoUpdater.once('error', (err) => {
            clearTimeout(safetyTimer);
            log.error(`[Updater] ❌ 업데이트 확인 실패: ${err.message}`);
            resolve(false);
        });

        autoUpdater.checkForUpdates();
    });
}

function initializeUpdater(mainWindow) {
    log.info("[Updater] 백그라운드 업데이트 모듈 초기화.");
    // (기존 주기적 확인 로직 유지)
    setInterval(() => {
        autoUpdater.checkForUpdates();
    }, 60 * 60 * 1000);
}

function setInactivityStatus(status) {}

module.exports = {
    initializeUpdater,
    setInactivityStatus,
    checkForUpdatesBlocking
};