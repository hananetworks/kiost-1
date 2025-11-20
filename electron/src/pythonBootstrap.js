const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const { log } = require('./logging'); // 로깅 모듈 경로 확인

// [설정] 배포할 파이썬 태그 (파이썬 업데이트 시 여기만 수정)
const REQUIRED_ENV_VERSION = 'env-v1.0.0';
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiost-1';

// AppData 폴더에 설치 (쓰기 권한 문제 해결)
const USER_DATA_PATH = app.getPath('userData');
const PYTHON_ENV_PATH = path.join(USER_DATA_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'python.exe');

async function ensurePythonEnvironment(win) {
    let currentVersion = null;
    if (fs.existsSync(VERSION_FILE)) {
        currentVersion = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
    }

    log.info(`[PythonBootstrap] 현재: ${currentVersion} / 목표: ${REQUIRED_ENV_VERSION}`);

    // 버전이 맞고 파일도 있으면 통과
    if (currentVersion === REQUIRED_ENV_VERSION && fs.existsSync(PYTHON_EXE)) {
        return PYTHON_EXE;
    }

    log.info('[PythonBootstrap] 파이썬 환경 다운로드 시작...');
    if (win) win.webContents.send('python-download-start');

    const downloadUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${REQUIRED_ENV_VERSION}/python-env.zip`;
    const tempZipPath = path.join(USER_DATA_PATH, 'temp_python.zip');

    try {
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`Download Failed: ${res.statusText}`);

        const dest = fs.createWriteStream(tempZipPath);
        await new Promise((resolve, reject) => {
            res.body.pipe(dest);
            res.body.on('error', reject);
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