const { ipcMain } = require('electron');
// 경로 주의: ../services 로 변경됨
const ttsPipeClient = require('../services/voice/ttsPipeClient');
const ttsPipeClientEN = require('../services/voice/ttsPipeClientEN');

module.exports = function registerTtsHandlers() {
    ipcMain.on('tts:command', (event, args) => {
        const { lang, command } = args;
        const commandString = JSON.stringify(command);
        const isPlayCommand = command.hasOwnProperty('text');
        const stopCommandString = JSON.stringify({ command: "stop" });
        const stopDelay = 50; // ms

        // 모든 TTS 엔진에 명령 (주로 Stop)
        if (lang === 'ALL') {
            console.log(`IPC: tts:command (ALL) -> ${commandString}`);
            if (ttsPipeClient) ttsPipeClient.send(commandString);
            if (ttsPipeClientEN) ttsPipeClientEN.send(commandString);
        }
        // 영어 TTS
        else if (lang === 'en') {
            if (isPlayCommand) {
                if (ttsPipeClient) ttsPipeClient.send(stopCommandString); // 한국어 중단
                setTimeout(() => {
                    if (ttsPipeClientEN) ttsPipeClientEN.send(commandString);
                }, stopDelay);
            } else {
                if (ttsPipeClientEN) ttsPipeClientEN.send(commandString);
            }
        }
        // 한국어 TTS (기본값)
        else {
            if (isPlayCommand) {
                if (ttsPipeClientEN) ttsPipeClientEN.send(stopCommandString); // 영어 중단
                setTimeout(() => {
                    if (ttsPipeClient) ttsPipeClient.send(commandString);
                }, stopDelay);
            } else {
                if (ttsPipeClient) ttsPipeClient.send(commandString);
            }
        }
    });
};