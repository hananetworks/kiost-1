import { useState, useEffect, useCallback } from "react";

export function useSystemVolume(initialVolume = 50) {
    const [volume, setVolume] = useState(initialVolume);

    // 초기 마운트 시 시스템 볼륨 가져오기
    useEffect(() => {
        const fetchVolume = async () => {
            if (window.electronAPI?.getSystemVolume) {
                try {
                    const currentVol = await window.electronAPI.getSystemVolume();
                    console.log("🔊 System Volume:", currentVol);
                    setVolume(currentVol);
                } catch (error) {
                    console.error("볼륨 가져오기 실패:", error);
                }
            }
        };
        fetchVolume();
    }, []);

    // 볼륨 변경 함수 (State 업데이트 + IPC 전송)
    const updateVolume = useCallback((newVolume) => {
        setVolume(newVolume);
        if (window.electronAPI?.setSystemVolume) {
            window.electronAPI.setSystemVolume(newVolume);
        }
    }, []);

    return { volume, setVolume: updateVolume };
}