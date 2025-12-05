// electron/src/pythonBootstrap.js

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정]
const REQUIRED_ENV_VERSION = 'env-v1.2.5'; // <-- 태그명 꼭 확인하세요!
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

// [Helper] 로컬 파일 해시 안전하게 가져오기
async function getLocalHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return await calculateFileHash(filePath);
    } catch (e) {
        return null;
    }
}

// ▼▼▼ [수정됨] win을 받아서 진행률을 쏴주는 다운로드 함수 ▼▼▼
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

            // 1. 전체 용량 확인
            const totalBytes = parseInt(res.headers.get('content-length'), 10);
            let downloadedBytes = 0;
            let lastReportTime = 0;

            const fileStream = fs.createWriteStream(destPath);

            await new Promise((resolve, reject) => {
                // 2. 데이터가 들어올 때마다 진행률 계산해서 전송
                res.body.on('data', (chunk) => {
                    downloadedBytes += chunk.length;

                    // 너무 자주 보내면 렉 걸리니까 100ms마다 한 번씩만 전송
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

    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        log.info('[PythonBootstrap] 최신 버전 보유 중. (검증 생략)');
        if (win) {
            win.webContents.send('python-check-pass');
            await new Promise(r => setTimeout(r, 500));
        }
        return PYTHON_EXE;
    }

    // 2. 업데이트 감지
    log.info('[PythonBootstrap] 업데이트 필요! 전략 수립 중...');
    if (win) win.webContents.send('python-download-start');

    const token = loadEnvToken();
    if (!token) throw new Error("GH_TOKEN이 없습니다.");

    const manifestPath = path.join(USER_DATA_PATH, 'manifest_remote.json');
    let downloadTarget = 'Full';

    try {
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status}`);
        const releaseData = await releaseRes.json();

        // 3. Manifest 확인 (스마트 스위칭)
        const manifestAsset = releaseData.assets.find(a => a.name === 'manifest.json');

        if (manifestAsset) {
            log.info('[PythonBootstrap] Manifest 다운로드...');
            // Manifest는 용량이 작으니 win 없어도 됨
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

            if (isCriticalChanged) {
                log.info('[결정] 중요 라이브러리 변경됨 -> 📦 Full 버전');
                downloadTarget = 'Full';
            } else {
                log.info('[결정] 로직만 변경됨 -> 🚀 Patch 버전');
                downloadTarget = 'Patch';
            }
        } else {
            log.warn('[PythonBootstrap] Manifest 없음 -> Full 버전');
        }

        // 4. 메인 파일 다운로드 (여기서 win을 넘겨야 진행률이 뜸!)
        const targetFileName = (downloadTarget === 'Patch') ? 'python-env-patch.zip' : 'python-env-full.zip';
        const zipAsset = releaseData.assets.find(a => a.name === targetFileName);
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error(`${targetFileName}을 찾을 수 없습니다.`);

        const tempZipPath = path.join(USER_DATA_PATH, `temp_${downloadTarget}.zip`);
        const tempHashPath = path.join(USER_DATA_PATH, 'temp_hash.txt');

        // ▼▼▼ 여기에 'win'을 꼭 넣어줘야 합니다! ▼▼▼
        await downloadWithRetry(zipAsset.url, tempZipPath, token, win);

        if (hashAsset) await downloadWithRetry(hashAsset.url, tempHashPath, token, null);

        // 5. 무결성 검증
        if (hashAsset && fs.existsSync(tempHashPath)) {
            log.info('[PythonBootstrap] 해시 검증...');
            const hashFileContent = fs.readFileSync(tempHashPath, 'utf-8');
            const actualHash = await calculateFileHash(tempZipPath);
            if (!hashFileContent.toUpperCase().includes(actualHash.toUpperCase())) {
                throw new Error(`다운로드 파일 해시 불일치!`);
            }
        }

        // 6. 설치
        if (win) win.webContents.send('python-extracting');

        if (downloadTarget === 'Full' && fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
        }

        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true);

        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        try { fs.unlinkSync(tempZipPath); } catch(e) {}
        try { fs.unlinkSync(tempHashPath); } catch(e) {}
        try { fs.unlinkSync(manifestPath); } catch(e) {}

        log.info('[PythonBootstrap] 설치 완료!');
        if (win) win.webContents.send('python-download-complete');
        return PYTHON_EXE;

    } catch (error) {
        log.error(`[PythonBootstrap Error] ${error.message}`);
        if (win) win.webContents.send('python-download-error', error.message);
        try { fs.unlinkSync(path.join(USER_DATA_PATH, `temp_${downloadTarget}.zip`)); } catch(e) {}
        throw error;
    }
}

module.exports = { ensurePythonEnvironment };