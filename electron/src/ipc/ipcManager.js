// electron/src/ipc/ipcManager.js

const fetch = require('node-fetch');
const { Headers } = require('node-fetch');
const FormData = require('form-data');

// 전역 설정 (기존 ipcHandlers.js에 있던 것)
global.fetch = fetch;
global.Headers = Headers;
global.FormData = FormData;

// 4개의 전문 핸들러 임포트
const registerTtsHandlers = require('./ttsHandler');
const registerSttHandlers = require('./sttHandler');
const registerRemoteHandlers = require('./remoteHandler');
const registerSystemHandlers = require('./systemHandler');

/**
 * 모든 IPC 핸들러를 등록하는 함수
 * @param {BrowserWindow} win - 메인 윈도우 객체
 */
function registerAllIpcHandlers(win) {
    registerTtsHandlers();
    registerSttHandlers();
    registerRemoteHandlers();
    registerSystemHandlers();

    console.log('✅ [IPC Manager] 모든 IPC 핸들러가 성공적으로 로드되었습니다.');
}

module.exports = { registerAllIpcHandlers };