const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정] 파이썬 배포 태그 (버전 정보)
const REQUIRED_ENV_VERSION = 'env-v1.0.0';
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

// [유틸] 파일 해시 계산
function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    });
}

// [유틸] 다운로드 함수 (진행률 전송 추가됨)
async function downloadWithRetry(url, destPath, token, win, retries = MAX_RETRIES) {
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

            // 진행률 계산 준비
            const totalBytes = parseInt(res.headers.get('content-length'), 10);
            let downloadedBytes = 0;
            const fileStream = fs.createWriteStream(destPath);

            await new Promise((resolve, reject) => {
                res.body.on('data', (chunk) => {
                    downloadedBytes += chunk.length;

                    // 윈도우가 있고 전체 크기를 알 수 있을 때 진행률 전송
                    if (win && totalBytes) {
                        const percent = (downloadedBytes / totalBytes) * 100;
                        win.webContents.send('python-download-progress', percent);
                    }
                });

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
    // 1. 버전 체크
    let currentVersion = null;
    if (fs.existsSync(VERSION_FILE)) {
        currentVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }
    log.info(`[PythonBootstrap] 현재: ${currentVersion} / 목표: ${REQUIRED_ENV_VERSION}`);

    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        log.info('[PythonBootstrap] 최신 버전 보유 중. (검증 생략)');
        return PYTHON_EXE;
    }

    // 2. 다운로드 준비 알림
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
        const zipAsset = releaseData.assets.find(a => a.name === 'python-env.zip');
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error("python-env.zip 파일이 없습니다.");

        // 4. 파일 다운로드 (win 객체 전달하여 진행률 표시)
        await downloadWithRetry(zipAsset.url, tempZipPath, token, win);

        if (hashAsset) {
            await downloadWithRetry(hashAsset.url, tempHashPath, token, null);
        }

        // 5. 무결성 검증
        if (hashAsset && fs.existsSync(tempHashPath)) {
            log.info('[PythonBootstrap] 무결성 검증 중...');
            const expectedHash = fs.readFileSync(tempHashPath, 'utf-8').trim();
            const actualHash = await calculateFileHash(tempZipPath);

            if (expectedHash.toUpperCase() !== actualHash.toUpperCase()) {
                throw new Error(`해시 불일치! (기대값: ${expectedHash}, 실제값: ${actualHash})`);
            }
            log.info('[PythonBootstrap] 무결성 검증 통과! ✅');
        }

        // 6. 압축 해제 및 설치
        log.info('[PythonBootstrap] 압축 해제 및 설치 적용...');
        if (win) win.webContents.send('python-extracting');

        if (fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
        }

        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true);

        // 버전 기록
        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        // 임시 파일 정리
        try { fs.unlinkSync(tempZipPath); } catch(e) {}
        try { fs.unlinkSync(tempHashPath); } catch(e) {}

        log.info('[PythonBootstrap] 설치 완료!');
        if (win) win.webContents.send('python-download-complete');
        return PYTHON_EXE;

    } catch (error) {
        log.error(`[PythonBootstrap Error] ${error.message}`);
        if (win) win.webContents.send('python-download-error', error.message);
        if (fs.existsSync(tempZipPath)) {
            try { fs.unlinkSync(tempZipPath); } catch(e) {}
        }
        throw error;
    }
}

module.exports = { ensurePythonEnvironment };