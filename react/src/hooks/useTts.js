import { useRef, useCallback, useEffect } from "react";

export function useTts(lang) {
    const ttsQueueRef = useRef([]);
    const isTtsPlayingRef = useRef(false);
    const hasPlaybackStartedRef = useRef(false);

    // 큐 초기화 및 중지
    const stopTts = useCallback(() => {
        ttsQueueRef.current = [];
        isTtsPlayingRef.current = false;
        hasPlaybackStartedRef.current = false;
        window.electronAPI.sendTtsCommand('ALL', { command: "stop" });
    }, []);

    // 큐에서 하나 꺼내 읽기
    const speakNext = useCallback(() => {
        if (isTtsPlayingRef.current || ttsQueueRef.current.length === 0) return;

        const textToPlay = ttsQueueRef.current.shift();
        if (!textToPlay?.trim()) {
            speakNext();
            return;
        }

        isTtsPlayingRef.current = true;
        // 한국어/영어만 지원한다고 가정
        const targetLang = lang?.startsWith('ko') ? 'ko' : 'en';
        window.electronAPI.sendTtsCommand(targetLang, { text: textToPlay });
    }, [lang]);

    // 텍스트 추가
    const addText = useCallback((text, forcePlay = false) => {
        if (!text?.trim()) return;
        ttsQueueRef.current.push(text);

        if (!isTtsPlayingRef.current && (forcePlay || hasPlaybackStartedRef.current)) {
            hasPlaybackStartedRef.current = true;
            speakNext();
        }
    }, [speakNext]);

    // 재생 완료 리스너
    useEffect(() => {
        const removeListener = window.electronAPI.onTtsPlaybackFinished(() => {
            isTtsPlayingRef.current = false;
            speakNext(); // 다음 문장 재생
        });
        return () => removeListener();
    }, [speakNext]);

    return { addText, stopTts };
}