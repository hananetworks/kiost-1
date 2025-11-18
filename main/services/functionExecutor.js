// functionExecutor.js (plan_tourist_route 도구 정의 수정)

const { plan_tourist_route } = require('./routeService.js');
const { search_web_for_info } = require('./searchService.js');

const availableFunctions = {
    plan_tourist_route,
    search_web_for_info,
};

const availableTools = [
    {
        type: 'function',
        function: {
            name: 'plan_tourist_route',
            // 🔽 [수정 1] 설명 변경 (최적 경로/경유지 -> 단순 경로/목적지)
            description: '사용자가 요청한 출발지에서 목적지까지의 경로를 안내합니다. "A에서 B까지" 같은 질문에서 A는 출발지, B는 목적지입니다.', //
            parameters: {
                type: 'object',
                properties: {
                    // 🔽 [수정 2] 'waypoints' (배열) -> 'destination' (문자열)
                    destination: { //
                        type: 'string',
                        description: '방문할 최종 목적지 장소 이름. 예: "독립기념관"',
                    },
                    origin: {
                        type: 'string',
                        description: '경로 탐색의 출발지. 지정하지 않으면 현재 키오스크 위치(천안시청)가 기본값입니다.', //
                    },
                },
                // 🔽 [수정 3] 필수 매개변수 변경
                required: ['destination'], //
            },
        },
    },
    {
        type: 'function',
        function: {
            // 'search_web_for_info' 도구는 기존과 동일
            name: 'search_web_for_info',
            description: '내부 지식 기반(천안 8경)에 없는 최신 정보나 특정 주제에 대해 웹에서 정보를 검색합니다.', //
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: '웹에서 검색할 구체적인 질문 또는 키워드. 예: "천안 날씨"',
                    },
                },
                required: ['query'],
            },
        },
    },
];

async function executeFunction(functionCall) {
    const functionName = functionCall.name;
    const args = JSON.parse(functionCall.arguments);

    if (availableFunctions[functionName]) {
        // 수정된 routeService.js는 { destination, origin } 인자를 받습니다.
        const result = await availableFunctions[functionName](args);
        return result;
    } else {
        return JSON.stringify({ error: `알 수 없는 함수입니다: ${functionName}` });
    }
}

module.exports = {
    availableTools,
    executeFunction,
};