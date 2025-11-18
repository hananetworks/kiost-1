import { useState, useEffect } from "react"; // ✅ useEffect 추가
import { useNavigate, useLocation } from "react-router-dom";
import HomeIcon from "../../assets/icons/home.svg?react";
import BackIcon from "../../assets/icons/back.svg?react";
import CallIcon from "../../assets/icons/call.svg?react";
import HighContrastIcon from "../../assets/icons/high_contrast.svg?react";
import ZoomInIcon from "../../assets/icons/zoom_in.svg?react";
import CaptionIcon from "../../assets/icons/caption.svg?react";
import VoiceIcon from "../../assets/icons/voice.svg?react";
import VoiceModal from "../../components/common/VoiceModal";
import CallModal from "../../components/common/CallModal";
import MicIcon from "../../assets/icons/mic.svg?react";
import LanguageModal from "../../components/common/LanguageModal";
// Globe 아이콘은 새 코드에서 사용 안 함
// import Globe from "../../assets/icons/globe.svg?react";
import { changeLanguage } from "../../utils/changeLanguage";

// --- 🔽 [추가] 국기 아이콘 import ---
import koIcon from "../../assets/icons/ko_icon.png";
import enIcon from "../../assets/icons/en_icon.png";
import zhIcon from "../../assets/icons/zh_icon.png";
import jaIcon from "../../assets/icons/ja_icon.png";
import esIcon from "../../assets/icons/es_icon.png";
// --- [추가] 끝 ---


// --- 🔽 [추가] 언어별 국기 아이콘 반환 함수 ---
const getLangFlag = (lang) => {
    switch (lang?.toLowerCase()) { // 소문자로 비교 (안전성)
        case "ko":
            return koIcon;
        case "en":
            return enIcon;
        case "zh":
        case "zh-cn": // 중국어 간체 추가
            return zhIcon;
        case "ja":
        case "ja-jp": // 일본어 추가
            return jaIcon;
        case "es":
        case "es-es": // 스페인어 추가
            return esIcon;
        default:
            return koIcon; // 기본값 한국어
    }
};
// --- [추가] 끝 ---


/* ✅ 현재 활성 언어 가져오기 함수 (기존 유지) */
function getActiveLang() {
    const fromLS = localStorage.getItem("app_lang");
    if (fromLS) return fromLS;

    const m = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
    if (m) {
        const v = decodeURIComponent(m[1]);
        const parts = v.split("/");
        const last = parts[parts.length - 1];
        if (last) return last;
    }
    return "ko";
}

