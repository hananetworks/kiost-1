/**
 * main/utils/inputHandler.js
 * 외부 입력 장치(리모컨, 링크프리 등)의 입력을 감지하고 처리하는 파일입니다.
 */

import { goToMainScreen, goBack } from './kioskActions';

let navigateFunction = null;

/**
 * 방향키 입력을 받아 포커스를 이동시키는 함수
 * @param {string} key - 눌린 키 ('ArrowUp', 'ArrowDown' 등)
 */
function handleFocusNavigation(key) {
    // 1. 🔽 [수정] 버그 수정:
    // [tabindex] -> [tabindex]:not([tabindex="-1"])
    // (Tab 키처럼 -1은 건너뛰도록 수정)
    const focusableSelector = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const focusableElements = Array.from(document.querySelectorAll(focusableSelector))
        // [추가] 화면에 보이고, 비활성화되지 않은 요소만 필터링
        .filter(el => el.offsetParent !== null && !el.disabled);

    if (focusableElements.length === 0) return; // 포커스할 요소가 없으면 종료

    // 2. 현재 포커스된 요소의 인덱스를 찾습니다.
    const currentFocusedIndex = focusableElements.findIndex(
        (elem) => elem === document.activeElement
    );

    let nextIndex = 0;

    // 3. 다음에 포커스할 요소의 인덱스를 계산합니다.
    if (currentFocusedIndex === -1) {
        // 현재 아무것도 포커스되어 있지 않다면, 첫 번째 요소로 이동
        nextIndex = 0;
    } else {
        if (key === 'ArrowDown' || key === 'ArrowRight') {
            nextIndex = (currentFocusedIndex + 1) % focusableElements.length;
        } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
            nextIndex = (currentFocusedIndex - 1 + focusableElements.length) % focusableElements.length;
        }
    }

    // 4. 다음 요소에 포커스를 적용합니다.
    focusableElements[nextIndex]?.focus();
}


/**
 * 키보드 입력을 처리하는 메인 함수
 */
function handleRemoteInput(event) {
    // 🔽 [수정] navigateFunction이 없어도 방향키/Enter는 작동하도록 수정
    // if (!navigateFunction) return;

    // 눌린 키에 따라 적절한 동작을 실행합니다.
    switch (event.key) {
        // 기존 기능: 처음으로 / 이전으로
        case 'Home':
            if (navigateFunction) goToMainScreen(navigateFunction);
            break;
        case 'Escape':
            if (navigateFunction) goBack(navigateFunction);
            break;

        // ✅ 새로 추가된 기능: 방향키 포커스 이동
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
            event.preventDefault(); // 방향키로 인한 화면 스크롤 방지
            handleFocusNavigation(event.key);
            break;

        // ✅ 새로 추가된 기능: Enter 또는 Space로 클릭
        case 'Enter':
        case ' ': // 스페이스바
            event.preventDefault(); // 스페이스바로 인한 화면 스크롤 방지
            // 현재 포커스된 요소를 클릭 처리
            if (document.activeElement && typeof document.activeElement.click === 'function') {
                document.activeElement.click();
            }
            break;
    }
}


export function initializeInputHandler(navigate) {
    navigateFunction = navigate;
    document.removeEventListener('keydown', handleRemoteInput);
    document.addEventListener('keydown', handleRemoteInput);
    console.log("Input handler with arrow key navigation has been initialized (v1.1 - TabIndex Fixed).");
}