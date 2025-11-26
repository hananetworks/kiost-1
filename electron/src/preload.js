// preload.js (수정본)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

    toggleDevTools: () => ipcRenderer.send('toggle-debug'),

    refresh: () => ipcRenderer.send('refresh'),

    // [기존] 타이핑 등 비(非)-STT 질문용
    askAI: (conversationHistory) => ipcRenderer.send('openai:ask', conversationHistory),

    print: (htmlContent) => ipcRenderer.invoke('print:content', htmlContent),

    // [기존] (현재는 거의 사용되지 않음)
    correctSTT: (text) => ipcRenderer.invoke('stt:correct', text),

    // [기존] 볼륨 제어 API
    setSystemVolume: (volume) => ipcRenderer.invoke('set-system-volume', volume),
    getSystemVolume: () => ipcRenderer.invoke('get-system-volume'),

    // 🚨🚨🚨 [여기가 빠져있었습니다! 추가 필수!] 🚨🚨🚨
    // 원격 제어 명령 실행 (React -> Main)
    executeRemoteCommand: (commandData) => ipcRenderer.invoke('execute-remote-command', commandData),
    // ----------------------------------------------------


    // --- AI 스트리밍 리스너 (수정 없음) ---
    onAIChunk: (callback) => {
        const listener = (_event, chunk) => callback(chunk);
        ipcRenderer.on('ai:chunk', listener);
        return () => ipcRenderer.removeListener('ai:chunk', listener);
    },
    onAIStreamEnd: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('ai:stream-end', listener);
        return () => ipcRenderer.removeListener('ai:stream-end', listener);
    },
    onAIError: (callback) => {
        const listener = (_event, error) => callback(error);
        ipcRenderer.on('ai:error', listener);
        return () => ipcRenderer.removeListener('ai:error', listener);
    },
    // --- AI 스트리밍 끝 ---


    // --- [신규] STT 결과를 AI로 넘기는 전용 함수 ---
    submitSttForAI: (sttText, conversationHistory) => {
        ipcRenderer.send('stt:submit-for-ai', { sttText, conversationHistory });
    },
    // --- [신규] 끝 ---


    // --- STT 관련 (수정 없음) ---
    startSpeechStream: (lang) => ipcRenderer.send('speech:start-stream', lang),
    sendAudioChunk: (chunk) => ipcRenderer.send('speech:audio-chunk', chunk),
    stopSpeechStream: () => ipcRenderer.send('speech:stop-stream'),

    onSpeechResult: (callback) => {
        const listener = (_event, transcript) => callback(transcript);
        ipcRenderer.on('speech:result', listener);
        return () => ipcRenderer.removeListener('speech:result', listener);
    },
    onSpeechInterimResult: (callback) => {
        const listener = (_event, transcript) => callback(transcript);
        ipcRenderer.on('speech:interim-result', listener);
        return () => ipcRenderer.removeListener('speech:interim-result', listener);
    },
    onSpeechError: (callback) => {
        const listener = (_event, error) => callback(error);
        ipcRenderer.on('speech:error', listener);
        return () => ipcRenderer.removeListener('speech:error', listener);
    },
    // --- STT 끝 ---


    // --- TTS 관련 (수정 없음) ---
    sendTtsCommand: (language, commandObject) => {
        ipcRenderer.send('tts:command', { lang: language, command: commandObject });
    },
    onTtsPlaybackFinished: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('tts:playback-finished', listener);
        return () => ipcRenderer.removeListener('tts:playback-finished', listener);
    },
    // --- TTS 끝 ---

    // [기존] 유휴 상태 전송 함수
    sendInactivityStatus: (status) => {
        ipcRenderer.send('app:inactivity-status', status);
    }
});