import React, { useState } from "react";
import { Rnd } from "react-rnd";
import { IoClose } from "react-icons/io5";
import VirtualKeyboard from "./VirtualKeyboard";

// ⚠️ 중요: 이 상수들이 WINDOW_RATIO 계산보다 "먼저" 위에 있어야 합니다.
const SOURCE_WIDTH = 1000;
const SOURCE_HEIGHT = 650;
const HEADER_HEIGHT = 40;

// 상수 선언 후 계산
const WINDOW_RATIO = SOURCE_WIDTH / (SOURCE_HEIGHT + HEADER_HEIGHT);

export default function KeyboardModal({ onClose }) {
    // 1. 초기 크기 설정 (화면 너비의 70% 정도)
    const initialWidth = Math.min(window.innerWidth * 0.7, 800);
    // 높이는 비율에 맞춰 자동 계산
    const initialHeight = initialWidth / WINDOW_RATIO;

    // 2. 현재 너비 상태 관리
    const [currentWidth, setCurrentWidth] = useState(initialWidth);

    // 3. 배율 계산
    const scale = currentWidth / SOURCE_WIDTH;

    return (
        <div className="fixed inset-0 z-[99999] pointer-events-none">
            <Rnd
                // 초기 위치 및 크기
                default={{
                    x: (window.innerWidth - initialWidth) / 2,
                    y: window.innerHeight - initialHeight - 50,
                    width: initialWidth,
                    height: initialHeight,
                }}

                // 비율 고정 (가로/세로 비율 유지)
                lockAspectRatio={true}
                lockAspectRatioExtraHeight={0}

                // 크기 제한
                minWidth={500}
                maxWidth={window.innerWidth}
                bounds="window"
                dragHandleClassName="window-drag-handle"

                // 리사이즈 시 너비 업데이트 -> 내부 스케일 변경
                onResize={(e, direction, ref) => {
                    setCurrentWidth(parseInt(ref.style.width));
                }}

                // 윈도우 스타일
                className="pointer-events-auto flex flex-col rounded-xl overflow-hidden shadow-2xl border-4 border-gray-600 bg-gray-200"
            >
                {/* --- 상단 바 (드래그 핸들) --- */}
                <div
                    className="window-drag-handle w-full bg-gray-800 text-white flex items-center justify-between px-3 cursor-move select-none shrink-0"
                    style={{ height: `${HEADER_HEIGHT}px` }}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-xl">⌨️</span>
                        <span className="font-bold text-sm">Touch Keyboard</span>
                    </div>

                    <div
                        onClick={onClose}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="bg-red-500 hover:bg-red-600 rounded w-6 h-6 flex items-center justify-center cursor-pointer transition-colors"
                    >
                        <IoClose size={18} />
                    </div>
                </div>

                {/* --- 키보드 컨텐츠 영역 --- */}
                <div className="relative w-full flex-1 bg-[#d1d5db] overflow-hidden">
                    <div
                        style={{
                            width: `${SOURCE_WIDTH}px`,
                            height: `${SOURCE_HEIGHT}px`,
                            transform: `scale(${scale})`,
                            transformOrigin: "top left",
                            willChange: "transform",
                        }}
                    >
                        <VirtualKeyboard />
                    </div>
                </div>
            </Rnd>
        </div>
    );
}