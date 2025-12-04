import { useState, useEffect } from 'react';

export function useAutoUpdate() {
    // [핵심] 초기값을 'startup'으로 해서, 앱 켜지자마자 무조건 오버레이가 보이게 함
    const [updateStatus, setUpdateStatus] = useState('startup');
    const [progress, setProgress] = useState(0);
    const [version, setVersion] = useState('');

    useEffect(() => {
        if (!window.electronAPI) return;

        // 1. 앱 업데이트 관련
        const removeChecking = window.electronAPI.on('update-checking', () => setUpdateStatus('checking'));
        const removeAvailable = window.electronAPI.on('update-available', (info) => {
            setUpdateStatus('available');
            setVersion(info.version);
        });
        const removeProgress = window.electronAPI.on('download-progress', (p) => {
            setUpdateStatus('downloading');
            setProgress(Math.round(p.percent || 0));
        });
        const removeDownloaded = window.electronAPI.on('update-downloaded', () => {
            setUpdateStatus('completed');
            setProgress(100);
        });
        const removeError = window.electronAPI.on('update-error', () => {
            setUpdateStatus('error');
            // 에러 나면 3초 뒤에 강제로 켬 (혹은 멈춤)
            setTimeout(() => setUpdateStatus('idle'), 3000);
        });

        // [중요] "업데이트 없음"이 떠도 바로 앱을 켜지 않음 (파이썬 체크가 남았으므로)
        // 그냥 로그만 찍고 상태는 유지하거나 'checked' 정도로 둠
        const removeNotAvailable = window.electronAPI.on('update-not-available', () => {
            console.log("앱 업데이트 없음. 다음 단계(파이썬) 대기...");
        });


        // 2. 파이썬 관련
        const removePyStart = window.electronAPI.on('python-download-start', () => {
            setUpdateStatus('python-downloading');
            setProgress(0);
        });
        const removePyProgress = window.electronAPI.on('python-download-progress', (p) => {
            setUpdateStatus('python-downloading');
            setProgress(Math.round(p));
        });
        const removePyExtracting = window.electronAPI.on('python-extracting', () => {
            setUpdateStatus('python-extracting');
        });

        // [중요] 파이썬 끝나도 바로 켜지 않음 (메인 프로세스가 최종 신호 줄 때까지 대기)
        const removePyComplete = window.electronAPI.on('python-download-complete', () => {
            console.log("파이썬 준비 완료. 최종 신호 대기...");
        });
        const removePyError = window.electronAPI.on('python-download-error', () => setUpdateStatus('error'));


        // 3. [최종] 모든 준비 완료 신호 (이걸 받아야 문이 열림)
        const removeAppReady = window.electronAPI.on('app-ready', () => {
            console.log("🚀 모든 시스템 준비 완료! 메인 앱 진입.");
            setUpdateStatus('idle'); // 이때 비로소 오버레이가 사라짐
        });

        return () => {
            removeChecking(); removeAvailable(); removeProgress(); removeDownloaded(); removeError(); removeNotAvailable();
            removePyStart(); removePyProgress(); removePyExtracting(); removePyComplete(); removePyError();
            removeAppReady();
        };
    }, []);

    return { updateStatus, progress, version };
}