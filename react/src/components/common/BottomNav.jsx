import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import HomeIcon from "../../assets/icons/home.svg?react";
import BackIcon from "../../assets/icons/back.svg?react";
import CallIcon from "../../assets/icons/call.svg?react";
import HighContrastIcon from "../../assets/icons/high_contrast.svg?react";
import ZoomInIcon from "../../assets/icons/zoom_in.svg?react";
// import CaptionIcon from "../../assets/icons/caption.svg?react"; // [삭제] 자막 아이콘 미사용
import VoiceIcon from "../../assets/icons/voice.svg?react";
import VoiceModal from "./VoiceModal";
import CallModal from "./CallModal";
import MicIcon from "../../assets/icons/mic.svg?react";
import LanguageModal from "./LanguageModal";
import { changeLanguage } from "../../utils/changeLanguage";
import { useLanguage } from "../../hooks/useLanguage";

// ✅ [추가] 키보드 아이콘 및 모달 import
import { FaKeyboard } from "react-icons/fa"; // npm install react-icons 필요
import KeyboardModal from "./KeyboardModal"; // ⚠️ 파일 경로 확인 필요! (같은 폴더에 있다고 가정)

// --- 국기 아이콘 import ---
import koIcon from "../../assets/icons/ko_icon.png";
import enIcon from "../../assets/icons/en_icon.png";
import zhIcon from "../../assets/icons/zh_icon.png";
import jaIcon from "../../assets/icons/ja_icon.png";
import esIcon from "../../assets/icons/es_icon.png";

const getLangFlag = (lang) => {
    switch (lang?.toLowerCase()) {
        case "ko": return koIcon;
        case "en": return enIcon;
        case "zh": case "zh-cn": return zhIcon;
        case "ja": case "ja-jp": return jaIcon;
        case "es": case "es-es": return esIcon;
        case "vi": return "🇻🇳"; // 베트남어 (아이콘 없으면 이모지 사용)
        case "tl": case "fil": return "🇵🇭"; // 필리핀어 (아이콘 없으면 이모지 사용)
        default: return koIcon;
    }
};

