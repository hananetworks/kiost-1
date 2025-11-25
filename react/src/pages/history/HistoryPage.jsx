import { useState, useEffect, useRef } from "react"; // useRef 추가
import KioskLayout from "../../components/layout/KioskLayout";
import logo from "../../assets/images/logo.png";
import { useParams } from "react-router-dom";
import { historyContents } from "../../data/historyContents.js";

// --- 🔽 [추가] 다국어 관련 함수 (새 코드에서 가져옴) ---
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


export default function HistoryPage({
                                        setContrastLevel,
                                        zoomLevel,
                                        setZoomLevel,
                                        voiceSettings,
                                        setVoiceSettings,
                                        isSpeaking,
                                        setIsSpeaking,
                                    }) {

    const { id } = useParams();
    const initialIndex = historyContents.findIndex(
        (item) => item.id === parseInt(id, 10)
    );
    const [page, setPage] = useState(initialIndex >= 0 ? initialIndex : 0);
    const mainContentRef = useRef(null);

    // --- 🔽 [추가] 현재 언어 상태 관리 (새 코드 방식) ---
    const [currentLang, setCurrentLang] = useState(() => getActiveLang());

    useEffect(() => {
        const handler = () => setCurrentLang(getActiveLang());
        // 'languagechange' 와 'storage' 이벤트 모두 감지
        window.addEventListener("languagechange", handler);
        window.addEventListener("storage", handler);
        return () => {
            window.removeEventListener("languagechange", handler);
            window.removeEventListener("storage", handler);
        }
    }, []);



    // --- ✅ 기존 speakText 함수 (TTS 기능 유지, 언어 조건 추가) ---
    const speakText = (text) => {
        if (!text || !text.trim()) {
            console.log("speakText: 텍스트가 비어있어 실행하지 않습니다.");
            if (setIsSpeaking) setIsSpeaking(false);
            return;
        }

        // 현재 언어가 한국어 또는 영어일 때만 lang 값을 설정
        const lang = (currentLang === 'ko' || currentLang === 'en') ? currentLang : null;

        if (lang) { // TTS 지원 언어일 때만 전송
            const commandObject = { text: text };
            console.log(`Electron: TTS 명령 전송 (Lang: ${lang}):`, commandObject);
            window.electronAPI.sendTtsCommand(lang, commandObject);
        } else {
            console.log(`TTS skipped for language: ${currentLang}`);
            if (setIsSpeaking) setIsSpeaking(false); // TTS 안 하면 즉시 false 처리
        }
    };

    const handlePrev = () => {
        if (page > 0) setPage(page - 1);
    };

    const handleNext = () => {
        if (page < historyContents.length - 1) setPage(page + 1);
    };

    const current = historyContents[page];

    // --- ✅ 기존 포커스 관리 useEffect 유지 ---
    useEffect(() => {
        const timer = setTimeout(() => {
            // mainContentRef가 가리키는 div에 포커스
            mainContentRef.current?.focus();
        }, 100);
        return () => clearTimeout(timer);
    }, [page]);

    // --- 🔽 [추가] Google 번역 재실행 useEffect (새 코드) ---
    useEffect(() => {
        const retranslate = () => {
            if (window.google && window.google.translate) {
                const googleTranslateElement = document.querySelector('.goog-te-combo');
                if (googleTranslateElement) {
                    const currentValue = googleTranslateElement.value;
                    // 현재 언어와 구글 번역 위젯 값이 다르면 (페이지 이동 후 풀리는 경우 등)
                    if (currentValue && currentValue !== currentLang) {
                        console.log(`Retranslating due to mismatch: Widget=${currentValue}, Current=${currentLang}`);
                        // 강제로 현재 언어로 다시 설정 시도 (주의: 불안정할 수 있음)
                        googleTranslateElement.value = currentLang;
                        googleTranslateElement.dispatchEvent(new Event('change'));

                    }
                }
            }
        };

        const timer = setTimeout(retranslate, 300);
        return () => clearTimeout(timer);
    }, [page, currentLang]);

    // --- ✅ 기존 음성 안내 useEffect (TTS 기능 유지, 언어 조건 추가) ---
    useEffect(() => {
        if (typeof setIsSpeaking !== 'function') { return; }

        let fullText = "";
        if (currentLang === 'ko' || currentLang === 'en') {
            fullText = currentLang === 'en' && current.desc_en ? current.desc_en : current.desc_ko;
        } else {
            if (setIsSpeaking) setIsSpeaking(false);
        }

        const speechTimer = setTimeout(() => {
            if (fullText) {
                console.log("안내 음성 재생");
                setIsSpeaking(true);

                // ★ [핵심 수정] TTS용 텍스트 정제 (줄바꿈제거 + 마침표 보장)
                // 1. \n이나 \\n을 공백으로 바꿔서 문장이 끊기지 않게 연결
                // 2. 끝에 마침표가 없으면 추가 (버퍼링 강제 해제용)
                let ttsText = fullText.replace(/\\n/g, " ").replace(/\n/g, " ").trim();
                if (!/[.?!]$/.test(ttsText)) {
                    ttsText += ".";
                }

                speakText(ttsText);
            }
        }, 1500); // (NaturePage는 2000, HistoryPage는 1500 기존 유지)

        return () => {
            clearTimeout(speechTimer);
            // "Stop" 텍스트 읽음 방지를 위해 확실하게 stop 명령 전송
            window.electronAPI.sendTtsCommand('ALL', { command: "stop" });
            if (setIsSpeaking) setIsSpeaking(false);
        };
    }, [page, currentLang, setIsSpeaking]);

    // --- 🔽 [추가] 다국어 제목/설명/폰트 함수
    const getDescriptionByLang = (item) => {
        switch (currentLang) {
            case "en": return item.desc_en || item.desc_ko;
            case "zh": case "zh-CN": return item.desc_zh || item.desc_ko;
            case "ja": case "ja-JP": return item.desc_ja || item.desc_ko;
            case "es": case "es-ES": return item.desc_es || item.desc_ko;
            default: return item.desc_ko;
        }
    };

    // historyContents에 title_es 등이 있다고 가정
    const getTitleByLang = (item) => {
        // 영어 제목은 title_en 사용 (기존 코드 반영)
        if (currentLang === "en") return item.title_en || item.title; // title_en 필드 필요
        // 스페인어 등 다른 언어 제목 필드가 있다면 추가
        if (currentLang === "es" || currentLang === "es-ES") return item.title_es || item.title;
        // 기본은 한국어 title
        return item.title;
    };

    const getFontClass = () => {
        if (currentLang.startsWith("es")) {
            // 새 코드 기본값 사용 또는 기존 크기 유지 결정 필요
            return "text-2xl lg:text-3xl xl:text-4xl"; // 새 코드 기본값
            // return "text-3xl lg:text-4xl xl:text-5xl"; // 기존 크기
        } else if (["zh", "ja"].some(l => currentLang.startsWith(l))) {
            // 새 코드 기본값 사용 또는 기존 크기 유지 결정 필요
            return "text-2xl lg:text-3xl xl:text-4xl break-all"; // 새 코드 기본값
            // return "text-3xl lg:text-4xl xl:text-5xl break-keep"; // 기존 크기 + break-keep
        } else { // 한국어, 영어 등
            // 기존 크기 유지 (영어도 포함)
            return "text-2xl lg:text-3xl xl:text-4xl";
        }
    };


    return (
        <KioskLayout
            logo={logo} // 로고는 Layout에서 처리
            showBanner={true} // 배너 항상 표시
            banner={current.img} // 현재 페이지 이미지를 배너로 사용
            bannerHeight="430px" // 배너 높이 크게
            bannerPadding="px-10" // 배너 좌우 패딩
            bannerBorder="border-4" // 배너 테두리
            bannerRounded="rounded-2xl" // 배너 둥글게
            bannerShadow="shadow-lg" // 배너 그림자
            showSubtitle={true} // 자막 영역은 항상 표시 (기존 유지)
            setContrastLevel={setContrastLevel}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            voiceSettings={voiceSettings}
            setVoiceSettings={setVoiceSettings}
            // onRequestSpeak={onRequestSpeak} // 필요 시 주석 해제
            // defaultMessage 제거 (Layout의 subtitle prop 사용)
            subtitle={current.subtitle || "상세 정보"} // 현재 페이지 부제목 전달
        >
            {/* ✅ key prop 추가로 페이지 변경 시 강제 리렌더링 (새 코드) */}
            <div key={page} className="w-full flex flex-col items-center px-4 outline-none"
                 ref={mainContentRef} // 포커스를 위해 ref 유지
                 tabIndex="-1"        // 포커스를 위해 tabindex 유지
                 role="region"        // 접근성 위해 유지
                 aria-label="메인 컨텐츠" // 접근성 위해 유지
            >

                {/* 제목 */}
                {/* ✅ getTitleByLang 사용 */}
                <h2 className="text-3xl lg:text-4xl xl:text-5xl font-bold">
                    {getTitleByLang(current)}
                </h2>

                {/* 설명 */}

                <p
                    className={`description-box mt-4 ${getFontClass()} text-gray-700
                    px-6 py-7 border border-gray-300 rounded-xl shadow-sm bg-white 
                    w-full h-[550px] overflow-y-auto 
                    leading-relaxed notranslate`}
                    style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "normal",
                        overflowWrap: "anywhere",
                    }}
                >
                    {(getDescriptionByLang(current) || "")
                        .replace(/\\n/g, "\n")
                        .trim()}
                </p>


                {/* 페이지네이션 */}
                {/* ✅ 새 코드 스타일 적용 (px, py, font-semibold) */}
                <div className="flex items-center justify-center gap-6 mt-10"> {/* mt-10으로 변경 (기존 mt-6)*/}
                    <button
                        onClick={handlePrev}
                        disabled={page === 0}
                        // 새 코드 스타일 적용
                        className="px-12 py-3 bg-black text-white text-3xl lg:text-4xl xl:text-5xl font-semibold rounded-full disabled:bg-gray-400"
                    >
                        이전
                    </button>
                    <span className="text-3xl lg:text-4xl xl:text-5xl font-semibold">
                        {page + 1} / {historyContents.length}
                    </span>
                    <button
                        onClick={handleNext}
                        disabled={page === historyContents.length - 1}
                        // 새 코드 스타일 적용
                        className="px-12 py-3 bg-black text-white text-3xl lg:text-4xl xl:text-5xl font-semibold rounded-full disabled:bg-gray-400"
                    >
                        다음
                    </button>
                </div>
            </div>
        </KioskLayout>
    );
}