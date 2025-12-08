const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { log } = require('./logging/logger');
const dotenv = require('dotenv');
const os = require('os');
const { execSync } = require('child_process'); // [추가] 외부 명령어(hpatchz) 실행용

// [설정]
const REQUIRED_ENV_VERSION = 'env-v1.3.5'; // 목표 버전
const REPO_OWNER = 'hananetworks';
const REPO_NAME = 'kiosk-python-runtime';
const MAX_RETRIES = 3;

const USER_DATA_PATH = app.getPath('userData');
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const APP_LOCAL_PATH = path.join(LOCAL_APP_DATA, 'MAXEE_promotional'); // 앱 루트
const UPDATE_CACHE_PATH = path.join(APP_LOCAL_PATH, 'updates'); // [추가] 업데이트 파일 보관소

// 필요한 폴더 생성
[APP_LOCAL_PATH, UPDATE_CACHE_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 경로 설정
const PYTHON_ENV_PATH = path.join(APP_LOCAL_PATH, 'python-env');
const VERSION_FILE = path.join(PYTHON_ENV_PATH, 'version.txt');
const PYTHON_EXE = path.join(PYTHON_ENV_PATH, 'kiosk_python.exe');

// [핵심] 로컬에 보관된 '직전 버전'의 원본 Zip 파일 경로
const CACHED_FULL_ZIP = path.join(UPDATE_CACHE_PATH, 'python-env-full.zip');
// [핵심] 패치 도구 경로
const HPATCH_TOOL = path.join(UPDATE_CACHE_PATH, 'hpatchz.exe');

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

    // 2. 업데이트 로직 시작
    log.info('[PythonBootstrap] 업데이트 시작...');
    if (win) win.webContents.send('python-download-start');

    const token = loadEnvToken();
    let finalZipPath = ''; // 최종적으로 압축 풀 Zip 파일 경로

    try {
        if (!token) throw new Error("GH_TOKEN이 없습니다.");

        // 릴리즈 정보 가져오기
        const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${REQUIRED_ENV_VERSION}`;
        const releaseRes = await fetch(apiUrl, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!releaseRes.ok) throw new Error(`릴리즈 정보 조회 실패: ${releaseRes.status}`);
        const releaseData = await releaseRes.json();

        // 에셋 찾기
        const fullAsset = releaseData.assets.find(a => a.name === 'python-env-full.zip');
        const patchAsset = releaseData.assets.find(a => a.name === 'patch.hdiff');
        const toolAsset = releaseData.assets.find(a => a.name === 'hpatchz.exe');

        if (!fullAsset) throw new Error('Release에 python-env-full.zip이 없습니다.');

        // -----------------------------------------------------------
        // [A] 패치 도구(hpatchz.exe) 준비
        // -----------------------------------------------------------
        if (!fs.existsSync(HPATCH_TOOL)) {
            if (toolAsset) {
                log.info('hpatchz.exe 다운로드 중...');
                await downloadWithRetry(toolAsset.url, HPATCH_TOOL, token, null);
            } else {
                log.warn('hpatchz.exe를 서버에서 찾을 수 없습니다. (패치 불가)');
            }
        }

        // -----------------------------------------------------------
        // [B] 다운로드 모드 결정 (Diff Patch vs Full Download)
        // -----------------------------------------------------------
        let usePatch = false;

        // 조건: 패치 파일 존재 + 로컬에 구버전 원본 존재 + 패치 도구 존재
        if (patchAsset && fs.existsSync(CACHED_FULL_ZIP) && fs.existsSync(HPATCH_TOOL)) {
            usePatch = true;
        }

        if (usePatch) {
            log.info(`🚀 [Diff Patch Mode] 용량 절약 모드로 진행합니다.`);
            const patchPath = path.join(UPDATE_CACHE_PATH, 'patch.hdiff');
            const newZipPath = path.join(UPDATE_CACHE_PATH, `temp_new_${Date.now()}.zip`);

            try {
                // 1. 패치 파일 다운로드 (15MB)
                await downloadWithRetry(patchAsset.url, patchPath, token, win);

                // 2. 병합 실행 (Old + Patch = New)
                // hpatchz.exe [old] [diff] [new]
                if (win) win.webContents.send('python-extracting'); // UI 멘트: "패치 적용 중..."
                log.info('패치 병합(Merge) 시작...');

                execSync(`"${HPATCH_TOOL}" "${CACHED_FULL_ZIP}" "${patchPath}" "${newZipPath}"`);

                log.info('패치 병합 성공!');
                finalZipPath = newZipPath;

                // 패치 파일은 이제 필요 없으니 삭제
                fs.unlinkSync(patchPath);

            } catch (patchErr) {
                log.error(`❌ 패치 적용 실패 (Full 모드로 전환): ${patchErr.message}`);
                usePatch = false;
                // 임시 파일 정리
                if (fs.existsSync(newZipPath)) fs.unlinkSync(newZipPath);
                if (fs.existsSync(patchPath)) fs.unlinkSync(patchPath);
            }
        }

        // -----------------------------------------------------------
        // [C] Full Download (패치 불가 or 실패 시)
        // -----------------------------------------------------------
        if (!usePatch) {
            log.info(`📦 [Full Download Mode] 전체 파일을 다운로드합니다.`);
            finalZipPath = path.join(UPDATE_CACHE_PATH, `temp_full_${Date.now()}.zip`);
            await downloadWithRetry(fullAsset.url, finalZipPath, token, win);
        }

        // -----------------------------------------------------------
        // [D] 압축 해제 및 교체
        // -----------------------------------------------------------
        if (win) win.webContents.send('python-extracting');

        // 기존 환경 폴더 삭제
        if (fs.existsSync(PYTHON_ENV_PATH)) {
            try { fs.rmSync(PYTHON_ENV_PATH, { recursive: true, force: true }); } catch(e) {
                log.warn('기존 폴더 삭제 중 경미한 오류(무시됨): ' + e.message);
            }
        }

        // 압축 해제
        const zip = new AdmZip(finalZipPath);
        zip.extractAllTo(APP_LOCAL_PATH, true); // python-env 폴더가 생성됨

        // 버전 파일 갱신
        fs.writeFileSync(VERSION_FILE, REQUIRED_ENV_VERSION);

        // -----------------------------------------------------------
        // [E] 다음 업데이트를 위한 캐시 갱신 (중요!)
        // -----------------------------------------------------------
        // 방금 받은(또는 만든) Zip 파일을 'python-env-full.zip'으로 이름 바꿔서 보관
        // 그래야 다음 버전에 Patch 모드를 쓸 수 있음.
        try {
            if (fs.existsSync(CACHED_FULL_ZIP)) fs.unlinkSync(CACHED_FULL_ZIP);
            fs.renameSync(finalZipPath, CACHED_FULL_ZIP);
            log.info('업데이트 캐시 갱신 완료 (다음 패치 준비 완료)');
        } catch (e) {
            log.warn('캐시 파일 갱신 실패(다음엔 Full 다운로드 됨): ' + e.message);
        }

        log.info('[PythonBootstrap] 모든 업데이트 완료!');
        if (win) win.webContents.send('python-download-complete');
        return PYTHON_EXE;

    } catch (error) {
        log.error(`[PythonBootstrap Error] ${error.message}`);

        // [Fallback] 실패 시 기존 버전이라도 실행 시도
        if (fs.existsSync(PYTHON_EXE)) {
            log.warn(`⚠️ 업데이트 실패. 기존 버전을 사용합니다.`);
            if (win) {
                win.webContents.send('python-download-progress', 100);
                win.webContents.send('python-download-complete');
                setTimeout(() => win.webContents.send('python-check-pass'), 1000);
            }
            return PYTHON_EXE;
        }

        if (win) win.webContents.send('python-download-error', error.message);
        throw error;
    }
}

module.exports = { ensurePythonEnvironment };