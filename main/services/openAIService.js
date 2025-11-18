// openAIService.js
const OpenAI = require('openai');
const { cheonanSights } = require('../config/knowledgeBase.js');
const { availableTools, executeFunction } = require('./functionExecutor.js');

let client = null;
const model = 'gpt-3.5-turbo-0125'; // 기본 응답 모델
const correctionModel = 'gpt-4-turbo'; // STT 교정용 모델

// 프롬프트에 주입할 고유명사 리스트
const sightListForPrompt = "제1경 독립기념관, 제2경 유관순열사 사적지, 제3경 천안삼거리공원, 제4경 태조산 왕건길과 청동대좌불, 제5경 아라리오조각광장, 제6경 성성호수공원, 제7경 광덕산, 제8경 국보 봉선홍경사갈기비";
const locationListForPrompt = "천안역, 아산역(천안아산역), 쌍용역, 두정역, 천안시청, 천안터미널(신세계백화점)";

// AI 응답 캐시
const aiResponseCache = new Map();
const MAX_CACHE_SIZE = 50;
const NON_CACHEABLE_FUNCTIONS = ['search_web_for_info']; // 웹 검색 결과는 캐시하지 않음

/**
 * AI의 페르소나(정체성)를 정의하는 시스템 프롬프트를 반환합니다.
 */
function getSystemPersona() {
    return `
# 페르소나 (Persona)
당신은 천안시의 관광 정보를 안내하는 친절하고 유능한 AI 키오스크 '하나'입니다. 방문객들에게 '천안 8경'에 대한 정확하고 흥미로운 정보를 제공하는 것이 당신의 임무입니다. 항상 존댓말을 사용하고, 긍정적인 태도를 유지하세요.

# 지리적 권역 정보 (AI 답변 시 활용)
이 정보는 사용자가 '내 위치'를 언급하며 **가기 좋은 곳**을 물을 때 동선 효율성을 판단하는 기준이 됩니다.
1. **[동남 역사권]**: **제1경 독립기념관**과 **제2경 유관순열사 사적지**.
2. **[도심 중앙권]**: **제5경 아라리오조각광장**과 **제3경 천안삼거리공원**.
3. **[서북/자연권]**: **제6경 성성호수공원**과 **제4경 태조산 왕건길과 청동대좌불**.

# 주요 위치 (AI 답변 시 활용)
- ${locationListForPrompt}
`;
}

/**
 * AI에게 주입할 천안 8경 지식(영문)을 반환합니다.
 */
function getSystemKnowledge() {
    return `
# [중요] 지식 기반 (Knowledge Base)
* AI는 아래의 영어 지식 기반을 참고하여 답변을 생성해야 합니다.
* 이 지식은 답변 생성을 위한 '참고 자료'이며, 이 자료의 언어(영어)가 당신의 '답변 언어'를 결정해서는 안 됩니다.
${cheonanSights}
`;
}

/**
 * AI가 반드시 지켜야 할 최종 답변 규칙을 반환합니다.
 */
function getSystemRules() {
    return `
# [!!!] 최종 답변 규칙 (FINAL ANSWERING RULES)
이 규칙은 당신이 생성하는 모든 답변에 **가장 우선적으로 적용**됩니다.

1. **[최우선: 언어 일치 정책]**
* 사용자가 **한국어**로 질문했다면, 당신의 답변도 **반드시 한국어**여야 합니다.
* (A) '지식 기반(Knowledge Base)'의 영어 내용을 **반드시 자연스러운 한국어로 *번역*하여 답변**해야 합니다.
* (B) \`search_web_for_info\` 함수 결과가 영어일지라도, **최종 답변은 반드시 한국어(예: "오늘 날씨는 맑습니다.")로 번역/요약해서 제공**해야 합니다.
* 사용자가 **영어**로 질문했다면, 당신의 답변도 **반드시 영어**여야 합니다.

2. **[글자 수 및 완결성]**
* 모든 답변은 반드시 공백 포함 300자 이하로, 핵심만 간결하게 요약해서 답변해야 합니다.
* **[매우 중요]** 답변이 글자 수 제한에 근접하더라도, **절대로 문장을 중간에 끊지 마십시오.** 반드시 **문법적으로 완결된 구두점(마침표 '.', 물음표 '?', 느낌표 '!')으로 문장을 깔끔하게 마무리**하고 응답을 종료해야 합니다.

3. **[정보 부족 시]** '지식 기반'에 없는 정보(예: "오늘 날씨")를 질문받았을 경우, \`search_web_for_info\` 함수를 호출하십시오.

4. **[경로 탐색 요청]**
* 사용자가 '목적지'를 명확히 밝히며 "가는 길"을 물으면, \`plan_tourist_route\` 함수를 호출하십시오.
* '목적지' 없이 "가는 길"을 물으면, "어디로 가는 길을 알려드릴까요?"라고 되물으십시오.
`;
}

