// server.js (Node.js - 전체 코드 최종 수정 - 개발 모드용)

import express from "express";
import jwt from "jsonwebtoken";
import { v2 as webdav } from "webdav-server";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import 'dotenv/config';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

// ====== [1] 기본 환경 설정 ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_AUDIO_DIR = path.join(__dirname, 'temp_audio'); // 임시 폴더 (파일 생성 안 하므로 실제 사용X)

if (!fs.existsSync(TEMP_AUDIO_DIR)){
    fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
}

// ---- 포트 설정 ----
const API_PORT = process.env.API_PORT || 3000;
const WEBDAV_PORT = process.env.WEBDAV_PORT || 1900;

// ---- JWT 설정 ----
const userKey = process.env.AVATAR_USER_KEY;
const appId = process.env.AVATAR_APP_ID;

// ---- TTS/STT 설정 ----
const HOST = "127.0.0.1";
// ❗️❗️❗️ Python 경로 확인 ❗️❗️❗️
const PYTHON_EXE = "C:\\Users\\hana_us04\\Desktop\\kiosk\\cheonan_kiosk\\.venv\\Scripts\\python.exe";

// KO TTS
const TTS_WORKER_PATH = path.join(__dirname, "tts_worker_pipe_kr.py");
const TTS_PIPE_NAME = "\\\\.\\pipe\\melo_tts";
// EN TTS
const TTS_EN_WORKER_PATH = path.join(__dirname, "tts_worker_pipe_en.py");
const TTS_EN_PIPE_NAME = "\\\\.\\pipe\\melo_tts_en";
// STT
const STT_WORKER_PATH = path.join(__dirname, "stt_worker_pipe.py");
const STT_PIPE_NAME = "\\\\.\\pipe\\stt_whisper";

// ====== [2] Express 앱 생성 및 미들웨어 설정 ======
const app = express();

app.use(cors({
    origin: 'http://localhost:4000' // ❗️ React 개발 서버 포트
}));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false }));

// 정적 파일 제공 (public 폴더 - 필요시)
app.use(express.static(path.join(__dirname, "public")));


// =================================================================
// ===== [3] JWT 발급 API 기능 (기존과 동일) =====
// =================================================================
app.get("/api/generate-jwt", (req, res) => {
    try {
        if (!userKey || !appId) { throw new Error("Server configuration error: AVATAR_USER_KEY or AVATAR_APP_ID is missing"); }
        const payload = { appId, platform: "web" };
        const options = { header: { typ: "JWT", alg: "HS256" }, expiresIn: "5m" };
        const clientToken = jwt.sign(payload, userKey, options);
        res.json({ appId, token: clientToken });
    } catch (e) {
        console.error("JWT generation error:", e.message);
        res.status(500).json({ error: e.message });
    }
});

// =================================================================
// ===== [4] WebDAV 서버 기능 (기존과 동일) =====
// =================================================================
const webdavServer = new webdav.WebDAVServer({ port: WEBDAV_PORT, /* ... autoSave ... */ });
const physicalPath = path.join(__dirname, 'webdav');
webdavServer.setFileSystem('/Settings', new webdav.PhysicalFileSystem(physicalPath), (success) => {
    console.log(success ? '✅ WebDAV /Settings mapped' : '❌ WebDAV mapping failed');
});
webdavServer.start((s) => console.log(`🚀 WebDAV server started: http://localhost:${s.address().port}/Settings/`));


// =================================================================
// ===== [5] TTS/STT 파이썬 워커 관리 및 API =====
// =================================================================

// ---- 변수 ----
let ttsPyProc = null; // KO TTS
let ttsReady = false;
let ttsEnPyProc = null; // EN TTS
let ttsEnReady = false;
let sttPyProc = null; // STT
let sttReady = false;
let lastApiCall = 0;

// ---- 헬퍼 함수 ----
function tooFast(interval = 150) {
    const now = Date.now();
    if (now - lastApiCall < interval) return true;
    lastApiCall = now;
    return false;
}

