/** @type {import('tailwindcss').Config} */
module.exports = {
    // [수정] Tailwind가 스캔할 파일 경로를 새 'react/' 폴더로 변경
    content: [
        "./react/index.html",
        "./react/src/**/*.{js,jsx,ts,tsx}",
    ],
    theme: {
        fontFamily: {
            sans: ["Pretendard", "ui-sans-serif", "system-ui", "sans-serif"],
        },
    },
    plugins: [],
};