import { useState, useEffect } from 'react';

export function useAutoUpdate() {
    // status: 'idle' | 'checking' | 'available' | 'downloading' | 'completed' | 'error' | 'python-downloading' | 'python-extracting'
    const [updateStatus, setUpdateStatus] = useState('idle');
    const [progress, setProgress] = useState(0);
    const [version, setVersion] = useState('');

    useEffect(() => {
        if (!window.electronAPI) return;

        // --- 1. 앱 업데이트 (Electron) ---
        const removeChecking = window.electronAPI.on('update-checking', () => {
            console.log("🔄 앱 업데이트 확인 중...");
            setUpdateStatus('checking');
        });

        const removeAvailable = window.electronAPI.on('update-available', (info) => {
            console.log("✅ 앱 업데이트 발견:", info.version);
            setUpdateStatus('available');
            setVersion(info.version);
        });

        const removeProgress = window.electronAPI.on('download-progress', (progressObj) => {
            const percent = Math.round(progressObj.percent || 0);
            setUpdateStatus('downloading');
            setProgress(percent);
        });

        const removeDownloaded = window.electronAPI.on('update-downloaded', () => {
            setUpdateStatus('completed');
            setProgress(100);
        });

        const removeError = window.electronAPI.on('update-error', () => {
            setUpdateStatus('error');
            setTimeout(() => setUpdateStatus('idle'), 3000);
        });

        const removeNotAvailable = window.electronAPI.on('update-not-available', () => {
            // 앱 업데이트 없으면 Python 확인으로 넘어감 -> 잠깐 idle
            setUpdateStatus('idle');
        });


        // --- 2. AI 엔진(Python) 업데이트 ---
        const removePyStart = window.electronAPI.on('python-download-start', () => {
            console.log("🐍 AI 엔진 다운로드 시작");
            setUpdateStatus('python-downloading');
            setProgress(0);
        });

        const removePyProgress = window.electronAPI.on('python-download-progress', (percent) => {
            setUpdateStatus('python-downloading');
            setProgress(Math.round(percent));
        });

        const removePyExtracting = window.electronAPI.on('python-extracting', () => {
            console.log("📦 AI 엔진 압축 해제 중");
            setUpdateStatus('python-extracting');
            setProgress(100);
        });

        const removePyComplete = window.electronAPI.on('python-download-complete', () => {
            console.log("✅ AI 엔진 준비 완료");
            setUpdateStatus('idle');
        });

        const removePyError = window.electronAPI.on('python-download-error', (msg) => {
            console.error("❌ AI 엔진 오류:", msg);
            setUpdateStatus('error');
        });

        return () => {
            removeChecking(); removeAvailable(); removeProgress(); removeDownloaded(); removeError(); removeNotAvailable();
            removePyStart(); removePyProgress(); removePyExtracting(); removePyComplete(); removePyError();
        };
    }, []);

    return { updateStatus, progress, version };
}