/**
 * OpenAI API를 호출하여 AI 응답을 스트리밍합니다.
 * @param {Array} conversationHistory - 대화 내역 (시스템 프롬프트 제외)
 * @param {Object} sender - 응답을 보낼 대상 (Electron webContents)
 */
async function getOpenAIResponse(conversationHistory, sender) {
    if (!client) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("[OpenAI Service] OPENAI_API_KEY가 설정되지 않았습니다!");
            throw new Error("OpenAI API Key is not configured.");
        }
        client = new OpenAI({ apiKey: apiKey });
        console.log("[OpenAI Service] OpenAI 클라이언트 초기화 완료.");
    }

    // AI에게 전달할 전체 메시지 배열 구성
    const messages = [
        { role: 'system', content: getSystemPersona() },
        { role: 'system', name: 'knowledge_base', content: getSystemKnowledge() },
        ...conversationHistory,
        { role: 'system', content: getSystemRules() } // 최종 규칙이 항상 마지막
    ];

    const cacheKey = JSON.stringify(conversationHistory);

    // 캐시 확인
    if (aiResponseCache.has(cacheKey)) {
        console.log(`[OpenAI Service] CACHE HIT`);
        const cachedResponse = aiResponseCache.get(cacheKey);
        try {
            // 캐시된 응답도 스트리밍처럼 조각내어 전송
            for (let i = 0; i < cachedResponse.length; i += 5) {
                const chunk = cachedResponse.substring(i, i + 5);
                sender.send('ai:chunk', chunk);
                await new Promise(resolve => setTimeout(resolve, 10)); // 약간의 딜레이
            }
            sender.send('ai:stream-end');
            console.log("[OpenAI Service] 캐시된 응답 스트리밍 완료.");
        } catch (error) {
            console.error("[OpenAI Service] 캐시 응답 전송 중 오류:", error);
            sender.send('ai:error', '캐시 응답 전송 오류');
        }
        return;
    }

    console.log(`[OpenAI Service] CACHE MISS. 스트리밍 API 호출 시작.`);

    let fullResponseForCache = "";
    let functionCalled = null;

    try {
        const stream = await client.chat.completions.create({
            model: model,
            messages: messages,
            tools: availableTools,
            tool_choice: 'auto', max_tokens: 350, temperature: 0.2, stream: true,
        });

        let toolCallAssemblers = []; // 스트리밍되는 함수 호출 조각을 조립

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            // 1. 일반 텍스트 응답 조각 (ai:chunk)
            if (delta.content) {
                fullResponseForCache += delta.content;
                sender.send('ai:chunk', delta.content);
            }

            // 2. 함수 호출(Tool Call) 조각 조립
            if (delta.tool_calls) {
                for (const toolChunk of delta.tool_calls) {
                    const index = toolChunk.index;
                    if (toolCallAssemblers[index] === undefined) {
                        toolCallAssemblers[index] = { id: null, type: 'function', function: { name: "", arguments: "" } };
                    }
                    const assembler = toolCallAssemblers[index];
                    if (toolChunk.id) assembler.id = toolChunk.id;
                    if (toolChunk.function) {
                        if (toolChunk.function.name) assembler.function.name += toolChunk.function.name;
                        if (toolChunk.function.arguments) assembler.function.arguments += toolChunk.function.arguments;
                    }
                }
            }
        } // 스트림 루프 종료

        const accumulatedToolCalls = toolCallAssemblers.filter(tc => tc !== null && tc !== undefined);

        // 3. 함수 호출이 감지된 경우 (스트림 종료 후)
        if (accumulatedToolCalls.length > 0) {
            console.log("[OpenAI Service] 스트림 종료. 함수 호출 실행:",
                accumulatedToolCalls.map(t => `${t.function.name}(${t.function.arguments})`)
            );

            functionCalled = accumulatedToolCalls[0].function.name; // 캐시 여부 판단용

            // 함수 호출을 위한 새 메시지 배열 구성
            const messagesForToolCall = [
                ...messages, // 기존 대화 (페르소나, 지식, 유저질문, 규칙 포함)
                { role: 'assistant', tool_calls: accumulatedToolCalls }, // AI의 함수 호출 요청
            ];

            // 함수 실행
            const functionResponses = await Promise.all(
                accumulatedToolCalls.map(async (toolCall) => {
                    let functionResult;
                    try {
                        functionResult = await executeFunction(toolCall.function);
                    } catch (e) {
                        console.error(`[OpenAI Service] executeFunction 실행 중 오류: ${e.message}`);
                        functionResult = `함수 실행 오류: ${e.message}`;
                    }
                    return { tool_call_id: toolCall.id, role: 'tool', name: toolCall.function.name, content: functionResult };
                })
            );

            messagesForToolCall.push(...functionResponses); // 함수 실행 결과 추가
            // messagesForToolCall.push({ role: 'system', content: getSystemRules() }); // 규칙 재주입 (이미 messages에 포함됨)

            // 4. 함수 결과를 바탕으로 2차 스트리밍 호출
            const finalStream = await client.chat.completions.create({
                model: model,
                messages: messagesForToolCall,
                stream: true, max_tokens: 250, temperature: 0.2,
            });

            for await (const finalChunk of finalStream) {
                const textChunk = finalChunk.choices[0]?.delta?.content || "";
                if (textChunk) {
                    fullResponseForCache += textChunk;
                    sender.send('ai:chunk', textChunk);
                }
            }
        }

        console.log("[OpenAI Service] STREAM END 신호 전송.");
        sender.send('ai:stream-end');

        // 캐시 저장
        const shouldCache = fullResponseForCache && (!functionCalled || !NON_CACHEABLE_FUNCTIONS.includes(functionCalled));
        if (shouldCache) {
            if (aiResponseCache.size >= MAX_CACHE_SIZE) {
                aiResponseCache.delete(aiResponseCache.keys().next().value);
            }
            aiResponseCache.set(cacheKey, fullResponseForCache);
            console.log(`[OpenAI Service] 응답이 캐시됨.`);
        }

    } catch (error) {
        console.error("[OpenAI Service] OpenAI API 스트리밍 중 오류:", error);
        sender.send('ai:error', `AI 스트리밍 오류: ${error.message}`);
    }
}


