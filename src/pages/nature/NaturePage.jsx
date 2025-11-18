import { useState, useEffect, useRef } from "react"; // useRef 추가
import KioskLayout from "../../components/layout/KioskLayout";
import logo from "../../assets/images/logo.png";
import { useParams } from "react-router-dom";
import { natureContents } from "../../data/natureContents.js";

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
// --- [추가] 끝 ---


export default function NaturePage({
                                       // 기존 props 유지
                                       setContrastLevel,
                                       zoomLevel,
                                       setZoomLevel,
                                       voiceSettings,
                                       setVoiceSettings,
                                       isSpeaking,
                                       setIsSpeaking,
                                       // --- 🔽 [추가] onRequestSpeak prop (새 코드에 있었음) ---
                                       // onRequestSpeak, // KioskLayout/BottomNav에서 필요하면 주석 해제
                                       // defaultMessage는 Layout에서 처리하므로 제거 가능
                                   }) {

    const { id } = useParams();
    const initialIndex = natureContents.findIndex(
        (item) => item.id === parseInt(id, 10)
    );
    const [page, setPage] = useState(initialIndex >= 0 ? initialIndex : 0);
    const mainContentRef = useRef(null); // 포커스용 (기존 유지)

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
    // --- [추가] 끝 ---


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
    // --- ✅ ---

    const handlePrev = () => {
        if (page > 0) setPage(page - 1);
    };

    const handleNext = () => {
        if (page < natureContents.length - 1) setPage(page + 1);
    };

    const current = natureContents[page];

    // --- ✅ 기존 포커스 관리 useEffect 유지 ---
    useEffect(() => {
        const timer = setTimeout(() => {
            mainContentRef.current?.focus(); // mainContentRef 대신 실제 포커스 대상 확인 필요
        }, 100);
        return () => clearTimeout(timer);
    }, [page]);
    // --- ✅ ---

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

                        // // 더 안정적인 방법: 한국어로 초기화 후 다시 설정 (시간차 필요)
                        // googleTranslateElement.value = 'ko';
                        // googleTranslateElement.dispatchEvent(new Event('change'));
                        // setTimeout(() => {
                        //   googleTranslateElement.value = currentLang;
                        //   googleTranslateElement.dispatchEvent(new Event('change'));
                        // }, 150);
                    }
                }
            }
        };

        // 페이지 변경 후 약간의 딜레이를 두고 재번역 시도
        const timer = setTimeout(retranslate, 300);
        return () => clearTimeout(timer);
    }, [page, currentLang]); // 페이지 또는 언어가 변경될 때 실행
    // --- [추가] 끝 ---


    // --- ✅ 기존 음성 안내 useEffect (TTS 기능 유지, 언어 조건 추가) ---
    useEffect(() => {
        if (typeof setIsSpeaking !== 'function') {
            console.warn("NaturePage: setIsSpeaking prop이 전달되지 않았습니다.");
            return;
        }

        // 한국어 또는 영어일 때만 설명 텍스트 가져옴
        let fullText = "";
        if (currentLang === 'ko' || currentLang === 'en') {
            fullText = currentLang === 'en' && current.desc_en ? current.desc_en : current.desc_ko;
        } else {
            if (setIsSpeaking) setIsSpeaking(false); // TTS 안 할 거면 즉시 false
        }

        const speechTimer = setTimeout(() => {
            if (fullText) { // 읽을 텍스트가 있을 때만 (ko, en)
                console.log("NaturePage: 안내 음성(설명) 재생");
                setIsSpeaking(true);
                speakText(fullText);
            }
        }, 2000);

        // Cleanup: TTS 중지 (기존 유지)
        return () => {
            clearTimeout(speechTimer);
            // TTS 지원 언어 외에는 중지 명령 보낼 필요 없음 (선택 사항)
            // if (currentLang === 'ko' || currentLang === 'en') {
            console.log("NaturePage: Cleanup, TTS 중지 (ALL /stop)");
            window.electronAPI.sendTtsCommand('ALL', { command: "stop" });
            // }
            if (setIsSpeaking) setIsSpeaking(false); // 컴포넌트 떠날 때 확실히 false
        };

        // isSpeaking 상태 변경 시에는 재실행 안 함
    }, [page, currentLang, setIsSpeaking]); // ✅ isEnglish 대신 currentLang 사용
    // --- ✅ ---


    // --- 🔽 [추가] 다국어 제목/설명/폰트 함수 (새 코드) ---
    const getDescriptionByLang = (item) => {
        switch (currentLang) {
            case "en": return item.desc_en || item.desc_ko;
            case "zh": case "zh-CN": return item.desc_zh || item.desc_ko;
            case "ja": case "ja-JP": return item.desc_ja || item.desc_ko;
            case "es": case "es-ES": return item.desc_es || item.desc_ko;
            default: return item.desc_ko;
        }
    };

    const getTitleByLang = (item) => {
        // 영어 제목은 title_en 사용 (기존 코드 반영)
        if (currentLang === "en") return item.title_en || item.title;
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
    // --- [추가] 끝 ---


    return (
        <KioskLayout
            logo={logo} // 로고는 Layout에서 처리 (HeaderLogo 사용 가정)
            // --- 🔽 [수정] 새 코드의 배너 스타일 props 적용 ---
            showBanner={true} // 배너 항상 표시
            banner={current.img} // 현재 페이지 이미지를 배너로 사용
            bannerHeight="420px" // 배너 높이 크게
            bannerPadding="px-10" // 배너 좌우 패딩
            bannerBorder="border-4" // 배너 테두리
            bannerRounded="rounded-2xl" // 배너 둥글게
            bannerShadow="shadow-lg" // 배너 그림자
            // --- [수정] 끝 ---
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
                {/* 이미지는 배너로 이동했으므로 제거 */}
                {/* <div className="w-full max-w-[900px] h-[500px] bg-gray-200 overflow-hidden shadow">...</div> */}

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
                <div className="flex items-center justify-center gap-6 mt-10">
                    <button
                        onClick={handlePrev}
                        disabled={page === 0}
                        className="px-12 py-3 bg-black text-white text-3xl lg:text-4xl xl:text-5xl font-semibold rounded-full disabled:bg-gray-400"
                    >
                        이전
                    </button>
                    <span className="text-3xl lg:text-4xl xl:text-5xl font-semibold">
                        {page + 1} / {natureContents.length}
                    </span>
                    <button
                        onClick={handleNext}
                        disabled={page === natureContents.length - 1}
                        className="px-12 py-3 bg-black text-white text-3xl lg:text-4xl xl:text-5xl font-semibold rounded-full disabled:bg-gray-400"
                    >
                        다음
                    </button>
                </div>
            </div>
        </KioskLayout>
    );
}