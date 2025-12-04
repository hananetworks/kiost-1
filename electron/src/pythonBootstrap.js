const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정] 파이썬 배포 태그
const REQUIRED_ENV_VERSION = 'env-v1.2.1';
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiosk-python-runtime';
const MAX_RETRIES = 3;

const USER_DATA_PATH = app.getPath('userData');
const PYTHON_ENV_PATH = path.join(USER_DATA_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'kiosk_python.exe');

// [유틸] .env 토큰 로드
function loadEnvToken() {
    if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '.env')
        : path.join(__dirname, '../../.env');

    if (fs.existsSync(envPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        if (envConfig.GH_TOKEN) return envConfig.GH_TOKEN;
    }
    return null;
}

// [유틸] 파일 해시 계산 (SHA256)
function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    });
}

// [유틸] 재시도 로직이 포함된 다운로드 함수
async function downloadWithRetry(url, destPath, token, retries = MAX_RETRIES) {
    for (let i = 1; i <= retries; i++) {
        try {
            log.info(`[Download] 시도 ${i}/${retries}: ${path.basename(destPath)}`);

            const res = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/octet-stream',
                    'User-Agent': 'Electron-Kiosk'
                }
            });

            if (!res.ok) throw new Error(`HTTP 오류: ${res.status} ${res.statusText}`);

            const fileStream = fs.createWriteStream(destPath);
            await new Promise((resolve, reject) => {
                res.body.pipe(fileStream);
                res.body.on('error', reject);
                fileStream.on('finish', resolve);
            });

            log.info(`[Download] 다운로드 성공: ${path.basename(destPath)}`);
            return;

        } catch (err) {
            log.warn(`[Download] ${i}회차 실패: ${err.message}`);
            if (i === retries) throw err;
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function ensurePythonEnvironment(win) {
    // [추가] 점검 시작 알림 (UI 상태 변경용)
    if (win) win.webContents.send('python-check-start');

    // 1. 버전 체크
    let currentVersion = null;
    if (fs.existsSync(VERSION_FILE)) {
        currentVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }
    log.info(`[PythonBootstrap] 현재: ${currentVersion} / 목표: ${REQUIRED_ENV_VERSION}`);

    // [핵심] 이미 설치되어 있으면 Pass 신호 전송
    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        log.info('[PythonBootstrap] 최신 버전 보유 중. (검증 생략)');
        if (win) {
            win.webContents.send('python-check-pass');
            // 사용자가 "완료" 메시지를 볼 수 있게 0.5초 대기
            await new Promise(r => setTimeout(r, 500));
        }
        return PYTHON_EXE;
    }

    // 2. 다운로드 준비
    log.info('[PythonBootstrap] 새 버전 발견! 다운로드 시작...');
    if (win) win.webContents.send('python-download-start');

    const token = loadEnvToken();
    if (!token) throw new Error("GH_TOKEN이 없습니다.");

    const tempZipPath = path.join(USER_DATA_PATH, 'temp_python.zip');
    const tempHashPath = path.join(USER_DATA_PATH, 'temp_hash.txt');

    try {
        // 3. 릴리즈 정보 가져오기
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status}`);

        const releaseData = await releaseRes.json();

        // [수정됨] GitHub에 올라와 있는 실제 파일 이름(python-env-full.zip)으로 변경
        const zipAsset = releaseData.assets.find(a => a.name === 'python-env-full.zip');
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error("python-env-full.zip 파일이 없습니다.");
        if (!hashAsset) log.warn("hash.txt 파일이 없습니다. (무결성 검증 건너뜀)");

        // 4. 파일 다운로드
        await downloadWithRetry(zipAsset.url, tempZipPath, token);
        if (hashAsset) {
            await downloadWithRetry(hashAsset.url, tempHashPath, token);
        }

        // 5. 무결성 검증
        if (hashAsset && fs.existsSync(tempHashPath)) {
            log.info('[PythonBootstrap] 무결성 검증 중...');

            // [수정] 파일 전체 내용을 가져옵니다. (Full: ..., Patch: ... 등이 섞여있음)
            const hashFileContent = fs.readFileSync(tempHashPath, 'utf-8');

            // [수정] 우리가 다운받은 파일의 해시를 계산합니다.
            const actualHash = await calculateFileHash(tempZipPath);

            log.info(`[PythonBootstrap] 계산된 해시: ${actualHash}`);

            // [핵심 수정] "일치(===)"가 아니라 "포함(includes)"으로 변경!
            // hash.txt 안에 우리가 계산한 해시값이 들어있기만 하면 통과입니다.
            if (!hashFileContent.toUpperCase().includes(actualHash.toUpperCase())) {
                throw new Error(`해시 불일치!\n파일 내 기대값:\n${hashFileContent}\n실제 계산값: ${actualHash}`);
            }
            log.info('[PythonBootstrap] 무결성 검증 통과! ✅');
        }

        // 6. 압축 해제 (UI 알림)
        if (win) win.webContents.send('python-extracting');
        log.info('[PythonBootstrap] 압축 해제 및 설치 적용...');

        if (fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {
                log.warn(`기존 폴더 삭제 실패: ${e.message}`);
            }
        }

        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true);

        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        try { fs.unlinkSync(tempZipPath); } catch(e) {}
        try { fs.unlinkSync(tempHashPath); } catch(e) {}

        log.info('[PythonBootstrap] 설치 완료!');
        if (win) win.webContents.send('python-download-complete');
        return PYTHON_EXE;

    } catch (error) {
        log.error(`[PythonBootstrap Error] ${error.message}`);
        if (win) win.webContents.send('python-download-error', error.message);
        if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
        throw error;
    }
}

module.exports = { ensurePythonEnvironment };