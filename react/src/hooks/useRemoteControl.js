import { useEffect } from 'react';

const SERVER_URL = 'https://us-api.hananet'; // 리모컨 서버 주소

export function useRemoteControl() {
    useEffect(() => {
        let eventSource = null;
        let reconnectTimer = null;

        // 📝 결과 보고 함수 (서버로 로그 전송)
        const reportLog = async (action, result) => {
            try {
                await fetch(`${SERVER_URL}/api/logs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, result })
                });
                console.log(`📤 [Remote] 결과 전송 완료: ${result.success ? '성공' : '실패'}`);
            } catch (e) {
                console.error("❌ [Remote] 로그 전송 실패:", e);
            }
        };

        const connect = () => {
            console.log(`[Remote] 서버(${SERVER_URL}) 연결 시도...`);
            eventSource = new EventSource(`${SERVER_URL}/api/events/kiosk-control`);

            eventSource.onopen = () => {
                console.log("✅ [Remote] 서버와 연결되었습니다!");
            };

            eventSource.onmessage = async (event) => {
                if (event.data === ': heartbeat') return;

                try {
                    const command = JSON.parse(event.data);
                    if (!command.action) return;

                    console.log("📩 [Remote] 명령 수신:", command);

                    // (A) 화면 밝기 제어 (React 내부 처리)
                    if (command.action === 'SCREEN_BRIGHTNESS') {
                        // React UI 밝기 조절
                        window.dispatchEvent(new CustomEvent('CHANGE_BRIGHTNESS', {
                            detail: command.payload.brightness
                        }));

                        // Electron 시스템 밝기 조절 (있는 경우)
                        if (window.electronAPI?.executeRemoteCommand) {
                            window.electronAPI.executeRemoteCommand(command);
                        }

                        // 결과 보고
                        await reportLog(command.action, {
                            success: true,
                            message: `밝기 ${command.payload.brightness}% 설정 완료`
                        });
                    }
                    // (B) 그 외 시스템 명령 (Electron Main으로 위임)
                    else if (window.electronAPI?.executeRemoteCommand) {
                        const result = await window.electronAPI.executeRemoteCommand(command);
                        // 결과 보고
                        await reportLog(command.action, result);
                    }
                    else {
                        console.error("❌ executeRemoteCommand 함수가 없습니다!");
                    }

                } catch (err) {
                    console.error("❌ [Remote] 처리 중 오류:", err);
                }
            };

            eventSource.onerror = () => {
                console.warn("⚠️ [Remote] 연결 끊김. 3초 후 재연결...");
                eventSource.close();
                reconnectTimer = setTimeout(connect, 3000);
            };
        };

        connect();

        return () => {
            if (eventSource) eventSource.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, []);
}