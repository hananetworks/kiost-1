import React from 'react';

// PrintIcon (SVG)
const PrintIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03-.48.062-.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z"/>
    </svg>
);

export default function ChatMessage({ msg, onPrint }) {
    const isUser = msg.role === 'user';
    const isInterim = msg.role === 'interim';

    // 스타일 로직
    const isRight = isUser || isInterim;

    return (
        <div className={`flex items-end gap-4 ${isRight ? 'justify-end' : 'justify-start'}`}>
            {/* AI 답변일 때만 인쇄 버튼 표시 */}
            {msg.role === 'assistant' && (
                <button
                    onClick={() => onPrint(msg.content)}
                    className="p-3 mb-2 rounded-full text-gray-500 hover:bg-gray-200 active:bg-gray-300 focus:outline-none focus:ring-4 focus:ring-blue-500"
                    title="이 답변 인쇄하기"
                >
                    <PrintIcon />
                </button>
            )}

            <div className={`relative p-8 rounded-2xl max-w-[75%] text-[2rem] font-medium leading-relaxed 
                ${isUser ? "bg-blue-500 text-white bubble-user" :
                isInterim ? "bg-blue-300 text-black bubble-user animate-pulse" :
                    "bg-gray-200 text-black bubble-ai whitespace-pre-wrap"}`}>

                {msg.content}

                {/* 말풍선 꼬리 */}
                {isUser && (
                    <div className="absolute -right-2 bottom-4 w-0 h-0 border-l-[16px] border-l-blue-500 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent"></div>
                )}
                {isInterim && (
                    <div className="absolute -right-2 bottom-4 w-0 h-0 border-l-[16px] border-l-blue-300 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent"></div>
                )}
                {msg.role === 'assistant' && (
                    <div className="absolute -left-2 bottom-4 w-0 h-0 border-r-[16px] border-r-gray-200 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent"></div>
                )}
            </div>
        </div>
    );
}