// public/audio-processor.js (VAD + 디버깅 로그 최종 버전)

console.log(">>> audio-processor.js script loaded (VAD Enabled) <<<"); // VAD 사용 명시

class AudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        console.log(">>> AudioProcessor constructor called (VAD Enabled) <<<");

        // --- VAD 설정 (필요시 이 값들을 조절하세요) ---
        this.rmsThreshold = 0.04;  // 이 값보다 작은 소리는 침묵으로 간주 (0.01 ~ 0.05)
        this.silenceDuration = 1.0; // 이 시간(초) 이상 조용하면 '말 끝' (1.0 ~ 2.0)
        this.speechDuration = 0.1;  // 이 시간(초) 이상 소리가 나야 '말 시작' (0.1 ~ 0.3)
        // --- VAD 설정 끝 ---

        this.sampleRate = 16000; // 고정 샘플 레이트
        this.chunkIntervalMs = 100; // 오디오 청크 전송 간격 (ms)
        this.framesPerChunk = (this.sampleRate / 1000) * this.chunkIntervalMs; // 청크당 프레임 수
        this.chunkBuffer = new Float32Array(this.framesPerChunk); // 현재 청크 데이터 버퍼
        this.chunkIndex = 0; // 현재 청크 버퍼 인덱스

        // VAD 계산용 프레임 수
        this.silenceFrames = (this.sampleRate / 1000) * (this.silenceDuration * 1000);
        this.speechFrames = (this.sampleRate / 1000) * (this.speechDuration * 1000);

        // VAD 상태 변수
        this.silenceCounter = 0; // 연속 침묵 프레임 카운터
        this.speechCounter = 0;  // 연속 소리 프레임 카운터
        this.speechDetected = false; // 현재 말하는 중인지 여부
        this.vadEnabled = true; // VAD 기능 활성화 여부

        // 메인 스레드로부터 메시지 수신 (예: VAD 활성화/비활성화)
        this.port.onmessage = (event) => {
            if (event.data.type === 'control') {
                if (typeof event.data.vadEnabled === 'boolean') {
                    this.vadEnabled = event.data.vadEnabled;
                    console.log(`>>> AudioProcessor VAD ${this.vadEnabled ? 'Enabled' : 'Disabled'} <<<`);
                    this.resetVadState(); // VAD 상태 변경 시 리셋
                }
            }
        };
    }

    // VAD 상태 초기화 함수
    resetVadState() {
        this.silenceCounter = 0;
        this.speechCounter = 0;
        this.speechDetected = false;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
            return true; // 입력 없으면 통과
        }
        const inputChannel = input[0];

        let minVal = 1.0, maxVal = -1.0, sum = 0; // 디버깅용

        for (let i = 0; i < inputChannel.length; i++) {
            const sample = inputChannel[i];

            // 디버깅 값 업데이트
            if (sample < minVal) minVal = sample;
            if (sample > maxVal) maxVal = sample;
            sum += sample * sample;

            // 1. 오디오 청크 버퍼 채우기
            this.chunkBuffer[this.chunkIndex++] = sample;
            if (this.chunkIndex === this.framesPerChunk) {
                this.port.postMessage(this.chunkBuffer.slice()); // 복사본 전송
                this.chunkIndex = 0; // 인덱스 리셋
            }

            // 2. VAD 로직 (활성화된 경우에만 실행)
            if (this.vadEnabled) {
                const isSilentFrame = Math.abs(sample) < this.rmsThreshold;

                if (isSilentFrame) { // 조용할 때
                    this.speechCounter = 0;
                    if (this.speechDetected) { // 말하다 조용해졌다면
                        this.silenceCounter++;
                        if (this.silenceCounter >= this.silenceFrames) {
                            console.log(">>> VAD: Speech ended (silence detected). Sending speech_end signal.");
                            this.port.postMessage({ type: "vad", status: "speech_end" });
                            this.resetVadState(); // 상태 리셋
                        }
                    }
                } else { // 소리 있을 때
                    this.silenceCounter = 0;
                    if (!this.speechDetected) { // 조용하다 말 시작했다면
                        this.speechCounter++;
                        if (this.speechCounter >= this.speechFrames) {
                            console.log(">>> VAD: Speech started. Sending speech_start signal.");
                            this.port.postMessage({ type: "vad", status: "speech_start" });
                            this.speechDetected = true; // 상태 변경
                            this.speechCounter = 0;
                        }
                    }
                }
            } // end if (this.vadEnabled)
        } // end for loop

        // RMS 로그 (필요시 주석 해제)
        // const rms = Math.sqrt(sum / inputChannel.length);
        // if (rms > 0.005) { console.log(`[AudioProcessor DEBUG] Chunk RMS: ${rms.toFixed(4)}`); }

        return true; // Keep processor alive
    }
}

registerProcessor('audio-processor', AudioProcessor);
console.log(">>> audio-processor registered (VAD Enabled) <<<");