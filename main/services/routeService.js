// routeService.js (카카오 API 호출)
const axios = require('axios');

const KAKAO_DIRECTIONS_URL = 'https://apis-navi.kakaomobility.com/v1/directions';

// 키오스크의 기본 위치 (천안시청)
const KIOSK_LOCATION_NAME = "천안시청";
const KIOSK_COORDINATES = { x: '127.1149', y: '36.8148' }; // (경도, 위도)

// --- 1. 장소 좌표 데이터 (미리 정규화된 Key 사용) ---
// Key: 공백, '와', '과'를 모두 제거한 한글 및 영문 별칭
const locations = {
    // 8경
    '독립기념관': { x: '127.2847', y: '36.7835' },
    'independencehall': { x: '127.2847', y: '36.7835' },
    '유관순열사사적지': { x: '127.2333', y: '36.8953' },
    'yugwansunshrine': { x: '127.2333', y: '36.8953' },
    'yugwansunsinsite': { x: '127.2333', y: '36.8953' },
    '천안삼거리공원': { x: '127.1593', y: '36.7971' },
    'cheonansamgeoripark': { x: '127.1593', y: '36.7971' },
    '태조산왕건길청동대좌불': { x: '127.1843', y: '36.8157' },
    'taejosanwanggeongil': { x: '127.1843', y: '36.8157' },
    'taejosan': { x: '127.1843', y: '36.8157' },
    '각원사': { x: '127.1843', y: '36.8157' },
    'gakwonsatemple': { x: '127.1843', y: '36.8157' },
    'gakwonsa': { x: '127.1843', y: '36.8157' },
    '아라리오조각광장': { x: '127.1554', y: '36.8191' },
    'arariogallery': { x: '127.1554', y: '36.8191' },
    'arariosculpturepark': { x: '127.1554', y: '36.8191' },
    '성성호수공원': { x: '127.1430', y: '36.8400' },
    'sseongseonglakepark': { x: '127.1430', y: '36.8400' },
    '광덕산': { x: '127.0850', y: '36.7094' },
    'gwangdeoksanmountain': { x: '127.0850', y: '36.7094' },
    'gwangdeoksan': { x: '127.0850', y: '36.7094' },
    '국보봉선홍경사갈기비': { x: '127.1328', y: '36.9031' },
    'bongseonhonggyeongsagalbibi': { x: '127.1328', y: '36.9031' },
    // 주요 위치
    '천안시청': { x: '127.1149', y: '36.8148' },
    'cheonancityhall': { x: '127.1149', y: '36.8148' },
    '천안역': { x: '127.1437', y: '36.8118' },
    'cheonanstation': { x: '127.1437', y: '36.8118' },
    '아산역': { x: '127.1105', y: '36.7915' },
    'asanstation': { x: '127.1105', y: '36.7915' },
    '천안아산역': { x: '127.1105', y: '36.7915' },
    'cheonanasanstation': { x: '127.1105', y: '36.7915' },
    '쌍용역': { x: '127.1232', y: '36.7947' },
    'ssangyongstation': { x: '127.1232', y: '36.7947' },
    '두정역': { x: '127.1439', y: '36.8285' },
    'dujeongstation': { x: '1D.1439', y: '36.8285' },
    '천안터미널': { x: '127.1554', y: '36.8191' },
    'cheonanbusterminal': { x: '127.1554', y: '36.8191' },
    'cheonanterminal': { x: '127.1554', y: '36.8191' },
    '신세계백화점': { x: '127.1554', y: '36.8191' },
    'shinsegaedepartmentstore': { x: '127.1554', y: '36.8191' },
};

/**
 * 장소 이름(STT 오타 포함 가능)을 받아 좌표 객체로 변환합니다.
 * @param {string} placeName - 사용자가 말한 장소 이름 (예: "천한역", "독립기념관")
 */
