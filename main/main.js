/* eslint-disable @typescript-eslint */
const { app, BrowserWindow, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const express = require('express');
const { PythonShell } = require('python-shell');
// [수정 1] 자동 업데이트 모듈 추가
const { autoUpdater } = require('electron-updater');

let win; // BrowserWindow 인스턴스
let ttsKrShell, ttsEnShell, sttShell;
let registerIpcHandlers;
let ttsPipeClient, ttsPipeClientEN, sttPipeClient;
let logFilePath = null;

// GPU 가속 및 성능 관련 플래그
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch("disable-frame-rate-limit");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");

/**
 * 로그 파일 및 콘솔에 메시지를 기록하는 함수
 * @param {string} message - 기록할 로그 메시지
 */
function writeLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    console.log(logMessage);

    if (logFilePath) {
        try {
            fs.appendFileSync(logFilePath, logMessage + '\n');
        } catch (e) {
            console.error('로그 파일 쓰기 실패:', e);
        }
    }
}
writeLog("[Main Init] main.js 실행 시작...");

// [수정 2] 자동 업데이트 설정 및 이벤트 리스너 추가
autoUpdater.autoDownload = true; // 업데이트 발견 시 자동 다운로드

autoUpdater.on('checking-for-update', () => {
    writeLog('[Updater] 업데이트 확인 중...');
});

autoUpdater.on('update-available', (info) => {
    writeLog(`[Updater] 새 업데이트 발견: ${info.version}`);
});

autoUpdater.on('update-not-available', (info) => {
    writeLog('[Updater] 현재 최신 버전입니다.');
});

autoUpdater.on('error', (err) => {
    writeLog(`[Updater Error] 업데이트 중 오류 발생: ${err}`);
});

// 다운로드 진행률 로그 (로그 파일 용량이 커질 수 있으므로 콘솔에만 출력하거나 필요 시 주석 해제)
autoUpdater.on('download-progress', (progressObj) => {
    // writeLog(`[Updater] 다운로드 속도: ${progressObj.bytesPerSecond} - ${progressObj.percent}%`);
});

autoUpdater.on('update-downloaded', (info) => {
    writeLog('[Updater] 업데이트 다운로드 완료. 설치를 위해 앱을 재시작합니다.');
    // 키오스크 모드이므로 사용자 확인 없이 즉시 설치 및 재시작 (Silent Install)
    autoUpdater.quitAndInstall(true, true);
});


// Python 및 파이썬 스크립트 경로 설정
let myPythonPath;
let scriptPath;

if (app.isPackaged) {
    // 패키징된 경우, 실행 파일과 함께 'main' 폴더에 스크립트가 위치합니다.
    scriptPath = path.join(process.resourcesPath, 'main');
    // 패키징된 파이썬 실행 파일 경로
    myPythonPath = path.join(process.resourcesPath, 'python-env', 'python.exe');
} else {
    // 개발 모드에서는 main.js와 같은 디렉토리에 스크립트가 위치합니다.
    scriptPath = __dirname;
    // 개발 모드의 파이썬 가상환경 실행 파일 경로
    myPythonPath = path.join(__dirname, '..', 'python-env', 'python.exe');
}
writeLog(`[Main Init] ScriptPath: ${scriptPath}`);
writeLog(`[Main Init] PythonPath: ${myPythonPath}`);


function createWindow() {
    writeLog("[Main] createWindow 호출됨.");
    win = new BrowserWindow({
        kiosk: true,
        frame: true,
        width: 1080,
        height: 1920,
        show: false, // 'ready-to-show' 이벤트에서 창을 표시하여 깜빡임을 방지합니다.
        autoHideMenuBar: true,
        webPreferences: {
            preload: app.isPackaged
                ? path.join(app.getAppPath(), 'preload', 'preload.js') // 패키징 시
                : path.join(__dirname, "../preload/preload.js"), // 개발 시
            contextIsolation: true,
            sandbox: false // preload 스크립트에서 Node.js 모듈(ipcRenderer)을 사용하기 위해 false로 설정
        },
    });

    // 로드할 URL을 패키징/개발 환경에 따라 분기합니다.
    const urlToLoad = app.isPackaged
        ? "http://localhost:3000/#/" // 패키징된 앱은 로컬 서버의 콘텐츠를 로드합니다.
        : "http://localhost:4000";   // 개발 시에는 Vite 개발 서버에 연결합니다.

    writeLog(`[Main] URL 로드 시도: ${urlToLoad}`);
    win.loadURL(urlToLoad).catch(err => {
        writeLog(`[Main] URL 로드 실패: ${err}`);
        dialog.showErrorBox('로드 오류', `애플리케이션 페이지 로드에 실패했습니다:\n${err}`);
    });

    win.once('ready-to-show', () => {
        writeLog("[Main] Window가 표시 준비됨.");
        win.show();
        if (!app.isPackaged) {
            win.webContents.openDevTools({ mode: "detach" });
        }
    });

    win.on('closed', () => {
        win = null;
    });
}

