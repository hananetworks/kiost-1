import { useState, useEffect } from "react";
// ✅ utils에서 로직을 수입해옵니다. (중복 제거)
import { getActiveLang, normalizeLang } from "../utils/changeLanguage";

export function useLanguage() {
    // 초기값은 utils의 함수를 사용
    const [lang, setLang] = useState(() => getActiveLang());

    useEffect(() => {
        // 이벤트 발생 시 utils의 함수로 최신값 가져오기
        const handler = () => setLang(getActiveLang());

        window.addEventListener("languagechange", handler);
        window.addEventListener("storage", handler);

        return () => {
            window.removeEventListener("languagechange", handler);
            window.removeEventListener("storage", handler);
        };
    }, []);

    // 정규화된 언어 코드 (zh-CN -> zh 등)
    // utils의 normalizeLang 함수를 재사용
    const normalized = normalizeLang(lang);

    return {
        lang,            // 원본 언어 코드 (예: zh-CN)
        normalizedLang: normalized, // 정규화된 코드 (예: zh)
        isKorean: normalized === 'ko' // 편의용 플래그
    };
}