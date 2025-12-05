const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정]
const REQUIRED_ENV_VERSION = 'env-v1.2.5';
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiosk-python-runtime';
const MAX_RETRIES = 3;

const USER_DATA_PATH = app.getPath('userData');
const PYTHON_ENV_PATH = path.join(USER_DATA_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'kiosk_python.exe');

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

async function getLocalHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return await calculateFileHash(filePath); } catch (e) { return null; }
}

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

            const totalBytes = parseInt(res.headers.get('content-length'), 10);
            let downloadedBytes = 0;
            let lastReportTime = 0;

            const fileStream = fs.createWriteStream(destPath);
            await new Promise((resolve, reject) => {
                res.body.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    const now = Date.now();
                    if (win && totalBytes > 0 && (now - lastReportTime > 100 || downloadedBytes === totalBytes)) {
                        const percent = (downloadedBytes / totalBytes) * 100;
                        win.webContents.send('python-download-progress', percent);
                        lastReportTime = now;
                    }
                });
                res.body.pipe(fileStream);
                res.body.on('error', reject);
                fileStream.on('finish', resolve);
            });
            log.info(`[Download] 성공: ${path.basename(destPath)}`);
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

    // 1. 현재 버전 확인
    let currentVersion = 'unknown';
    if (fs.existsSync(VERSION_FILE)) {
        currentVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }
    log.info(`[PythonBootstrap] 현재: ${currentVersion} / 목표: ${REQUIRED_ENV_VERSION}`);

    // [Pass 조건] 버전 일치 및 실행 파일 존재 시
    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        log.info('[PythonBootstrap] 최신 버전 보유 중. (Pass)');
        if (win) {
            win.webContents.send('python-check-pass');
            await new Promise(r => setTimeout(r, 500));
        }
        return PYTHON_EXE;
    }

    // 2. 업데이트 진행
    log.info('[PythonBootstrap] 업데이트 시작...');
    if (win) win.webContents.send('python-download-start');

    // 트래픽 분산을 위한 랜덤 딜레이 (0~5초)
    const randomDelay = Math.floor(Math.random() * 5000);
    if(randomDelay > 1000) await new Promise(r => setTimeout(r, randomDelay));

    const token = loadEnvToken();
    const manifestPath = path.join(USER_DATA_PATH, 'manifest_remote.json');
    let downloadTarget = 'Full';
    let tempZipPath = '';

    try {
        if (!token) throw new Error("GH_TOKEN이 없습니다.");

        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });

        // 404 등 오류 발생 시 throw -> catch 블록으로 이동
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status}`);

        const releaseData = await releaseRes.json();

        // --- Smart Switching Logic ---
        const manifestAsset = releaseData.assets.find(a => a.name === 'manifest.json');
        if (manifestAsset) {
            log.info('[PythonBootstrap] Manifest 분석...');
            await downloadWithRetry(manifestAsset.url, manifestPath, token, null);

            const remoteManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const criticalHashes = remoteManifest.criticalHashes || {};
            let isCriticalChanged = false;

            if (!fs.existsSync(PYTHON_ENV_PATH)) {
                isCriticalChanged = true;
            } else {
                for (const [relPath, remoteHash] of Object.entries(criticalHashes)) {
                    const localFilePath = path.join(PYTHON_ENV_PATH, relPath);
                    const localHash = await getLocalHash(localFilePath);
                    if (!localHash || localHash.toUpperCase() !== remoteHash.toUpperCase()) {
                        isCriticalChanged = true;
                        break;
                    }
                }
            }
            downloadTarget = isCriticalChanged ? 'Full' : 'Patch';
            log.info(`[결정] 다운로드 모드: ${downloadTarget}`);
        } else {
            log.warn('[PythonBootstrap] Manifest 없음 -> Full 모드');
        }

        // --- File Download ---
        const targetFileName = (downloadTarget === 'Patch') ? 'python-env-patch.zip' : 'python-env-full.zip';
        const zipAsset = releaseData.assets.find(a => a.name === targetFileName);
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error(`${targetFileName} 없음`);

        tempZipPath = path.join(USER_DATA_PATH, `temp_${downloadTarget}.zip`);
        const tempHashPath = path.join(USER_DATA_PATH, 'temp_hash.txt');

        await downloadWithRetry(zipAsset.url, tempZipPath, token, win);
        if (hashAsset) await downloadWithRetry(hashAsset.url, tempHashPath, token, null);

        // --- Integrity Check ---
        if (hashAsset && fs.existsSync(tempHashPath)) {
            const hashFileContent = fs.readFileSync(tempHashPath, 'utf-8');
            const actualHash = await calculateFileHash(tempZipPath);
            if (!hashFileContent.toUpperCase().includes(actualHash.toUpperCase())) {
                throw new Error(`파일 해시 불일치 (변조 또는 깨짐)`);
            }
        }

        // --- Extract ---
        if (win) win.webContents.send('python-extracting');
        if (downloadTarget === 'Full' && fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
        }

        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true);

        // 버전 파일 갱신
        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        // 정리
        try { fs.unlinkSync(tempZipPath); } catch(e) {}
        try { fs.unlinkSync(tempHashPath); } catch(e) {}
        try { fs.unlinkSync(manifestPath); } catch(e) {}

        log.info('[PythonBootstrap] 업데이트 완료!');
        if (win) win.webContents.send('python-download-complete');
        return PYTHON_EXE;

    } catch (error) {
        log.error(`[PythonBootstrap Error] 업데이트 실패: ${error.message}`);

        // [Fallback Logic] 기존 파일이 있다면 그걸로 실행
        if (fs.existsSync(PYTHON_EXE)) {
            log.warn(`[PythonBootstrap] ⚠️ 업데이트 실패. 기존 버전(${currentVersion})을 사용합니다.`);

            if (win) {
                // UI에 "통과" 신호를 보내서 부팅 진행
                win.webContents.send('python-check-pass');
            }
            // 임시 파일 정리
            try { if(tempZipPath) fs.unlinkSync(tempZipPath); } catch(e) {}

            return PYTHON_EXE;
        }

        // 기존 파일도 없으면 진짜 에러
        if (win) win.webContents.send('python-download-error', error.message);
        try { if(tempZipPath) fs.unlinkSync(tempZipPath); } catch(e) {}

        throw error;
    }
}

module.exports = { ensurePythonEnvironment };