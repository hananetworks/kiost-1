import React, { useState, useEffect } from "react";
import { Rnd } from "react-rnd";
import { IoClose } from "react-icons/io5";
import VirtualKeyboard from "./VirtualKeyboard";

const SOURCE_WIDTH = 1000;
const SOURCE_HEIGHT = 650;
const HEADER_HEIGHT = 40;
const WINDOW_RATIO = SOURCE_WIDTH / (SOURCE_HEIGHT + HEADER_HEIGHT);

// savedLayout: DB에서 가져온 { width: 0.8, x: 0.1, y: 0.65 } 형태의 객체
export default function KeyboardModal({ onClose, savedLayout }) {

    // 1. 초기값 계산 함수 (DB 비율값 -> 실제 픽셀값 변환)
    const getInitialLayout = () => {
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;

        // DB 값이 있으면 쓰고, 없으면 기본값(너비 70%, 중앙 정렬) 사용
        const ratioW = savedLayout?.width ?? 0.7;
        const ratioX = savedLayout?.x ?? (1 - ratioW) / 2; // 자동 중앙 정렬 계산
        const ratioY = savedLayout?.y ?? 0.6; // 대략 하단 위치

        // 실제 픽셀로 변환
        const realWidth = screenW * ratioW;
        const realHeight = realWidth / WINDOW_RATIO; // 높이는 비율 공식 따름
        const realX = screenW * ratioX;
        const realY = screenH * ratioY;

        return { x: realX, y: realY, width: realWidth, height: realHeight };
    };

    // 초기값 로드
    const initial = getInitialLayout();

    const [currentWidth, setCurrentWidth] = useState(initial.width);
    const scale = currentWidth / SOURCE_WIDTH;

    return (
        <div className="fixed inset-0 z-[99999] pointer-events-none">
            <Rnd
                // 계산된 픽셀값 적용
                default={{
                    x: initial.x,
                    y: initial.y,
                    width: initial.width,
                    height: initial.height,
                }}

                lockAspectRatio={true}
                lockAspectRatioExtraHeight={0}

                minWidth={300}
                maxWidth={window.innerWidth}
                bounds="window"

                onResize={(e, direction, ref) => {
                    setCurrentWidth(parseInt(ref.style.width));
                }}

                className="pointer-events-auto flex flex-col rounded-xl overflow-hidden shadow-2xl border-4 border-gray-600 bg-gray-200"
            >
                {/* ... 상단바 및 내용 (이전과 동일) ... */}
                <div
                    className="window-drag-handle w-full bg-gray-800 text-white flex items-center justify-between px-3 cursor-move select-none shrink-0"
                    style={{ height: `${HEADER_HEIGHT}px` }}
                >
                    <div className="flex items-center gap-2">
                        <span className="text-xl">⌨️</span>
                        <span className="font-bold text-sm">Touch Keyboard</span>
                    </div>
                    <div onClick={onClose} className="bg-red-500 hover:bg-red-600 rounded w-6 h-6 flex items-center justify-center cursor-pointer">
                        <IoClose size={18} />
                    </div>
                </div>

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