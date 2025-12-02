const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

    // ============================================================
    // ✅ [핵심 추가] 업데이트 및 파이썬 다운로드 신호 수신용 (이게 없어서 안 떴음)
    // ============================================================
    on: (channel, func) => {
        const validChannels = [
            // 🚨 [필수] 업데이트 관련 채널
            'update-checking', 'update-available', 'update-not-available',
            'download-progress', 'update-downloaded', 'update-error',
            // 🚨 [필수] Python 다운로드 관련 채널
            'python-download-start', 'python-download-progress',
            'python-extracting', 'python-download-complete', 'python-download-error',

            // 기존 채널들
            'speech-result', 'speech-interim-result', 'speech-error',
            'ai-chunk', 'ai-stream-end', 'ai-error', 'tts-playback-finished'
        ];

        if (validChannels.includes(channel)) {
            const subscription = (event, ...args) => {
                // console.log(`📡 [Preload] 신호 수신: ${channel}`, args); // 디버깅용
                func(...args);
            };
            ipcRenderer.on(channel, subscription);
            return () => ipcRenderer.removeListener(channel, subscription);
        }
    },

    // --- [2] 송신 (Renderer -> Main) ---
    send: (channel, data) => {
        const validChannels = ['quit-and-install', 'python-download-start', 'start-speech-stream', 'stop-speech-stream', 'stt:submit-for-ai', 'tts:command', 'app:inactivity-status', 'speech:audio-chunk'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },

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