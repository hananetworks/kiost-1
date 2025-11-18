// AvatarPlayer_noBlink.jsx
import React, { useEffect, useRef, useLayoutEffect } from 'react';

const URLS = [
    "/img/arms_extended.apng",
    "/img/Hands_clasped.apng",
    "/img/right_duidance.apng",
];

const DURATIONS = {
    "/img/arms_extended.apng": 2500,
    "/img/Hands_clasped.apng": 2500,
    "/img/right_duidance.apng": 2000,
};

const OFFSETS = {
    "/img/arms_extended.apng": { x: 7, y: -12, s: 1 },
    "/img/Hands_clasped.apng": { x: -15, y: 0, s: 0.98 },
    "/img/right_duidance.apng": { x: 80, y: -26, s: 1 },
};


export default function AvatarPlayer() {
    const containerRef = useRef(null);
    const mountedRef = useRef(false);

    useEffect(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;

        const container = containerRef.current;
        if (!container) return;

        console.log("🚀 아바타 플레이어 시작 (무깜빡 버전)");

        const layerA = document.createElement("img");
        const layerB = document.createElement("img");

        const baseStyle = `
  position: absolute;
  top: 0;
  left: 38%;
  height: 100%;
  width: auto;
  object-fit: cover;
  object-position: bottom center;
  visibility: hidden;
  z-index: 0;
  transform-origin: left top;
  pointer-events: none;
  backface-visibility: hidden;
  will-change: transform;
  image-rendering: -webkit-optimize-contrast; /* ✅ 크롬용 */
  image-rendering: crisp-edges;               /* ✅ 선명도 향상 */
`;

        layerA.style.cssText = baseStyle;
        layerB.style.cssText = baseStyle;

        container.appendChild(layerA);
        container.appendChild(layerB);

        let front = layerA;
        let back = layerB;
        let idx = 0;
        let timer = null;
        let isRunning = true;

        const applyTransform = (img, url) => {
            const { x, y, s } = OFFSETS[url] || { x: 0, y: 0, s: 1 };
            const slimX = 0.9; // 가로 비율 (1보다 작으면 날씬)
            img.style.transform = `translateX(-50%) translate(${x}px, ${y}px) scale(${slimX}, ${s})`;
        };

        const preload = (url) =>
            new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = resolve;
                img.src = url;
            });

        const prepareNext = async (nextUrl) => {
            await preload(nextUrl);
            if (!isRunning) return;
            back.src = nextUrl;
            applyTransform(back, nextUrl);
        };

        const swapNow = () => {
            if (!isRunning) return;

            // 1️⃣ back 먼저 보이게 (즉시)
            back.style.visibility = "visible";
            back.style.zIndex = 1;

            // 2️⃣ 다음 프레임에서 front를 끔 (한 프레임 겹침)
            requestAnimationFrame(() => {
                front.style.visibility = "hidden";
                front.style.zIndex = 0;

                // 포인터 스왑
                const temp = front;
                front = back;
                back = temp;
            });
        };

        const scheduleNext = async () => {
            const curUrl = URLS[idx];
            const duration = DURATIONS[curUrl] || 1500;
            await new Promise((r) => (timer = setTimeout(r, duration)));
            if (!isRunning) return;

            idx = (idx + 1) % URLS.length;
            await prepareNext(URLS[idx]);
            swapNow();
            scheduleNext();
        };

        const init = async () => {
            await Promise.all(URLS.map(preload));
            front.src = URLS[0];
            applyTransform(front, URLS[0]);
            front.style.visibility = "visible";
            await prepareNext(URLS[1]);
            scheduleNext();
        };

        init();

        return () => {
            isRunning = false;
            clearTimeout(timer);
            try {
                container.removeChild(layerA);
                container.removeChild(layerB);
            } catch { }
            mountedRef.current = false;
            console.log("🛑 아바타 플레이어 정리 완료");
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="avatar-player"
            style={{
                position: "relative",
                width: "570px",
                height: "1250px",
                overflow: "visible",
                transform: "translateZ(0)",
                pointerEvents: "none",
            }}
        />
    );
}
