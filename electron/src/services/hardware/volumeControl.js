// electron/src/services/hardware/volumeControl.js
const loudness = require('loudness');

async function setVolume(level) {
    console.log(`[Volume Debug] setVolume 호출됨: ${level}`); // 👈 로그 추가
    try {
        // 소수점 제거 (loudness는 정수만 받음)
        const intLevel = Math.round(level);
        await loudness.setVolume(intLevel);
        console.log(`[Volume Debug] 볼륨 변경 성공 -> ${intLevel}`);
        return true;
    } catch (error) {
        console.error('[Volume Debug] ❌ 볼륨 변경 실패 에러:', error);
        return false;
    }
}

async function getVolume() {
    try {
        const vol = await loudness.getVolume();
        console.log(`[Volume Debug] 현재 볼륨 가져옴: ${vol}`);
        return vol;
    } catch (error) {
        console.error('[Volume Debug] ❌ 볼륨 가져오기 실패:', error);
        return 50;
    }
}

module.exports = { setVolume, getVolume };