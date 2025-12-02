const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

    // ============================================================
    // ✅ [핵심 추가] 업데이트 및 파이썬 다운로드 신호 수신용 (이게 없어서 안 떴음)
    // ============================================================
    on: (channel, func) => {
        const validChannels = [
            // 1. 앱 업데이트 관련
            'update-checking',
            'update-available',
            'update-not-available',
            'download-progress',
            'update-downloaded',
            'update-error',

            // 2. Python 업데이트 관련
            'python-download-start',
            'python-download-progress',
            'python-extracting',
            'python-download-complete',
            'python-download-error'
        ];
        if (validChannels.includes(channel)) {
            // 이벤트 리스너 등록
            const subscription = (event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);

            // 리스너 제거 함수 반환 (React useEffect clean-up용)
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        }
    },

    // 업데이트 설치 요청 (React -> Main)
    send: (channel, data) => {
        const validChannels = ['quit-and-install'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    // ============================================================


    // --- [기존 기능 유지] ---
    toggleDevTools: () => ipcRenderer.send('toggle-debug'),
    refresh: () => ipcRenderer.send('refresh'),

    // AI 및 시스템 제어
    askAI: (conversationHistory) => ipcRenderer.send('openai:ask', conversationHistory),
    print: (htmlContent) => ipcRenderer.invoke('print:content', htmlContent),
    correctSTT: (text) => ipcRenderer.invoke('stt:correct', text),
    setSystemVolume: (volume) => ipcRenderer.invoke('set-system-volume', volume),
    getSystemVolume: () => ipcRenderer.invoke('get-system-volume'),
    executeRemoteCommand: (commandData) => ipcRenderer.invoke('execute-remote-command', commandData),

    // AI 스트리밍 리스너
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

    // STT 결과를 AI로 넘기는 전용 함수
    submitSttForAI: (sttText, conversationHistory, lang) => {
        // lang 인자 추가하여 백엔드 전송
        ipcRenderer.send('stt:submit-for-ai', { sttText, conversationHistory, lang });
    },

    // STT 관련
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

    // TTS 관련
    sendTtsCommand: (language, commandObject) => {
        ipcRenderer.send('tts:command', { lang: language, command: commandObject });
    },
    onTtsPlaybackFinished: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('tts:playback-finished', listener);
        return () => ipcRenderer.removeListener('tts:playback-finished', listener);
    },

    // 유휴 상태 전송
    sendInactivityStatus: (status) => {
        ipcRenderer.send('app:inactivity-status', status);
    }
});