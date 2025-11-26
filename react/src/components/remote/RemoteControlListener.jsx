import React, { useEffect, useState } from 'react';

const SERVER_URL = 'http://localhost:5000'; // 리모컨 서버 주소

const RemoteControlListener = () => {
    // 연결 상태 모니터링용
    const [status, setStatus] = useState('disconnected');

    useEffect(() => {
        let eventSource = null;
        let reconnectTimer = null;

        const connect = () => {
            console.log(`[Remote] 서버(${SERVER_URL}) 연결 시도...`);

            // SSE 연결 생성
            eventSource = new EventSource(`${SERVER_URL}/events/kiosk-control`);

            // 1. 연결 성공 시
            eventSource.onopen = () => {
                console.log("✅ [Remote] 서버와 연결되었습니다!");
                setStatus('connected');
            };

            // 2. 메시지 수신 시
            eventSource.onmessage = async (event) => {
                // 🚨 [수정 완료] alert 제거함 (이제 끊김 없이 바로 실행됩니다)
                // console.log("🔥 [Raw Data] 데이터 도착함:", event.data);

                try {
                    // 하트비트 무시
                    if (event.data === ': heartbeat') return;

                    const command = JSON.parse(event.data);
                    console.log("📩 [Remote] 명령 수신:", command);

                    if (!command.action) return;

                    // (A) 화면 밝기 제어 (React 내부 처리)
                    if (command.action === 'SCREEN_BRIGHTNESS') {
                        console.log("💡 밝기 제어 명령 감지됨");
                        const customEvent = new CustomEvent('CHANGE_BRIGHTNESS', {
                            detail: command.payload.brightness
                        });
                        window.dispatchEvent(customEvent);

                        // Electron에도 알림 (값 저장용)
                        if (window.electronAPI) window.electronAPI.executeRemoteCommand(command);

                        reportLog(command.action, { success: true, message: `밝기 ${command.payload.brightness}% 설정(SW)` });
                        return;
                    }

                    // (B) 시스템 명령 (Electron Main으로 전달)
                    console.log("💻 Electron으로 전달 시도...");

                    // window.electronAPI 확인
                    if (!window.electronAPI) {
                        console.error("❌ window.electronAPI가 없습니다! preload.js 확인 필요");
                        return;
                    }

                    if (window.electronAPI.executeRemoteCommand) {
                        // ★ 여기가 핵심: Main 프로세스로 명령을 보내고 결과를 기다림
                        const result = await window.electronAPI.executeRemoteCommand({
                            action: command.action,
                            payload: command.payload
                        });
                        console.log("✅ Electron 실행 결과:", result);

                        // ★ 결과를 서버로 다시 전송 (이게 가야 리모컨 화면이 바뀜)
                        reportLog(command.action, result);
                    } else {
                        console.error("❌ executeRemoteCommand 함수가 없습니다!");
                    }

                } catch (err) {
                    console.error("❌ [Remote] 처리 중 오류 발생:", err);
                }
            };

            // 3. 에러 발생 시 (연결 끊김 등)
            eventSource.onerror = (err) => {
                console.warn("⚠️ [Remote] 연결 끊김. 3초 후 재연결 시도...");
                setStatus('disconnected');
                eventSource.close();

                // 3초 뒤 재연결
                reconnectTimer = setTimeout(connect, 3000);
            };
        };

        // 최초 연결 시작
        connect();

        // 컴포넌트 사라질 때 정리
        return () => {
            if (eventSource) eventSource.close();
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, []);

    // 로그 전송 헬퍼
    const reportLog = async (action, result) => {
        try {
            await fetch(`${SERVER_URL}/api/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, result })
            });
            console.log(`📤 [Remote] 결과 전송 완료: ${result.success ? '성공' : '실패'}`);
        } catch (e) {
            console.error("❌ [Remote] 로그 전송 실패 (서버 꺼짐?)", e);
        }
    };

    return null;
};

export default RemoteControlListener;