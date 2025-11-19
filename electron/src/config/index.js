const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { log } = require('../logging');

// 'C:\ProgramData\[앱이름]' (모든 사용자 공용)
// 이 경로는 포맷해도 살아남지 않지만, 앱 재설치나 사용자 변경에는 영향을 받지 않습니다.
const SETTINGS_DIR = path.join(app.getPath('appData'), '..', 'Local', 'MyKioskSettings');
const LICENSE_FILE_PATH = path.join(SETTINGS_DIR, 'kiosk_license.txt');

// (예시) 실제로는 서버 API를 통해 이 키가 유효한지 확인해야 합니다.
// const EXPECTED_LICENSE_KEY = "KIOSK_SERIAL_12345_GANGNAM";

/**
 * [보안] 라이선스 키 파일을 읽고 검증합니다.
 */
function initializeSecurity() {
    try {
        log.info(`[Config] 라이선스 파일 경로 확인: ${LICENSE_FILE_PATH}`);
        if (!fs.existsSync(SETTINGS_DIR)) {
            fs.mkdirSync(SETTINGS_DIR, { recursive: true });
            log.info(`[Config] 설정 폴더 생성: ${SETTINGS_DIR}`);
        }

        if (!fs.existsSync(LICENSE_FILE_PATH)) {
            throw new Error(`라이선스 파일(kiosk_license.txt)이 없습니다.\n경로: ${LICENSE_FILE_PATH}`);
        }

        const deviceId = fs.readFileSync(LICENSE_FILE_PATH, 'utf8').trim();
        if (!deviceId) {
            throw new Error("라이선스 파일이 비어있습니다.");
        }

        // (중요) 이 deviceId를 서버로 보내 유효한지 검증하는 로직이 필요
        // if (deviceId !== EXPECTED_LICENSE_KEY) {
        //     throw new Error("라이선스 키가 유효하지 않습니다.");
        // }

        log.info(`[Config] 장비 인증 성공. Device ID: ${deviceId}`);
        process.env.KIOSK_DEVICE_ID = deviceId; // 전역으로 ID 저장

    } catch (err) {
        log.error(`[Config] 보안 초기화 실패: ${err.message}`);
        throw err; // `main.js`가 이 오류를 받아서 앱을 종료시킴
    }
}

/**
 * [설정] .env 및 gcloud-key 경로를 설정합니다.
 */
function initializeEnv() {
    // .env 파일 로드
    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '.env')
        : path.join(process.cwd(), ".env");

    if (!fs.existsSync(envPath)) {
        throw new Error(`.env 파일을 찾을 수 없음: ${envPath}`);
    }
    dotenv.config({ path: envPath });
    log.info(`[Config] .env 로드 완료.`);

    // gcloud-key 경로 설정
    const gcloudKeyPath = app.isPackaged
        ? path.join(process.resourcesPath, 'gcloud-key.json')
        : path.join(__dirname, '..','..', '..', 'gcloud-key.json');

    if (!fs.existsSync(gcloudKeyPath)) {
        throw new Error(`gcloud-key.json 파일을 찾을 수 없음: ${gcloudKeyPath}`);
    }

    process.env.GCLOUD_KEY_PATH = gcloudKeyPath;
    log.info(`[Config] GCloud Key 경로 설정 완료.`);
}

/**
 * 설정 및 보안 모듈을 초기화하는 메인 함수
 */
async function initializeConfig() {
    // 1. 환경변수(.env) 로드
    initializeEnv();

    // 2. 보안(라이선스) 체크
    initializeSecurity();

    // 3. (미래) 서버에서 설정값 받아오기 (apiGetSettings)
    // const settings = await apiGetSettings(process.env.KIOSK_DEVICE_ID);
    // global.kioskSettings = settings;

    log.info("[Config] 모든 설정 초기화 완료.");
}

module.exports = { initializeConfig };