export default function BottomNav({
    setContrastLevel,
    onToggleSubtitle, // 이제 사용 안 함 (필요 시 제거 가능)
    onRequestSpeak,
    defaultMessage,
    zoomLevel,
    setZoomLevel,
    voiceSettings,
    setVoiceSettings
}) {
    const navigate = useNavigate();
    const location = useLocation();
    const [modalType, setModalType] = useState(null);

    const { lang: language } = useLanguage();

    const openLanguageModal = () => setModalType("language");

    const handleHighContrast = () => {
        setContrastLevel((prev) => (prev + 1) % 3);
    };

    const openVoiceModal = () => setModalType("voice");

    const openCallModal = () => {
        setModalType("call");
        onRequestSpeak?.("직원 호출을 요청하였습니다. 곧 직원이 도와드릴 예정입니다. 잠시만 기다려 주세요.");
    };

    // ✅ [추가] 키보드 모달 열기 함수
    const openKeyboardModal = () => {
        setModalType("keyboard");
    };

    const handleZoom = () => {
        setZoomLevel((prev) => (prev === 1 ? 2 : 1));
    };

    const getZoomButtonText = () => (zoomLevel === 1 ? "화면확대" : "화면축소");

    const stopTTSAndNavigate = (path) => {
        console.log(`[BottomNav] 화면 이동 전 TTS 중지 명령 (ALL /stop) 전송`);
        if (window.electronAPI) {
            window.electronAPI.sendTtsCommand('ALL', { text: "/stop" });
        }
        if (typeof path === "string" || typeof path === "number") {
            navigate(path);
        }
    };

    // --- 버튼 구성 수정 ---
    const buttons = [
        { key: "call", Icon: CallIcon, text: "직원호출", onClick: openCallModal },
        { key: "zoom", Icon: ZoomInIcon, text: getZoomButtonText(), onClick: handleZoom },
        { key: "contrast", Icon: HighContrastIcon, text: "선명모드", onClick: handleHighContrast },
        { key: "lang", text: "Language", flag: getLangFlag(language), onClick: openLanguageModal },

        // ✅ [수정] 자막안내 -> 키보드 버튼으로 교체
        { key: "keyboard", Icon: FaKeyboard, text: "키보드", onClick: openKeyboardModal },

        { key: "voice", Icon: VoiceIcon, text: "음성안내", onClick: openVoiceModal },
    ];

    const isKorean = language === "ko";

    return (
        <div className={`bottom-nav w-full flex flex-col items-center justify-end ${isKorean ? "text-[1rem]" : "text-[0.9rem]"}`}>

            {/* 상단 네비게이션 (이전, 처음으로, AI 도움) - 기존 동일 */}
            <div className="flex flex-row gap-2 w-full mt-10 px-4">
                <button
                    onClick={() => {
                        if (location.pathname === "/" || location.pathname.startsWith("/kiosk/main")) return;
                        stopTTSAndNavigate(-1);
                    }}
                    disabled={location.pathname === "/" || location.pathname.startsWith("/kiosk/main")}
                    className={`flex-1 flex items-center justify-center gap-3 rounded-full shadow-xl text-3xl h-20 font-bold
                    ${location.pathname === "/" || location.pathname.startsWith("/kiosk/main")
                            ? "bg-gray-400 text-gray-200 cursor-not-allowed"
                            : "bg-black text-white hover:bg-gray-800 active:bg-gray-700"
                        }`}
                >
                    {isKorean && <BackIcon className="w-10 h-10 lg:w-12 lg:h-12" />}
                    <span className="leading-tight text-center break-keep">이전</span>
                </button>

                <button
                    onClick={() => stopTTSAndNavigate("/")}
                    className="flex-1 flex items-center justify-center gap-3 bg-black text-white rounded-full shadow-xl text-3xl h-20 font-bold hover:bg-gray-800 active:bg-gray-700"
                >
                    {isKorean && <HomeIcon className="w-12 h-12 lg:w-12 lg:h-14" />}
                    <span className="leading-tight text-center break-keep">처음으로</span>
                </button>

                <button
                    onClick={() => navigate("/ai")}
                    className="flex-1 flex items-center justify-center gap-3 text-white rounded-full shadow-xl text-3xl h-20 hover:opacity-90 font-bold active:opacity-80"
                    style={{ background: "linear-gradient(135deg, #0066cc 0%, #004999 100%)" }}
                >
                    {isKorean && <MicIcon className="w-9 h-9 lg:w-10 lg:h-12" />}
                    <span className="leading-tight text-center break-keep">AI 도움</span>
                </button>
            </div>

            {/* 하단 기능 버튼 그리드 */}
            <div className="grid grid-cols-3 gap-2 px-1 mt-5 mb-8 w-full">
                {buttons.map(({ key, Icon, text, flag, onClick }) => (
                    <button
                        key={key}
                        onClick={onClick}
                        className="bg-black text-white w-full h-24
                          rounded-xl shadow-xl flex items-center justify-center
                          gap-3 text-3xl font-bold hover:bg-gray-800 active:bg-gray-700"
                    >
                        {key === "lang" ? (
                            <span className="flex items-center gap-3 notranslate">
                                <img src={flag} alt="lang-flag" className="w-10 h-10 lg:w-12 lg:h-12 object-contain" />
                                {text}
                            </span>
                        ) : (
                            <>
                                {/* FaKeyboard는 컴포넌트 형태이므로 바로 렌더링 */}
                                {isKorean && Icon && <Icon className="w-10 h-10 lg:w-12 lg:h-12 ml-3" />}
                                <span className="text-[1.6rem] lg:text-[1.8rem] text-center break-words whitespace-normal leading-tight">
                                    {text}
                                </span>
                            </>
                        )}
                    </button>
                ))}
            </div>

            {/* 모달 영역 */}
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
                            onSelect={async (langCode) => {
                                await changeLanguage(langCode);
                                setModalType(null);
                            }}
                        />
                    )}

                    {/* ✅ [추가] 키보드 모달 연결 */}
                    {modalType === "keyboard" && (
                        <KeyboardModal
                            onClose={() => setModalType(null)}
                        />
                    )}
                </div>
            </div>

        </div>
    );
}