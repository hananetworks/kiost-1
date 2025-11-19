// 📁 bootstrap.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// ✅ 로그 파일 경로 선언 먼저
const desktopPath = path.join(os.homedir(), 'Desktop');
const logFilePath = path.join(desktopPath, 'electron_runtime.log');

// ✅ 로그 기록 함수 정의
function appendLog(content) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFilePath, `[${timestamp}] ${content}\n`, 'utf8');
}

// ✅ console.log / console.error 재정의
console.log = (...args) => {
  appendLog('[LOG] ' + args.join(' '));
  process.stdout.write(args.join(' ') + '\n');
};

console.error = (...args) => {
  appendLog('[ERROR] ' + args.join(' '));
  process.stderr.write(args.join(' ') + '\n');
};

// ✅ 예외/비동기 오류 로그
process.on('uncaughtException', (err) => {
  appendLog('[UNCAUGHT EXCEPTION] ' + (err.stack || err.message));
});

process.on('unhandledRejection', (reason, promise) => {
  appendLog('[UNHANDLED REJECTION] ' + (reason.stack || reason));
});

console.log('ABI Version:', process.versions.modules);
console.log('Electron Version:', process.versions.electron);
console.log('Node Version:', process.versions.node);

// ✅ 최초 실행 로그
appendLog('🚀 Electron 부트스트랩 시작됨');

// ✅ main.js 실행
require('./electron/src/main.js');
