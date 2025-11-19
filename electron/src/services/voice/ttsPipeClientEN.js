// ttsPipeClientEN.js (영어 TTS)
const net = require('net');
const { EventEmitter } = require('events');

const PIPE_NAME = "\\\\.\\pipe\\melo_tts_en"; // 영어 TTS 파이프 이름

class TtsPipeClient extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.reconnectInterval = 5000; // 5초 후 재시도
        this.buffer = '';
    }

    connect() {
        if (this.client) {
            console.log('[TTS_EN Client] 이미 연결됨.');
            return;
        }

        console.log(`[TTS_EN Client] Python 워커(${PIPE_NAME})에 연결 시도...`);
        this.client = net.createConnection(PIPE_NAME, () => {
            console.log('[TTS_EN Client] ✅ Python 워커에 성공적으로 연결됨.');
        });

        this.client.on('data', (data) => {
            this.buffer += data.toString('utf-8');

            while (this.buffer.includes('\n')) {
                const [message, ...rest] = this.buffer.split('\n');
                this.buffer = rest.join('\n');
                const trimmedMessage = message.trim();

                if (trimmedMessage === 'DONE') {
                    console.log("[TTS_EN Client] ◀ Python으로부터 'DONE' (재생 끝) 신호 수신");
                    this.emit('playback-finished'); // main.js로 이벤트 전파
                } else if (trimmedMessage === 'START') {
                } else if (trimmedMessage) {
                    console.log("[TTS_EN Client] ◀ 수신 (기타):", trimmedMessage);
                }
            }
        });

        this.client.on('end', () => {
            console.log('[TTS_EN Client] ❌ Python 워커 연결 끊김.');
            this.client = null;
            setTimeout(() => this.connect(), this.reconnectInterval);
        });

        this.client.on('error', (err) => {
            console.error('[TTS_EN Client] ❌ 파이프 연결 오류:', err.message);
            this.client = null;
            if (err.code !== 'ENOENT') {
                setTimeout(() => this.connect(), this.reconnectInterval);
            }
        });
    }

    send(commandJson) {
        const command = commandJson.endsWith('\n') ? commandJson : commandJson + '\n';

        if (this.client && this.client.writable) {
            try {
                console.log('[TTS_EN Client] ▶ Python으로 명령 전송:', command.trim());
                this.client.write(command, 'utf-8');
            } catch (err) {
                console.error('[TTS_EN Client] ❌ 파이프 쓰기 오류:', err.message);
            }
        } else {
            console.error('[TTS_EN Client] ❌ 파이프가 연결되지 않아 명령 전송 실패:', command.trim());
            if (!this.client) this.connect();
        }
    }
}

module.exports = new TtsPipeClient();