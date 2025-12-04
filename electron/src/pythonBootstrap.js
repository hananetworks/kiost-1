const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정]
const REQUIRED_ENV_VERSION = 'env-v1.2.3'; // <-- 태그명 확인!
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiosk-python-runtime';
const MAX_RETRIES = 3;

const USER_DATA_PATH = app.getPath('userData');
const PYTHON_ENV_PATH = path.join(USER_DATA_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'kiosk_python.exe');

// ... (loadEnvToken, calculateFileHash, downloadWithRetry는 기존 유지) ...
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

    // [Pass 조건]
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

    // [핵심] Patch 사용 여부 판단
    // 기존 파이썬 폴더가 있고 실행 파일도 있다면 -> Patch 사용 (덮어쓰기)
    // 아예 없다면 -> Full 사용 (전체 설치)
    let usePatch = false;
    if (fs.existsSync(PYTHON_ENV_PATH) && fs.existsSync(PYTHON_EXE)) {
        usePatch = true;
        log.info("[PythonBootstrap] 기존 환경 감지됨 -> Patch 버전(가벼운 파일)을 사용합니다. 🚀");
    } else {
        log.info("[PythonBootstrap] 기존 환경 없음 -> Full 버전(전체 파일)을 사용합니다. 📦");
    }

    const tempZipPath = path.join(USER_DATA_PATH, usePatch ? 'temp_patch.zip' : 'temp_full.zip');
    const tempHashPath = path.join(USER_DATA_PATH, 'temp_hash.txt');

    try {
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status}`);
        const releaseData = await releaseRes.json();

        // [핵심] 파일 선택 로직
        const targetFileName = usePatch ? 'python-env-patch.zip' : 'python-env-full.zip';
        const zipAsset = releaseData.assets.find(a => a.name === targetFileName);
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error(`${targetFileName} 파일을 찾을 수 없습니다.`);

        // 3. 파일 다운로드
        await downloadWithRetry(zipAsset.url, tempZipPath, token);
        if (hashAsset) await downloadWithRetry(hashAsset.url, tempHashPath, token);

        // 4. 무결성 검증
        if (hashAsset && fs.existsSync(tempHashPath)) {
            log.info('[PythonBootstrap] 무결성 검증 중...');
            const hashFileContent = fs.readFileSync(tempHashPath, 'utf-8');
            const actualHash = await calculateFileHash(tempZipPath);

            // hash.txt에는 "Full: ABC..." 와 "Patch: DEF..." 가 들어있음
            // 우리가 받은 파일의 해시가 포함되어 있는지 확인
            if (!hashFileContent.toUpperCase().includes(actualHash.toUpperCase())) {
                throw new Error(`해시 불일치! 파일 변조 또는 다운로드 오류.`);
            }
            log.info('[PythonBootstrap] 무결성 검증 통과! ✅');
        }

        // 5. 설치 (압축 해제)
        if (win) win.webContents.send('python-extracting');

        // [중요] Full 버전일 때만 기존 폴더 삭제 (클린 설치)
        // Patch 버전일 때는 삭제하지 않고 덮어씌움 (Overwrite)
        if (!usePatch && fs.existsSync(PYTHON_ENV_PATH)) {
            log.info("[PythonBootstrap] Full 설치를 위해 기존 폴더 삭제 중...");
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
        }

        log.info(`[PythonBootstrap] 압축 해제 중... (${usePatch ? '덮어쓰기' : '새로 설치'})`);
        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true); // true = overwrite 허용

        // 버전 기록 업데이트
        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        // 청소
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