async function getCoordinatesForPlace(placeName) {
    console.log(`[Route Service] 좌표 변환 요청: ${placeName}`);

    // 1. 입력된 placeName을 정규화합니다. (공백, '와', '과' 제거)
    const searchKey = placeName.replace(/\s+/g, '').replace('와', '').replace('과', '');

    // 2. 정규화된 키로 'locations' 객체에서 정확히 일치하는지 확인
    if (locations[searchKey]) {
        console.log(`[Route Service] '정확 일치' 발견: ${searchKey}`);
        return locations[searchKey];
    }

    // 3. STT 오타 대비 '포함' 여부 검사 (예: "천안역에서"가 "천안역" 키를 포함)
    const locationKeys = Object.keys(locations);
    for (const key of locationKeys) {
        if (searchKey.includes(key)) {
            console.log(`[Route Service] '포함 일치' 발견: 입력('${searchKey}')이 키('${key}')를 포함합니다.`);
            return locations[key];
        }
    }

    // 4. 좌표 찾기 실패
    console.log(`[Route Service] [오류] 좌표를 찾지 못함: ${placeName} (정규화: ${searchKey})`);
    return null;
}

/**
 * 카카오 Directions API를 사용하여 '출발지 -> 목적지'의 단순 경로를 탐색합니다.
 * (AI의 functionExecutor.js에서 호출됨)
 */
async function plan_tourist_route({ destination, origin }) {

    if (!destination) {
        return JSON.stringify({ error: '경로를 탐색할 목적지를 알려주세요.' });
    }

    let startPlaceName = origin;
    let startCoord = null;
    const goalPlaceName = destination;

    // 출발지(origin) 결정 로직
    if (!origin || origin === "내 위치" || origin === "여기") {
        startPlaceName = KIOSK_LOCATION_NAME;
        startCoord = KIOSK_COORDINATES;
        console.log(`[Route Service] 출발지가 지정되지 않아 키오스크 위치(${startPlaceName})를 사용합니다.`);
    } else {
        // 사용자가 명확한 출발지(예: 천안역)를 말한 경우
        console.log(`[Route Service] 지정된 출발지(${startPlaceName})의 좌표를 검색합니다.`);
        startCoord = await getCoordinatesForPlace(startPlaceName);
    }

    try {
        // --- 1. 좌표 준비 ---
        const goalCoord = await getCoordinatesForPlace(goalPlaceName);

        if (!startCoord) {
            return JSON.stringify({ error: `죄송합니다. 출발지 '${startPlaceName}'의 정확한 좌표를 알 수 없어 경로 탐색을 시작할 수 없습니다.` });
        }
        if (!goalCoord) {
            return JSON.stringify({ error: `죄송합니다. 목적지 '${goalPlaceName}'의 정확한 좌표를 알 수 없어 경로 탐색을 시작할 수 없습니다.` });
        }

        // --- 2. 카카오 API 요청 ---
        const requestConfig = {
            method: 'GET',
            url: KAKAO_DIRECTIONS_URL,
            params: {
                origin: `${startCoord.x},${startCoord.y}`,
                destination: `${goalCoord.x},${goalCoord.y}`,
                priority: 'RECOMMEND', // 추천 경로
            },
            headers: {
                'Authorization': `KakaoAK ${process.env.KAKAO_REST_API_KEY}`,
            }
        };

        console.log(`[Kakao API] 요청 시작: ${startPlaceName} -> ${goalPlaceName}`);
        const response = await axios(requestConfig);

        // --- 3. 결과 파싱 ---
        const route = response.data.routes[0];
        if (!route) {
            throw new Error('카카오 API가 경로를 찾지 못했습니다.');
        }

        const summary = route.summary;
        const distance = summary.distance; // 미터
        const duration = summary.duration; // 초

        const durationInMinutes = Math.round(duration / 60);
        const distanceInKm = (distance / 1000).toFixed(1);

        // AI에게 반환될 JSON 문자열
        return JSON.stringify({
            totalDistanceInMeters: distance,
            totalDurationInSeconds: duration,
            optimizedRouteOrder: [startPlaceName, goalPlaceName],
            summary: `[${startPlaceName} 출발] ${goalPlaceName}까지 총 거리는 약 ${distanceInKm}km이며, 예상 소요 시간은 약 ${durationInMinutes}분입니다.`,
        });

    } catch (error) {
        console.error('경로 탐색 실패:', error.response ? error.response.data : error.message);
        return JSON.stringify({ error: '경로 탐색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
    }
}

module.exports = { plan_tourist_route };