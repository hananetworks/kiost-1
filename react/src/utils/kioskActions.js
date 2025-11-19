/**
 * main/utils/kioskActions.js
 * 키오스크의 핵심 동작을 정의하는 파일입니다.
 */

export const goToMainScreen = (navigate) => {
    console.log("ACTION: 메인 화면으로 이동 (/)");
    navigate("/");
};

export const goBack = (navigate) => {
    console.log("ACTION: 이전 화면으로 이동 (-1)");
    navigate(-1);
};