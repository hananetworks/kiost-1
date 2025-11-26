import React, { useState, useEffect } from 'react';

const BrightnessOverlay = () => {
    const [brightness, setBrightness] = useState(100);

    useEffect(() => {
        const handleBrightnessChange = (event) => {
            setBrightness(event.detail);
        };

        window.addEventListener('CHANGE_BRIGHTNESS', handleBrightnessChange);
        return () => {
            window.removeEventListener('CHANGE_BRIGHTNESS', handleBrightnessChange);
        };
    }, []);

    // 밝기 100 = 투명도 0, 밝기 0 = 투명도 1
    const opacity = 1 - (brightness / 100);

    // 밝기가 100일 때는 굳이 렌더링하지 않음 (성능 최적화)
    if (brightness >= 100) return null;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                backgroundColor: 'black',
                opacity: opacity,
                zIndex: 99999,          // 최상단
                pointerEvents: 'none',  // 클릭 통과
                transition: 'opacity 0.3s ease'
            }}
        />
    );
};

export default BrightnessOverlay;