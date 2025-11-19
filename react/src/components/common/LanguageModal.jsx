// LanguageModal.jsx
import React from "react";
import { createPortal } from "react-dom";

export default function LanguageModal({ onClose, onSelect, selected = "ko" }) {
    // 모달이 열리지 않았으면 null (선택)
    if (typeof document === "undefined") return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50"
            translate="no"
        >
            <div className="modal-box bg-white rounded-3xl shadow-2xl p-12 w-[600px] text-center border border-gray-200">
                <h2 className="text-4xl font-extrabold mb-10 text-gray-800">언어 선택</h2>

                <div className="flex flex-col gap-6">
                    {/* 한국어 */}
                    <button
                        onClick={() => onSelect?.("ko")}
                        className={`py-4 rounded-2xl text-3xl font-semibold transition-all duration-200 border-2
              ${
                            selected === "ko"
                                ? "bg-blue-100 border-blue-500 text-blue-700 shadow-md"
                                : "bg-gray-100 hover:bg-gray-200 border-transparent text-gray-800"
                        }`}
                    >
                        한국어
                    </button>

                    {/* 영어 */}
                    <button
                        onClick={() => onSelect?.("en")}
                        className={`py-4 rounded-2xl text-3xl font-semibold transition-all duration-200 border-2
              ${
                            selected === "en"
                                ? "bg-blue-100 border-blue-500 text-blue-700 shadow-md"
                                : "bg-gray-100 hover:bg-gray-200 border-transparent text-gray-800"
                        }`}
                    >
                        English
                    </button>

                    {/* 중국어 */}
                    <button
                        onClick={() => onSelect?.("zh-CN")}
                        className={`py-4 rounded-2xl text-3xl font-semibold transition-all duration-200 border-2
              ${
                            selected === "zh-CN"
                                ? "bg-blue-100 border-blue-500 text-blue-700 shadow-md"
                                : "bg-gray-100 hover:bg-gray-200 border-transparent text-gray-800"
                        }`}
                    >
                        中文（简体）
                    </button>

                    {/* 일본어 */}
                    <button
                        onClick={() => onSelect?.("ja")}
                        className={`py-4 rounded-2xl text-3xl font-semibold transition-all duration-200 border-2
              ${
                            selected === "ja"
                                ? "bg-blue-100 border-blue-500 text-blue-700 shadow-md"
                                : "bg-gray-100 hover:bg-gray-200 border-transparent text-gray-800"
                        }`}
                    >
                        日本語
                    </button>

                    {/* 스페인어 */}
                    <button
                        onClick={() => onSelect?.("es")}
                        className={`py-4 rounded-2xl text-3xl font-semibold transition-all duration-200 border-2
              ${
                            selected === "es"
                                ? "bg-blue-100 border-blue-500 text-blue-700 shadow-md"
                                : "bg-gray-100 hover:bg-gray-200 border-transparent text-gray-800"
                        }`}
                    >
                        Español
                    </button>
                </div>

                <div className="flex justify-center">
                    <button
                        onClick={onClose}
                        className="bg-[#555] hover:bg-[#333] text-white px-6 sm:px-8 lg:px-14 xl:px-12 2xl:px-14 py-2
                        sm:py-3 lg:py-5 xl:py-7 rounded-full text-base sm:text-lg lg:text-[2rem] xl:text-2xl 2xl:text-3xl
                        font-bold mt-6 sm:mt-8 lg:mt-10 transition-all duration-200 ease-in-out"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>,
        document.body // ✅ 여기서 Layout 밖(body)에 직접 렌더링
    );
}