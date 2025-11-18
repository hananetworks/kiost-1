// printService.js

const { SerialPort } = require('serialport');
const iconv = require('iconv-lite');

const PRINTER_PORT = 'COM4'; // 키오스크 프린터 포트
const LINE_WIDTH = 40; // 영수증 용지 너비

/**
 * 문자열의 실제 디스플레이 너비(한글 2, 영어 1)를 계산합니다.
 */
function getDisplayWidth(text) {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        width += (charCode > 127) ? 2 : 1;
    }
    return width;
}

/**
 * 디스플레이 너비(LINE_WIDTH)를 기준으로 텍스트를 줄바꿈합니다.
 * 긴 영단어나 한글이 잘리지 않도록 처리합니다.
 */
function wrapText(text, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');

    paragraphs.forEach(paragraph => {
        let currentLine = '';
        const words = paragraph.split(' ');

        words.forEach(word => {
            const wordWidth = getDisplayWidth(word);
            let lineCandidateWidth = getDisplayWidth(currentLine);
            let potentialLineWidth = lineCandidateWidth + (currentLine.length > 0 ? 1 : 0) + wordWidth;

            if (potentialLineWidth <= maxWidth) {
                currentLine += (currentLine.length > 0 ? ' ' : '') + word;
            } else {
                if (currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = '';
                }

                let remainingWord = word;
                while (getDisplayWidth(remainingWord) > maxWidth) {
                    let cutPoint = 0;
                    let currentWidth = 0;
                    for (let i = 0; i < remainingWord.length; i++) {
                        const char = remainingWord[i];
                        const charWidth = getDisplayWidth(char);
                        if (currentWidth + charWidth <= maxWidth) {
                            currentWidth += charWidth;
                            cutPoint = i + 1;
                        } else {
                            break;
                        }
                    }
                    lines.push(remainingWord.substring(0, cutPoint));
                    remainingWord = remainingWord.substring(cutPoint);
                }
                currentLine = remainingWord;
            }
        });

        if (currentLine.length > 0) {
            lines.push(currentLine);
        }
    });
    return lines;
}

/**
 * 명령어 버퍼 배열을 포트를 통해 순차적으로 전송하는 헬퍼 함수
 */
function writeChain(port, buffers, resolve, reject, initialMessage) {
    if (buffers.length === 0) {
        console.log(initialMessage || 'Print data sent successfully.');
        resolve({ success: true });
        port.close();
        return;
    }

    const nextBuffer = buffers.shift();
    port.write(nextBuffer.buffer, (err) => {
        if (err) {
            return rejectAndClose(port, `Failed to write command: ${nextBuffer.name}`, reject, err);
        }
        port.drain(() => {
            writeChain(port, buffers, resolve, reject, initialMessage);
        });
    });
}

/**
 * AI 대화 내용을 받아 실제 영수증 프린터로 출력하는 메인 함수
 * @param {string} contentToPrint - AI가 생성한 답변 텍스트
 */
function printContent(contentToPrint) {
    return new Promise((resolve, reject) => {

        // 1. 박스 내용 생성 (가변 높이)
        const contentWidth = LINE_WIDTH - 4; // "| "와 " |" 제외한 내용 너비
        const wrappedLines = wrapText(contentToPrint, contentWidth);

        // 텍스트 내용 줄을 박스 안에 채우는 형식으로 변환 (좌측 정렬)
        const formattedLines = wrappedLines.map(line => {
            const displayLength = getDisplayWidth(line);
            const paddingNeeded = contentWidth - displayLength;
            const padding = " ".repeat(paddingNeeded > 0 ? paddingNeeded : 0);
            return "| " + line + padding + " |";
        });

        // 최종 박스 텍스트 (내용 길이에 따라 세로 길이가 유연하게 늘어남)
        const topBottomBorder = "-".repeat(LINE_WIDTH);
        const boxedText =
            topBottomBorder + "\n" +
            formattedLines.join("\n") + "\n" +
            topBottomBorder + "\n";

        // 2. 명령어 버퍼 정의 및 설정
        const initPrinter = { name: "Init", buffer: Buffer.from([0x1B, 0x40]) };
        const setLineSpacing = { name: "SetLineSpacing", buffer: Buffer.from([0x1B, 0x33, 90]) }; // 줄 간격 90 dot
        const normalSize = { name: "NormalTextSize", buffer: Buffer.from([0x1D, 0x21, 0x00]) }; // 1배 크기
        const doubleSize = { name: "DoubleTextSize", buffer: Buffer.from([0x1D, 0x21, 1]) }; // 2배 크기
        const cutPaperCommand = { name: "CutPaper", buffer: Buffer.from([0x1D, 0x56, 0x01]) };
        const alignCenter = { name: "AlignCenter", buffer: Buffer.from([0x1B, 0x61, 0x01]) };
        const alignLeft = { name: "AlignLeft", buffer: Buffer.from([0x1B, 0x61, 0x00]) };
        const boldOn = { name: "BoldOn", buffer: Buffer.from([0x1B, 0x45, 0x01]) };
        const boldOff = { name: "BoldOff", buffer: Buffer.from([0x1B, 0x45, 0x00]) };

        // 출력 데이터 인코딩 (EUC-KR/CP949)
        const headerText = "\n*** 하나 AI 답변 ***\n";
        const footerText = "\n이용해 주셔서 감사합니다.\n\n\n";

        const encodedHeader = { name: "HeaderData", buffer: iconv.encode(headerText, 'cp949') };
        const encodedBoxedText = { name: "BoxData", buffer: iconv.encode(boxedText, 'cp949') };
        const encodedFooter = { name: "FooterData", buffer: iconv.encode(footerText, 'cp949') };

        // 3. 포트 열기
        const port = new SerialPort({
            path: PRINTER_PORT,
            baudRate: 115200,
        }, (err) => {
            if (err) {
                console.error(`Error: Could not open port ${PRINTER_PORT}:`, err.message);
                return reject({ success: false, error: `Could not open port ${PRINTER_PORT}` });
            }
        });

        port.on('open', () => {
            console.log(`Port ${PRINTER_PORT} opened for printing.`);

            // 4. 명령어 전송 순서 정의
            const commands = [
                initPrinter,
                setLineSpacing,
                // 헤더 (중앙, 2배, 볼드)
                alignCenter,
                doubleSize,
                boldOn,
                encodedHeader,
                boldOff,
                // 본문 박스 (중앙, 2배)
                alignCenter,
                doubleSize,
                encodedBoxedText,
                // 푸터 (중앙, 1배, 볼드)
                normalSize,
                alignCenter,
                boldOn,
                encodedFooter,
                boldOff,
                // 자르기
                cutPaperCommand
            ];

            // 5. 명령어 순차 전송
            writeChain(port, commands, resolve, reject, 'Print data sent successfully.');
        });

        port.on('error', (err) => {
            console.error('Port Error:', err.message);
            reject({ success: false, error: `Port error: ${err.message}` });
        });
    });
}

/**
 * 오류 발생 시 포트를 닫고 Promise를 reject하는 헬퍼 함수
 */
function rejectAndClose(port, message, reject, err) {
    console.error(`Error: ${message}`, err ? err.message : '');
    reject({ success: false, error: message });
    if(port && port.isOpen) {
        port.close((closeErr) => {
            if(closeErr) console.error('Error closing port after error:', closeErr.message);
        });
    }
}

module.exports = { printContent };