const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { log } = require('../logging/logger');
const axios = require('axios'); // ★ axios 설치 필수 (npm install axios)

const SETTINGS_DIR = path.join(app.getPath('appData'), '..', 'Local', 'MyKioskSettings');
const LICENSE_FILE_PATH = path.join(SETTINGS_DIR, 'kiosk_license.txt');

/**
 * [설정] .env 파일을 로드합니다.
 * 이 함수가 가장 먼저 실행되어야 process.env 값을 쓸 수 있습니다.
 */
function initializeEnv() {
    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '.env')
        : path.join(process.cwd(), ".env");

    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        log.info(`[Config] .env 로드 완료.`);
    } else {
        log.warn(`[Config] .env 파일을 찾을 수 없습니다: ${envPath}`);
    }
}

/**
 * [보안] 로컬 라이선스 파일로 서버 인증(로그인)을 수행합니다.
 */
async function initializeSecurity() {
    try {
        // 1. 환경변수에서 API 주소 가져오기
        const baseUrl = process.env.API_BASE_URL;
        if (!baseUrl) {
            throw new Error(".env 파일에 API_BASE_URL이 설정되지 않았습니다.");
        }

        const loginUrl = `${baseUrl}/kiosks/kiosk-login`;

        // 2. 로컬 파일 체크 및 코드 읽기
        if (!fs.existsSync(LICENSE_FILE_PATH)) {
            throw new Error(`라이선스 파일이 없습니다.\n경로: ${LICENSE_FILE_PATH}`);
        }

        const kioskCode = fs.readFileSync(LICENSE_FILE_PATH, 'utf8').trim();
        if (!kioskCode) {
            throw new Error("라이선스 파일 내용이 비어있습니다.");
        }

        log.info(`[Config] 키오스크 코드: ${kioskCode}, 서버 인증 시도: ${loginUrl}`);

        // 3. 서버로 POST 요청
        const response = await axios.post(loginUrl, {
            kiosk_code: kioskCode
        });

        // 4. 토큰 및 정보 저장 (수정됨)
        const responseData = response.data;

        // ★ 중요: 로그에서 확인된 변수명 'access_token' 사용
        const token = responseData.access_token;
        const storeCode = responseData.store_code; // 매장 코드도 같이 저장

        if (token) {
            process.env.KIOSK_AUTH_TOKEN = token; // 토큰 저장
            process.env.KIOSK_CODE = kioskCode;   // 키오스크 코드 저장

            if (storeCode) {
                process.env.STORE_CODE = storeCode; // 매장 코드 저장 (나중에 주문 넣을 때 필요할 수 있음)
            }

            log.info(`[Config] 서버 인증 성공! (Store: ${storeCode})`);
        } else {
            // 여전히 토큰이 없다면 진짜 문제
            log.warn(`[Config] 인증 성공했으나 access_token을 찾을 수 없습니다. 응답: ${JSON.stringify(responseData)}`);
        }

    } catch (err) {
        log.error(`[Config] 서버 인증 실패: ${err.message}`);
        if (err.response) {
            log.error(`[Config] 서버 응답 에러 데이터: ${JSON.stringify(err.response.data)}`);
        }
        throw err;
    }
}

/**
 * 설정 및 보안 모듈을 초기화하는 메인 함수
 */
async function initializeConfig() {
    // 1. 환경변수(.env) 먼저 로드 (순서 중요!)
    initializeEnv();

    // 2. 서버 인증 수행 (await 필수)
    // await initializeSecurity();

    // 3. 이후 필요한 설정 로직...
    log.info("[Config] 모든 초기화 완료.");
}

module.exports = { initializeConfig };