// --- STT 교정 서비스 ---
const sttCorrectionCache = new Map();
const MAX_STT_CACHE_SIZE = 100;

/**
 * STT 결과를 GPT-4-Turbo를 이용해 교정합니다. (오타, 영어 음차 등 처리)
 * @param {string} textToCorrect - STT 원본 텍스트
 */
async function correctTextWithGPT(textToCorrect) {
    if (!textToCorrect || textToCorrect.length < 2) {
        return textToCorrect; // 너무 짧으면 교정 안 함
    }

    // 1. 완벽한 영어 문장인지, 혹은 자주 쓰이는 영어 단어인지 확인
    const englishRegex = /^[a-zA-Z0-9\s,.?!'"]+$/;
    const commonEnglishWords = /\b(hello|how|what|who|why|where|when|can|do|is|am|are|it|you|me|show|way|much|name|help)\b/i;
    if (englishRegex.test(textToCorrect) && commonEnglishWords.test(textToCorrect)) {
        console.log(`[STT Correction] 영어로 감지됨. 교정 생략: "${textToCorrect}"`);
        return textToCorrect;
    }

    // 2. STT 교정 캐시 확인
    if (sttCorrectionCache.has(textToCorrect)) {
        console.log(`[STT Correction] CACHE HIT: "${textToCorrect}"`);
        return sttCorrectionCache.get(textToCorrect);
    }
    console.log(`[STT Correction] CACHE MISS: "${textToCorrect}"`);

    // 3. OpenAI 클라이언트 확인
    if (!client) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("[STT Correction] OPENAI_API_KEY가 설정되지 않았습니다!");
            return textToCorrect; // 교정 실패 시 원본 반환
        }
        client = new OpenAI({ apiKey: apiKey });
    }

    // 4. 교정 프롬프트
    const correctionPrompt = `
    다음 문장은 음성 인식(STT) 결과입니다. 이 문장은 천안 관광 질문일 수 있습니다.
    문맥을 면밀히 고려하여, STT 오류를 수정한 **가장 자연스러운 문장**으로 수정해주세요.

    **천안 8경 목록:** ${sightListForPrompt}
    **주요 위치 목록:** ${locationListForPrompt}
    
    **매우 중요 지침 (수정됨):**

    1. **[최우선: 영어 음차 복원]**
    * 만약 원본 문장이 "헬로우", "하우 머치", "인디펜던스 홀"처럼 **영어를 한국어로 단순히 음차(phonetic transcription)한 것**으로 판단되면, **절대로 한국어로 교정하지 마십시오.**
    * 대신, **원본 의도였을 영어 문장으로 *복원*하십시오.**
    * (예: "헬로우, 인디패던스 홀 알려줘" -> "Hello, tell me about Independence Hall")
    * (예: "와츠 유어 네임?" -> "What's your name?")

    2. **[고유명사 교정 (한국어)]**
    * **1번에 해당하지 않는 *한국어* 질문** 중에서, STT 결과가 '천안 8경 목록' 또는 '주요 위치 목록'의 장소 이름과 유사하게 들릴 경우 (예: '썽썽' -> '성성', '갈비비' -> '갈기비'), 해당 장소 이름으로 적극적으로 수정합니다.
    
    3. **[영어 원본 유지]**
    * **1번에 해당하지 않으며,** 원본 문장이 "Hello"처럼 **이미 완벽한 영어**일 경우, **절대 수정하지 말고** 원본을 그대로 반환하십시오.

    4. **[한국어 원본 유지 (제한적)]**
    * **1, 2, 3번에 해당하지 않는 경우에만,** 원본 STT 문장이 이미 문법적으로 올바르고 의미가 명확한 한국어 질문이라면 (예: "내가 지금 천안역인데 어디로 가야 할까?"), 수정하지 마십시오.
        
    5. **[숫자 형식]** 'X경', '몇경' 등은 '제X경' 또는 'X경'(아라비아 숫자)으로 통일합니다. (예: "삼경" -> "3경")
    
    6. **[결과 형식]** 다른 설명 없이 최종적으로 수정된 문장만 간결하게 반환해주세요.
        
    원본 STT 문장: "${textToCorrect}"
    수정된 문장:`;

    try {
        console.log(`[STT Correction] GPT-${correctionModel}에 교정 요청: "${textToCorrect}"`);
        const response = await client.chat.completions.create({
            model: correctionModel,
            messages: [{ role: 'user', content: correctionPrompt }],
            temperature: 0.1, max_tokens: 350,
        });

        let correctedText = response.choices[0]?.message?.content?.trim() || textToCorrect;

        // GPT 응답에 포함될 수 있는 따옴표나 "수정된 문장:" 접두어 제거
        if ((correctedText.startsWith('"') && correctedText.endsWith('"')) || (correctedText.startsWith("'") && correctedText.endsWith("'"))) {
            correctedText = correctedText.substring(1, correctedText.length - 1);
        }
        if (correctedText.startsWith("수정된 문장:")) {
            correctedText = correctedText.substring("수정된 문장:".length).trim();
        }

        console.log(`[STT Correction] 교정 완료: "${correctedText}"`);

        // 캐시 저장
        if (sttCorrectionCache.size >= MAX_STT_CACHE_SIZE) {
            sttCorrectionCache.delete(sttCorrectionCache.keys().next().value);
        }
        sttCorrectionCache.set(textToCorrect, correctedText);

        return correctedText;

    } catch (error) {
        console.error("[STT Correction] 텍스트 교정 중 오류:", error);
        return textToCorrect; // 오류 시 원본 반환
    }
}


/**
 * (ipcHandlers.js에서 호출)
 * STT 결과를 받아 -> 교정 -> 대화 내역에 추가 -> AI 응답 스트리밍 시작
 */
async function handleUserSttInput(rawSttText, conversationHistory, sender, lang) {
    console.log(`[Main Handler] STT 원본 입력: "${rawSttText}" (Lang: ${lang})`);

    // 'correctTextWithGPT'를 항상 호출 (내부에서 영어/캐시 등 처리)
    console.log("[Main Handler] STT 교정 시작...");
    const correctedText = await correctTextWithGPT(rawSttText);

    // 교정된 텍스트를 대화 내역에 추가
    const updatedConversationHistory = [
        ...conversationHistory,
        { role: 'user', content: correctedText }
    ];

    // AI 응답 스트리밍 시작
    try {
        await getOpenAIResponse(updatedConversationHistory, sender);
    } catch (error) {
        console.error("[Main Handler] getOpenAIResponse 처리 중 오류:", error);
        sender.send('ai:error', 'AI 응답 처리 중 오류가 발생했습니다.');
    }
}

module.exports = {
    getOpenAIResponse,
    correctTextWithGPT,
    handleUserSttInput
};