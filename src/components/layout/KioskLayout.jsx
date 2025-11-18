import { useState, useEffect } from "react";
import BottomNav from "../common/BottomNav";
import Subtitle from "../common/Subtitle";
import HeaderLogo from "../../components/layout/HeaderLogo";
import AvatarPlayer from "../avatar/AvatarPlayer";

export default function KioskLayout({
                                        logo, // 로고
                                        children, // 페이지별 콘텐츠
                                        banner, // 배너
                                        showBanner = true, // 배너 표시 여부
                                        bannerHeight = "240px",
                                        bannerWidth = "100%",
                                        bannerMarginRight = "0px",
                                        bannerPadding = "",
                                        bannerBorder = "",
                                        bannerRounded = "",
                                        bannerShadow = "",
                                        showHomeBack = true, // 홈/뒤로가기 버튼 표시 여부
                                        showSubtitle = true, // 자막 표시 여부
                                        setContrastLevel,
                                        zoomLevel = 1,
                                        setZoomLevel,
                                        voiceSettings,
                                        setVoiceSettings,
                                        subtitle,
                                        isModalOpen = false, // ✅ 모달 열림 여부
                                        defaultMessage = "천안 8경의 아름다운 자연 명소를 소개합니다.\n원하시는 장소를 선택해주세요.",
                                    }) {
    const [liveSubtitle, setLiveSubtitle] = useState(defaultMessage);
    const [subtitleVisible, setSubtitleVisible] = useState(showSubtitle);

    // ✅ defaultMessage 변경 시 자막 갱신
    useEffect(() => {
        setLiveSubtitle(defaultMessage);
    }, [defaultMessage]);

    const handleToggleSubtitle = () => setSubtitleVisible((prev) => !prev);

    return (
        <div className="w-full h-screen flex flex-col bg-white relative overflow-hidden">
            {/* 로고 */}
            {logo && (
                <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40">
                    <img src={logo} alt="천안시 로고" className="h-16 lg:h-20 object-contain" />
                </div>
            )}

            {/* 배너 */}
            {showBanner && banner && (
                <div className={`w-full mt-36 ${bannerPadding}`}>
                    <div
                        className={`w-full bg-gray-200 overflow-hidden ${bannerBorder} ${bannerRounded} ${bannerShadow}`}
                        style={{
                            height: bannerHeight,
                            width: bannerWidth,
                            margin: "0 auto",
                            marginRight: bannerMarginRight,
                        }}
                    >
                        <img src={banner} alt="천안시 비주얼 배너" className="w-full h-full object-cover" />
                    </div>
                </div>
            )}

            {/* 메인 영역 */}
            <div className="relative flex-1 w-full mt-2">
                {/* ✅ 아바타 */}
                <div
                    className={`avatar-container absolute left-5 bottom-4 pointer-events-none transition-all duration-300 ${isModalOpen ? "z-10 opacity-70" : "z-40"
                    }`}
                >
                    <div className="flex items-end justify-center">
                        <AvatarPlayer />
                    </div>
                </div>

                {/* 메인 콘텐츠 */}
                <div className="absolute z-30 inset-0 flex flex-col justify-between">
                    {/* 본문 */}
                    <div className="flex-[6] flex items-center justify-center pl-[380px] pr-10 pt-4">
                        {children}
                    </div>

                    {/* 버튼 영역 */}
                    <div className="flex-[2.5] flex items-center justify-center pl-[380px] pr-10">
                        <BottomNav
                            showHomeBack={showHomeBack}
                            setContrastLevel={setContrastLevel}
                            zoomLevel={zoomLevel}
                            setZoomLevel={setZoomLevel}
                            voiceSettings={voiceSettings}
                            setVoiceSettings={setVoiceSettings}
                            onToggleSubtitle={handleToggleSubtitle}
                        />
                    </div>

                    {/* 자막 */}
                    <div className="flex-[1.5] flex items-center justify-center pb-10 pl-[380px] pr-10">
                        <div
                            className={`w-[95%] h-[180px] bg-white border border-gray-300 shadow-md rounded-xl px-3 py-3 flex items-center justify-center text-center transition-opacity duration-300 ${subtitleVisible ? "opacity-100" : "opacity-0 pointer-events-none"
                            }`}
                            style={{ whiteSpace: "pre-line" }}
                        >
                            <Subtitle text={subtitle || liveSubtitle} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
