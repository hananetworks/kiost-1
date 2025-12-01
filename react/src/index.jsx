import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/contrast.css";
import "./styles/zoom.css";
import App from "./App";

// IndexedDB 에러 숨김 처리 (선택 사항)
window.addEventListener("error", (event) => {
    if (event?.message?.includes("IDB") || event?.target instanceof IDBRequest) {
        event.stopImmediatePropagation();
    }
}, true);

window.addEventListener("unhandledrejection", (event) => {
    if (event.reason && String(event.reason).includes("IDB")) {
        event.preventDefault();
    }
});

ReactDOM.createRoot(document.getElementById("root")).render(
    // StrictMode는 개발 중 두 번 렌더링을 유발하므로, 필요에 따라 켜거나 끌 수 있습니다.
    // 여기서는 켜둡니다.
    <React.StrictMode>
        <App />
    </React.StrictMode>
);