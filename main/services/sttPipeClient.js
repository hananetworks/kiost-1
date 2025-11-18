// main/services/sttPipeClient.js
const net = require('net');
const { EventEmitter } = require('events');

const PIPE_NAME = "\\\\.\\pipe\\stt_whisper"; // STT 파이프 이름 (Whisper가 아닌 GCloud)
const RETRY_INTERVAL = 3000; // 3초 후 재시도

class SttPipeClient extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.isConnected = false;
        this.shouldReconnect = true; // 재연결 시도 여부
    }

    connect() {
        if (this.client) return; // 이미 연결 중이거나 연결됨
        this.shouldReconnect = true;
        console.log(`[STT Pipe] ${PIPE_NAME}에 연결 시도...`);
        this.client = net.connect(PIPE_NAME);

        this.client.on('connect', () => {
            console.log('[STT Pipe] ✅ 성공적으로 연결됨.');
            this.isConnected = true;
            this.emit('connected'); // main.js로 이벤트 전파
        });

        let buffer = ''; // 데이터 수신 버퍼
        this.client.on('data', (data) => {
            buffer += data.toString('utf8');
            // 개행 문자(\n)를 기준으로 JSON 메시지 분리
            while (buffer.includes('\n')) {
                const parts = buffer.split('\n');
                const jsonStr = parts.shift();
                buffer = parts.join('\n');
                if (jsonStr) {
                    try {
                        const jsonData = JSON.parse(jsonStr);
                        // 파싱된 JSON 데이터를 main.js로 전파
                        this.emit('stt:data', jsonData);
                    } catch (e) {
                        console.error('[STT Pipe] 수신된 JSON 파싱 오류:', jsonStr, e);
                    }
                }
            }
        });

        this.client.on('end', () => {
            console.log('[STT Pipe] ❌ 서버로부터 연결 끊김.');
            this.isConnected = false; this.client = null;
            if (this.shouldReconnect) this.reconnect();
        });

        this.client.on('error', (err) => {
            console.error(`[STT Pipe] ❌ 연결 오류: ${err.message}`);
            this.isConnected = false; if (this.client) this.client.destroy(); this.client = null;
            if (this.shouldReconnect) this.reconnect();
        });
    }

    reconnect() {
        console.log(`[STT Pipe] ${RETRY_INTERVAL / 1000}초 후 재연결 시도...`);
        setTimeout(() => { this.connect(); }, RETRY_INTERVAL);
    }

    send(commandJson) {
        if (!this.isConnected || !this.client) {
            console.warn('[STT Pipe] 연결되지 않아 명령을 전송할 수 없습니다.');
            return;
        }
        try {
            // 파이썬에서 \n 기준으로 읽으므로 추가
            this.client.write(commandJson + '\n', 'utf8');
        }
        catch (error) {
            console.error('[STT Pipe] 명령 전송 실패:', error);
        }
    }

    disconnect() {
        this.shouldReconnect = false; // 수동 종료 시 재연결 방지
        if (this.client) { this.client.end(); this.client.destroy(); }
        this.client = null; this.isConnected = false;
        console.log('[STT Pipe] 수동으로 연결 종료됨.');
    }
}

module.exports = new SttPipeClient();