import { HashRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import KioskMain from "./pages/kioskmain/KioskMain";
import NaturePage from "./pages/nature/NaturePage";
import HistoryPage from "./pages/history/HistoryPage";
import AIDialogue from "./pages/ai/AIDialogue";

// ✅ 훅 Import
import { useRemoteControl } from "./hooks/useRemoteControl";
import { useKeyboardNav } from "./hooks/useKeyboardNav";

// 컴포넌트 Import
import BrightnessOverlay from "./components/remote/BrightnessOverlay"; // 밝기 조절 오버레이

// [유휴 상태 감지 훅]
function useIdleTimer(timeout = 60000) { // 기본 60초 (테스트 시 조절)
    const timerRef = useRef(null);

    const resetTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);

        // "사용 중" 신호
        if (window.electronAPI?.sendInactivityStatus) {
            window.electronAPI.sendInactivityStatus(false);
        }

        // "유휴 상태" 타이머 설정
        timerRef.current = setTimeout(() => {
            console.log("IdleTimer: 활동 없음. 유휴 상태 진입.");
            if (window.electronAPI?.sendInactivityStatus) {
                window.electronAPI.sendInactivityStatus(true);
            }
        }, timeout);
    };

    useEffect(() => {
        const events = ['mousedown', 'touchstart', 'keydown', 'scroll', 'mousemove'];
        resetTimer();
        events.forEach(event => window.addEventListener(event, resetTimer));
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            events.forEach(event => window.removeEventListener(event, resetTimer));
        };
    }, [timeout]);
}

function AppContent() {
    const [contrastLevel, setContrastLevel] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [voiceSettings, setVoiceSettings] = useState({ volume: 50, rate: 1, pitch: 1 });
    const [isZoomTransitioning, setIsZoomTransitioning] = useState(false);
    const location = useLocation();

    // 1. 유휴 타이머 실행
    useIdleTimer(60000);

    // 2. 리모컨 기능 활성화 (훅 사용)
    useRemoteControl();

    // 3. 키보드/리모컨 네비게이션 활성화 (훅 사용)
    useKeyboardNav();

    // 4. 줌 효과 관리
    useEffect(() => {
        setIsZoomTransitioning(true);
        const timer = setTimeout(() => setIsZoomTransitioning(false), 300);
        return () => clearTimeout(timer);
    }, [zoomLevel]);

    // 5. 페이지 이동 시 스크롤 초기화
    useEffect(() => {
        const scrollWrapper = document.querySelector('.scroll-wrapper');
        if (scrollWrapper) scrollWrapper.scrollTop = 0;
    }, [location.pathname]);

    // 6. 고대비 모드 적용
    useEffect(() => {
        document.body.classList.remove("contrast-1", "contrast-2");
        if (contrastLevel === 1) document.body.classList.add("contrast-1");
        if (contrastLevel === 2) document.body.classList.add("contrast-2");
    }, [contrastLevel]);

    // 7. 언어 클래스 적용 (간단 버전)
    useEffect(() => {
        const lang = localStorage.getItem("app_lang") || "ko";
        document.body.classList.add(`lang-${lang}`);
    }, []);

    // 8. 구글 번역기 초기화 및 중복 방지
    useEffect(() => {
        const cleanup = () => {
            const iframes = document.querySelectorAll('iframe[src*="translate.google"]');
            iframes.forEach((f, i) => {
                if (i > 0) f.remove(); // 중복 제거
            });
        };
        const observer = new MutationObserver(cleanup);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, []);

    return (
        <div className="scroll-wrapper w-screen h-screen overflow-auto">
            <div
                className="zoom-content"
                style={{
                    transform: `scale(${zoomLevel})`,
                    transformOrigin: "top left",
                    transition: isZoomTransitioning ? "transform 0.3s ease-in-out" : "none",
                }}
            >
                <Routes>
                    <Route path="/" element={<Navigate to="/kiosk/main/nature" replace />} />
                    <Route
                        path="/kiosk/main/:tab"
                        element={
                            <KioskMain
                                setContrastLevel={setContrastLevel}
                                zoomLevel={zoomLevel}
                                setZoomLevel={setZoomLevel}
                                voiceSettings={voiceSettings}
                                setVoiceSettings={setVoiceSettings}
                            />
                        }
                    />
                    <Route
                        path="kiosk/nature/:id"
                        element={
                            <NaturePage
                                setContrastLevel={setContrastLevel}
                                zoomLevel={zoomLevel}
                                setZoomLevel={setZoomLevel}
                                voiceSettings={voiceSettings}
                                setVoiceSettings={setVoiceSettings}
                            />
                        }
                    />
                    <Route
                        path="kiosk/history/:id"
                        element={
                            <HistoryPage
                                setContrastLevel={setContrastLevel}
                                zoomLevel={zoomLevel}
                                setZoomLevel={setZoomLevel}
                                voiceSettings={voiceSettings}
                                setVoiceSettings={setVoiceSettings}
                            />
                        }
                    />
                    <Route
                        path="ai"
                        element={
                            <AIDialogue
                                setContrastLevel={setContrastLevel}
                                zoomLevel={zoomLevel}
                                setZoomLevel={setZoomLevel}
                                voiceSettings={voiceSettings}
                                setVoiceSettings={setVoiceSettings}
                            />
                        }
                    />
                </Routes>
            </div>
        </div>
    );
}

export default function App() {
    return (
        <Router>
            {/* 화면 밝기 오버레이 (최상단) */}
            <BrightnessOverlay />
            <AppContent />
        </Router>
    );
}