export default function BottomNav({
                                      setContrastLevel,            // 고대비
                                      onToggleSubtitle,            // 자막
                                      onRequestSpeak,              // 음성
                                      defaultMessage,              // 기본 안내
                                      zoomLevel,                   // 현재 확대 비율
                                      setZoomLevel,                // 확대
                                      voiceSettings,               // 음성 설정 객체
                                      setVoiceSettings             // 음성 설정
                                  }) {
    const navigate = useNavigate();
    const location = useLocation();
    const [modalType, setModalType] = useState(null);

    // --- 🔽 [수정] 언어 상태 관리 (새 코드 방식 적용) ---
    const [language, setLanguage] = useState(() => getActiveLang());

    /* 언어 변경 시 즉시 아이콘 반영 */
    useEffect(() => {
        const syncLang = () => setLanguage(getActiveLang());
        // localStorage 변경 감지 (changeLanguage.js가 localStorage를 변경하므로)
        window.addEventListener("storage", syncLang);
        // Google 번역 위젯 변경 감지 (필요 시)
        window.addEventListener("languagechange", syncLang);

        // 컴포넌트 언마운트 시 리스너 제거
        return () => {
            window.removeEventListener("storage", syncLang);
            window.removeEventListener("languagechange", syncLang);
        }
    }, []);
    // --- [수정] 끝 ---


    // 언어 선택 모달 열기
    const openLanguageModal = () => {
        setLanguage(getActiveLang()); // 모달 열 때 최신 언어 반영
        setModalType("language");
    };

    // 고대비 전환 (새 코드 방식 % 3 사용)
    const handleHighContrast = () => {
        setContrastLevel((prev) => (prev + 1) % 3);
    };

    // 음성안내 모달 열기
    const openVoiceModal = () => setModalType("voice");

    // 직원 호출 모달
    const openCallModal = () => {
        setModalType("call");
        // Optional Chaining 사용 (onRequestSpeak가 없을 수도 있으므로)
        onRequestSpeak?.("직원 호출을 요청하였습니다. 곧 직원이 도와드릴 예정입니다. 잠시만 기다려 주세요.");
    };

    /* 화면 확대/축소 토글 (새 코드 방식) */
    const handleZoom = () => {
        setZoomLevel((prev) => (prev === 1 ? 2 : 1));
    };

    /* 확대 버튼 텍스트 표시용 (새 코드 방식) */
    const getZoomButtonText = () => (zoomLevel === 1 ? "화면확대" : "화면축소");

    // --- ✅ TTS 중지 후 이동 함수 (기존 기능 유지 - 중요!) ---
    const stopTTSAndNavigate = (path) => {
        console.log(`[BottomNav] 화면 이동 전 TTS 중지 명령 (ALL /stop) 전송`);
        window.electronAPI.sendTtsCommand('ALL', { text: "/stop" });

        if (typeof path === "string") {
            navigate(path);
        } else if (typeof path === "number") {
            navigate(path);
        }
    };
    // --- ✅ ---


    // --- 🔽 [수정] 버튼 구성 (새 코드 방식 적용) ---
    const buttons = [
        { key: "call", Icon: CallIcon, text: "직원호출", onClick: openCallModal },
        { key: "zoom", Icon: ZoomInIcon, text: getZoomButtonText(), onClick: handleZoom },
        { key: "contrast", Icon: HighContrastIcon, text: "선명모드", onClick: handleHighContrast },
        // 언어 버튼: 텍스트는 고정 'Language', 국기는 동적 변경
        { key: "lang", text: "Language", flag: getLangFlag(language), onClick: openLanguageModal },
        { key: "caption", Icon: CaptionIcon, text: "자막안내", onClick: onToggleSubtitle },
        { key: "voice", Icon: VoiceIcon, text: "음성안내", onClick: openVoiceModal },
    ];
    // --- [수정] 끝 ---

    // --- 🔽 [추가] isKorean 변수 ---
    const isKorean = language === "ko";
    // --- [추가] 끝 ---


    // --- 🔽 [수정] 전체 레이아웃 및 스타일 (새 코드 기준) ---
    return (
        // 언어에 따라 기본 텍스트 크기 조절 (새 코드)
        <div className={`bottom-nav w-full flex flex-col items-center justify-end ${isKorean ? "text-[1rem]" : "text-[0.9rem]"}`}>

            {/* 상단 버튼 3개 */}
            {/* gap-2 적용 (새 코드) */}
            <div className="flex flex-row gap-2 w-full mt-10 px-4">

                {/* 이전 */}
                <button
                    onClick={() => {
                        if (location.pathname === "/" || location.pathname.startsWith("/kiosk/main")) return;
                        stopTTSAndNavigate(-1); // ✅ 기존 stopTTSAndNavigate 호출 유지!
                    }}
                    disabled={location.pathname === "/" || location.pathname.startsWith("/kiosk/main")}
                    // 새 코드 스타일 적용 (h-20, text-3xl 등) + isKorean 아이콘 조건부 렌더링
                    className={`flex-1 flex items-center justify-center gap-3 rounded-full shadow-xl text-3xl h-20 font-bold
                    ${location.pathname === "/" || location.pathname.startsWith("/kiosk/main")
                        ? "bg-gray-400 text-gray-200 cursor-not-allowed" // 비활성 스타일 개선
                        : "bg-black text-white hover:bg-gray-800 active:bg-gray-700"
                    }`}
                >
                    {isKorean && <BackIcon className="w-10 h-10 lg:w-12 lg:h-12" />}
                    <span className="leading-tight text-center break-keep">이전</span>
                </button>


                {/* 처음으로 */}
                <button
                    onClick={() => {
                        stopTTSAndNavigate("/"); // ✅ 기존 stopTTSAndNavigate 호출 유지!
                    }}
                    // 새 코드 스타일 적용 + isKorean 아이콘 조건부 렌더링
                    className="flex-1 flex items-center justify-center gap-3 bg-black text-white rounded-full shadow-xl text-3xl h-20 font-bold hover:bg-gray-800 active:bg-gray-700"
                >
                    {isKorean && <HomeIcon className="w-12 h-12 lg:w-12 lg:h-14" />}
                    <span className="leading-tight text-center break-keep">처음으로</span>
                </button>

                {/* AI 도움 */}
                <button
                    onClick={() => {
                        // AI 페이지 이동 시에는 TTS 중지 안 함 (AIDialogue가 스스로 처리)
                        navigate("/ai");
                    }}
                    // 새 코드 스타일 적용 + isKorean 아이콘 조건부 렌더링
                    className="flex-1 flex items-center justify-center gap-3 text-white rounded-full shadow-xl text-3xl h-20 hover:opacity-90 font-bold active:opacity-80"
                    style={{
                        background: "linear-gradient(135deg, #0066cc 0%, #004999 100%)",
                    }}
                >
                    {isKorean && <MicIcon className="w-9 h-9 lg:w-10 lg:h-12" />}
                    <span className="leading-tight text-center break-keep">AI 도움</span>
                </button>
            </div>

            {/* 하단 도움 기능 버튼 */}
            {/* gap-2, px-1 적용 (새 코드) */}
            <div className="grid grid-cols-3 gap-2 px-1 mt-5 mb-8 w-full">
                {buttons.map(({ key, Icon, text, flag, onClick }) => (
                    <button
                        key={key}
                        onClick={onClick}
                        // 새 코드 스타일 적용 (h-20 ~ h-32 범위 대신 h-24 고정?, text-3xl)
                        className="bg-black text-white w-full h-24
              rounded-xl shadow-xl flex items-center justify-center
              gap-3 text-3xl font-bold hover:bg-gray-800 active:bg-gray-700"
                    >
                        {key === "lang" ? (
                            // 언어 버튼: 국기 + 고정 텍스트 "Language"
                            <span className="flex items-center gap-3 notranslate">
                                <img src={flag} alt="lang-flag" className="w-10 h-10 lg:w-12 lg:h-12 object-contain" />
                                {text}
                            </span>
                        ) : (
                            // 나머지 버튼: 아이콘(한국어일때만) + 텍스트
                            <>
                                {isKorean && Icon && <Icon className="w-10 h-10 lg:w-12 lg:h-12 ml-3" />}
                                {/* 새 코드 텍스트 스타일 적용 */}
                                <span className="text-[1.6rem] lg:text-[1.8rem] text-center break-words whitespace-normal leading-tight">{text}</span>
                            </>
                        )}
                    </button>
                ))}
            </div>
            {/* --- [수정] 끝 --- */}


            {/* ✅ 모든 모달을 최상단으로 고정 */}
            <div className="fixed inset-0 z-[99999] pointer-events-none">
                <div className="pointer-events-auto">
                    {modalType === "call" && (
                        <CallModal
                            defaultMessage={defaultMessage}
                            onClose={() => setModalType(null)}
                            onRequestSpeak={onRequestSpeak}
                        />
                    )}
                    {modalType === "voice" && (
                        <VoiceModal
                            defaultMessage={defaultMessage}
                            onClose={() => setModalType(null)}
                            voiceSettings={voiceSettings}
                            setVoiceSettings={setVoiceSettings}
                        />
                    )}
                    {modalType === "language" && (
                        <LanguageModal
                            selected={language}
                            onClose={() => setModalType(null)}
                            onSelect={async (lang) => {
                                setLanguage(lang);
                                localStorage.setItem("app_lang", lang);
                                await changeLanguage(lang);
                                setModalType(null);
                            }}
                        />
                    )}
                </div>
            </div>

        </div>
    );
}