// 파이썬 워커 실행 함수
function startWorker(exe, scriptPath, name) {
    console.log(`[${name}-PY] Starting python worker: ${scriptPath}`);
    if (!fs.existsSync(exe)) { console.error(`[ERR] Python exe not found: ${exe}`); return null; }
    if (!fs.existsSync(scriptPath)) { console.error(`[ERR] Script not found: ${scriptPath}`); return null; }

    const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    // TTS 워커는 HF_HOME 필요 (경로 확인!)
    if (name.startsWith("TTS")) {
        env.HF_HOME = "D:\\xTTS\\hf_cache"; // ❗️ HF_HOME 경로 확인!
        env.HF_HUB_ENABLE_HF_TRANSFER = "1";
    }

    const proc = spawn(exe, [scriptPath], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
    proc.stdout.on("data", (d) => console.log(`[${name}-py-out]`, d.toString().trim()));
    proc.stderr.on("data", (d) => console.error(`[${name}-py-err]`, d.toString().trim()));
    proc.on("close", (code) => {
        console.error(`[${name}-py-exit] Worker exited with code ${code}`);
        if (name === 'TTS-KO') { ttsPyProc = null; ttsReady = false; }
        if (name === 'TTS-EN') { ttsEnPyProc = null; ttsEnReady = false; }
        if (name === 'STT') { sttPyProc = null; sttReady = false; }
        // (필요시 자동 재시작 로직 추가)
    });
    return proc;
}

// 파이프 연결 확인 함수
async function waitForPipe(pipeName, timeoutMs = 30000) {
    const start = Date.now();
    console.log(`[Pipe] Waiting for ${pipeName}...`);
    while (Date.now() - start < timeoutMs) {
        const ok = await new Promise((resolve) => {
            const c = net.connect(pipeName, () => { c.end(); resolve(true); });
            c.on("error", () => resolve(false));
        });
        if (ok) { console.log(`[Pipe] Connected to ${pipeName}`); return true; }
        await new Promise((r) => setTimeout(r, 200));
    }
    console.error(`[Pipe] Timeout waiting for ${pipeName}`);
    return false;
}

// 워커 준비 확인 및 시작 함수
async function ensureWorkerReady(procRef, startFunc, pipeName, readyFlagRef) {
    if (readyFlagRef.value) return true; // 이미 준비됨
    if (!procRef.value) procRef.value = startFunc(); // 없으면 시작
    if (!procRef.value) return false; // 시작 실패

    const ok = await waitForPipe(pipeName); // 파이프 연결 대기
    readyFlagRef.value = ok;
    return ok;
}

// 파이프 전송 헬퍼 (SimpleAudio 재생용 - 응답 기다리지 않음)
function sendToPipe(pipeName, payload) {
    return new Promise((resolve, reject) => {
        console.log(`[Pipe Send] Attempting to connect to ${pipeName}`);
        const client = net.connect(pipeName, () => {
            console.log(`[Pipe Send] Connected to ${pipeName}. Sending payload.`);
            client.write(JSON.stringify(payload) + "\n", "utf8", (err) => {
                client.end(); // 보내고 바로 종료
                if (err) {
                    console.error(`[Pipe Send] Error writing to pipe ${pipeName}:`, err);
                    reject(err);
                } else {
                    console.log(`[Pipe Send] Successfully sent payload to ${pipeName}.`);
                    resolve();
                }
            });
        });
        client.on("error", (err) => {
            console.error(`[Pipe Send] Connection error for ${pipeName}:`, err);
            reject(err);
        });
        // 타임아웃 추가 (예: 5초)
        client.setTimeout(5000, () => {
            console.error(`[Pipe Send] Connection timeout for ${pipeName}`);
            client.destroy();
            reject(new Error(`Connection timeout for ${pipeName}`));
        });
    });
}

// ---- API 라우트 ----

// 헬스 체크 API (모든 워커 상태 확인)
app.get("/api/health", async (_req, res) => {
    try {
        // 각 워커의 준비 상태 확인 (값을 객체로 전달하여 내부에서 수정)
        const koOk = await ensureWorkerReady({ value: ttsPyProc }, () => startWorker(PYTHON_EXE, TTS_WORKER_PATH, 'TTS-KO'), TTS_PIPE_NAME, { value: ttsReady });
        const enOk = await ensureWorkerReady({ value: ttsEnPyProc }, () => startWorker(PYTHON_EXE, TTS_EN_WORKER_PATH, 'TTS-EN'), TTS_EN_PIPE_NAME, { value: ttsEnReady });
        const sttOk = await ensureWorkerReady({ value: sttPyProc }, () => startWorker(PYTHON_EXE, STT_WORKER_PATH, 'STT'), STT_PIPE_NAME, { value: sttReady });

        ttsReady = koOk; // 실제 플래그 업데이트
        ttsEnReady = enOk;
        sttReady = sttOk;

        const status = { tts_ko: koOk, tts_en: enOk, stt: sttOk };
        if (!koOk || !enOk || !sttOk) {
            console.warn("[Health Check] Worker not ready:", status);
            return res.status(503).json({ ok: false, error: "worker_not_ready", status });
        }
        console.log("[Health Check] All workers ready:", status);
        return res.json({ ok: true, status });
    } catch (e) {
        console.error('[Health Check] Error:', e);
        return res.status(500).json({ ok: false, error: "internal_error", message: e.message });
    }
});

// TTS 요청 API (/api/speak)
app.post("/api/speak", async (req, res) => {
    // ❗️ [핵심 수정] 요청 빈도, 텍스트 유효성 검사
    if (tooFast()) return res.status(429).json({ ok: false, error: "too_fast" });

    const text = (req.body?.text ?? "").toString().trim();
    // ❗️ lang 파라미터 받기 (기본 'ko')
    const lang = (req.body?.lang ?? "ko").toString().toLowerCase();

    if (!text) return res.status(400).json({ ok: false, error: "empty_text" });
    if (text.length > 2000) return res.status(413).json({ ok: false, error: "too_long" });

    // ❗️ 언어에 따라 워커 준비 확인 및 파이프 선택
    let targetPipeName;
    let workerReady;
    if (lang === 'en') {
        targetPipeName = TTS_EN_PIPE_NAME;
        workerReady = await ensureWorkerReady({ value: ttsEnPyProc }, () => startWorker(PYTHON_EXE, TTS_EN_WORKER_PATH, 'TTS-EN'), targetPipeName, { value: ttsEnReady });
        ttsEnReady = workerReady; // 플래그 업데이트
    } else {
        targetPipeName = TTS_PIPE_NAME;
        workerReady = await ensureWorkerReady({ value: ttsPyProc }, () => startWorker(PYTHON_EXE, TTS_WORKER_PATH, 'TTS-KO'), targetPipeName, { value: ttsReady });
        ttsReady = workerReady; // 플래그 업데이트
    }

    if (!workerReady) {
        console.error(`[API Speak] Worker not ready for lang=${lang}`);
        return res.status(503).json({ ok: false, error: "worker_not_ready", lang });
    }

    // ❗️ 파이프로 요청 전송 (텍스트만 포함)
    try {
        console.log(`[API Speak] Sending text to ${targetPipe} (lang=${lang}): ${text.substring(0, 20)}...`);
        await sendToPipe(targetPipeName, { text }); // output_path 불필요

        // ❗️ [핵심 수정] 파이썬이 직접 재생하므로, 파일 대기/스트리밍 없이 바로 성공 응답
        return res.json({ ok: true, message: "request_sent_to_worker", lang });

    } catch (e) {
        console.error('[API Speak] Error sending to pipe:', e);
        // 파이프 전송 실패 시, 해당 워커 상태를 'not ready'로 변경
        if (lang === 'en') ttsEnReady = false; else ttsReady = false;
        return res.status(500).json({ ok: false, error: "pipe_send_failed", lang, message: e.message });
    }
});

// 종료 API (/api/quit) - 모든 워커 종료 시도
app.post("/api/quit", async (_req, res) => {
    console.log("[API Quit] Received quit request. Sending /quit to all workers.");
    // try-catch 블록 추가
    try {
        const payload = { text: "/quit" };
        // 각 파이프에 비동기적으로 전송 (결과 기다리지 않음)
        sendToPipe(TTS_PIPE_NAME, payload).catch(e => console.error("Error sending /quit to KO:", e.message));
        sendToPipe(TTS_EN_PIPE_NAME, payload).catch(e => console.error("Error sending /quit to EN:", e.message));
        sendToPipe(STT_PIPE_NAME, payload).catch(e => console.error("Error sending /quit to STT:", e.message));

        // 잠시 후 프로세스 강제 종료 (안전 장치)
        setTimeout(() => {
            if (ttsPyProc) { try { ttsPyProc.kill(); } catch {} }
            if (ttsEnPyProc) { try { ttsEnPyProc.kill(); } catch {} }
            if (sttPyProc) { try { sttPyProc.kill(); } catch {} }
        }, 500); // 0.5초 대기

        return res.json({ ok: true });
    } catch (e) {
        console.error('[API Quit] Error:', e);
        // 실패해도 일단 응답은 보냄
        return res.status(500).json({ ok: false, error: "quit_failed", message: e.message });
    }
});


// =================================================================
// ===== [6] 메인 서버 실행 및 워커 시작 =====
// =================================================================
app.listen(API_PORT, HOST, async () => {
    console.log(`✅ API server running: http://${HOST}:${API_PORT}`);

    // 서버 시작 시 모든 워커 미리 실행 및 준비 확인 시도
    console.log("Attempting to start and check all workers...");
    // (ensureWorkerReady 내부에서 시작 및 상태 업데이트)
    const koOk = await ensureWorkerReady({ value: ttsPyProc }, () => startWorker(PYTHON_EXE, TTS_WORKER_PATH, 'TTS-KO'), TTS_PIPE_NAME, { value: ttsReady });
    const enOk = await ensureWorkerReady({ value: ttsEnPyProc }, () => startWorker(PYTHON_EXE, TTS_EN_WORKER_PATH, 'TTS-EN'), TTS_EN_PIPE_NAME, { value: ttsEnReady });
    const sttOk = await ensureWorkerReady({ value: sttPyProc }, () => startWorker(PYTHON_EXE, STT_WORKER_PATH, 'STT'), STT_PIPE_NAME, { value: sttReady });
    ttsReady = koOk; ttsEnReady = enOk; sttReady = sttOk; // 최종 상태 업데이트
    console.log("Initial worker status:", { tts_ko: ttsReady, tts_en: ttsEnReady, stt: sttReady });
});

// ---- 프로세스 종료 시 자원 정리 ----
async function cleanup() {
    console.log("Cleaning up before exit...");
    // /quit 명령 전송 (결과 기다리지 않음)
    const payload = { text: "/quit" };
    sendToPipe(TTS_PIPE_NAME, payload).catch(()=>{});
    sendToPipe(TTS_EN_PIPE_NAME, payload).catch(()=>{});
    sendToPipe(STT_PIPE_NAME, payload).catch(()=>{});

    // 잠시 후 강제 종료
    setTimeout(() => {
        if (ttsPyProc) try { ttsPyProc.kill(); } catch {}
        if (ttsEnPyProc) try { ttsEnPyProc.kill(); } catch {}
        if (sttPyProc) try { sttPyProc.kill(); } catch {}
        process.exit(0);
    }, 500);
}

process.on("SIGINT", cleanup); // Ctrl+C
process.on("SIGTERM", cleanup); // Terminate