const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정]
const REQUIRED_ENV_VERSION = 'env-v1.2.4'; // <-- 태그명 확인!
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

// [Helper] 파일 해시 계산
function calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex').toUpperCase()));
    });
}

// [Helper] 로컬 파일 해시 안전하게 가져오기 (파일 없으면 null)
async function getLocalHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return await calculateFileHash(filePath);
    } catch (e) {
        return null;
    }
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

    // 1. 버전 체크 (버전 파일 내용이 태그와 같으면 패스)
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

    // 2. 업데이트 감지 -> 다운로드 전략 수립
    log.info('[PythonBootstrap] 업데이트 필요! 전략 수립 중...');
    if (win) win.webContents.send('python-download-start');

    const token = loadEnvToken();
    if (!token) throw new Error("GH_TOKEN이 없습니다.");

    // 임시 파일 경로들
    const manifestPath = path.join(USER_DATA_PATH, 'manifest_remote.json');
    let downloadTarget = 'Full'; // 기본값은 안전하게 Full (문제 생기면 다 받는 게 상책)

    try {
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status}`);
        const releaseData = await releaseRes.json();

        // 3. Manifest 다운로드 및 분석 (스마트 스위칭)
        const manifestAsset = releaseData.assets.find(a => a.name === 'manifest.json');

        if (manifestAsset) {
            log.info('[PythonBootstrap] Manifest 다운로드 및 분석...');
            await downloadWithRetry(manifestAsset.url, manifestPath, token);

            const remoteManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            const criticalHashes = remoteManifest.criticalHashes || {};

            let isCriticalChanged = false;

            // 기존 환경이 아예 없으면 -> 무조건 Full
            if (!fs.existsSync(PYTHON_ENV_PATH)) {
                log.info(' -> 기존 환경 없음 (Full 다운로드)');
                isCriticalChanged = true;
            } else {
                // 중요 파일들(Torch 등) 하나씩 비교
                for (const [relPath, remoteHash] of Object.entries(criticalHashes)) {
                    // relPath 예시: "Lib/site-packages/torch/version.py"
                    const localFilePath = path.join(PYTHON_ENV_PATH, relPath);
                    const localHash = await getLocalHash(localFilePath);

                    // 로컬 파일이 없거나, 해시가 다르면 -> 무거운 게 바뀐 것임
                    if (!localHash || localHash.toUpperCase() !== remoteHash.toUpperCase()) {
                        log.warn(` -> 변경 감지됨(Critical): ${relPath}`);
                        isCriticalChanged = true;
                        break;
                    }
                }
            }

            if (isCriticalChanged) {
                log.info('[결정] 중요 라이브러리 변경됨 -> 📦 Full 버전 다운로드');
                downloadTarget = 'Full';
            } else {
                log.info('[결정] 로직만 변경됨 -> 🚀 Patch 버전 다운로드 (고속)');
                downloadTarget = 'Patch';
            }
        } else {
            log.warn('[PythonBootstrap] Manifest 없음 -> 안전하게 Full 버전 다운로드');
        }

        // 4. 실제 파일 다운로드 (Full 또는 Patch)
        const targetFileName = (downloadTarget === 'Patch') ? 'python-env-patch.zip' : 'python-env-full.zip';
        const zipAsset = releaseData.assets.find(a => a.name === targetFileName);
        const hashAsset = releaseData.assets.find(a => a.name === 'hash.txt');

        if (!zipAsset) throw new Error(`${targetFileName}을 찾을 수 없습니다.`);

        const tempZipPath = path.join(USER_DATA_PATH, `temp_${downloadTarget}.zip`);
        const tempHashPath = path.join(USER_DATA_PATH, 'temp_hash.txt');

        await downloadWithRetry(zipAsset.url, tempZipPath, token);
        if (hashAsset) await downloadWithRetry(hashAsset.url, tempHashPath, token);

        // 5. 무결성 검증 (Hash Check)
        if (hashAsset && fs.existsSync(tempHashPath)) {
            log.info('[PythonBootstrap] 다운로드 파일 무결성 검증...');
            const hashFileContent = fs.readFileSync(tempHashPath, 'utf-8');
            const actualHash = await calculateFileHash(tempZipPath);

            // hash.txt 안에 "Full: ABC..." 형식으로 들어있음
            if (!hashFileContent.toUpperCase().includes(actualHash.toUpperCase())) {
                throw new Error(`다운로드 파일 해시 불일치! (파일 깨짐 또는 변조)`);
            }
            log.info('[PythonBootstrap] 무결성 검증 통과! ✅');
        }

        // 6. 설치 (압축 해제)
        if (win) win.webContents.send('python-extracting');

        // Full 버전이면 기존 폴더 삭제 (클린 설치)
        if (downloadTarget === 'Full' && fs.existsSync(PYTHON_ENV_PATH)) {
            log.info("[PythonBootstrap] Full 설치를 위해 기존 폴더 삭제...");
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
        }

        log.info(`[PythonBootstrap] 압축 해제 중... (${downloadTarget} 모드)`);
        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true); // overwrite 허용

        // 버전 기록 업데이트
        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        // 뒷정리
        try { fs.unlinkSync(tempZipPath); } catch(e) {}
        try { fs.unlinkSync(tempHashPath); } catch(e) {}
        try { fs.unlinkSync(manifestPath); } catch(e) {}

        log.info('[PythonBootstrap] 모든 설치 완료!');
        if (win) win.webContents.send('python-download-complete');
        return PYTHON_EXE;

    } catch (error) {
        log.error(`[PythonBootstrap Error] ${error.message}`);
        if (win) win.webContents.send('python-download-error', error.message);

        // 에러 시 임시 파일 정리
        try { fs.unlinkSync(path.join(USER_DATA_PATH, `temp_${downloadTarget}.zip`)); } catch(e) {}

        throw error;
    }
}

module.exports = { ensurePythonEnvironment };