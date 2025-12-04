import { useState, useEffect, useRef } from 'react';

export function useAutoUpdate() {
    // [초기상태] 앱이 켜지자마자 오버레이 표시 ('startup')
    const [updateStatus, setUpdateStatus] = useState('startup');
    const [progress, setProgress] = useState(0);
    const [version, setVersion] = useState('');

    // [안전장치] 메인 응답 없을 시 15초 후 강제 진입용 타이머
    const failsafeTimerRef = useRef(null);

    useEffect(() => {
        if (!window.electronAPI) {
            console.error("❌ electronAPI 없음 (Preload 확인)");
            return;
        }

        // 안전장치 타이머 시작 (15초)
        failsafeTimerRef.current = setTimeout(() => {
            if (updateStatus !== 'idle' && updateStatus !== 'downloading') {
                console.warn("⚠️ UI 안전장치 발동: 응답 없어 메인 화면 진입");
                setUpdateStatus('idle');
            }
        }, 15000);

        // --- 이벤트 핸들러 ---

        // 1. 앱 업데이트
        const removeChecking = window.electronAPI.on('update-checking', () => setUpdateStatus('checking'));

        const removeAvailable = window.electronAPI.on('update-available', (info) => {
            setUpdateStatus('available');
            setVersion(info.version);
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
        });

        const removeProgress = window.electronAPI.on('download-progress', (p) => {
            setUpdateStatus('downloading');
            setProgress(Math.round(p.percent || 0));
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
        });

        const removeDownloaded = window.electronAPI.on('update-downloaded', () => {
            setUpdateStatus('completed');
            setProgress(100);
        });

        const removeError = window.electronAPI.on('update-error', () => {
            setUpdateStatus('error');
            setTimeout(() => setUpdateStatus('startup'), 2000);
        });

        // [핵심] 업데이트 없음 -> 'startup'으로 복귀 (파이썬 체크 대기)
        const removeNotAvailable = window.electronAPI.on('update-not-available', () => {
            console.log("Hooks: 앱 업데이트 없음 -> startup 복귀");
            setUpdateStatus('startup');
        });

        // 2. 파이썬 관련
        // [추가] 점검 시작
        const removePyCheckStart = window.electronAPI.on('python-check-start', () => {
            setUpdateStatus('python-checking');
        });
        // [추가] 점검 통과 (이미 설치됨)
        const removePyCheckPass = window.electronAPI.on('python-check-pass', () => {
            setUpdateStatus('python-pass');
        });

        const removePyStart = window.electronAPI.on('python-download-start', () => {
            setUpdateStatus('python-downloading');
            setProgress(0);
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
        });

        const removePyProgress = window.electronAPI.on('python-download-progress', (p) => {
            setUpdateStatus('python-downloading');
            setProgress(Math.round(p));
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
        });

        const removePyExtracting = window.electronAPI.on('python-extracting', () => {
            setUpdateStatus('python-extracting');
        });

        const removePyComplete = window.electronAPI.on('python-download-complete', () => {
            console.log("Hooks: 파이썬 설치 완료");
        });

        const removePyError = window.electronAPI.on('python-download-error', () => setUpdateStatus('error'));

        // 3. 최종 완료 (문 열기)
        const removeAppReady = window.electronAPI.on('app-ready', () => {
            console.log("🚀 Hooks: 메인 앱 진입 신호 수신!");
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
            setUpdateStatus('idle');
        });

        // Cleanup
        return () => {
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
            // 함수 존재 여부 체크 후 실행 (안전성 확보)
            [
                removeChecking, removeAvailable, removeProgress, removeDownloaded, removeError, removeNotAvailable,
                removePyCheckStart, removePyCheckPass, removePyStart, removePyProgress, removePyExtracting, removePyComplete, removePyError,
                removeAppReady
            ].forEach(fn => fn && typeof fn === 'function' && fn());
        };
    }, []);

    return { updateStatus, progress, version };
}