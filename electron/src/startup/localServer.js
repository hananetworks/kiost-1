const express = require('express');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { log } = require('../logging/logger');

function startLocalServer() {
    // 패키징 상태가 아니면 서버 실행 안 함
    if (!app.isPackaged) return;

    const server = express();
    const distPath = path.join(app.getAppPath(), 'dist');

    if (!fs.existsSync(distPath)) {
        log.error(`[LocalServer] dist 디렉토리 없음: ${distPath}`);
        return;
    }

    server.use(express.static(distPath));
    server.get('/', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });

    const PORT = 3000;
    server.listen(PORT, 'localhost', () => {
        log.info(`✅ 로컬 서버 시작: http://localhost:${PORT}`);
    }).on('error', (err) => {
        log.error(`[LocalServer] 서버 시작 실패: ${err}`);
    });
}

module.exports = { startLocalServer };