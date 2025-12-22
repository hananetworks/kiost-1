import { useState, useEffect, useRef } from "react";
import KioskLayout from "../../components/layout/KioskLayout";
import logo from "../../assets/images/logo.png";
import { useParams } from "react-router-dom";
import { historyContents } from "../../data/historyContents.js";

// ✅ 훅 Import
import { useLanguage } from "../../hooks/useLanguage";
import { useTts } from "../../hooks/useTts";

export default function HistoryPage({
    setContrastLevel,
    zoomLevel,
    setZoomLevel,
    voiceSettings,
    setVoiceSettings,
}) {
    const { id } = useParams();
    const initialIndex = historyContents.findIndex((item) => item.id === parseInt(id, 10));
    const [page, setPage] = useState(initialIndex >= 0 ? initialIndex : 0);
    const mainContentRef = useRef(null);

    // 1. 훅 사용
    const { lang, normalizedLang, isKorean } = useLanguage();
    const { addText, stopTts } = useTts(lang);

    const current = historyContents[page];

    // 2. TTS 재생 (수정: 딜레이 제거, 다국어 지원)
    useEffect(() => {
        // 언어별 설명 가져오기
        let desc = "";
        switch (normalizedLang) {
            case "en": desc = current.desc_en || current.desc_ko; break;
            case "zh": desc = current.desc_zh || current.desc_ko; break;
            case "ja": desc = current.desc_ja || current.desc_ko; break;
            case "es": desc = current.desc_es || current.desc_ko; break;
            case "vi": desc = current.desc_vi || current.desc_en || current.desc_ko; break; // 🇻🇳
            case "tl":
            case "fil": desc = current.desc_tl || current.desc_en || current.desc_ko; break; // 🇵🇭
            default: desc = current.desc_ko; break;
        }

        const ttsText = desc.replace(/\\n/g, " ").replace(/\n/g, " ").trim() + ".";

        const timer = setTimeout(() => {
            stopTts();
            addText(ttsText, true);
        }, 50);

        return () => {
            clearTimeout(timer);
            stopTts();
        };
    }, [page, normalizedLang, addText, stopTts, current]);

    // 3. 핸들러
    const handlePrev = () => { if (page > 0) setPage(page - 1); };
    const handleNext = () => { if (page < historyContents.length - 1) setPage(page + 1); };

    // 4. 포커스
    useEffect(() => {
        setTimeout(() => mainContentRef.current?.focus(), 100);
    }, [page]);

    // 5. 헬퍼 함수
    const getTitle = () => {
        if (normalizedLang === 'en') return current.title_en || current.title;
        if (normalizedLang === 'zh') return current.title_cn || current.title;
        if (normalizedLang === 'ja') return current.title_jp || current.title;
        if (normalizedLang === 'es') return current.title_es || current.title;
        if (normalizedLang === 'vi') return current.title_vi || current.title_en || current.title; // 🇻🇳
        if (normalizedLang === 'tl' || normalizedLang === 'fil') return current.title_tl || current.title_en || current.title; // 🇵🇭
        return current.title;
    };

    const getDescription = () => {
        switch (normalizedLang) {
            case "en": return current.desc_en || current.desc_ko;
            case "zh": return current.desc_zh || current.desc_ko;
            case "ja": return current.desc_ja || current.desc_ko;
            case "es": return current.desc_es || current.desc_ko;
            case "vi": return current.desc_vi || current.desc_en || current.desc_ko; // 🇻🇳
            case "tl":
            case "fil": return current.desc_tl || current.desc_en || current.desc_ko; // 🇵🇭
            default: return current.desc_ko;
        }
    };

    return (
        <KioskLayout
            logo={logo}
            showBanner={true}
            banner={current.img}
            bannerHeight="420px"
            bannerPadding="px-10"
            bannerBorder="border-4"
            bannerRounded="rounded-2xl"
            bannerShadow="shadow-lg"
            showSubtitle={true}
            setContrastLevel={setContrastLevel}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            voiceSettings={voiceSettings}
            setVoiceSettings={setVoiceSettings}
            subtitle={current.subtitle || "상세 정보"}
        >
            <div key={page}
                className="w-full flex flex-col items-center px-4 outline-none"
                ref={mainContentRef}
                tabIndex="-1"
                role="region"
            >
                {/* 제목 */}
                <h2 className="text-3xl lg:text-4xl xl:text-5xl font-bold">
                    {getTitle()}
                </h2>

                {/* 설명 */}
                <p className={`description-box mt-4 p-6 border border-gray-300 rounded-xl shadow-sm bg-white 
                    w-full h-[550px] overflow-y-auto leading-relaxed notranslate
                    text-gray-700 text-2xl lg:text-3xl xl:text-4xl`}
                    style={{ whiteSpace: "pre-wrap" }}
                >
                    {getDescription().replace(/\\n/g, "\n").trim()}
                </p>

                {/* 버튼 */}
                <div className="flex items-center justify-center gap-6 mt-10">
                    <button
                        onClick={handlePrev}
                        disabled={page === 0}
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
                        className="px-12 py-3 bg-black text-white text-3xl lg:text-4xl xl:text-5xl font-semibold rounded-full disabled:bg-gray-400"
                    >
                        다음
                    </button>
                </div>
            </div>
        </KioskLayout>
    );
}