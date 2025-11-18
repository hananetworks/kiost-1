import React from "react";
import { createPortal } from "react-dom";

export default function CallModal({ defaultMessage, onClose, onRequestSpeak }) {
    if (typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
            <div
                className="modal-box bg-white rounded-2xl shadow-2xl
                  w-[90%] max-w-[400px]
                  sm:max-w-[500px]
                  lg:max-w-[700px]
                  xl:max-w-[800px]
                  2xl:max-w-[900px]
                  p-6 sm:p-8 lg:p-10 xl:p-12
                  text-center
                  min-h-[300px] sm:min-h-[400px] lg:min-h-[300px]"
            >
                {/* 제목 */}
                <p
                    className="text-lg sm:text-xl lg:text-[2.5rem] xl:text-3xl 2xl:text-4xl
                     font-extrabold text-gray-900 mb-10 mt-7"
                >
                    직원 호출을 요청하였습니다.
                </p>

                {/* 안내 문구 */}
                <p
                    className="text-base sm:text-lg md:text-2xl lg:text-3xl xl:text-4xl
                    text-gray-600 leading-snug"
                >
                    직원이 도와드릴 예정입니다.<br />
                    잠시만 기다려 주세요.
                </p>

                {/* 닫기 버튼 */}
                <button
                    onClick={async () => {
                        onClose();
                        if (onRequestSpeak && defaultMessage) {
                            await onRequestSpeak(defaultMessage);
                        }
                    }}
                    className="bg-[#555] hover:bg-[#333] text-white
                     px-6 sm:px-8 lg:px-14 xl:px-12 2xl:px-14
                     py-2 sm:py-3 lg:py-5 xl:py-7
                     rounded-full
                     text-base sm:text-lg lg:text-[2rem] xl:text-2xl 2xl:text-3xl
                     font-bold mt-6 sm:mt-8 lg:mt-10
                     transition-all duration-200 ease-in-out"
                >
                    닫기
                </button>
            </div>
        </div>,
        document.body // ✅ Layout 밖(body)에 렌더링
    );
}
