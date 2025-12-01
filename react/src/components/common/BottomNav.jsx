import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import HomeIcon from "../../assets/icons/home.svg?react";
import BackIcon from "../../assets/icons/back.svg?react";
import CallIcon from "../../assets/icons/call.svg?react";
import HighContrastIcon from "../../assets/icons/high_contrast.svg?react";
import ZoomInIcon from "../../assets/icons/zoom_in.svg?react";
import CaptionIcon from "../../assets/icons/caption.svg?react";
import VoiceIcon from "../../assets/icons/voice.svg?react";
import VoiceModal from "./VoiceModal";
import CallModal from "./CallModal";
import MicIcon from "../../assets/icons/mic.svg?react";
import LanguageModal from "./LanguageModal";
import { changeLanguage } from "../../utils/changeLanguage";
import { useLanguage } from "../../hooks/useLanguage"; // ✅ [NEW] 훅 import

// --- 국기 아이콘 import ---
import koIcon from "../../assets/icons/ko_icon.png";
import enIcon from "../../assets/icons/en_icon.png";
import zhIcon from "../../assets/icons/zh_icon.png";
import jaIcon from "../../assets/icons/ja_icon.png";
import esIcon from "../../assets/icons/es_icon.png";

// --- 언어별 국기 아이콘 반환 함수 ---
const getLangFlag = (lang) => {
    switch (lang?.toLowerCase()) {
        case "ko": return koIcon;
        case "en": return enIcon;
        case "zh": case "zh-cn": return zhIcon;
        case "ja": case "ja-jp": return jaIcon;
        case "es": case "es-es": return esIcon;
        default: return koIcon;
    }
};

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

    // ✅ [수정] 훅을 사용하여 현재 언어 상태 가져오기 (기존 getActiveLang, useEffect 삭제됨)
    // lang: 실제 언어 코드 (예: ko, en, zh-CN)
    const { lang: language } = useLanguage();

    // 언어 선택 모달 열기
    const openLanguageModal = () => {
        setModalType("language");
    };

    // 고대비 전환
    const handleHighContrast = () => {
        setContrastLevel((prev) => (prev + 1) % 3);
    };

    // 음성안내 모달 열기
    const openVoiceModal = () => setModalType("voice");

    // 직원 호출 모달
    const openCallModal = () => {
        setModalType("call");
        onRequestSpeak?.("직원 호출을 요청하였습니다. 곧 직원이 도와드릴 예정입니다. 잠시만 기다려 주세요.");
    };

    /* 화면 확대/축소 토글 */
    const handleZoom = () => {
        setZoomLevel((prev) => (prev === 1 ? 2 : 1));
    };

    /* 확대 버튼 텍스트 표시용 */
    const getZoomButtonText = () => (zoomLevel === 1 ? "화면확대" : "화면축소");

    // --- TTS 중지 후 이동 함수 ---
    const stopTTSAndNavigate = (path) => {
        console.log(`[BottomNav] 화면 이동 전 TTS 중지 명령 (ALL /stop) 전송`);
        window.electronAPI.sendTtsCommand('ALL', { text: "/stop" });

        if (typeof path === "string") {
            navigate(path);
        } else if (typeof path === "number") {
            navigate(path);
        }
    };

    // --- 버튼 구성 ---
    const buttons = [
        { key: "call", Icon: CallIcon, text: "직원호출", onClick: openCallModal },
        { key: "zoom", Icon: ZoomInIcon, text: getZoomButtonText(), onClick: handleZoom },
        { key: "contrast", Icon: HighContrastIcon, text: "선명모드", onClick: handleHighContrast },
        // 언어 버튼: 텍스트는 고정 'Language', 국기는 동적 변경
        { key: "lang", text: "Language", flag: getLangFlag(language), onClick: openLanguageModal },
        { key: "caption", Icon: CaptionIcon, text: "자막안내", onClick: onToggleSubtitle },
        { key: "voice", Icon: VoiceIcon, text: "음성안내", onClick: openVoiceModal },
    ];

    // --- 한국어 여부 확인 (normalizedLang을 쓸 수도 있지만, 기존 로직 유지) ---
    const isKorean = language === "ko";

    return (
        // 언어에 따라 기본 텍스트 크기 조절
        <div className={`bottom-nav w-full flex flex-col items-center justify-end ${isKorean ? "text-[1rem]" : "text-[0.9rem]"}`}>

            {/* 상단 버튼 3개 (이전, 처음으로, AI 도움) */}
            <div className="flex flex-row gap-2 w-full mt-10 px-4">

                {/* 이전 */}
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

                {/* 처음으로 */}
                <button
                    onClick={() => {
                        stopTTSAndNavigate("/");
                    }}
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
                    className="flex-1 flex items-center justify-center gap-3 text-white rounded-full shadow-xl text-3xl h-20 hover:opacity-90 font-bold active:opacity-80"
                    style={{
                        background: "linear-gradient(135deg, #0066cc 0%, #004999 100%)",
                    }}
                >
                    {isKorean && <MicIcon className="w-9 h-9 lg:w-10 lg:h-12" />}
                    <span className="leading-tight text-center break-keep">AI 도움</span>
                </button>
            </div>

            {/* 하단 도움 기능 버튼 그리드 */}
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
                            // 언어 버튼: 국기 + 고정 텍스트 "Language"
                            <span className="flex items-center gap-3 notranslate">
                                <img src={flag} alt="lang-flag" className="w-10 h-10 lg:w-12 lg:h-12 object-contain" />
                                {text}
                            </span>
                        ) : (
                            // 나머지 버튼: 아이콘(한국어일때만) + 텍스트
                            <>
                                {isKorean && Icon && <Icon className="w-10 h-10 lg:w-12 lg:h-12 ml-3" />}
                                <span className="text-[1.6rem] lg:text-[1.8rem] text-center break-words whitespace-normal leading-tight">{text}</span>
                            </>
                        )}
                    </button>
                ))}
            </div>

            {/* 모달 영역 (Portal로 렌더링됨) */}
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
                                // changeLanguage 함수가 localStorage 저장 및 이벤트를 발생시킴
                                // useLanguage 훅이 이를 감지하여 자동으로 상태를 업데이트함
                                await changeLanguage(langCode);
                                setModalType(null);
                            }}
                        />
                    )}
                </div>
            </div>

        </div>
    );
}