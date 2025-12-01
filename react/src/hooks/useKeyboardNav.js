import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 방향키 입력을 받아 포커스를 이동시키는 헬퍼 함수
 * (Hook 외부에 선언하여 불필요한 재생성 방지)
 */
function handleFocusNavigation(key) {
    // 1. 포커스 가능한 요소 선택 (tabindex -1 제외)
    const focusableSelector = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const focusableElements = Array.from(document.querySelectorAll(focusableSelector))
        // 화면에 보이고(offsetParent !== null), 비활성화되지 않은(!disabled) 요소만 필터링
        .filter(el => el.offsetParent !== null && !el.disabled);

    if (focusableElements.length === 0) return; // 포커스할 요소가 없으면 종료

    // 2. 현재 포커스된 요소의 인덱스 찾기
    const currentFocusedIndex = focusableElements.findIndex(
        (elem) => elem === document.activeElement
    );

    let nextIndex = 0;

    // 3. 다음 인덱스 계산
    if (currentFocusedIndex === -1) {
        // 현재 아무것도 포커스되어 있지 않다면 첫 번째 요소로
        nextIndex = 0;
    } else {
        if (key === 'ArrowDown' || key === 'ArrowRight') {
            // 다음 요소 (순환)
            nextIndex = (currentFocusedIndex + 1) % focusableElements.length;
        } else if (key === 'ArrowUp' || key === 'ArrowLeft') {
            // 이전 요소 (순환)
            nextIndex = (currentFocusedIndex - 1 + focusableElements.length) % focusableElements.length;
        }
    }

    // 4. 포커스 이동
    focusableElements[nextIndex]?.focus();
}

export function useKeyboardNav() {
    const navigate = useNavigate();

    useEffect(() => {
        const handleKey = (event) => {
            switch (event.key) {
                // 1. 페이지 이동 기능
                case 'Home':
                    console.log("ACTION: 메인 화면으로 이동 (/)");
                    navigate('/');
                    break;
                case 'Escape':
                    console.log("ACTION: 이전 화면으로 이동 (-1)");
                    navigate(-1);
                    break;

                // 2. 방향키 포커스 이동 기능
                case 'ArrowUp':
                case 'ArrowDown':
                case 'ArrowLeft':
                case 'ArrowRight':
                    event.preventDefault(); // 스크롤 방지
                    handleFocusNavigation(event.key);
                    break;

                // 3. 선택(클릭) 기능
                case 'Enter':
                case ' ': // 스페이스바
                    event.preventDefault(); // 스크롤 방지
                    // 현재 포커스된 요소가 있고 클릭 가능하다면 클릭 실행
                    if (document.activeElement && typeof document.activeElement.click === 'function') {
                        document.activeElement.click();
                    }
                    break;

                default:
                    break;
            }
        };

        // 리스너 등록
        document.addEventListener('keydown', handleKey);
        console.log("⌨️ Keyboard Navigation Hook attached.");

        // 컴포넌트 언마운트 시 리스너 제거 (Cleanup)
        return () => {
            document.removeEventListener('keydown', handleKey);
            console.log("⌨️ Keyboard Navigation Hook detached.");
        };
    }, [navigate]); // navigate가 변경될 때(사실상 거의 없음) 리스너 재등록
}