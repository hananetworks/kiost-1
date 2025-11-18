import { useState, useEffect } from "react";
import BottomNav from "../common/BottomNav";
import Subtitle from "../common/Subtitle";
import avatarImg from "../../assets/images/avatar.png";
import HeaderLogo from "../../components/layout/HeaderLogo";

export default function KioskLayout({
                                        logo, // 로고
                                        children,  // 페이지별 콘텐츠
                                        banner, // 배너
                                        showBanner = true, // 배너 표시 여부
                                        bannerHeight = "240px",
                                        bannerWidth = "100%",
                                        bannerMarginRight = "0px",
                                        bannerPadding = "", // 기본값: 여백 없음
                                        bannerBorder = "", // 기본값: 테두리 없음
                                        bannerRounded = "", // 기본값: 둥근 모서리 없음
                                        bannerShadow = "", // 기본값: 그림자 없음
                                        showHomeBack = true, // 홈/뒤로가기 버튼 표시 여부
                                        showSubtitle = true, // 자막 표시 여부
                                        setContrastLevel, // 고대비
                                        zoomLevel = 1, // 화면 확대 비율
                                        setZoomLevel, // 확대 설정
                                        voiceSettings, // 음성 설정
                                        setVoiceSettings, // 음성 설정 변경
                                        subtitle, // 페이지별자막
                                        defaultMessage = "천안 8경의 아름다운 자연 명소를 소개합니다.\n원하시는 장소를 선택해주세요.",
                                    }) {


    const [subtitleVisible, setSubtitleVisible] = useState(showSubtitle);

// ✅ 자막 on/off 토글 함수 (이거 꼭 필요)
    const handleToggleSubtitle = () => {
        setSubtitleVisible((prev) => !prev);
    };

    return (
        <div className="w-full h-screen flex flex-col bg-white overflow-hidden">
            {/* 상단 영역 (로고 + 배너) - 고정 높이 */}
            <div className="flex-shrink-0 flex flex-col items-center justify-start">

                {/* 로고 (항상 상단 중앙 고정) */}
                {logo && (
                    <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50">
                        <img
                            src={logo}
                            alt="천안시 로고"
                            className="h-16 lg:h-20 object-contain"
                        />
                    </div>
                )}

                {/* 배너 - 각 페이지에서 스타일 커스터마이징 */}
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
                            <img
                                src={banner}
                                alt="천안시 비주얼 배너"
                                className="w-full h-full object-cover"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 메인 영역 - 남은 공간 전체 사용 */}
            <div className="flex flex-row w-full px-5 pr-10 py-4 mt-2">
                {/* 왼쪽: 아바타 영역 (이미지 크기만큼만 차지) */}
                <div className="flex flex-col justify-end items-center" style={{ width: "380px" }}>
                    {/* 아바타 이미지 */}
                    <div className="flex items-end justify-center pb-2">
                        <img
                            src={avatarImg}
                            alt="AI 아바타"
                            className="h-[1150px] object-contain"
                        />
                    </div>
                </div>

                {/* 오른쪽: 메인 콘텐츠 전체 */}
                <div className="flex-1 flex flex-col justify-between">
                    {/* 콘텐츠 */}
                    <div className="flex-[6] flex items-center justify-center">
                        {children}
                    </div>

                    {/* 버튼 */}
                    <div className="flex-[2.5] flex items-center justify-center">
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


                    {/* 자막 영역 */}
                    <div className="flex-[1.5] flex items-center justify-center pb-4">
                        <div
                            className={`w-[95%] h-[200px] bg-white border border-gray-300 shadow-md rounded-xl px-3 py-3 
                flex items-center justify-center text-center transition-opacity duration-300 ${subtitleVisible ? "opacity-100" : "opacity-0 pointer-events-none"
                            }`}
                            style={{ whiteSpace: "pre-line" }}
                        >
                            <Subtitle text={subtitle || defaultMessage} />
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}