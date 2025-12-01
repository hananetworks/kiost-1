import { useState, useRef, useEffect, useCallback } from 'react';

export function useStt({ lang, onResult, onInterim, onError }) {
    const [isListening, setIsListening] = useState(false);

    // 비동기 작업 안에서도 최신 상태를 참조하기 위한 Refs
    const audioContextRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const workletNodeRef = useRef(null);
    const isListeningRef = useRef(false);

    // 상태(state)와 Ref 동기화
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);

    // --- 🛑 녹음 중지 함수 ---
    const stopRecording = useCallback(() => {
        if (!mediaStreamRef.current && !audioContextRef.current) return;

        console.log("Hooks(useStt): 녹음 중지 및 리소스 정리 시작...");

        // 1. AudioWorklet 정리
        if (workletNodeRef.current) {
            workletNodeRef.current.port.onmessage = null;
            try { workletNodeRef.current.disconnect(); } catch (e) {}
            workletNodeRef.current = null;
        }

        // 2. AudioContext 정리
        if (audioContextRef.current?.state !== 'closed') {
            try { audioContextRef.current?.close(); } catch (e) {}
            audioContextRef.current = null;
        }

        // 3. 마이크 스트림 정리
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        // 4. 백엔드에 중지 신호 전송
        window.electronAPI.stopSpeechStream();
        setIsListening(false);
    }, []);

    // --- 🎙️ 녹음 시작 함수 ---
    const startRecording = useCallback(async () => {
        if (isListeningRef.current) return; // 이미 듣고 있으면 패스

        console.log("Hooks(useStt): 녹음 시작 시도...");
        setIsListening(true);

        try {
            // 1. 마이크 장치 찾기 (기본 장치 사용)
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInput = devices.find(d => d.kind === 'audioinput');
            const deviceId = audioInput ? audioInput.deviceId : undefined;

            // 2. 스트림 획득 (16kHz 필수)
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: deviceId ? { deviceId: { exact: deviceId }, sampleRate: 16000 } : { sampleRate: 16000 },
                video: false
            });

            mediaStreamRef.current = stream;

            // 3. 오디오 컨텍스트 설정
            const context = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = context;

            // 4. 오디오 프로세서 로드 (경로 주의: public/img/audio-processor.js)
            // 만약 파일 위치가 다르면 경로를 수정해야 합니다.
            try {
                await context.audioWorklet.addModule('/img/audio-processor.js');
            } catch (err) {
                // 혹시 경로가 루트라면 다시 시도 (fallback)
                console.warn("audio-processor 로드 실패(1차), 루트 경로 재시도...");
                await context.audioWorklet.addModule('/audio-processor.js');
            }

            const source = context.createMediaStreamSource(stream);
            const workletNode = new AudioWorkletNode(context, 'audio-processor');

            workletNodeRef.current = workletNode;

            // 5. 오디오 데이터 전송 (PCM 변환)
            workletNode.port.onmessage = (event) => {
                if (!workletNodeRef.current || !isListeningRef.current) return;

                // Float32 -> Int16 변환 (백엔드가 PCM 16bit를 원함)
                if (event.data instanceof Float32Array) {
                    const float32 = event.data;
                    const int16 = new Int16Array(float32.length);
                    for (let i = 0; i < float32.length; i++) {
                        int16[i] = Math.max(-1, Math.min(1, float32[i])) * 0x7FFF;
                    }
                    window.electronAPI.sendAudioChunk(int16.buffer);
                }
            };

            source.connect(workletNode);

            // 6. 백엔드에 시작 신호 전송
            window.electronAPI.startSpeechStream(lang);

        } catch (err) {
            console.error("Mic Error:", err);
            stopRecording(); // 에러 나면 즉시 정리
            setIsListening(false);
            if (onError) onError(err);
            else alert("마이크를 사용할 수 없습니다: " + err.message);
        }
    }, [lang, onError, stopRecording]);

    // --- 📨 IPC 리스너 등록 ---
    useEffect(() => {
        // 최종 결과 수신
        const removeResult = window.electronAPI.onSpeechResult((text) => {
            if (!isListeningRef.current) return;
            // 결과 받으면 녹음 끄고 콜백 호출
            stopRecording();
            if (onResult) onResult(text);
        });

        // 중간 결과(자막용) 수신
        const removeInterim = window.electronAPI.onSpeechInterimResult((text) => {
            if (!isListeningRef.current) return;
            if (onInterim) onInterim(text);
        });

        // 에러 수신
        const removeError = window.electronAPI.onSpeechError((err) => {
            console.error("STT Error form Backend:", err);
            stopRecording();
            if (onError) onError(err);
        });

        return () => {
            removeResult();
            removeInterim();
            removeError();
        };
    }, [onResult, onInterim, onError, stopRecording]);

    // 화면이 꺼지거나 훅이 사라질 때 안전하게 녹음 종료
    useEffect(() => {
        return () => stopRecording();
    }, [stopRecording]);

    return { isListening, startRecording, stopRecording };
}