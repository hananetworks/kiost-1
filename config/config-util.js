const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join('C:', 'Users', 'USER', 'Settings', 'settings.json');

// 설정 파일을 로드하고 JSON으로 반환
function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    throw new Error(`설정 파일이 존재하지 않습니다: ${SETTINGS_PATH}`);
  }

  const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  return JSON.parse(content);
}

// 설정 파일이 없으면 생성
function ensureSettings(defaults = { serial: 'BXL1234567' }) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaults, null, 2));
  }
}

module.exports = {
  loadSettings,
  ensureSettings
};
