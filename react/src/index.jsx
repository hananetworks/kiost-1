import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/contrast.css";
import "./styles/zoom.css";
import App from "./App";   

// setup.js
window.addEventListener("error", (event) => {
  if (
    event?.message?.includes("IDB") ||
    event?.target instanceof IDBRequest
  ) {
    event.stopImmediatePropagation();
  }
}, true);

window.addEventListener("unhandledrejection", (event) => {
  if (event.reason && String(event.reason).includes("IDB")) {
    event.preventDefault();
  }
});


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
