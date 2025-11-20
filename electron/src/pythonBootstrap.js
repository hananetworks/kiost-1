const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');

// [설정] 파이썬 배포 태그와 일치해야 합니다!
// 아까 env-v1.0.3으로 올리셨으면 여기도 1.0.3이어야 합니다.
const REQUIRED_ENV_VERSION = 'env-v1.0.11';
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiost-1';

const USER_DATA_PATH = app.getPath('userData');
const PYTHON_ENV_PATH = path.join(USER_DATA_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'python.exe');

// [중요] .env 파일에서 토큰을 안전하게 로드하는 함수
function loadEnvToken() {
    if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '.env')
        : path.join(__dirname, '../../.env');

    log.info(`[PythonBootstrap] 토큰 로드 시도: ${envPath}`);

    if (fs.existsSync(envPath)) {
        const envConfig = dotenv.parse(fs.readFileSync(envPath));
        if (envConfig.GH_TOKEN) {
            return envConfig.GH_TOKEN;
        }
    }
    return null;
}

async function ensurePythonEnvironment(win) {
    let currentVersion = null;
    if (fs.existsSync(VERSION_FILE)) {
        currentVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }

    log.info(`[PythonBootstrap] 현재: ${currentVersion} / 목표: ${REQUIRED_ENV_VERSION}`);

    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        log.info('[PythonBootstrap] 최신 버전 보유 중.');
        return PYTHON_EXE;
    }

    log.info('[PythonBootstrap] 다운로드 시작 (Private Repo)...');
    if (win) win.webContents.send('python-download-start');

    const token = loadEnvToken();
    if (!token) {
        const err = "GH_TOKEN이 없습니다. .env 파일 주입 실패.";
        log.error(err);
        throw new Error(err);
    }

    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
    const tempZipPath = path.join(USER_DATA_PATH, 'temp_python.zip');

    try {
        const releaseRes = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Electron-Kiosk'
            }
        });

        if (!releaseRes.ok) throw new Error(`릴리즈 조회 실패: ${releaseRes.status}`);

        const releaseData = await releaseRes.json();
        const asset = releaseData.assets.find(a => a.name === 'python-env.zip');
        if (!asset) throw new Error("릴리즈에 'python-env.zip' 파일이 없습니다.");

        const downloadRes = await fetch(asset.url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/octet-stream',
                'User-Agent': 'Electron-Kiosk'
            }
        });

        if (!downloadRes.ok) throw new Error(`다운로드 실패: ${downloadRes.status}`);

        const dest = fs.createWriteStream(tempZipPath);
        await new Promise((resolve, reject) => {
            downloadRes.body.pipe(dest);
            downloadRes.body.on('error', reject);
            dest.on('finish', resolve);
        });

        log.info('[PythonBootstrap] 압축 해제 중...');
        if (fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {}
        }

        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(USER_DATA_PATH, true);

        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);
        fs.unlinkSync(tempZipPath);

        log.info('[PythonBootstrap] 설치 성공!');
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