import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useSystemVolume } from "../../hooks/useSystemVolume"; // 🆕 Hook Import

export default function VoiceModal({ onClose, voiceSettings, setVoiceSettings }) {
    // 1. 시스템 볼륨 훅 사용 (초기화, 동기화 다 알아서 해줌)
    const { volume, setVolume } = useSystemVolume(voiceSettings.volume);

    // 2. 부모 State(voiceSettings)와 씽크 맞추기
    // (사용자가 조절할 때 부모에게도 알림)
    const handleVolumeChange = (newVol) => {
        setVolume(newVol); // 시스템 볼륨 조절
        setVoiceSettings(prev => ({ ...prev, volume: newVol })); // 부모 설정 저장
    };

    const handleStep = (step) => {
        let newVal = volume + step;
        newVal = Math.max(0, Math.min(100, newVal));
        handleVolumeChange(newVal);
    };

    const settingsConfig = [{ label: "볼륨", min: 0, max: 100, step: 5 }];

    if (typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-5">
            <div className="modal-box bg-white rounded-xl shadow-lg p-10 w-full max-w-[800px]">
                <h2 className="text-6xl font-bold mb-10 text-center">음성 안내 설정</h2>

                <label className="flex flex-col mb-6">
                    <span className="mb-3 text-4xl font-medium notranslate">
                        볼륨 ({volume.toFixed(0)})
                    </span>
                    <div className="flex items-center gap-4">
                        <button onClick={() => handleStep(-5)} className="px-5 py-4 bg-gray-200 rounded-lg text-4xl hover:bg-gray-300">
                            ➖ 감소
                        </button>
                        <input
                            type="range" min="0" max="100" step="5"
                            value={volume}
                            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                            className="flex-1 h-10 accent-blue-500 cursor-pointer"
                        />
                        <button onClick={() => handleStep(5)} className="px-5 py-4 bg-gray-200 rounded-lg text-4xl hover:bg-gray-300">
                            ➕ 증가
                        </button>
                    </div>
                </label>

                <div className="flex justify-center mt-10">
                    <button onClick={onClose} className="bg-[#555] hover:bg-[#333] text-white px-12 py-5 rounded-full text-3xl font-bold">
                        닫기
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}