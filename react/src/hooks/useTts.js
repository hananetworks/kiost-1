import { useRef, useCallback, useEffect } from "react";

export function useTts(lang) {
    const ttsQueueRef = useRef([]);       // 대기열
    const isTtsPlayingRef = useRef(false); // 재생 중인지 여부
    const audioRef = useRef(new Audio());  // 오디오 플레이어 (브라우저 내장)

    // 1. 큐 초기화 및 중지 (Stop)
    const stopTts = useCallback(() => {
        // 대기열 비우기
        ttsQueueRef.current = [];
        isTtsPlayingRef.current = false;

        // 현재 재생 중인 오디오 즉시 중단
        audioRef.current.pause();
        audioRef.current.currentTime = 0;

        // (선택) 필요하다면 로그 출력
        console.log("[useTts] TTS Stopped.");
    }, []);

    // 언어 자동 감지 함수
    const detectLanguage = (text) => {
        // 한글 체크
        if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
        // 일본어 체크 (히라가나, 가타카나)
        if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'ja';
        // 중국어 체크 (CJK 통합 한자)
        if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
        // 기본값: 영어
        return 'en';
    };

    // 2. 큐에서 하나 꺼내서 처리 (API 요청 -> 재생)
    const speakNext = useCallback(async () => {
        // 이미 재생 중이거나 큐가 비었으면 패스
        if (isTtsPlayingRef.current || ttsQueueRef.current.length === 0) return;

        const textToPlay = ttsQueueRef.current.shift();
        if (!textToPlay?.trim()) {
            speakNext();
            return;
        }

        isTtsPlayingRef.current = true;
        // ✅ Hook에서 받은 언어를 사용 (베트남어/필리핀어 지원)
        let targetLang = (lang || 'ko').toLowerCase().split('-')[0];
        if (targetLang === 'fil') targetLang = 'tl'; // fil -> tl 변환


        try {
            console.log(`[useTts] 요청 시작: "${textToPlay}"`);

            // ★ 핵심: Electron(Main)을 통해 Python API 서버에 요청
            // preload.js에 ipcRenderer.invoke가 연결되어 있어야 합니다.
            const result = await window.electronAPI.invoke('tts-request', {
                text: textToPlay,
                lang: targetLang
            });

            console.log(`[useTts] 응답 받음:`, result);

            if (result.ok && result.url) {
                // 성공하면 URL을 받아서 오디오 소스로 설정
                console.log(`[useTts] 재생 준비: ${result.url}`);
                audioRef.current.src = result.url;
                audioRef.current.play().catch(e => console.error("[useTts] 재생 에러:", e));

                // 재생 끝나면 다음 거 실행
                audioRef.current.onended = () => {
                    isTtsPlayingRef.current = false;
                    speakNext();
                };
            } else {
                console.error("[useTts] 실패 - result:", result);
                isTtsPlayingRef.current = false;
                speakNext(); // 실패해도 다음 거 시도
            }

        } catch (error) {
            console.error("[useTts] 통신 에러:", error);
            isTtsPlayingRef.current = false;
            speakNext();
        }
    }, [lang]);

    // 3. 텍스트 추가 (Add)
    const addText = useCallback((text, forcePlay = false) => {
        if (!text?.trim()) return;

        // forcePlay면 기존 거 끊고 바로 시작
        if (forcePlay) {
            stopTts();
        }

        ttsQueueRef.current.push(text);

        if (!isTtsPlayingRef.current) {
            speakNext();
        }
    }, [speakNext, stopTts]);

    // 컴포넌트 사라질 때 정리
    useEffect(() => {
        return () => stopTts();
    }, [stopTts]);

    return { addText, stopTts };
}