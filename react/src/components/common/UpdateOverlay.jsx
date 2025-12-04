import React from 'react';

export default function UpdateOverlay({ status, progress, version }) {
    // idle 상태면 오버레이를 렌더링하지 않음 (메인 앱 노출)
    if (status === 'idle') return null;

    let title = "시스템 점검 중";
    let message = "잠시만 기다려 주세요.";

    switch (status) {
        case 'startup':
            title = "시스템 초기화 중";
            message = "키오스크 환경을 점검하고 있습니다...";
            break;

        case 'checking':
            title = "업데이트 확인 중";
            message = "최신 버전을 확인하고 있습니다...";
            break;
        case 'available':
            title = "업데이트 발견";
            message = `새 버전(${version})을 준비하고 있습니다...`;
            break;
        case 'downloading':
            title = "시스템 업데이트 중";
            message = `새로운 기능(${version})을 다운로드하고 있습니다.\n전원을 끄지 마세요.`;
            break;
        case 'completed':
            title = "업데이트 설치 시작";
            message = "설치를 위해 잠시 앱이 종료됩니다.\n화면이 꺼져도 전원을 뽑지 마세요.\n(자동으로 다시 켜집니다)";
            break;

        // Python 관련
        case 'python-checking':
            title = "AI 엔진 점검 중";
            message = "AI 기능 실행을 위한 환경을 확인하고 있습니다...";
            break;
        case 'python-pass':
            title = "시스템 준비 완료";
            message = "모든 시스템이 정상입니다.\n곧 시작합니다.";
            break;
        case 'python-downloading':
            title = "AI 엔진 업데이트 중";
            message = "더 똑똑한 AI 기능을 위해 데이터를 받고 있습니다...";
            break;
        case 'python-extracting':
            title = "AI 엔진 설치 중";
            message = "다운로드한 데이터를 설치하고 있습니다...";
            break;

        case 'error':
            title = "오류 발생";
            message = "시스템 점검 중 문제가 발생했습니다.\n잠시 후 다시 시도하거나 메인 화면으로 이동합니다.";
            break;
        default: break;
    }

    return (
        <div className="fixed inset-0 z-[999999] bg-black bg-opacity-95 flex flex-col items-center justify-center text-white touch-none">
            <div className="mb-10">
                {(status === 'downloading' || status === 'python-downloading' || status === 'checking' || status === 'python-extracting' || status === 'python-checking') ? (
                    <div className="w-24 h-24 border-8 border-gray-600 border-t-blue-500 rounded-full animate-spin"></div>
                ) : (
                    <div className="text-6xl">📥</div>
                )}
            </div>

            <h1 className="text-5xl font-bold mb-6">{title}</h1>
            <p className="text-3xl text-gray-300 mb-12 text-center whitespace-pre-wrap px-4">{message}</p>

            {(status === 'downloading' || status === 'python-downloading') && (
                <div className="w-[60%] max-w-[800px]">
                    <div className="flex justify-between mb-2 text-2xl font-bold">
                        <span>진행률</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="w-full h-8 bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 transition-all duration-300 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}