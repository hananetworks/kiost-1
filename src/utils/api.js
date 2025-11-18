// src/utils/api.js

// window.electronAPI는 preload.js에서 노출된 객체입니다.
const { electronAPI } = window;

export const api = {
    // askAI는 이제 요청만 보내고 아무것도 반환하지 않습니다.
    askAI: electronAPI.askAI,

    print: electronAPI.print,

    // [추가] 스트리밍 이벤트를 수신하기 위한 리스너
    onAIChunk: electronAPI.onAIChunk,
    onAIStreamEnd: electronAPI.onAIStreamEnd,
    onAIError: electronAPI.onAIError,
};