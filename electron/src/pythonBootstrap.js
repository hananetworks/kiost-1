const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [중요] GitHub Release에 올라간 태그명과 100% 일치해야 합니다.
// 스크린샷에는 '1.2.0'으로 보이지만 태그가 'env-v1.2.0'인지 확인하세요.
const REQUIRED_ENV_VERSION = 'env-v1.2.3';
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiosk-python-runtime';
const MAX_RETRIES = 3;

const USER_DATA_PATH = app.getPath('userData');
const PYTHON_ENV_PATH = path.join(USER_DATA_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'kiosk_python.exe');

// ... (loadEnvToken, calculateFileHash, downloadWithRetry 함수는 기존과 동일하게 유지) ...
function loadEnvToken() {
    if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
    const envPath = app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        if (envConfig.GH_TOKEN) return envConfig.GH_TOKEN;
    }
    return null;
}

function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    });
}

async function downloadWithRetry(url, destPath, token, retries = MAX_RETRIES) {
    for (let i = 1; i <= retries; i++) {
        try {
            log.info(`[Download] 시도 ${i}/${retries}: ${path.basename(destPath)}`);
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/octet-stream', 'User-Agent': 'Electron-Kiosk' } });
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
    if (win) win.webContents.send('python-check-start');

    // 1. 버전 체크
    let currentVersion = null;
    if (fs.existsSync(VERSION_FILE)) {
        currentVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }
    log.info(`[PythonBootstrap] 현재: ${currentVersion} / 목표: ${REQUIRED_ENV_VERSION}`);

    // [Pass 조건] 버전 일치 & 실행 파일 존재
    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        log.info('[PythonBootstrap] 최신 버전 보유 중. (검증 생략)');
        if (win) {
            win.webContents.send('python-check-pass');
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
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status} (태그 ${REQUIRED_ENV_VERSION} 확인 필요)`);

        const releaseData = await releaseRes.json();

        // [핵심 수정] GitHub에 올라간 실제 파일 이름(python-env-full.zip)을 찾아야 함
        const zipAsset = releaseData.assets.find(a => a.name === 'python-env-full.zip');
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error("python-env-full.zip 파일을 찾을 수 없습니다.");

        // 4. 파일 다운로드
        await downloadWithRetry(zipAsset.url, tempZipPath, token);
        if (hashAsset) await downloadWithRetry(hashAsset.url, tempHashPath, token);

        // 5. 무결성 검증
        if (hashAsset && fs.existsSync(tempHashPath)) {
            log.info('[PythonBootstrap] 무결성 검증 중...');
            const hashFileContent = fs.readFileSync(tempHashPath, 'utf-8'); // Full: ABC... Patch: DEF...
            const actualHash = await calculateFileHash(tempZipPath);

            log.info(`[PythonBootstrap] 계산된 해시: ${actualHash}`);

            // [핵심] includes로 포함 여부 확인 (hash.txt에 라벨이 붙어있으므로)
            if (!hashFileContent.toUpperCase().includes(actualHash.toUpperCase())) {
                throw new Error(`해시 불일치! 파일이 변조되었거나 덜 받아졌습니다.`);
            }
            log.info('[PythonBootstrap] 무결성 검증 통과! ✅');
        }

        // 6. 설치 진행
        if (win) win.webContents.send('python-extracting');

        // 기존 폴더 삭제 후 압축 해제
        if (fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
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
        try { fs.unlinkSync(tempZipPath); } catch(e) {}
        throw error;
    }
}

module.exports = { ensurePythonEnvironment };