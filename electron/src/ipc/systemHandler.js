const { ipcMain } = require('electron');
const volumeControl = require('../services/hardware/volumeControl');
const { printContent } = require('../services/hardware/printService.js');
const { setInactivityStatus } = require('../updater/updateManager');

module.exports = function registerSystemHandlers() {

    // 볼륨 제어
    ipcMain.handle('set-system-volume', async (event, volume) => {
        return await volumeControl.setVolume(volume);
    });

    ipcMain.handle('get-system-volume', async () => {
        return await volumeControl.getVolume();
    });

    // 프린트
    ipcMain.handle('print:content', async (event, htmlContent) => {
        try {
            await printContent(htmlContent);
            return { success: true };
        } catch (error) {
            console.error('인쇄 처리 중 오류:', error);
            return { success: false, error: '인쇄 중 오류가 발생했습니다.' };
        }
    });

    // 업데이트용 유휴 상태 전송
    ipcMain.on('app:inactivity-status', (event, status) => {
        setInactivityStatus(status);
    });
};