const { ipcMain } = require('electron');
const remoteCommandHandler = require('../services/remote/commandHandler');

module.exports = function registerRemoteHandlers() {
    ipcMain.handle('execute-remote-command', async (event, { action, payload }) => {
        console.log(`🔥 [Main Process] IPC 요청 받음! Action: ${action}`);
        try {
            const result = await remoteCommandHandler.execute(action, payload);
            console.log(`✅ [Main Process] 실행 완료. 결과:`, result);
            return result;
        } catch (err) {
            console.error(`❌ [Main Process] 실행 중 에러:`, err);
            return { success: false, message: err.message };
        }
    });
};