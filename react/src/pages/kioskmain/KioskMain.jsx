// KioskMain.jsx

import { useState, useEffect, useRef } from "react";
import KioskLayout from "../../components/layout/KioskLayout";
import { useNavigate, useParams } from "react-router-dom";

import mainKo from "../../assets/images/main_ko.png";
import mainEn from "../../assets/images/main_en.png";
import mainCn from "../../assets/images/main_cn.png"; // 중국어
import mainJp from "../../assets/images/main_jp.png"; // 일본어
import mainEs from "../../assets/images/main_es.png"; // 스페인어

import logo from "../../assets/images/logo.png";

import nature1 from "../../assets/images/nature_1.jpg";
import nature2 from "../../assets/images/nature_2.jpg";
import nature3 from "../../assets/images/nature_3.jpg";
import nature4 from "../../assets/images/nature_4.jpg";
import history1 from "../../assets/images/history_1.jpg";
import history2 from "../../assets/images/history_2.jpg";
import history3 from "../../assets/images/history_3.jpg";
import history4 from "../../assets/images/history_4.jpg";

export default function KioskMain({
                                      // 기존 props 유지
                                      setContrastLevel,
                                      zoomLevel,
                                      setZoomLevel,
                                      voiceSettings,
                                      setVoiceSettings,
                                      isSpeaking,
                                      setIsSpeaking
                                  }) {

    const navigate = useNavigate();
    const { tab } = useParams();
    const currentTab = tab || "nature";

    const firstTabRef = useRef(null); // 기존 포커스 관리 유지

    // --- ✅ 언어 코드 표준화 추가 ---
    const normalizeLang = (value) => {
        const v = (value || "").toLowerCase();
        if (v.includes("zh")) return "zh";   // ✅ zh, zh-CN, zh-TW 모두 zh 처리
        if (v.includes("ja")) return "ja";   // 일본어
        if (v.includes("es")) return "es";   // 스페인어
        if (v.includes("en")) return "en";   // 영어
        return "ko";                         // 기본값 한국어
    };

    // --- ✅ 초기 언어 설정 ---
    const [lang, setLang] = useState(() => normalizeLang(localStorage.getItem("app_lang")));

    // --- ✅ 언어 변경 감지 (storage + languagechange) ---
    useEffect(() => {
        const handler = () => {
            const raw = localStorage.getItem("app_lang");
            const newLang = normalizeLang(raw);
            setLang(newLang);
        };
        window.addEventListener("languagechange", handler);
        window.addEventListener("storage", handler);
        return () => {
            window.removeEventListener("languagechange", handler);
            window.removeEventListener("storage", handler);
        };
    }, []);


    // --- ✅ 기존 TTS 관련 로직 유지 ---
    const speakText = (text) => {
        if (!text || !text.trim()) {
            console.log("speakText: 텍스트가 비어있어 실행하지 않습니다.");
            if (setIsSpeaking) setIsSpeaking(false);
            return;
        }
        const commandObject = { text: text };
        console.log(`Electron: TTS 명령 전송 (Lang: ${lang}):`, commandObject);
        // 한국어 또는 영어일 때만 TTS 요청 (선택 사항)
        if (lang === 'ko' || lang === 'en') {
            window.electronAPI.sendTtsCommand(lang, commandObject);
        } else {
            console.log(`TTS skipped for language: ${lang}`);
            if (setIsSpeaking) setIsSpeaking(false); // TTS 안 하면 즉시 false 처리
        }
    };

    useEffect(() => {
        if (typeof setIsSpeaking !== 'function') {
            console.warn("KioskMain: setIsSpeaking prop이 전달되지 않았습니다.");
            return;
        }

        // 한국어 또는 영어일 때만 안내 문구 설정 및 재생
        let fullText = "";
        if (lang === 'ko' || lang === 'en') {
            if (currentTab === 'nature') {
                fullText = lang === 'ko'
                    ? "천안 8경의 아름다운 자연 명소를 소개합니다. 원하시는 장소를 선택해주세요."
                    : "Introducing the beautiful natural sights of Cheonan. Please select a place you want.";
            } else { // history
                fullText = lang === 'ko'
                    ? "천안의 유서 깊은 역사 명소를 소개합니다. 원하시는 장소를 선택해주세요."
                    : "Introducing the historic sites of Cheonan. Please select a place you want.";
            }
        } else {
            // 다른 언어는 자막만 표시하고 TTS는 안 함 (빈 텍스트 전달 또는 speakText 호출 안 함)
            fullText = "";
            if (setIsSpeaking) setIsSpeaking(false); // TTS 안 할 거면 즉시 false
        }


        const speechTimer = setTimeout(() => {
            if (fullText) {
                console.log("KioskMain: 안내 음성 재생");
                setIsSpeaking(true);

                // ★ [수정] 메인 페이지도 혹시 모를 줄바꿈 제거 및 마침표 보장
                let ttsText = fullText.replace(/\\n/g, " ").replace(/\n/g, " ").trim();
                if (!/[.?!]$/.test(ttsText)) ttsText += ".";

                speakText(ttsText);
            }
        }, 2000);

        return () => {
            clearTimeout(speechTimer);
            window.electronAPI.sendTtsCommand('ALL', { command: "stop" });
            if (setIsSpeaking) setIsSpeaking(false);
        };
    }, [currentTab, lang, setIsSpeaking]);


    // --- ✅ 기존 포커스 관리 로직 유지 ---
    useEffect(() => {
        const timer = setTimeout(() => firstTabRef.current?.focus(), 100);
        return () => clearTimeout(timer);
    }, []); // 첫 마운트 시

    useEffect(() => {
        const timer = setTimeout(() => firstTabRef.current?.focus(), 100);
        return () => clearTimeout(timer);
    }, [currentTab]); // 탭 변경 시

    // --- 🔽 [추가] 언어별 배너 선택 로직 ---
    const getBannerByLang = (lang) => {
        switch (lang?.toLowerCase()) { // 소문자로 비교
            case "en": return mainEn;
            case "zh": case "zh-cn": return mainCn; // 중국어
            case "ja": case "ja-jp": return mainJp; // 일본어
            case "es": case "es-es": return mainEs; // 스페인어
            default: return mainKo; // 기본 한국어
        }
    };
    const banner = getBannerByLang(lang);

    // --- ✅ 카드 데이터 (다국어 포함) ---
    const natureItems = [
        {
            id: 1,
            title: "광덕산",
            title_en: "Gwangdeoksan Mountain",
            title_cn: "光德山",
            title_jp: "クァンデク山",
            title_es: "Monte Gwangdeok",
            img: nature1,
        },
        {
            id: 2,
            title: "천안삼거리공원",
            title_en: "Cheonan Samgeori Park",
            title_cn: "天安三岔路公园",
            title_jp: "チョナン三叉路公園",
            title_es: "Parque Samgeori de Cheonan",
            img: nature2,
        },
        {
            id: 3,
            title: "성성호수공원",
            title_en: "Seongseong Lake Park",
            title_cn: "城成湖公园",
            title_jp: "ソンソン湖公園",
            title_es: "Parque del Lago Seongseong",
            img: nature3,
        },
        {
            id: 4,
            title: "태학산자연휴양림",
            title_en: "Taehaksan Recreation Forest",
            title_cn: "太鹤山自然休养林",
            title_jp: "テハク山自然休養林",
            title_es: "Bosque Recreativo Taehaksan",
            img: nature4,
        },
    ];

    const historyItems = [
        {
            id: 1,
            title: "독립기념관",
            title_en: "Independence Hall",
            title_cn: "独立纪念馆",
            title_jp: "独立記念館",
            title_es: "Salón de la Independencia",
            img: history1,
        },
        {
            id: 2,
            title: "유관순열사 사적지",
            title_en: "Yu Gwan-sun's Historic Site",
            title_cn: "柳宽顺烈士史迹地",
            title_jp: "柳寛順烈士の史跡地",
            title_es: "Sitio Histórico de Yu Gwan-sun",
            img: history2,
        },
        {
            id: 3,
            title: "태조산왕건길",
            title_en: "Taejosan Wanggeon Trail and Bronze Seated Buddha",
            title_cn: "太祖山王建路与青铜坐佛",
            title_jp: "太祖山ワンゴン道と青銅座仏",
            title_es: "Sendero Wanggeon del Monte Taejo y Gran Buda de Bronce",
            img: history3,
        },
        {
            id: 4,
            title: "봉선홍경사갈기비",
            title_en: "Bongseon Honggyeongsa Stele",
            title_cn: "奉先洪庆寺碑",
            title_jp: "奉先洪慶寺碑",
            title_es: "Estela del Templo Honggyeongsa",
            img: history4,
        },
    ];
    ;

    const items = currentTab === "history" ? historyItems : natureItems;

    return (
        <KioskLayout
            logo={logo}
            banner={banner}
            showBanner={true}
            showHomeBack={false}
            setContrastLevel={setContrastLevel}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            voiceSettings={voiceSettings}
            setVoiceSettings={setVoiceSettings}
            subtitle={
                currentTab === 'nature'
                    ? (lang === 'ko' ? "천안 8경의 아름다운 자연 명소를 소개합니다. 원하시는 장소를 선택해주세요." : "Introducing the beautiful natural sights of Cheonan. Please select a place you want.")
                    : (lang === 'ko' ? "천안의 유서 깊은 역사 명소를 소개합니다. 원하시는 장소를 선택해주세요" : "Introducing the historic sites of Cheonan. Please select a place you want")
            }
        >
            <div className="flex flex-col items-start justify-center w-full">
                <div className="flex gap-6 mb-8 justify-start w-full">
                    <button
                        ref={firstTabRef} // ✅ 포커스 ref
                        onClick={() => navigate("/kiosk/main/nature")}

                        className={`px-16 py-4 rounded-full text-3xl lg:text-4xl xl:text-5xl font-bold transition ${currentTab === "nature"
                            ? "bg-gray-800 text-white ring-4 ring-blue-500 shadow-lg"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        } focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400`}
                    >
                        자연
                    </button>
                    <button
                        onClick={() => navigate("/kiosk/main/history")}

                        className={`px-16 py-4 rounded-full text-3xl lg:text-4xl xl:text-5xl font-bold transition ${currentTab === "history"
                            ? "bg-gray-800 text-white ring-4 ring-blue-500 shadow-lg"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        } focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400`}
                    >
                        역사
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-6 w-full max-w-[900px]">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            tabIndex="0"
                            role="button"
                            aria-label={
                                lang === "en"
                                    ? item.title_en
                                    : lang === "zh" || lang === "zh-cn"
                                        ? item.title_cn
                                        : lang === "ja" || lang === "ja-jp"
                                            ? item.title_jp
                                            : lang === "es" || lang === "es-es"
                                                ? item.title_es
                                                : item.title
                            }
                            className="card bg-white border border-gray-300 rounded-xl shadow-lg overflow-hidden
                      h-[380px] cursor-pointer hover:scale-105 transition
                      focus:outline-none focus:ring-4 focus:ring-blue-500"
                            onClick={() => navigate(`/kiosk/${currentTab}/${item.id}`)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    navigate(`/kiosk/${currentTab}/${item.id}`);
                                }
                            }}
                        >
                            <img
                                src={item.img}
                                alt={
                                    lang === "en"
                                        ? item.title_en
                                        : lang === "zh" || lang === "zh-cn"
                                            ? item.title_cn
                                            : lang === "ja" || lang === "ja-jp"
                                                ? item.title_jp
                                                : lang === "es" || lang === "es-es"
                                                    ? item.title_es
                                                    : item.title
                                }
                                className="w-full h-[70%] object-cover"
                            />

                            <div
                                className={`grid place-items-center text-center
                font-bold text-gray-800 h-[30%] px-6
                ${lang === "en"
                                    ? "text-2xl lg:text-3xl xl:text-4xl leading-tight"
                                    : "text-2xl lg:text-3xl xl:text-4xl leading-snug"}
                card-title`}
                            >
                                {lang === "en"
                                    ? item.title_en
                                    : lang === "zh" || lang === "zh-cn"
                                        ? item.title_cn
                                        : lang === "ja" || lang === "ja-jp"
                                            ? item.title_jp
                                            : lang === "es" || lang === "es-es"
                                                ? item.title_es
                                                : item.title}
                            </div>

                        </div>
                    ))}
                </div>
            </div>
        </KioskLayout>
    );
}