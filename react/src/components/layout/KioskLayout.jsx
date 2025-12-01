import { useState, useEffect } from "react";
import BottomNav from "../common/BottomNav";
import Subtitle from "../common/Subtitle";
import AvatarPlayer from "../avatar/AvatarPlayer";
// HeaderLogo는 안 쓰이면 제거해도 됨

export default function KioskLayout({
                                        logo,
                                        children,
                                        banner,
                                        showBanner = true,
                                        bannerHeight = "240px",
                                        bannerWidth = "100%",
                                        bannerMarginRight = "0px",
                                        bannerPadding = "",
                                        bannerBorder = "",
                                        bannerRounded = "",
                                        bannerShadow = "",
                                        showHomeBack = true,
                                        showSubtitle = true,
                                        setContrastLevel,
                                        zoomLevel = 1,
                                        setZoomLevel,
                                        voiceSettings,
                                        setVoiceSettings,
                                        subtitle, // 현재 페이지에서 전달받은 자막 내용
                                        isModalOpen = false,
                                    }) {
    // 자막 표시 여부 토글
    const [subtitleVisible, setSubtitleVisible] = useState(showSubtitle);

    const handleToggleSubtitle = () => setSubtitleVisible((prev) => !prev);

    return (
        <div className="w-full h-screen flex flex-col bg-white relative overflow-hidden">
            {/* 1. 상단 로고 */}
            {logo && (
                <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40">
                    <img src={logo} alt="로고" className="h-16 lg:h-20 object-contain" />
                </div>
            )}

            {/* 2. 배너 영역 */}
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
                        <img src={banner} alt="배너 이미지" className="w-full h-full object-cover" />
                    </div>
                </div>
            )}

            {/* 3. 메인 콘텐츠 영역 (좌측 아바타 + 우측 콘텐츠) */}
            <div className="relative flex-1 w-full mt-2">
                {/* 좌측: 아바타 */}
                <div
                    className={`avatar-container absolute left-5 bottom-4 pointer-events-none transition-all duration-300 ${
                        isModalOpen ? "z-10 opacity-70" : "z-40"
                    }`}
                >
                    <div className="flex items-end justify-center">
                        <AvatarPlayer />
                    </div>
                </div>

                {/* 우측: 실제 콘텐츠 + 버튼 + 자막 */}
                <div className="absolute z-30 inset-0 flex flex-col justify-between">

                    {/* (A) 페이지별 내용 */}
                    <div className="flex-[6] flex items-center justify-center pl-[380px] pr-10 pt-4">
                        {children}
                    </div>

                    {/* (B) 하단 버튼 네비게이션 */}
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

                    {/* (C) 자막 박스 */}
                    <div className="flex-[1.5] flex items-center justify-center pb-10 pl-[380px] pr-10">
                        <div
                            className={`w-[95%] h-[180px] bg-white border border-gray-300 shadow-md rounded-xl px-3 py-3 
                            flex items-center justify-center text-center transition-opacity duration-300 ${
                                subtitleVisible ? "opacity-100" : "opacity-0 pointer-events-none"
                            }`}
                            style={{ whiteSpace: "pre-line" }}
                        >
                            <Subtitle text={subtitle || "안내 내용이 없습니다."} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}