/**
 * 패키징된 앱을 위해 Express 로컬 서버를 시작합니다.
 */
function startLocalServer() {
    const server = express();
    const distPath = path.join(app.getAppPath(), 'dist');

    writeLog(`[Main] 로컬 서버 시작. dist 경로: ${distPath}`);
    if (!fs.existsSync(distPath)) {
        writeLog(`[Main Error] dist 디렉토리를 찾을 수 없음: ${distPath}`);
        dialog.showErrorBox('서버 오류', `정적 파일을 찾을 수 없습니다:\n${distPath}`);
        return;
    }

    server.use(express.static(distPath));
    server.get('/', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });

    const PORT = 3000;
    server.listen(PORT, 'localhost', () => {
        writeLog(`✅ 로컬 서버가 http://localhost:${PORT} 에서 시작되었습니다.`);
    }).on('error', (err) => {
        writeLog(`[Main Error] 로컬 서버 시작 실패: ${err}`);
        dialog.showErrorBox('서버 오류', `포트 ${PORT}에서 로컬 서버를 시작하지 못했습니다:\n${err}`);
    });
}

app.whenReady().then(() => {
    writeLog("[Main Ready] App 준비 완료.");

    if (app.isPackaged) {
        startLocalServer();

        // [수정 3] 앱이 패키징된 상태라면 자동 업데이트 확인 시작
        writeLog("[Updater] 업데이트 확인 시작...");
        autoUpdater.checkForUpdatesAndNotify();
    }

    // 로그 파일 경로 설정
    try {
        const logDir = path.join(app.getPath('appData'), 'MAXEE promotional', 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        logFilePath = path.join(logDir, 'main.log');
        fs.appendFileSync(logFilePath, `--- App Ready Event: ${new Date().toISOString()} ---\n`);
        writeLog("[Main Ready] 로그 파일 경로 설정 완료.");
    } catch (e) {
        console.error(`[Main Ready] 로그 경로 설정 실패: ${e}`);
        dialog.showErrorBox("로그 설정 오류", `로그 디렉토리/파일 생성에 실패했습니다: ${e}`);
    }

    // .env 파일 로드
    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '.env') // 패키징 시 .exe와 같은 폴더
        : path.join(process.cwd(), ".env");         // 개발 시 프로젝트 루트

    writeLog(`[Main Ready] .env 파일 로드 시도: ${envPath}`);
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        writeLog(`[Main Ready] .env 로드 완료. OpenAI Key 존재 여부: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
    } else {
        writeLog(`[Main Ready] .env 파일을 찾을 수 없음: ${envPath}`);
        dialog.showErrorBox("설정 오류", `.env 파일이 없습니다. 경로: ${envPath}`);
        app.quit();
        return;
    }

    // STT를 위한 Google Cloud Key 절대 경로 설정
    const gcloudKeyPath = app.isPackaged
        ? path.join(process.resourcesPath, 'gcloud-key.json') // 배포 시 resources 폴더
        : path.join(__dirname, '..', 'gcloud-key.json');      // 개발 시 프로젝트 루트

    writeLog(`[Main Ready] STT gcloudKeyPath 경로: ${gcloudKeyPath}`);

    // PythonShell 생성 및 초기화
    writeLog("[Main Ready] PythonShell 초기화 중...");
    const shellOptions = {
        pythonOptions: ['-u'],
        pythonPath: myPythonPath,
        scriptPath: scriptPath,
        args: [app.isPackaged ? 'packaged' : 'dev', process.resourcesPath]
    };

    try {
        ttsKrShell = new PythonShell('tts_worker_pipe_kr.py', shellOptions);
        ttsEnShell = new PythonShell('tts_worker_pipe_en.py', shellOptions);
        sttShell = new PythonShell('stt_worker_gcloud.py', {
            ...shellOptions,
            env: { // STT를 위해 GOOGLE_APPLICATION_CREDENTIALS 환경 변수를 절대 경로로 설정합니다.
                'GOOGLE_APPLICATION_CREDENTIALS': gcloudKeyPath
            }
        });
    } catch (e) {
        writeLog(`[Main FATAL] PythonShell 생성 실패: ${e}`);
        dialog.showErrorBox("시작 오류", `Python 프로세스를 시작하지 못했습니다: ${e}`);
        app.quit();
        return;
    }

    // 파이썬 스크립트 로그 리스너 설정
    ttsKrShell.on('message', (message) => writeLog(`[TTS_KR_MSG] ${message}`));
    ttsKrShell.on('stderr', (stderr) => writeLog(`[TTS_KR_ERR] ${stderr}`));
    ttsEnShell.on('message', (message) => writeLog(`[TTS_EN_MSG] ${message}`));
    ttsEnShell.on('stderr', (stderr) => writeLog(`[TTS_EN_ERR] ${stderr}`));
    sttShell.on('message', (message) => writeLog(`[STT_MSG] ${message}`));
    sttShell.on('stderr', (stderr) => writeLog(`[STT_ERR] ${stderr}`));


    // 주요 서비스 모듈 로드
    try {
        const ipcModule = require('./ipcHandlers');
        registerIpcHandlers = ipcModule.registerIpcHandlers;
        ttsPipeClient = require('./services/ttsPipeClient');
        ttsPipeClientEN = require('./services/ttsPipeClientEN');
        sttPipeClient = require('./services/sttPipeClient');
        writeLog("[Main Ready] 모든 서비스 모듈 로드 완료.");
    } catch (e) {
        writeLog(`[Main FATAL] 서비스 모듈 로드 실패: ${e}`);
        dialog.showErrorBox("시작 오류", `서비스 모듈을 로드하지 못했습니다: ${e}`);
        app.quit();
        return;
    }

    // --- 애플리케이션 실행 순서 ---
    createWindow();
    if (win && registerIpcHandlers) {
        registerIpcHandlers(win);
        writeLog("[Main Ready] IPC 핸들러 등록 완료.");
    }

    // 파이썬 스크립트가 준비될 시간을 고려하여 파이프 연결을 약간 지연시킵니다.
    setTimeout(() => {
        if (ttsPipeClient) ttsPipeClient.connect();
        if (ttsPipeClientEN) ttsPipeClientEN.connect();
        if (sttPipeClient) sttPipeClient.connect();
        writeLog("[Main Ready] 모든 파이프 클라이언트 연결 시도.");
    }, 1500);


    // TTS 이벤트 리스너 (한국어)
    if (ttsPipeClient) {
        ttsPipeClient.on('playback-finished', () => {
            if (win) win.webContents.send('tts:playback-finished');
        });
        ttsPipeClient.on('connected', () => writeLog("[Main] TTS (KR) 파이프 연결됨."));
        ttsPipeClient.on('error', (err) => writeLog(`[Main ERROR] TTS (KR) 파이프 오류: ${err.message}`));
    }

    // TTS 이벤트 리스너 (영어)
    if (ttsPipeClientEN) {
        ttsPipeClientEN.on('playback-finished', () => {
            // 재생 종료 이벤트는 언어 구분 없이 동일하게 'tts:playback-finished'로 보냅니다.
            if (win) win.webContents.send('tts:playback-finished');
        });
        ttsPipeClientEN.on('connected', () => writeLog("[Main] TTS (EN) 파이프 연결됨."));
        ttsPipeClientEN.on('error', (err) => writeLog(`[Main ERROR] TTS (EN) 파이프 오류: ${err.message}`));
    }


    // STT 이벤트 리스너
    if (sttPipeClient) {
        sttPipeClient.on('stt:data', (jsonData) => {
            if (win) {
                // Google STT 응답 유형(interim/result/error)에 따라 다른 채널로 데이터를 전송합니다.
                if (jsonData.type === 'result') {
                    win.webContents.send('speech:result', jsonData.text); // 최종 결과
                } else if (jsonData.type === 'interim') {
                    win.webContents.send('speech:interim-result', jsonData.text); // 중간 결과
                } else if (jsonData.type === 'error') {
                    win.webContents.send('speech:error', jsonData.message); // 오류
                }
            }
        });
        sttPipeClient.on('connected', () => writeLog("[Main] STT 파이프 연결됨."));
        sttPipeClient.on('error', (err) => writeLog(`[Main ERROR] STT 파이프 오류: ${err.message}`));
    }

    // 개발 모드에서 F12로 개발자 도구 토글
    if (!app.isPackaged) {
        globalShortcut.register("F12", () => {
            if (win) win.webContents.toggleDevTools();
        });
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// 앱 종료 시 자원 정리
app.on("will-quit", () => {
    writeLog("[Main Event] will-quit: 앱 종료 시작.");

    // 실행 중인 Python 자식 프로세스들을 종료합니다.
    try {
        if (ttsKrShell) ttsKrShell.terminate();
        if (ttsEnShell) ttsEnShell.terminate();
        if (sttShell) sttShell.terminate();
        writeLog("모든 PythonShell 프로세스가 종료되었습니다.");
    } catch (e) {
        writeLog(`PythonShell 종료 중 오류 발생: ${e.message}`);
    }

    globalShortcut.unregisterAll();
    writeLog("[Main] 앱 종료 완료.");
    if (logFilePath) {
        fs.appendFileSync(logFilePath, `--- Log End: ${new Date().toISOString()} ---\n`);
    }
});

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
    const errorMessage = `[Uncaught Exception] ${error.message}\n${error.stack}`;
    writeLog(errorMessage);
    dialog.showErrorBox("예상치 못한 오류", `오류가 발생했습니다: ${error.message}`);
    // process.exit(1);
});