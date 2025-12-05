import { useState, useEffect, useRef } from 'react';

export function useAutoUpdate() {
    // 1. 초기 상태: 이미 부팅된 적이 있으면(도장이 있으면) 'idle'로 시작 -> 화면 안 뜸
    const [updateStatus, setUpdateStatus] = useState(() => {
        const isBooted = sessionStorage.getItem('kiosk_booted');
        return isBooted ? 'idle' : 'startup';
    });

    const [progress, setProgress] = useState(0);
    const [version, setVersion] = useState('');
    const failsafeTimerRef = useRef(null);

    // [헬퍼] 이미 부팅된 상태인지 확인
    const isBooted = () => sessionStorage.getItem('kiosk_booted') === 'true';

    // [수정] 부팅 완료 처리를 확실하게 하는 함수
    const markAsBooted = () => {
        // 1. 세션 스토리지에 도장 찍기 (언어 변경 후 새로고침 되어도 기억함)
        sessionStorage.setItem('kiosk_booted', 'true');
        // 2. 화면 가림막 치우기
        setUpdateStatus('idle');
    };

    useEffect(() => {
        if (!window.electronAPI) {
            console.error("❌ electronAPI 없음 (Preload 확인)");
            return;
        }

        // 안전장치 (15초): 만약 메인 프로세스에서 아무 응답이 없으면 강제로 켬
        if (!isBooted()) {
            failsafeTimerRef.current = setTimeout(() => {
                if (updateStatus !== 'idle' && updateStatus !== 'downloading') {
                    console.warn("⚠️ UI 안전장치 발동: 응답 없어 메인 화면 진입");
                    markAsBooted(); // 안전장치 발동 시에도 도장 찍기
                }
            }, 15000);
        }

        // --- 이벤트 핸들러 ---

        // 1. 업데이트 확인 중
        const removeChecking = window.electronAPI.on('update-checking', () => {
            if (isBooted()) return;
            setUpdateStatus('checking');
        });

        // 2. 업데이트 발견 (이건 부팅 여부 상관없이 무조건 뜸)
        const removeAvailable = window.electronAPI.on('update-available', (info) => {
            setUpdateStatus('available');
            setVersion(info.version);
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
        });

        // 3. 다운로드 진행률
        const removeProgress = window.electronAPI.on('download-progress', (p) => {
            setUpdateStatus('downloading');
            setProgress(Math.round(p.percent || 0));
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
        });

        // 4. 다운로드 완료
        const removeDownloaded = window.electronAPI.on('update-downloaded', () => {
            setUpdateStatus('completed');
            setProgress(100);
        });

        // 5. 에러 발생
        const removeError = window.electronAPI.on('update-error', () => {
            setUpdateStatus('error');
            // 에러 나면 2초 뒤에 그냥 켜줌
            setTimeout(() => markAsBooted(), 2000);
        });

        // [핵심 수정] 업데이트 없음 -> "점검 끝!" -> 부팅 완료 처리
        const removeNotAvailable = window.electronAPI.on('update-not-available', () => {
            if (isBooted()) return; // 이미 켜져있으면 무시

            console.log("Hooks: 업데이트 없음 -> 부팅 완료 처리");
            // 여기서 바로 도장을 찍어버립니다.
            // (만약 파이썬 체크가 뒤에 이어진다면 화면이 잠깐 깜빡일 수 있지만, 무한 로딩보다는 낫습니다)
            markAsBooted();
        });

        // --- 파이썬 관련 핸들러 ---

        const removePyCheckStart = window.electronAPI.on('python-check-start', () => {
            if (isBooted()) return;
            setUpdateStatus('python-checking');
        });

        // [핵심 수정] 파이썬 점검 통과 -> "점검 끝!" -> 부팅 완료 처리
        const removePyCheckPass = window.electronAPI.on('python-check-pass', () => {
            if (isBooted()) return;
            console.log("Hooks: 파이썬 점검 통과 -> 부팅 완료 처리");
            markAsBooted();
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
            markAsBooted(); // 설치 다 됐으니 완료
        });

        const removePyError = window.electronAPI.on('python-download-error', () => {
            setUpdateStatus('error');
            setTimeout(() => markAsBooted(), 2000);
        });

        // 혹시 메인에서 명시적으로 'app-ready'를 보내주는 경우
        const removeAppReady = window.electronAPI.on('app-ready', () => {
            console.log("🚀 Hooks: 메인 앱 진입 신호 수신!");
            markAsBooted();
        });

        // Cleanup (컴포넌트 사라질 때 이벤트 정리)
        return () => {
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
            [
                removeChecking, removeAvailable, removeProgress, removeDownloaded, removeError, removeNotAvailable,
                removePyCheckStart, removePyCheckPass, removePyStart, removePyProgress, removePyExtracting, removePyComplete, removePyError,
                removeAppReady
            ].forEach(fn => fn && typeof fn === 'function' && fn());
        };
    }, []); // 의존성 없음 (한 번만 실행)

    return { updateStatus, progress, version };
}