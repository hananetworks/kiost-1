// preload.js (수정본)
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

    toggleDevTools: () => ipcRenderer.send('toggle-debug'),

    refresh: () => ipcRenderer.send('refresh'),

    // [기존] 타이핑 등 비(非)-STT 질문용
    askAI: (conversationHistory) => ipcRenderer.send('openai:ask', conversationHistory),

    print: (htmlContent) => ipcRenderer.invoke('print:content', htmlContent),

    // [기존] (현재는 거의 사용되지 않음)
    correctSTT: (text) => ipcRenderer.invoke('stt:correct', text),

    // 🔽 [신규] 볼륨 제어 API 추가 🔽
    setSystemVolume: (volume) => ipcRenderer.invoke('set-system-volume', volume),
    getSystemVolume: () => ipcRenderer.invoke('get-system-volume'),


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


    // --- 🔽 [신규] STT 결과를 AI로 넘기는 전용 함수 ---
    /**
     * STT 최종 결과를 대화 내역과 함께 메인 프로세스로 보냅니다.
     * 메인 프로세스의 handleUserSttInput이 응답을 스트리밍합니다.
     * @param {string} sttText - STT로 변환된 최종 텍스트
     * @param {object[]} conversationHistory - 현재까지의 대화 내역
     */
    submitSttForAI: (sttText, conversationHistory) => {
        ipcRenderer.send('stt:submit-for-ai', { sttText, conversationHistory });
    },
    // --- [신규] 끝 ---


    // --- STT 관련 (수정 없음) ---
    startSpeechStream: (lang) => ipcRenderer.send('speech:start-stream', lang),
    sendAudioChunk: (chunk) => ipcRenderer.send('speech:audio-chunk', chunk),
    stopSpeechStream: () => ipcRenderer.send('speech:stop-stream'),

    onSpeechResult: (callback) => { // ◀ 최종 결과 (유지)
        const listener = (_event, transcript) => callback(transcript);
        ipcRenderer.on('speech:result', listener);
        return () => ipcRenderer.removeListener('speech:result', listener);
    },
    onSpeechInterimResult: (callback) => { // ◀ 중간 결과 (유지)
        const listener = (_event, transcript) => callback(transcript);
        ipcRenderer.on('speech:interim-result', listener);
        return () => ipcRenderer.removeListener('speech:interim-result', listener);
    },
    onSpeechError: (callback) => { // ◀ 에러 (유지)
        const listener = (_event, error) => callback(error);
        ipcRenderer.on('speech:error', listener);
        return () => ipcRenderer.removeListener('speech:error', listener);
    },
    // --- STT 끝 ---


    // --- TTS 관련 (수정 없음) ---
    sendTtsCommand: (language, commandObject) => {
        ipcRenderer.send('tts:command', { lang: language, command: commandObject });
    },
    onTtsPlaybackFinished: (callback) => { // 재생 끝 리스너 (유지)
        const listener = () => callback();
        ipcRenderer.on('tts:playback-finished', listener);
        return () => ipcRenderer.removeListener('tts:playback-finished', listener);
    },
    // --- TTS 끝 ---

    // 🔽 [신규] '지능형 업데이트'를 위한 유휴 상태 전송 함수 🔽
    sendInactivityStatus: (status) => {
        ipcRenderer.send('app:inactivity-status', status);
    }
});