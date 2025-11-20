// ipcHandlers.js

const sttPipeClient = require('./services/voice/sttPipeClient');
const fetch = require('node-fetch');
const { Headers } = require('node-fetch');
const FormData = require('form-data');
const { setInactivityStatus } = require('./updater/updateManager');
global.fetch = fetch;
global.Headers = Headers;
global.FormData = FormData;

const { ipcMain } = require('electron');
const { getOpenAIResponse, correctTextWithGPT, handleUserSttInput } = require('./services/ai/openAIService.js');
const { printContent } = require('./services/hardware/printService.js');

const ttsPipeClient = require('./services/voice/ttsPipeClient'); // 한국어 TTS 클라이언트
const ttsPipeClientEN = require('./services/voice/ttsPipeClientEN'); // 영어 TTS 클라이언트

function registerIpcHandlers(win) {

    /**
     * STT 결과를 받아 AI 응답을 스트리밍하는 핸들러
     * React에서 onSpeechResult 이벤트 발생 시 이 채널을 사용합니다.
     */
    ipcMain.on('stt:submit-for-ai', async (event, { sttText, conversationHistory, lang }) => {
        try {
            // handleUserSttInput 함수가 STT 텍스트 교정, AI 호출, 응답 스트리밍을 모두 처리합니다.
            await handleUserSttInput(sttText, conversationHistory, event.sender, lang);
        } catch (error) {
            console.error('STT-to-AI 처리 중 오류:', error);
            event.sender.send('ai:error', `STT-AI 핸들러 오류: ${error.message}`);
        }
    });

    /**
     * 일반 텍스트 입력을 통해 AI에게 질문하는 핸들러
     */
    ipcMain.on('openai:ask', async (event, conversationHistory) => {
        try {
            // event.sender(React 렌더러)를 통해 'ai:chunk', 'ai:stream-end' 등의 이벤트를 보냅니다.
            await getOpenAIResponse(conversationHistory, event.sender);
        } catch (error) {
            console.error('OpenAI API 처리 중 오류:', error);
            event.sender.send('ai:error', `IPC 핸들러 오류: ${error.message}`);
        }
    });

    /**
     * HTML 콘텐츠를 인쇄하는 핸들러
     */
    ipcMain.handle('print:content', async (event, htmlContent) => {
        try {
            await printContent(htmlContent);
            return { success: true };
        } catch (error) {
            console.error('인쇄 처리 중 오류:', error);
            return { success: false, error: '인쇄 중 오류가 발생했습니다.' };
        }
    });

    /**
     * STT 텍스트를 GPT로 교정하는 핸들러
     * 참고: 현재 이 기능은 'stt:submit-for-ai' 핸들러의 handleUserSttInput 함수에 통합되었습니다.
     */
    ipcMain.handle('stt:correct', async (event, textToCorrect) => {
        try {
            const correctedText = await correctTextWithGPT(textToCorrect);
            return correctedText;
        } catch (error) {
            console.error('STT 교정 중 오류:', error);
            return textToCorrect; // 오류 발생 시 원본 텍스트 반환
        }
    });


    // --- STT 스트리밍 제어 ---
    ipcMain.on('speech:start-stream', (event, lang) => {
        // 앱에서 사용하는 언어 코드('ko', 'en')를 Google STT가 인식하는 코드('ko-KR', 'en-US')로 변환합니다.
        const langCode = lang === 'en' ? 'en-US' : 'ko-KR';
        console.log(`IPC: speech:start-stream (Lang: ${lang}, Code: ${langCode}) -> STT Pipe`);
        sttPipeClient.send(JSON.stringify({ "command": "start", "language": langCode }));
    });

    ipcMain.on('speech:audio-chunk', (event, chunk) => {
        const buffer = Buffer.from(chunk);
        const chunkBase64 = buffer.toString('base64');
        sttPipeClient.send(JSON.stringify({ "chunk": chunkBase64 }));
    });

    ipcMain.on('speech:stop-stream', () => {
        console.log("IPC: speech:stop-stream -> STT Pipe");
        sttPipeClient.send(JSON.stringify({ "command": "stop" }));
    });

    //지능형 업데이트를 위한 유휴 상태 리스너
    ipcMain.on('app:inactivity-status', (event, status) => {
        // React가 보낸 유휴 상태(true/false)를 Updater 모듈로 전달
        setInactivityStatus(status);
    });

    // --- TTS 제어 ---
    ipcMain.on('tts:command', (event, args) => {
        const { lang, command } = args;
        const commandString = JSON.stringify(command);
        const isPlayCommand = command.hasOwnProperty('text');
        const stopCommandString = JSON.stringify({ command: "stop" });
        const stopDelay = 50; // ms

        // 모든 TTS 엔진에 동일한 명령 전송 (주로 'stop'에 사용)
        if (lang === 'ALL') {
            console.log(`IPC: tts:command (ALL) -> ${commandString}`);
            if (ttsPipeClient) ttsPipeClient.send(commandString);
            if (ttsPipeClientEN) ttsPipeClientEN.send(commandString);
        }
        // 영어 TTS 재생 요청
        else if (lang === 'en') {
            if (isPlayCommand) {
                // 재생 요청 시, 다른 언어(한국어) TTS를 먼저 정지시켜 오디오가 겹치지 않게 합니다.
                if (ttsPipeClient) ttsPipeClient.send(stopCommandString);
                setTimeout(() => {
                    if (ttsPipeClientEN) ttsPipeClientEN.send(commandString);
                }, stopDelay);
            } else {
                if (ttsPipeClientEN) ttsPipeClientEN.send(commandString);
            }
        }
        // 한국어 TTS 재생 요청 (기본값)
        else {
            if (isPlayCommand) {
                // 재생 요청 시, 다른 언어(영어) TTS를 먼저 정지시킵니다.
                if (ttsPipeClientEN) ttsPipeClientEN.send(stopCommandString);
                setTimeout(() => {
                    if (ttsPipeClient) ttsPipeClient.send(commandString);
                }, stopDelay);
            } else {
                if (ttsPipeClient) ttsPipeClient.send(commandString);
            }
        }
    });

    console.log('IPC 핸들러가 등록되었습니다.');
}

module.exports = { registerIpcHandlers };