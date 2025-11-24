import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom"; // ✅ Portal import

export default function VoiceModal({ onClose, voiceSettings, setVoiceSettings }) {
    const [localSettings, setLocalSettings] = useState(voiceSettings);

    // ✅ [신규] 모달이 열릴 때, PC의 현재 시스템 볼륨을 가져와서 슬라이더에 반영
    useEffect(() => {
        const syncSystemVolume = async () => {
            if (window.electronAPI && window.electronAPI.getSystemVolume) {
                try {
                    const currentVol = await window.electronAPI.getSystemVolume();
                    console.log("Current System Volume:", currentVol);
                    // 가져온 볼륨값으로 로컬 상태 업데이트
                    setLocalSettings((prev) => ({ ...prev, volume: currentVol }));
                } catch (error) {
                    console.error("볼륨 가져오기 실패:", error);
                }
            }
        };
        syncSystemVolume();
    }, []);

    // 부모의 voiceSettings prop이 변경될 때 로컬 상태를 동기화합니다.
    useEffect(() => {
        setLocalSettings(voiceSettings);
    }, [voiceSettings]);

    const handleChange = (field, value) => {
        const updated = { ...localSettings, [field]: value };
        setLocalSettings(updated);
        setVoiceSettings(updated); // 변경 즉시 부모 상태에도 반영

        // ✅ [신규] 볼륨이 변경되면 PC 시스템 볼륨 조절 요청 (IPC)
        if (field === 'volume' && window.electronAPI && window.electronAPI.setSystemVolume) {
            window.electronAPI.setSystemVolume(value);
        }
    };

    const handleStep = (field, step, min, max) => {
        // 시스템 볼륨은 정수 단위가 깔끔하므로 소수점 처리 로직을 정수형에 맞게 단순화 가능하지만,
        // 기존 로직(parseFloat)을 유지해도 문제 없습니다.
        let newValue = localSettings[field] + step;
        newValue = Math.max(min, Math.min(max, newValue)); // min/max 범위 보장
        handleChange(field, newValue);
    };

    // ✅ [수정] 볼륨 범위를 PC 기준인 0 ~ 100으로 변경 (Step은 5단위 추천)
    const settingsConfig = [{ field: "volume", label: "볼륨", min: 0, max: 100, step: 5 }];

    // ✅ Portal이 렌더링 가능한 상태가 아닐 경우 (SSR 등) 방지
    if (typeof document === "undefined") return null;

    // ✅ Portal로 body에 직접 렌더링
    return createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-5">
            <div
                className="modal-box bg-white rounded-xl lg:rounded-2xl shadow-lg
                     p-4 sm:p-6 lg:p-10 xl:p-12
                     w-full max-w-[500px] sm:max-w-[600px] lg:max-w-[750px] xl:max-w-[800px] 2xl:max-w-[850px]
                     max-h-[100vh] overflow-y-auto"
            >
                <h2
                    className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl 2xl:text-7xl
                      font-bold mb-4 sm:mb-6 lg:mb-8 xl:mb-10 text-center"
                >
                    음성 안내 설정
                </h2>

                {settingsConfig.map((config) => (
                    <label key={config.field} className="flex flex-col mb-3 sm:mb-4 lg:mb-6">
                        {/* ✅ [수정] 소수점 표시(.toFixed(1)) 제거 -> 정수형(.toFixed(0)) 표시 */}
                        <span className="mb-2 sm:mb-3 sm:text-xl lg:text-3xl xl:text-4xl font-medium notranslate">
                            {config.label} ({localSettings[config.field].toFixed(0)})
                        </span>
                        <div className="flex items-center gap-2 sm:gap-3 lg:gap-4">
                            <button
                                onClick={() => handleStep(config.field, -config.step, config.min, config.max)}
                                className="px-2 sm:px-3 lg:px-4 xl:px-5 py-1 sm:py-2 lg:py-3 xl:py-4
                          rounded lg:rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400
                          flex items-center gap-1 sm:gap-2 sm:text-2xl lg:text-3xl xl:text-4xl transition-all
                          duration-150 ease-in-out touch-manipulation min-w-[60px] sm:min-w-[70px] lg:min-w-[80px] xl:min-w-[90px]"
                            >
                                ➖ <span>감소</span>
                            </button>
                            <input
                                type="range"
                                min={config.min}
                                max={config.max}
                                step={config.step}
                                value={localSettings[config.field]}
                                onChange={(e) => handleChange(config.field, parseFloat(e.target.value))}
                                className="flex-1 h-6 lg:h-8 xl:h-10 accent-blue-500 cursor-pointer"
                            />
                            <button
                                onClick={() => handleStep(config.field, config.step, config.min, config.max)}
                                className="px-2 sm:px-3 lg:px-4 xl:px-5 py-1 sm:py-2 lg:py-3 xl:py-4
                          rounded lg:rounded-lg bg-gray-200 hover:bg-gray-300 active:bg-gray-400
                          flex items-center gap-1 sm:gap-2 sm:text-2xl lg:text-3xl xl:text-4xl transition-all
                          duration-150 ease-in-out touch-manipulation min-w-[60px] sm:min-w-[70px] lg:min-w-[80px] xl:min-w-[90px]"
                            >
                                ➕ <span>증가</span>
                            </button>
                        </div>
                    </label>
                ))}

                {/* 닫기 버튼 */}
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
        document.body // ✅ 최상위 DOM에 렌더링
    );
}