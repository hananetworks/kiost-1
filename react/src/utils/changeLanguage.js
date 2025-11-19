// src/utils/changeLanguage.js (전체 코드)

// src/utils/changeLanguage.js (빠른 + 안정 하이브리드)
function getCombo() {
    return document.querySelector(".goog-te-combo");
}

// 짧은 폴링 (최대 1초)
function waitForCombo(maxTries = 10, interval = 100) {
    return new Promise((resolve, reject) => {
        let tries = 0;
        const timer = setInterval(() => {
            const el = getCombo();
            if (el) {
                clearInterval(timer);
                resolve(el);
            } else if (++tries >= maxTries) {
                clearInterval(timer);
                reject(new Error("Combo not found"));
            }
        }, interval);
    });
}

// 쿠키 강제 설정 (새로고침 포함)
function applyCookieFallback(lang) {
    const host = window.location.hostname;
    const v1 = `/ko/${lang}`;
    const v2 = `/auto/${lang}`;
    document.cookie = `googtrans=${v1};path=/;domain=${host}`;
    document.cookie = `googtrans=${v2};path=/;domain=${host}`;
    try { localStorage.setItem("app_lang", lang); } catch {}

    // ❗️ 수동 이벤트 발생 (새로고침 전)
    window.dispatchEvent(new Event("languagechange"));
    setTimeout(() => window.location.reload(), 100); // 살짝 딜레이 후 새로고침
}

export async function changeLanguage(langCode) {
    try {
        const combo = getCombo() || (await waitForCombo());
        combo.value = langCode;
        combo.dispatchEvent(new Event("change", { bubbles: true }));
        try { localStorage.setItem("app_lang", langCode); } catch {}
        document.body.classList.remove("lang-ko", "lang-en");
        document.body.classList.add(`lang-${langCode}`);

        // ❗️ 수동 이벤트 발생 (새로고침 안 할 때)
        window.dispatchEvent(new Event("languagechange"));

    } catch (err) {
        console.warn("combo not found, fallback to cookie:", err.message);
        applyCookieFallback(langCode);
    }

}

// 🔽 [수정 완료] App.jsx에서 이 함수를 가져와서 export 합니다.
export function getActiveLang() {
    const fromLS = localStorage.getItem("app_lang");
    if (fromLS) return fromLS;
    const m = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
    if (m) {
        const v = decodeURIComponent(m[1]);
        const last = v.split("/").pop();
        if (last) return last;
    }
    return "ko";
}