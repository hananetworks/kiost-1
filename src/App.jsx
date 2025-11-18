import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import KioskMain from "./pages/kioskmain/KioskMain";
import NaturePage from "./pages/nature/NaturePage";
import HistoryPage from "./pages/history/HistoryPage";
import AIDialogue from "./pages/ai/AIDialogue";
import { initializeInputHandler } from "./utils/inputHandler";

function getActiveLang() {
    const fromLS = localStorage.getItem("app_lang");
    if (fromLS) return fromLS;
    const m = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
    if (m) {
        const v = decodeURIComponent(m[1]);
        const last = v.split("/").pop();
        if (last) return last;
    }
    return "ko";
}

function AppContent() {
    const [contrastLevel, setContrastLevel] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [voiceSettings, setVoiceSettings] = useState({ volume: 1, rate: 1, pitch: 1 });
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isZoomTransitioning, setIsZoomTransitioning] = useState(false); // ✅ 추가
    const navigate = useNavigate();
    const location = useLocation(); // ✅ 추가

    // ✅ 줌 레벨 변경 시에만 transition 활성화
    useEffect(() => {
        setIsZoomTransitioning(true);
        const timer = setTimeout(() => setIsZoomTransitioning(false), 300);
        return () => clearTimeout(timer);
    }, [zoomLevel]);

    // ✅ 페이지 전환 시 스크롤 최상단으로
    useEffect(() => {
        const scrollWrapper = document.querySelector('.scroll-wrapper');
        if (scrollWrapper) {
            scrollWrapper.scrollTop = 0;
        }
    }, [location.pathname]);

    // ✅ 구글 번역 위젯 로드 후, 마지막 언어로 자동 재적용 (강화버전)
    useEffect(() => {
        const savedLang = localStorage.getItem("app_lang") || "ko";
        window.activeLang = savedLang; // ✅ 전역변수에 저장 (1회 세팅)

        const applyGoogleTranslateLang = () => {
            const select = document.querySelector(".goog-te-combo");
            if (select && savedLang && savedLang !== "ko") {
                const langValue = savedLang.startsWith("zh") ? "zh-CN" : savedLang;
                if (select.value !== langValue) {
                    select.value = langValue;
                    select.dispatchEvent(new Event("change"));
                    console.log(`[Google Translate] Applied: ${langValue}`);
                }
                return true;
            }
            return false;
        };

        // ✅ Google 번역이 이미 초기화된 경우만 시도
        const tryApply = () => {
            if (window.google && window.google.translate) {
                applyGoogleTranslateLang();
                return true;
            }
            return false;
        };

        if (!tryApply()) {
            window.addEventListener("google-translate-load", applyGoogleTranslateLang);
        }

        return () => {
            window.removeEventListener("google-translate-load", applyGoogleTranslateLang);
        };
    }, []);

    // ✅ 구글 번역 iframe 중복 정리 및 누수 방지
useEffect(() => {
  const cleanupGoogleIframes = () => {
    const iframes = document.querySelectorAll('iframe[src*="translate.google"]');
    iframes.forEach((f, i) => {
      if (i > 0) {
        console.warn("🧹 중복 Google 번역 iframe 제거됨:", f.src);
        f.remove();
      }
    });
  };

  // DOM 변화를 감시해서 중복 iframe 즉시 제거
  const observer = new MutationObserver(cleanupGoogleIframes);
  observer.observe(document.body, { childList: true, subtree: true });

  // 페이지 이동 시 iframe 수 확인
  const unlisten = window.addEventListener("hashchange", cleanupGoogleIframes);

  return () => {
    observer.disconnect();
    window.removeEventListener("hashchange", cleanupGoogleIframes);
  };
}, []);


    // ✅ ② 언어 클래스 동기화
    useEffect(() => {
        const applyLangClass = () => {
            const lang = getActiveLang();
            document.body.classList.remove("lang-ko", "lang-en");
            document.body.classList.add(`lang-${lang}`);
        };
        applyLangClass();
        window.addEventListener("languagechange", applyLangClass);
        return () => window.removeEventListener("languagechange", applyLangClass);
    }, []);

    // ✅ ③ TTS 종료 리스너
    useEffect(() => {
        const removeListener = window.electronAPI.onTtsPlaybackFinished(() => {
            console.log("App.jsx (전역 리스너): TTS 재생 완료/중단됨.");
            setIsSpeaking(false);
        });
        return () => removeListener();
    }, []);

    // ✅ ④ 고대비 모드
    useEffect(() => {
        document.body.classList.remove("contrast-1", "contrast-2");
        if (contrastLevel === 1) document.body.classList.add("contrast-1");
        if (contrastLevel === 2) document.body.classList.add("contrast-2");
    }, [contrastLevel]);

    // ✅ ⑤ 키패드 초기화
    useEffect(() => {
        initializeInputHandler(navigate);
        console.log("키패드 핸들러 등록 완료");
    }, [navigate]);

    return (
        <div className="scroll-wrapper w-screen h-screen overflow-auto">
            <div
                className="zoom-content"
                style={{
                    transform: `scale(${zoomLevel})`,
                    transformOrigin: "top left",
                    // ✅ 줌 변경할 때만 transition 적용
                    transition: isZoomTransitioning ? "transform 0.3s ease-in-out" : "none",
                    willChange: isZoomTransitioning ? "transform" : "auto",
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
                                isSpeaking={isSpeaking}
                                setIsSpeaking={setIsSpeaking}
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
                                isSpeaking={isSpeaking}
                                setIsSpeaking={setIsSpeaking}
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
                                isSpeaking={isSpeaking}
                                setIsSpeaking={setIsSpeaking}
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
                                isSpeaking={isSpeaking}
                                setIsSpeaking={setIsSpeaking}
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
            <AppContent />
        </Router>
    );
}