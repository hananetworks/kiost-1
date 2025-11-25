const { app } = require('electron');
const { exec } = require('child_process');
const si = require('systeminformation'); // 하드웨어 정보 (npm install systeminformation)
const loudness = require('loudness');    // 볼륨 제어 (npm install loudness)

// 프린터 모듈 (가정: 실제 영수증 프린터 로직이 있는 서비스)
// const printerService = require('../kiosk/printerService');

class CommandHandler {

    // 1. 메인 분기 처리
    async execute(action, payload) {
        console.log(`[Remote] 명령 수신: ${action}`, payload);

        try {
            switch (action) {
                // --- 전원/프로그램 관리 ---
                case 'OS_REBOOT':     return this.rebootOS();
                case 'APP_EXIT':      return this.exitApp();
                case 'APP_RESTART':   return this.restartApp();

                // --- 음량 제어 ---
                case 'VOLUME_CONTROL': return await this.controlVolume(payload);

                // --- 기기 상태 확인 ---
                case 'STATUS_CHECK':  return await this.checkStatus();

                // --- 출력 제어 (재발행) ---
                case 'PRINT_REPRINT': return await this.reprintReceipt(payload);

                default:
                    throw new Error(`알 수 없는 명령 코드: ${action}`);
            }
        } catch (error) {
            console.error(`[Remote] 오류 발생: ${error.message}`);
            return { success: false, message: error.message }; // 기획서의 '결과메시지'로 사용됨
        }
    }

    // ---------------------------------------------------------

    
    rebootOS() {
        // 윈도우 재부팅 명령
        exec('shutdown /r /f /t 0');
        return { success: true, message: '정상적으로 재부팅 명령이 전달되었습니다.' };
    }

    //  프로그램 종료
    exitApp() {
        setTimeout(() => app.quit(), 500); // 응답 보낼 시간 확보 후 종료
        return { success: true, message: '프로그램을 종료합니다.' };
    }

    // 프로그램 재시작
    restartApp() {
        app.relaunch();
        app.exit(0);
        return { success: true, message: '프로그램을 재시작합니다.' };
    }

    // 음량 제어
    async controlVolume({ volume, mute }) {
        // 기획서에 '음소거'와 '볼륨조절'이 있음
        if (mute !== undefined) {
            await loudness.setMuted(mute === 'ON'); // 기획서 UI가 ON/OFF 문자열이라면 변환 필요
        }
        if (volume !== undefined) {
            await loudness.setVolume(parseInt(volume));
        }
        return { success: true, message: '음량 설정이 성공적으로 적용되었습니다.' }; // [cite: 784]
    }

    //  기기 상태 확인
    async checkStatus() {
        const [cpu, mem, disk, net, display] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.fsSize(),
            si.networkInterfaces(),
            si.graphics()
        ]);

        const mainDisk = disk.length > 0 ? disk[0] : { use: 0 };
        const mainNet = net.find(iface => !iface.internal && iface.ip4) || net[0];

        // UI 항목 매핑
        const data = {
            network: {
                ip: mainNet.ip4,
                status: '연결됨' // 실제 인터넷 체크 로직 필요 (fetch google.com 등)
            },
            program: {
                status: '실행 중', // 현재 응답 중이므로 실행 중
                version: app.getVersion() // v1.3.7 포맷
            },
            hardware: {
                cpu: Math.round(cpu.currentLoad) + '%',
                memory: Math.round((mem.active / mem.total) * 100) + '%',
                disk: Math.round(mainDisk.use) + 'GB'
            },
            display: {
                brightness: '85%', // *주의: 하드웨어 제어 없이 알기 어려움 (더미 혹은 별도 툴 필요)
                power: 'ON'
            }
        };

        return { success: true, data: data };
    }

    //출력 제어 (재발행)
    async reprintReceipt(payload) {
        const { orderId, receiptData } = payload;

        if (!orderId) throw new Error('주문 번호가 없습니다.');

        // TODO: 실제 프린터 서비스 호출
        // await printerService.print(receiptData);

        console.log(`주문번호 ${orderId} 재발행 요청 처리됨`);
        return { success: true, message: '재발행 요청이 프린터로 전송되었습니다.' };
    }
}

module.exports = new CommandHandler();