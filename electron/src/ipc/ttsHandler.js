const { ipcMain } = require('electron');
const { log } = require('../logging/logger'); // 로거 경로가 맞는지 확인해주세요 (보통 ../../logging/logger)

module.exports = function registerTtsHandlers() {

    // [중요] React에서 'tts-request'라는 이름으로 호출해야 합니다.
    ipcMain.handle('tts-request', async (event, { text, lang }) => {
        log.info(`[TTS Handler] 요청 수신: "${text}" (언어: ${lang})`);

        try {
            // 1. Python API 서버로 HTTP POST 요청
            // (ipcManager.js에서 fetch를 전역으로 설정했으므로 바로 사용 가능)
            const response = await fetch('http://127.0.0.1:8000/synthesize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8' // ✅ 명시적 UTF-8 인코딩
                },
                body: JSON.stringify({
                    text: text,
                    lang: lang || 'ko' // 기본값 한국어
                })
            });

            // 2. 응답 데이터 받기 ({ ok: true, path: "...", url: "..." })
            const data = await response.json();

            if (!data.ok) {
                throw new Error(data.error || 'API Server Error');
            }

            log.info(`[TTS Handler] 생성 완료: ${data.path}`);

            // 3. React로 결과 반환
            return {
                ok: true,
                path: data.path,
                url: data.url
            };

        } catch (error) {
            log.error(`[TTS Handler] 생성 실패: ${error.message}`);

            // 서버가 꺼져있을 때 에러 처리
            if (error.code === 'ECONNREFUSED') {
                return { ok: false, error: 'AI 엔진이 아직 준비되지 않았습니다.' };
            }

            return { ok: false, error: error.message };
        }
    });
};