const { ipcMain } = require('electron');
const sttPipeClient = require('../services/voice/sttPipeClient');
const { getOpenAIResponse, correctTextWithGPT, handleUserSttInput } = require('../services/ai/openAIService.js');

module.exports = function registerSttHandlers() {

    // 1. STT 결과를 AI로 넘기기
    ipcMain.on('stt:submit-for-ai', async (event, { sttText, conversationHistory, lang }) => {
        try {
            await handleUserSttInput(sttText, conversationHistory, event.sender, lang);
        } catch (error) {
            console.error('STT-to-AI 처리 중 오류:', error);
            event.sender.send('ai:error', `STT-AI 핸들러 오류: ${error.message}`);
        }
    });

    // 2. 텍스트로 AI 질문하기
    ipcMain.on('openai:ask', async (event, conversationHistory) => {
        try {
            await getOpenAIResponse(conversationHistory, event.sender);
        } catch (error) {
            console.error('OpenAI API 처리 중 오류:', error);
            event.sender.send('ai:error', `IPC 핸들러 오류: ${error.message}`);
        }
    });

    // 3. STT 교정 (Legacy)
    ipcMain.handle('stt:correct', async (event, textToCorrect) => {
        try {
            const correctedText = await correctTextWithGPT(textToCorrect);
            return correctedText;
        } catch (error) {
            console.error('STT 교정 중 오류:', error);
            return textToCorrect;
        }
    });

    // 4. STT 스트리밍 제어 (Start/Stop/AudioChunk)
    ipcMain.on('speech:start-stream', (event, lang) => {
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
};