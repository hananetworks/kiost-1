import { useEffect, useRef } from "react";
import KioskLayout from "../../components/layout/KioskLayout";
import { useNavigate, useParams } from "react-router-dom";

// ✅ 훅 Import
import { useLanguage } from "../../hooks/useLanguage";
import { useTts } from "../../hooks/useTts";

// 이미지 Import
import mainKo from "../../assets/images/main_ko.png";
import mainEn from "../../assets/images/main_en.png";
import mainCn from "../../assets/images/main_cn.png";
import mainJp from "../../assets/images/main_jp.png";
import mainEs from "../../assets/images/main_es.png";
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
    setContrastLevel,
    zoomLevel,
    setZoomLevel,
    voiceSettings,
    setVoiceSettings,
    // isSpeaking prop은 useTts 내부 관리로 인해 선택적 사용
}) {
    const navigate = useNavigate();
    const { tab } = useParams();
    const currentTab = tab || "nature";
    const firstTabRef = useRef(null);

    // 1. 언어 훅 사용
    const { lang, normalizedLang, isKorean } = useLanguage();

    // 2. TTS 훅 사용
    const { addText, stopTts } = useTts(lang);

    // 3. 안내 멘트 재생
    useEffect(() => {
        const isNature = currentTab === 'nature';
        let textToSpeak = "";

        // 언어별 멘트 설정
        switch (normalizedLang) {
            case 'ko': // 한국어
                textToSpeak = isNature
                    ? "천안 8경의 아름다운 자연 명소를 소개합니다. 원하시는 장소를 선택해주세요."
                    : "천안의 유서 깊은 역사 명소를 소개합니다. 원하시는 장소를 선택해주세요.";
                break;

            case 'en': // 영어
                textToSpeak = isNature
                    ? "Introducing the beautiful natural sights of Cheonan. Please select a place."
                    : "Introducing the historic sites of Cheonan. Please select a place.";
                break;

            case 'ja': // 일본어
                textToSpeak = isNature
                    ? "天安八景の美しい自然の名所を紹介します。ご希望の場所を選択してください。"
                    : "天安の由緒ある歴史的名所を紹介します。ご希望の場所を選択してください。";
                break;

            case 'zh': // 중국어
                textToSpeak = isNature
                    ? "为您介绍天安八景的美丽自然名胜。请选择您想要的地点。"
                    : "为您介绍天安悠久的历史名胜。请选择您想要的地点。";
                break;

            case 'vi': // 🇻🇳 베트남어 (Piper TTS)
                textToSpeak = isNature
                    ? "Giới thiệu những điểm tham quan thiên nhiên tuyệt đẹp của Cheonan. Vui lòng chọn một địa điểm."
                    : "Giới thiệu những di tích lịch sử của Cheonan. Vui lòng chọn một địa điểm.";
                break;

            case 'tl': // 🇵🇭 타갈로그어 (Sherpa TTS)
            case 'fil': // 🇵🇭 필리핀어
                textToSpeak = isNature
                    ? "Ipinapakilala ang mga magagandang tanawin sa kalikasan ng Cheonan. Mangyaring pumili ng lugar."
                    : "Ipinapakilala ang mga makasaysayang lugar ng Cheonan. Mangyaring pumili ng lugar.";
                break;

            default: // 그 외
                textToSpeak = isNature
                    ? "Introducing the beautiful natural sights of Cheonan. Please select a place."
                    : "Introducing the historic sites of Cheonan. Please select a place.";
                break;
        }

        // ★ 딜레이 없이 즉시 실행 (ttsText → textToSpeak으로 수정)
        const timer = setTimeout(() => {
            stopTts();
            addText(textToSpeak, true);  // ✅ 변수명 수정
        }, 50);

        return () => {
            clearTimeout(timer);
            stopTts();
        };
    }, [currentTab, normalizedLang, isKorean, addText, stopTts]);

    // 4. 포커스 관리
    useEffect(() => {
        setTimeout(() => firstTabRef.current?.focus(), 100);
    }, [currentTab]);

    // 5. 배너 이미지 선택
    const getBanner = () => {
        if (normalizedLang === 'en') return mainEn;
        if (normalizedLang === 'zh') return mainCn;
        if (normalizedLang === 'ja') return mainJp;
        if (normalizedLang === 'es') return mainEs;
        if (normalizedLang === 'vi') return mainEn; // 베트남어는 영어 배너 사용
        if (normalizedLang === 'tl' || normalizedLang === 'fil') return mainEn; // 필리핀어는 영어 배너 사용
        return mainKo;
    };

    // 6. 데이터 (다국어 필드 포함 - 베트남어, 필리핀어 추가)
    const natureItems = [
        {
            id: 1,
            title: "광덕산",
            title_en: "Gwangdeoksan Mountain",
            title_cn: "光德山",
            title_jp: "クァンデク山",
            title_es: "Monte Gwangdeok",
            title_vi: "Núi Gwangdeoksan", // 🇻🇳
            title_tl: "Bundok Gwangdeoksan", // 🇵🇭
            img: nature1
        },
        {
            id: 2,
            title: "천안삼거리공원",
            title_en: "Cheonan Samgeori Park",
            title_cn: "天安三岔路公园",
            title_jp: "チョナン三叉路公園",
            title_es: "Parque Samgeori de Cheonan",
            title_vi: "Công viên Cheonan Samgeori", // 🇻🇳
            title_tl: "Parke ng Cheonan Samgeori", // 🇵🇭
            img: nature2
        },
        {
            id: 3,
            title: "성성호수공원",
            title_en: "Seongseong Lake Park",
            title_cn: "城成湖公园",
            title_jp: "ソンソン湖公園",
            title_es: "Parque del Lago Seongseong",
            title_vi: "Công viên Hồ Seongseong", // 🇻🇳
            title_tl: "Parke ng Lawa ng Seongseong", // 🇵🇭
            img: nature3
        },
        {
            id: 4,
            title: "태학산자연휴양림",
            title_en: "Taehaksan Recreation Forest",
            title_cn: "太鹤山自然休养林",
            title_jp: "テハク山自然休養林",
            title_es: "Bosque Recreativo Taehaksan",
            title_vi: "Rừng Nghỉ Dưỡng Taehaksan", // 🇻🇳
            title_tl: "Gubat na Taehaksan", // 🇵🇭
            img: nature4
        },
    ];

    const historyItems = [
        {
            id: 1,
            title: "독립기념관",
            title_en: "Independence Hall",
            title_cn: "独立纪念馆",
            title_jp: "独立記念館",
            title_es: "S alón de la Independencia",
            title_vi: "Tòa nhà Độc lập", // 🇻🇳
            title_tl: "Bulwagang Kalayaan", // 🇵🇭
            img: history1
        },
        {
            id: 2,
            title: "유관순열사 사적지",
            title_en: "Yu Gwan-sun's Historic Site",
            title_cn: "柳宽顺烈士史迹地",
            title_jp: "柳寛順烈士の史跡地",
            title_es: "Sitio Histórico de Yu Gwan-sun",
            title_vi: "Di tích Yu Gwan-sun", // 🇻🇳
            title_tl: "Historikal na Lugar ni Yu Gwan-sun", // 🇵🇭
            img: history2
        },
        {
            id: 3,
            title: "태조산왕건길",
            title_en: "Taejosan Wanggeon Trail",
            title_cn: "太祖山王建路",
            title_jp: "太祖山ワンゴン道",
            title_es: "Sendero Wanggeon",
            title_vi: "Đường mòn Taejosan Wanggeon", // 🇻🇳
            title_tl: "Landas ng Taejosan Wanggeon", // 🇵🇭
            img: history3
        },
        {
            id: 4,
            title: "봉선홍경사갈기비",
            title_en: "Bongseon Honggyeongsa Stele",
            title_cn: "奉先洪庆寺碑",
            title_jp: "奉先洪慶寺碑",
            title_es: "Estela del Templo Honggyeongsa",
            title_vi: "Bia đá Bongseon Honggyeongsa", // 🇻🇳
            title_tl: "Estela ng Templo Honggyeongsa", // 🇵🇭
            img: history4
        },
    ];

    const items = currentTab === "history" ? historyItems : natureItems;

    // 제목 헬퍼
    const getTitle = (item) => {
        if (normalizedLang === 'en') return item.title_en;
        if (normalizedLang === 'zh') return item.title_cn;
        if (normalizedLang === 'ja') return item.title_jp;
        if (normalizedLang === 'es') return item.title_es;
        if (normalizedLang === 'vi') return item.title_vi; // 🇻🇳
        if (normalizedLang === 'tl' || normalizedLang === 'fil') return item.title_tl; // 🇵🇭
        return item.title;
    };

    return (
        <KioskLayout
            logo={logo}
            banner={getBanner()}
            showBanner={true}
            showHomeBack={false}
            setContrastLevel={setContrastLevel}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            voiceSettings={voiceSettings}
            setVoiceSettings={setVoiceSettings}
            subtitle={isKorean ? "원하시는 장소를 선택해주세요." : "Please select a place."}
        >
            <div className="flex flex-col items-start justify-center w-full">
                <div className="flex gap-6 mb-8 justify-start w-full">
                    <button
                        ref={firstTabRef}
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
                            className="card bg-white border border-gray-300 rounded-xl shadow-lg overflow-hidden
                                       h-[380px] cursor-pointer hover:scale-105 transition
                                       focus:outline-none focus:ring-4 focus:ring-blue-500"
                            onClick={() => navigate(`/kiosk/${currentTab}/${item.id}`)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') navigate(`/kiosk/${currentTab}/${item.id}`);
                            }}
                        >
                            <img src={item.img} alt={item.title} className="w-full h-[70%] object-cover" />
                            <div className={`grid place-items-center text-center font-bold text-gray-800 h-[30%] px-6
                                ${!isKorean ? "text-2xl lg:text-3xl xl:text-4xl leading-tight" : "text-2xl lg:text-3xl xl:text-4xl leading-snug"}`}
                            >
                                {getTitle(item)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </KioskLayout>
    );
}