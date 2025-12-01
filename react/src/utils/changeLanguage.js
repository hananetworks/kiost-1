// src/utils/changeLanguage.js

// 1. 내부 헬퍼: 콤보박스 찾기
function getCombo() {
    return document.querySelector(".goog-te-combo");
}

// 2. 내부 헬퍼: 콤보박스 대기 (최대 1초)
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

// 3. 내부 헬퍼: 쿠키 강제 설정 (실패 시 폴백)
function applyCookieFallback(lang) {
    const host = window.location.hostname;
    const v1 = `/ko/${lang}`;
    const v2 = `/auto/${lang}`;
    document.cookie = `googtrans=${v1};path=/;domain=${host}`;
    document.cookie = `googtrans=${v2};path=/;domain=${host}`;
    try { localStorage.setItem("app_lang", lang); } catch {}

    window.dispatchEvent(new Event("languagechange"));
    setTimeout(() => window.location.reload(), 100);
}

// ✅ [메인 기능] 언어 변경 실행
export async function changeLanguage(langCode) {
    try {
        const combo = getCombo() || (await waitForCombo());
        combo.value = langCode;
        combo.dispatchEvent(new Event("change", { bubbles: true }));
        try { localStorage.setItem("app_lang", langCode); } catch {}

        document.body.classList.remove("lang-ko", "lang-en");
        document.body.classList.add(`lang-${langCode}`);

        // 수동 이벤트 발생 (React가 감지하도록)
        window.dispatchEvent(new Event("languagechange"));

    } catch (err) {
        console.warn("combo not found, fallback to cookie:", err.message);
        applyCookieFallback(langCode);
    }
}

// ✅ [Getter] 현재 언어 가져오기 (Hook에서 사용)
export function getActiveLang() {
    const fromLS = localStorage.getItem("app_lang");
    if (fromLS) return fromLS;

    // 쿠키에서 구글 번역 정보 확인
    const m = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
    if (m) {
        const v = decodeURIComponent(m[1]);
        const last = v.split("/").pop();
        if (last) return last;
    }
    return "ko";
}

// ✅ [Helper] 언어 코드 정규화 (Hook에서 사용) - 새로 추가됨!
export function normalizeLang(lang) {
    const v = (lang || "").toLowerCase();
    if (v.includes("zh")) return "zh";   // 중국어 통합
    if (v.includes("ja")) return "ja";   // 일본어
    if (v.includes("es")) return "es";   // 스페인어
    if (v.includes("en")) return "en";   // 영어
    return "ko";                         // 기본값
}