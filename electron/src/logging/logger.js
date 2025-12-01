const { app } = require('electron');
const log = require('electron-log');
const path = require('path');
const os = require('os');
const si = require('systeminformation');

let resourceLogInterval;

function initializeLogging() {
    // [수정됨] 기존에는 별도 폴더(MAXEE promotional)를 썼지만,
    // 이제는 앱 표준 데이터 폴더(userData) 내부의 logs 폴더로 통합합니다.
    // 결과 경로: C:\Users\[사용자]\AppData\Roaming\maxee-ticketing\logs\main.log
    const logDir = path.join(app.getPath('userData'), 'logs');

    // [설정] 파일 저장 경로 강제 지정
    log.transports.file.resolvePathFn = (variables) => {
        // variables.fileName이 없으면 기본값 main.log 사용
        return path.join(logDir, variables.fileName || 'main.log');
    };

    // 로그 형식
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

    // 로그 레벨
    log.transports.file.level = 'info';
    log.transports.console.level = 'debug';

    log.info(`[Logger] 로깅 모듈 초기화 완료. 저장 경로: ${logDir}`);
}

// 시스템 리소스(CPU/메모리) 로깅 함수
async function logSystemUsage() {
    try {
        const mem = await si.mem();
        const load = await si.currentLoad();
        const appMem = process.memoryUsage();

        log.info(`[Resource] AppMem(rss): ${(appMem.rss / 1024 / 1024).toFixed(2)} MB`);
        log.info(`[Resource] SysMem(used): ${(mem.active / 1024 / 1024).toFixed(2)} MB / ${(mem.total / 1024 / 1024).toFixed(2)} MB`);
        log.info(`[Resource] CPU(load): ${load.currentLoad.toFixed(2)}%`);

    } catch (e) {
        log.warn(`[Resource] 리소스 로깅 실패: ${e.message}`);
    }
}

// 5분마다 리소스 로깅 시작
function startResourceLogging() {
    log.info('[Logger] 시스템 리소스 로깅 시작 (5분 간격)');
    if (resourceLogInterval) clearInterval(resourceLogInterval);
    logSystemUsage(); // 즉시 1회 실행
    resourceLogInterval = setInterval(logSystemUsage, 300000); // 5분
}

module.exports = {
    log, // 다른 모듈에서 log.info() 등을 사용할 수 있게 export
    initializeLogging,
    startResourceLogging
};