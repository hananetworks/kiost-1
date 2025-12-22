import React, { useState, useEffect } from 'react';
import * as Hangul from 'hangul-js'; // npm install hangul-js 필수
import '../../styles/VirtualKeyboard.css';

// --- 키 레이아웃 데이터 (이전과 동일) ---
const KEYS = {
    row1: [
        { normal: '`', shift: '~' }, { normal: '1', shift: '!' }, { normal: '2', shift: '@' },
        { normal: '3', shift: '#' }, { normal: '4', shift: '$' }, { normal: '5', shift: '%' },
        { normal: '6', shift: '^' }, { normal: '7', shift: '&' }, { normal: '8', shift: '*' },
        { normal: '9', shift: '(' }, { normal: '0', shift: ')' }, { normal: '-', shift: '_' },
        { normal: '=', shift: '+' }, { label: '⌫', type: 'backspace', className: 'back-space-key' }
    ],
    row2: [
        { label: 'Tab', type: 'tab', className: 'tab-key' },
        { en: 'q', enS: 'Q', ko: 'ㅂ', koS: 'ㅃ' }, { en: 'w', enS: 'W', ko: 'ㅈ', koS: 'ㅉ' },
        { en: 'e', enS: 'E', ko: 'ㄷ', koS: 'ㄸ' }, { en: 'r', enS: 'R', ko: 'ㄱ', koS: 'ㄲ' },
        { en: 't', enS: 'T', ko: 'ㅅ', koS: 'ㅆ' }, { en: 'y', enS: 'Y', ko: 'ㅛ', koS: 'ㅛ' },
        { en: 'u', enS: 'U', ko: 'ㅕ', koS: 'ㅕ' }, { en: 'i', enS: 'I', ko: 'ㅑ', koS: 'ㅑ' },
        { en: 'o', enS: 'O', ko: 'ㅐ', koS: 'ㅒ' }, { en: 'p', enS: 'P', ko: 'ㅔ', koS: 'ㅖ' },
        { normal: '[', shift: '{' }, { normal: ']', shift: '}' }, { normal: '\\', shift: '|', className: 'back-slash-key' }
    ],
    row3: [
        { label: 'Caps', type: 'caps', className: 'caps-lock-key' },
        { en: 'a', enS: 'A', ko: 'ㅁ', koS: 'ㅁ' }, { en: 's', enS: 'S', ko: 'ㄴ', koS: 'ㄴ' },
        { en: 'd', enS: 'D', ko: 'ㅇ', koS: 'ㅇ' }, { en: 'f', enS: 'F', ko: 'ㄹ', koS: 'ㄹ' },
        { en: 'g', enS: 'G', ko: 'ㅎ', koS: 'ㅎ' }, { en: 'h', enS: 'H', ko: 'ㅗ', koS: 'ㅗ' },
        { en: 'j', enS: 'J', ko: 'ㅓ', koS: 'ㅓ' }, { en: 'k', enS: 'K', ko: 'ㅏ', koS: 'ㅏ' },
        { en: 'l', enS: 'L', ko: 'ㅣ', koS: 'ㅣ' }, { normal: ';', shift: ':' }, { normal: "'", shift: '"' },
        { label: 'Enter', type: 'enter', className: 'enter-key' }
    ],
    row4: [
        { label: 'Shift', type: 'shift', className: 'left-shift-key' },
        { en: 'z', enS: 'Z', ko: 'ㅋ', koS: 'ㅋ' }, { en: 'x', enS: 'X', ko: 'ㅌ', koS: 'ㅌ' },
        { en: 'c', enS: 'C', ko: 'ㅊ', koS: 'ㅊ' }, { en: 'v', enS: 'V', ko: 'ㅍ', koS: 'ㅍ' },
        { en: 'b', enS: 'B', ko: 'ㅠ', koS: 'ㅠ' }, { en: 'n', enS: 'N', ko: 'ㅜ', koS: 'ㅜ' },
        { en: 'm', enS: 'M', ko: 'ㅡ', koS: 'ㅡ' }, { normal: ',', shift: '<' }, { normal: '.', shift: '>' },
        { normal: '/', shift: '?' }, { label: 'Shift', type: 'shift', className: 'right-shift-key' }
    ],
    row5: [
        { label: 'Ctrl', type: 'ctrl', className: 'fn-key' },
        { label: 'Alt', className: 'fn-key' },
        { label: 'Space', type: 'space', className: 'space-key' },
        { label: '한/영', type: 'lang', className: 'fn-key' },
        { label: 'Ctrl', type: 'ctrl', className: 'fn-key' },
    ]
};

