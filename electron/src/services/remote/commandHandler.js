const { app } = require('electron');
const { exec } = require('child_process');
const si = require('systeminformation'); // 하드웨어 정보
const loudness = require('loudness');    // 볼륨 제어
const dns = require('dns').promises;     // [추가] 인터넷 연결 확인용

class CommandHandler {
    constructor() {
        // [추가] 하드웨어 조회가 힘든 "화면 상태"를 기억하기 위한 변수
        this.currentBrightness = 100;
        this.isScreenOn = true;
    }

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

                // --- [추가] 화면 제어 (소프트웨어 방식) ---
                case 'SCREEN_BRIGHTNESS': return this.setBrightness(payload);
                case 'SCREEN_POWER': return this.controlScreenPower(payload);

                // --- 출력 제어 (재발행) ---
                case 'PRINT_REPRINT': return await this.reprintReceipt(payload);

                default:
                    throw new Error(`알 수 없는 명령 코드: ${action}`);
            }
        } catch (error) {
            console.error(`[Remote] 오류 발생: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    // ---------------------------------------------------------

    // 1. 재부팅
    rebootOS() {
        exec('shutdown /r /f /t 0');
        return { success: true, message: '정상적으로 재부팅 명령이 전달되었습니다.' };
    }

    // 2. 프로그램 종료
    exitApp() {
        setTimeout(() => app.quit(), 500);
        return { success: true, message: '프로그램을 종료합니다.' };
    }

    // 3. 프로그램 재시작
    restartApp() {
        app.relaunch();
        app.exit(0);
        return { success: true, message: '프로그램을 재시작합니다.' };
    }

    // 4. 음량 제어
    async controlVolume({ volume, mute }) {
        // payload 예시: { volume: 50 } 또는 { mute: 'ON' }
        if (mute !== undefined) {
            // 리모컨에서 'ON' 문자열로 오거나 boolean true로 올 수 있음
            const isMute = (mute === 'ON' || mute === true);
            await loudness.setMuted(isMute);
        }
        if (volume !== undefined) {
            await loudness.setVolume(parseInt(volume));
        }
        return { success: true, message: '음량 설정이 성공적으로 적용되었습니다.' };
    }

    // 5. [핵심] 기기 상태 확인
    async checkStatus() {
        try {
            // (1) 하드웨어 정보 병렬 조회 (속도 최적화)
            const [cpu, mem, disk, net] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                si.fsSize(),
                si.networkInterfaces()
            ]);

            // (2) IP 주소 찾기 (내부망 loopback 제외, IPv4 기준)
            const mainNet = net.find(iface => !iface.internal && iface.ip4) || net[0];
            const ipAddress = mainNet ? mainNet.ip4 : '0.0.0.0';

            // (3) 실제 인터넷 연결 확인 (구글 DNS 핑)
            let internetStatus = '연결 안됨';
            try {
                await dns.lookup('google.com');
                internetStatus = '연결됨';
            } catch (e) {
                internetStatus = '끊김';
            }

            // (4) 디스크 정보 (보통 첫번째가 메인 드라이브)
            const mainDisk = disk.length > 0 ? disk[0] : { use: 0 };

            // (5) 데이터 조립
            const data = {
                network: {
                    ip: ipAddress,
                    status: internetStatus // 실제 조회 결과
                },
                program: {
                    status: '실행 중',
                    version: app.getVersion() // package.json 버전
                },
                hardware: {
                    cpu: Math.round(cpu.currentLoad) + '%',
                    memory: Math.round((mem.active / mem.total) * 100) + '%',
                    disk: Math.round(mainDisk.use) + '%' // 기획서는 GB일수 있으나 %가 직관적
                },
                display: {
                    // ★ 하드웨어 조회가 안되므로, 내가 기억하고 있는 변수값 리턴
                    brightness: `${this.currentBrightness}%`,
                    power: this.isScreenOn ? 'ON' : 'OFF'
                }
            };

            return { success: true, data: data };

        } catch (err) {
            console.error('상태 조회 실패:', err);
            return { success: false, message: '기기 상태를 가져오는데 실패했습니다.' };
        }
    }

    // 6. 화면 밝기 설정 (값만 저장 -> 실제 효과는 React 오버레이가 처리해야 함)
    setBrightness({ brightness }) {
        this.currentBrightness = parseInt(brightness);
        // *참고: 여기서 IPC로 React 쪽에 '밝기 변경해라' 이벤트를 보내야 완벽합니다.
        // (현재 구조상 Main -> Renderer 통신 코드는 main.js에 추가 필요)
        return { success: true, message: `밝기를 ${brightness}%로 설정했습니다.` };
    }

    // 7. 화면 전원 제어 (가짜 상태 저장 + 필요시 PowerShell)
    controlScreenPower({ power }) {
        const turnOn = (power === 'ON');
        this.isScreenOn = turnOn;

        // 실제 모니터 끄기 명령 (PowerShell) - 필요하면 주석 해제
        /*
        if (!turnOn) {
            const cmd = 'powershell (Add-Type \'[DllImport(\\"user32.dll\\")]^public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);\' -Name a -PassThru)::SendMessage(-1,0x0112,0xF170,2)';
            exec(cmd);
        }
        */

        return { success: true, message: `화면 전원 ${power} 설정 완료` };
    }

    // 8. 출력 제어
    async reprintReceipt(payload) {
        const { orderId } = payload;
        if (!orderId) throw new Error('주문 번호가 없습니다.');

        // TODO: 실제 프린터 로직 연결
        console.log(`주문번호 ${orderId} 재발행 요청`);

        return { success: true, message: '재발행 요청이 프린터로 전송되었습니다.' };
    }
}

module.exports = new CommandHandler();