const VirtualKeyboard = () => {
    // 모든 입력값(자모음 포함)을 담는 배열 (Source of Truth)
    const [buffer, setBuffer] = useState([]);

    // 상태 관리
    const [isShift, setIsShift] = useState(false);
    const [isCtrl, setIsCtrl] = useState(false); // Ctrl 상태 추가
    const [isCaps, setIsCaps] = useState(false);
    const [isKorean, setIsKorean] = useState(false);

    // ✅ 핵심: buffer가 바뀔 때마다 한글을 조립해서 보여줄 값 계산
    // Hangul.assemble은 ['ㄱ', 'ㅏ'] -> "가" 로 만들어줌 (영어도 그대로 합쳐줌)
    const displayValue = Hangul.assemble(buffer);

    // --- 키 입력 핸들러 ---
    const handleKeyClick = (key) => {
        // 1. 특수 기능 키 처리
        if (key.type === 'backspace') {
            setBuffer(prev => prev.slice(0, -1)); // 뒤에서 하나 삭제
            return;
        }
        if (key.type === 'space') {
            handleInput(" ");
            return;
        }
        if (key.type === 'enter') {
            handleInput("\n");
            return;
        }
        if (key.type === 'tab') {
            handleInput("\t");
            return;
        }
        if (key.type === 'shift') {
            setIsShift(!isShift); // 토글 (누르면 켜지고, 다시 누르면 꺼짐)
            return;
        }
        if (key.type === 'ctrl') {
            setIsCtrl(!isCtrl); // Ctrl 토글
            return;
        }
        if (key.type === 'caps') {
            setIsCaps(!isCaps); // Caps Lock은 영구 토글 (자동해제 안함)
            return;
        }
        if (key.type === 'lang') {
            setIsKorean(!isKorean);
            return;
        }

        // 2. 일반 문자 입력 처리
        let charToAdd = "";

        // 숫자/특수문자 라인
        if (key.normal) {
            charToAdd = isShift ? key.shift : key.normal;
        }
        // 문자 라인
        else if (key.en) {
            if (isKorean) {
                // 한글 모드 (Shift 있으면 쌍자음)
                charToAdd = isShift ? key.koS : key.ko;
            } else {
                // 영어 모드 (Shift or Caps)
                // Caps와 Shift가 다를 때 대문자 (XOR 로직)
                const isUpper = isShift !== isCaps;
                charToAdd = isUpper ? key.enS : key.en;
            }
        }

        // 3. 입력 실행 및 상태 초기화
        if (charToAdd) {
            handleInput(charToAdd);
        }
    };

    // --- 입력 공통 함수 ---
    const handleInput = (char) => {
        // 버퍼에 글자 추가
        setBuffer(prev => [...prev, char]);

        // ✅ [요청사항] Shift와 Ctrl은 한 번 입력하면 풀려야 함
        if (isShift) setIsShift(false);
        if (isCtrl) setIsCtrl(false);
    };

    // --- 키 렌더링 헬퍼 ---
    const renderKey = (key, index) => {
        let displayMain = "";
        let displaySub = "";

        if (key.label) displayMain = key.label;
        else if (key.en) {
            if (isKorean) {
                displayMain = isShift ? key.koS : key.ko;
                displaySub = isShift ? key.enS : key.en;
            } else {
                const showUpper = isShift || isCaps;
                displayMain = showUpper ? key.enS : key.en;
            }
        }
        else if (key.normal) {
            displayMain = isShift ? key.shift : key.normal;
            displaySub = isShift ? key.normal : key.shift;
        }

        // 활성화 클래스 (색상 변경용)
        let activeClass = "";
        if (key.type === 'caps' && isCaps) activeClass = "active";
        if (key.type === 'shift' && isShift) activeClass = "active";
        if (key.type === 'ctrl' && isCtrl) activeClass = "active"; // Ctrl 활성화 표시
        if (key.type === 'lang' && isKorean) activeClass = "active-lang";

        return (
            <div
                key={index}
                className={`key ${key.className || ''} ${activeClass}`}
                onClick={() => handleKeyClick(key)}
            >
                {displaySub && !key.label && <span className="two-value" style={{fontSize:'12px', color:'#777'}}>{displaySub}</span>}
                <span className={displaySub ? "two-value" : ""}>{displayMain}</span>
            </div>
        );
    };

    return (
        <div className="keyboard-container">
            {/* 입력창 */}
            <div className="input-group">
                <input
                    className="input-display"
                    type="text"
                    value={displayValue} // ✅ 여기가 핵심: 조립된 결과를 보여줌
                    readOnly
                    placeholder="터치하여 입력하세요"
                />
            </div>

            <div className="keyboard">
                <div className="row">{KEYS.row1.map(renderKey)}</div>
                <div className="row">{KEYS.row2.map(renderKey)}</div>
                <div className="row">{KEYS.row3.map(renderKey)}</div>
                <div className="row">{KEYS.row4.map(renderKey)}</div>
                <div className="row">{KEYS.row5.map(renderKey)}</div>
            </div>
        </div>
    );
};

export default VirtualKeyboard;