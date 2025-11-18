// AIDialogue.jsx (수정본)

import {useState, useRef, useEffect, useCallback} from "react";
import KioskLayout from "../../components/layout/KioskLayout";
import MicIcon from "../../assets/icons/mic.svg?react";
import logo from "../../assets/images/logo.png";

// [제거] import {api} from "../../utils/api"; // ◀ 'window.electronAPI'로 통일하므로 제거

// (PrintIcon 컴포넌트... 생략)
const PrintIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
         className="w-8 h-8">
        <path strokeLinecap="round" strokeLinejoin="round"
              d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03-.48.062-.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z"/>
    </svg>
);

const INTERIM_MESSAGE_ID = "interim-message-id";

export default function AIDialogue({
                                       banner,
                                       setContrastLevel,
                                       zoomLevel,
                                       setZoomLevel,
                                       voiceSettings,
                                       setVoiceSettings,
                                       isSpeaking,
                                       setIsSpeaking
                                   }) {

    const [lang, setLang] = useState(() => {
        const savedLang = localStorage.getItem("app_lang");
        return savedLang || "ko";
    });

    const [messages, setMessages] = useState(() => {
        const initialGreeting = lang === 'ko'
            ? "안녕하세요! 무엇을 도와드릴까요?"
            : "Hello! How can I help you?";
        return [{id: crypto.randomUUID(), role: "assistant", content: initialGreeting}];
    });

    const [liveSubtitle, setLiveSubtitle] = useState("안녕하세요! 하나 AI 도우미입니다. 궁금한 명소나 여행 정보를 말씀해주세요.");
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);

    useEffect(() => {
        const handler = () => setLang(localStorage.getItem("app_lang") || "ko");
        window.addEventListener("languagechange", handler);
        return () => window.removeEventListener("languagechange", handler);
    }, []);

    // --- Refs ---
    const chatEndRef = useRef(null);
    const audioContextRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const workletNodeRef = useRef(null);
    const hasSpokenRef = useRef(false);
    const micClickLockRef = useRef(false);

    // 상태 동기화를 위한 Refs
    const isListeningRef = useRef(isListening);
    const isLoadingRef = useRef(isLoading);
    const isSpeakingRef = useRef(isSpeaking);
    const sttResultLockRef = useRef(false);

    // TTS 큐 관련 Refs
    const ttsQueueRef = useRef([]);
    const isTtsPlayingRef = useRef(false);
    const ttsBufferRef = useRef(""); // (영어 버퍼로도 사용됨)
    const hasPlaybackStartedRef = useRef(false);
    const isAiStreamingRef = useRef(false);

    // [제거] const sttCooldownRef = useRef(false); // ◀ 제거됨

    // --- 상태 Ref 동기화 ---
    useEffect(() => {
        isListeningRef.current = isListening;
    }, [isListening]);
    useEffect(() => {
        isLoadingRef.current = isLoading;
    }, [isLoading]);
    useEffect(() => {
        isSpeakingRef.current = isSpeaking;
    }, [isSpeaking]);

    // --- 녹음 중지 로직 ---
    const stopRecording = useCallback(() => {
        if (!mediaStreamRef.current && !audioContextRef.current) {
            return;
        }
        console.log("stopRecording: Stopping audio streams and context...");
        if (workletNodeRef.current) {
            workletNodeRef.current.port.onmessage = null;
            try {
                workletNodeRef.current.disconnect();
            } catch (e) {
                console.warn("Error disconnecting workletNode:", e);
            }
            workletNodeRef.current = null;
        }
        if (audioContextRef.current?.state !== 'closed') {
            try {
                audioContextRef.current?.close();
            } catch (e) {
                console.warn("Error closing AudioContext:", e);
            }
            audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        console.log(">>> Sending stopSpeechStream to main.js (Physical stop)");
        window.electronAPI.stopSpeechStream();
    }, []);

    // --- TTS 큐 재생 로직 (기존과 동일) ---
    const speakNextInQueue = useCallback(() => {
        if (isTtsPlayingRef.current || ttsQueueRef.current.length === 0) {
            return;
        }
        if (!lang.startsWith('ko') && !lang.startsWith('en')) {
            console.log(`TTS Skipped: Unsupported language (${lang}). Clearing queue.`);
            ttsQueueRef.current = [];
            isTtsPlayingRef.current = false;
            if (setIsSpeaking) setIsSpeaking(false);
            isSpeakingRef.current = false;
            hasPlaybackStartedRef.current = false;
            return;
        }
        const textToPlay = ttsQueueRef.current.shift();
        if (!textToPlay || !textToPlay.trim()) {
            speakNextInQueue();
            return;
        }
        isTtsPlayingRef.current = true;
        if (setIsSpeaking) setIsSpeaking(true);
        isSpeakingRef.current = true;
        let targetLang = lang.startsWith('ko') ? 'ko' : 'en';
        const commandObject = {text: textToPlay};
        console.log(`Streaming TTS: Sending to pipe (Lang: ${targetLang}):`, commandObject);
        window.electronAPI.sendTtsCommand(targetLang, commandObject);
    }, [setIsSpeaking, lang]);

    // --- TTS 큐 추가 로직 (기존과 동일) ---
    const addTextToTtsQueue = useCallback((text, forcePlay = false) => {
        if (!text || !text.trim()) return;
        ttsBufferRef.current += text;
        const terminators = /[.!?。！？\n]/;
        let sentenceEndIndex = ttsBufferRef.current.search(terminators);
        while (sentenceEndIndex !== -1) {
            const sentence = ttsBufferRef.current.substring(0, sentenceEndIndex + 1).trim();
            ttsBufferRef.current = ttsBufferRef.current.substring(sentenceEndIndex + 1);
            if (sentence) {
                ttsQueueRef.current.push(sentence);
                console.log("TTS Queue: Added sentence:", sentence);
            }
            sentenceEndIndex = ttsBufferRef.current.search(terminators);
        }
        if (isTtsPlayingRef.current) return;
        const isKo = lang.startsWith('ko');
        const minSentencesToStart = isKo ? 1 : 5;
        if (forcePlay && ttsQueueRef.current.length > 0) {
            hasPlaybackStartedRef.current = true;
            speakNextInQueue();
        } else if (hasPlaybackStartedRef.current && ttsQueueRef.current.length > 0) {
            speakNextInQueue();
        } else if (!hasPlaybackStartedRef.current && ttsQueueRef.current.length >= minSentencesToStart) {
            console.log(`TTS Start Condition MET. (Lang: ${isKo ? 'ko' : 'other'}, Queue: ${ttsQueueRef.current.length})`);
            hasPlaybackStartedRef.current = true;
            speakNextInQueue();
        }
    }, [speakNextInQueue, lang]); // ◀ lang 의존성 추가

    // --- TTS 버퍼 플러시 (기존과 동일) ---
    const flushTtsBuffer = useCallback(() => {
        const leftoverText = ttsBufferRef.current.trim();
        if (leftoverText) {
            ttsQueueRef.current.push(leftoverText);
        }
        ttsBufferRef.current = "";
        if (!isTtsPlayingRef.current && ttsQueueRef.current.length > 0) {
            hasPlaybackStartedRef.current = true;
            speakNextInQueue();
        }
    }, [speakNextInQueue]);

    // --- TTS 중지 (기존과 동일) ---
    const stopAndClearTtsQueue = useCallback(() => {
        console.log("Streaming TTS: Stopping all playback and clearing queue.");
        ttsQueueRef.current = [];
        ttsBufferRef.current = "";
        isTtsPlayingRef.current = false;
        if (setIsSpeaking) setIsSpeaking(false);
        isSpeakingRef.current = false;
        hasPlaybackStartedRef.current = false;
        isAiStreamingRef.current = false;
        window.electronAPI.sendTtsCommand('ALL', {command: "stop"});
    }, [setIsSpeaking]);

    // --- TTS 재생 완료 리스너 (기존과 동일) ---
    useEffect(() => {
        const removeListener = window.electronAPI.onTtsPlaybackFinished(() => {
            console.log(">>> onTtsPlaybackFinished received.");
            isTtsPlayingRef.current = false;
            if (ttsQueueRef.current.length > 0) {
                speakNextInQueue();
            } else {
                if (!isAiStreamingRef.current) {
                    hasPlaybackStartedRef.current = false;
                    if (setIsSpeaking) setIsSpeaking(false);
                    isSpeakingRef.current = false;
                }
            }
        });
        return () => removeListener();
    }, [speakNextInQueue, setIsSpeaking]);

    // --- 녹음 시작 로직 (기존과 동일) ---
    const startRecording = useCallback(async () => {
        if (isListeningRef.current) return;
        if (isSpeakingRef.current) return;
        sttResultLockRef.current = false;
        console.log("Attempting to start recording...");
        setIsListening(true);
        isListeningRef.current = true; // ◀ "즉시 동기화" (1)
        try {
            let selectedDeviceId = null;
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
                selectedDeviceId = audioInputDevices[0].deviceId;
            } catch (err) {
                throw new Error(`마이크 목록 가져오기 실패: ${err.message}`);
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: selectedDeviceId ? {
                    deviceId: {exact: selectedDeviceId}, sampleRate: 16000
                } : {sampleRate: 16000},
                video: false
            });
            mediaStreamRef.current = stream;
            const context = new AudioContext({sampleRate: 16000});
            audioContextRef.current = context;
            try {
                await context.audioWorklet.addModule('audio-processor.js');
            } catch (e) {
                throw new Error(`audio-processor.js 로드 실패: ${e.message}`);
            }
            const source = context.createMediaStreamSource(stream);
            const workletNode = new AudioWorkletNode(context, 'audio-processor');
            workletNodeRef.current = workletNode;
            workletNode.port.onmessage = (event) => {
                if (!workletNodeRef.current || !isListeningRef.current) return;
                if (event.data instanceof Float32Array) {
                    const float32Array = event.data;
                    const int16Array = new Int16Array(float32Array.length);
                    for (let i = 0; i < float32Array.length; i++) {
                        int16Array[i] = Math.max(-1, Math.min(1, float32Array[i])) * 0x7FFF;
                    }
                    window.electronAPI.sendAudioChunk(int16Array.buffer);
                }
            };
            source.connect(workletNode);
            window.electronAPI.startSpeechStream(lang);
        } catch (err) {
            console.error("Error during startRecording:", err);
            alert(`마이크 에러: ${err.message}`);
            setIsListening(false);
            isListeningRef.current = false; // ◀ "즉시 동기화" (2)
        }
    }, [setIsListening, lang]);

    // --- [수정] submitMessage (비(非)-STT, 즉 타이핑 입력용) ---
    const submitMessage = useCallback(async (messageText) => {
        if (!messageText || !messageText.trim() || isLoadingRef.current) return;
        console.log(">>> submitMessage (Streaming) called with:", messageText);
        stopAndClearTtsQueue();
        setIsLoading(true);

        const userMessage = {id: crypto.randomUUID(), role: "user", content: messageText};

        const newMessagesForApi = await new Promise(resolve => {
            setMessages(currentMessages => {
                const filteredMessages = currentMessages.filter(m => m.id !== INTERIM_MESSAGE_ID);
                const newMessages = [
                    ...filteredMessages,
                    userMessage,
                    {id: crypto.randomUUID(), role: "assistant", content: ""}
                ];
                // API에는 'userMessage'를 포함한 히스토리를 보냅니다.
                resolve([...filteredMessages, userMessage].map(m => ({ role: m.role, content: m.content })));
                return newMessages;
            });
        });

        try {
            isAiStreamingRef.current = true;


            // 🔽 [수정] 'api.askAI' -> 'window.electronAPI.askAI'
            window.electronAPI.askAI(newMessagesForApi);
        } catch (error) {
            console.error("AI 요청 전송 오류:", error);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    return [...prev.slice(0, -1), {...lastMsg, content: "AI 요청 실패."}];
                }
                return [...prev, {id: crypto.randomUUID(), role: "assistant", content: "AI 요청 실패."}];
            });
            if (setIsSpeaking) setIsSpeaking(false);
            setIsLoading(false);
            isAiStreamingRef.current = false;
        }
    }, [setIsSpeaking, setIsLoading, setMessages, stopAndClearTtsQueue]);


    // --- [신규] submitSttMessage (STT 입력 전용) ---
    /**
     * STT 최종 결과를 백엔드(handleUserSttInput)로 전송합니다.
     */
    const submitSttMessage = useCallback(async (sttText) => {
        if (!sttText || !sttText.trim() || isLoadingRef.current) {
            console.warn("submitSttMessage: 중복 호출 또는 빈 텍스트로 인해 무시됨.");
            return;
        }

        console.log(">>> submitSttMessage (STT Flow) called with:", sttText);

        // 1. 기존 TTS 중지, 로딩 상태 시작
        stopAndClearTtsQueue();
        setIsLoading(true);

        const userMessage = {id: crypto.randomUUID(), role: "user", content: sttText};

        // 2. '이전' 대화 내역 (API 전송용)
        // setMessages 콜백을 사용하여 가장 최신 상태(prev)를 기준으로
        // '이전' 대화 내역을 가져오고, '이후' UI 상태를 설정합니다.
        const conversationHistory = await new Promise(resolve => {
            setMessages(prev => {
                const filteredMessages = prev.filter(m => m.id !== INTERIM_MESSAGE_ID);

                // API로 보낼 '이전' 대화 내역 (role, content만)
                const historyForApi = filteredMessages
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(({role, content}) => ({role, content}));

                resolve(historyForApi); // Promise에 '이전' 내역 반환

                // UI에 표시할 '새' 상태 (유저 메시지 + AI 셸)
                return [
                    ...filteredMessages,
                    userMessage,
                    {id: crypto.randomUUID(), role: "assistant", content: ""}
                ];
            });
        });

        // 3. 새 IPC 채널로 전송
        try {
            isAiStreamingRef.current = true;

            console.log(`[STT Submit] Sending to main: (Text: "${sttText}", History Length: ${conversationHistory.length})`);

            // 🔽 [신규] 새로운 'submitSttForAI' API 호출
            // 백엔드가 STT 교정, AI 호출, 스트리밍을 모두 처리합니다.
            window.electronAPI.submitSttForAI(sttText, conversationHistory,lang);

        } catch (error) {
            console.error("STT 요청 전송 오류:", error);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                    return [...prev.slice(0, -1), {...lastMsg, content: "STT 요청 실패."}];
                }
                return [...prev, {id: crypto.randomUUID(), role: "assistant", content: "STT 요청 실패."}];
            });
            if (setIsSpeaking) setIsSpeaking(false);
            setIsLoading(false);
            isAiStreamingRef.current = false;
        }

    }, [setIsSpeaking, setIsLoading, setMessages, stopAndClearTtsQueue]);
    // --- [신규] 끝 ---


    // --- 함수 Ref 화 (STT 리스너에서 최신 함수를 사용하기 위함) ---
    const addTextToTtsQueueRef = useRef(addTextToTtsQueue);
    const flushTtsBufferRef = useRef(flushTtsBuffer);
    const setIsLoadingRef = useRef(setIsLoading);
    const setMessagesRef = useRef(setMessages);
    const submitMessageRef = useRef(submitMessage);
    const submitSttMessageRef = useRef(submitSttMessage); // ◀ [신규] STT 전용 submit Ref
    const setIsListeningRef = useRef(setIsListening);
    const stopRecordingRef = useRef(stopRecording);
    const stopAndClearTtsQueueRef = useRef(stopAndClearTtsQueue); // ◀ [신규] STT 결과 처리시 TTS 중지를 위해 추가

    // --- 함수 Ref 최신화 ---
    useEffect(() => {
        addTextToTtsQueueRef.current = addTextToTtsQueue;
    }, [addTextToTtsQueue]);
    useEffect(() => {
        flushTtsBufferRef.current = flushTtsBuffer;
    }, [flushTtsBuffer]);
    useEffect(() => {
        setIsLoadingRef.current = setIsLoading;
    }, [setIsLoading]);
    useEffect(() => {
        setMessagesRef.current = setMessages;
    }, [setMessages]);
    useEffect(() => {
        submitMessageRef.current = submitMessage;
    }, [submitMessage]);
    useEffect(() => { // ◀ [신규]
        submitSttMessageRef.current = submitSttMessage;
    }, [submitSttMessage]);
    useEffect(() => {
        setIsListeningRef.current = setIsListening;
    }, [setIsListening]);
    useEffect(() => {
        stopRecordingRef.current = stopRecording;
    }, [stopRecording]);
    useEffect(() => { // ◀ [신규]
        stopAndClearTtsQueueRef.current = stopAndClearTtsQueue;
    }, [stopAndClearTtsQueue]);


    // 초기 메시지 재생 (기존과 동일)
    useEffect(() => {
        if (typeof setIsSpeaking !== "function") return;
        if (hasSpokenRef.current) return;
        const initialMessage = messages[0]?.content;
        if (!initialMessage) return;
        const timerId = setTimeout(() => {
            hasSpokenRef.current = true;
            addTextToTtsQueueRef.current(initialMessage, true);
        }, 50);
        return () => clearTimeout(timerId);
    }, [messages, setIsSpeaking]);

    // 화면 이탈 시 중지 (기존과 동일)
    useEffect(() => {
        return () => {
            console.log("화면 이탈: TTS 및 녹음 중지");
            stopAndClearTtsQueue();
            stopRecording();
        };
    }, [stopRecording, stopAndClearTtsQueue]);


    // --- 🔽 [수정] STT 결과/에러 처리 ---
    useEffect(() => {
        // 중간 결과 리스너 (기존과 동일)
        const removeInterimListener = window.electronAPI.onSpeechInterimResult((transcript) => {
            if (!isListeningRef.current || isSpeakingRef.current) {
                return;
            }
            setMessagesRef.current(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.id === INTERIM_MESSAGE_ID) {
                    return [...prev.slice(0, -1), {id: INTERIM_MESSAGE_ID, role: "interim", content: transcript}];
                } else {
                    return [...prev, {id: INTERIM_MESSAGE_ID, role: "interim", content: transcript}];
                }
            });
        });

        // [수정] 최종 결과 리스너
        const removeResultListener = window.electronAPI.onSpeechResult(async (transcript) => {
            console.log(">>> onSpeechResult (Final) received:", transcript);

            // 🔽 "잠금" (기존과 동일)
            if (!isListeningRef.current || isSpeakingRef.current) {
                console.warn("onSpeechResult: Ignoring stale transcript (Guard ACTIVE: isListening=false or AI isSpeaking).");
                return;
            }

            if (!transcript || !transcript.trim()) {
                console.warn("onSpeechResult: Empty transcript ignored.");
                // [수정] 빈 결과 수신 시 interim 제거 및 녹음 중지
                setMessagesRef.current(prev => prev.filter(m => m.id !== INTERIM_MESSAGE_ID));
                setIsListeningRef.current(false);
                isListeningRef.current = false; // "즉시 동기화"
                stopRecordingRef.current();
                return;
            }

            if (sttResultLockRef.current) {
                console.warn("onSpeechResult: STT result is already being processed. Ignoring duplicate.");
                return;
            }

            // [수정] UI에서 'interim' 메시지 즉시 제거
            setMessagesRef.current(prev => prev.filter(m => m.id !== INTERIM_MESSAGE_ID));

            try {
                sttResultLockRef.current = true;
                console.log("onSpeechResult: Acquired STT lock, processing result.");

                // [수정] 녹음 중지 및 상태 동기화
                setIsListeningRef.current(false);
                isListeningRef.current = false; // "즉시 동기화" (3)
                stopRecordingRef.current();

                // 🔽 [수정] 새로운 STT 전용 submit 함수 호출
                // 이 함수가 로딩 설정, UI 업데이트, API 호출을 모두 처리합니다.
                submitSttMessageRef.current(transcript);

                // 🔽 [제거] 기존 로직 (수동 교정, 수동 submit)
                // const correctedText = await window.electronAPI.correctSTT(transcript);
                // submitMessageRef.current(correctedText);

            } catch (error) {
                // [수정] submitSttMessageRef.current(transcript) 호출에서 에러가 날 경우
                // (이론상 'submitSttMessage' 내부의 try/catch가 처리해야 함)
                // 만약의 사태를 대비해 'submitMessage' (기존 로직)로 폴백합니다.
                console.error("onSpeechResult: Fallback error:", error);
                submitMessageRef.current(transcript); // 폴백 (기존 'openai:ask' 사용)

            } finally {
                // [수정] 락 해제
                // submitSttMessage가 API 호출을 '전송'만 하므로 락을 즉시 해제합니다.
                // 로딩 상태(isLoading)는 onAIStreamEnd에서 해제됩니다.
                sttResultLockRef.current = false;
            }
        });

        // 에러 리스너 (기존과 동일)
        const removeErrorListener = window.electronAPI.onSpeechError((error) => {
            console.error(">>> onSpeechError received:", error);
            if (!isListeningRef.current || isSpeakingRef.current) {
                console.warn("onSpeechError: Ignoring stale error (Guard ACTIVE: isListening=false or AI isSpeaking).");
                return;
            }
            setMessagesRef.current(prev => prev.filter(m => m.id !== INTERIM_MESSAGE_ID));
            sttResultLockRef.current = false;
            setIsListeningRef.current(false);
            isListeningRef.current = false; // "즉시 동기화" (4)
            stopRecordingRef.current();
        });

        return () => {
            removeInterimListener();
            removeResultListener();
            removeErrorListener();
        };
    }, []); // ◀ 의존성 배열 [] 유지 (모든 함수는 Ref를 통해 호출됨)
    // --- [수정] STT 결과 처리 끝 ---


    // 스크롤 (기존과 동일)
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({behavior: "smooth"});
    }, [messages]);


    // --- 🔽 [수정] AI 스트리밍 리스너 ('api.' -> 'window.electronAPI.') ---
    useEffect(() => {
        const handleAIChunk = (chunk) => {
            if (!chunk) return;
            if (lang.startsWith('en')) {
                ttsBufferRef.current += chunk;
                return;
            }
            isAiStreamingRef.current = true;
            setMessagesRef.current(prev => {
                const lastAsstMsgIndex = prev.findLastIndex(m => m.role === 'assistant');
                if (lastAsstMsgIndex !== -1) {
                    const newMessages = [...prev];
                    const newContent = (newMessages[lastAsstMsgIndex].content || "") + chunk;
                    newMessages[lastAsstMsgIndex] = {...prev[lastAsstMsgIndex], content: newContent};
                    return newMessages;
                }
                return prev;
            });
            setTimeout(() => {
                addTextToTtsQueueRef.current(chunk, false);
            }, 0);
        };

        const handleAIStreamEnd = () => {
            console.log("Streaming: END signal received.");
            if (lang.startsWith('en')) {
                const fullText = ttsBufferRef.current;
                ttsBufferRef.current = "";
                if (fullText.trim()) {
                    setMessagesRef.current(prev => {
                        const lastAsstMsgIndex = prev.findLastIndex(m => m.role === 'assistant');
                        if (lastAsstMsgIndex !== -1) {
                            const newMessages = [...prev];
                            newMessages[lastAsstMsgIndex] = {...prev[lastAsstMsgIndex], content: fullText};
                            return newMessages;
                        }
                        return prev;
                    });
                    addTextToTtsQueueRef.current(fullText, true);
                }
            } else {
                flushTtsBufferRef.current();
            }
            setIsLoadingRef.current(false);
            isAiStreamingRef.current = false;

            if (ttsQueueRef.current.length === 0 && !isTtsPlayingRef.current) {
                hasPlaybackStartedRef.current = false;
                if (setIsSpeaking) setIsSpeaking(false);
                isSpeakingRef.current = false;
            }
        };

        const handleAIError = (errorMsg) => {
            console.error("Streaming: ERROR received:", errorMsg);
            setIsLoadingRef.current(false);
            ttsBufferRef.current = "";
            setMessagesRef.current(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === "") {
                    return [...prev.slice(0, -1), {...lastMsg, id: crypto.randomUUID(), content: errorMsg}];
                }
                return [...prev, {id: crypto.randomUUID(), role: "assistant", content: errorMsg}];
            });
            isAiStreamingRef.current = false;
            hasPlaybackStartedRef.current = false;
        };

        // 🔽 [수정] 'api.' -> 'window.electronAPI.'
        const removeChunkListener = window.electronAPI.onAIChunk(handleAIChunk);
        const removeEndListener = window.electronAPI.onAIStreamEnd(handleAIStreamEnd);
        const removeErrorListener = window.electronAPI.onAIError(handleAIError);

        return () => {
            removeChunkListener();
            removeEndListener();
            removeErrorListener();
        };
    }, [setIsSpeaking, lang]); // ◀ lang 의존성 유지
    // --- [수정] AI 스트리밍 리스너 끝 ---


    // PTT 로직 (마이크 클릭, 기존과 동일)
    const handleMicClick = useCallback(() => {
        if (micClickLockRef.current) return;
        micClickLockRef.current = true;
        setTimeout(() => {
            micClickLockRef.current = false;
        }, 300);

        const currentIsSpeaking = isSpeakingRef.current;
        const currentIsListening = isListeningRef.current;

        if (currentIsListening) {
            console.log("Action: (PTT) Stopping recording.");
            sttResultLockRef.current = false;
            setIsListening(false);
            isListeningRef.current = false; // ◀ "즉시 동기화" (5)
            stopRecording();
            setMessages(prev => prev.filter(m => m.id !== INTERIM_MESSAGE_ID));
        } else if (currentIsSpeaking) {
            console.log("Action: (PTT) Interrupting TTS and starting recording.");
            stopAndClearTtsQueue();
            startRecording();
        } else {
            console.log("Action: (PTT) Starting recording.");
            stopAndClearTtsQueue();
            startRecording();
        }
    }, [startRecording, stopRecording, setIsListening, stopAndClearTtsQueue, setMessages]);


    // --- 🔽 [수정] 프린트 핸들러 ('api.' -> 'window.electronAPI.') ---
    const handlePrintSingleMessage = async (contentToPrint) => {
        try {
            // 🔽 [수정] 'api.' -> 'window.electronAPI.'
            const result = await window.electronAPI.print(contentToPrint);
            if (!result.success) alert(`인쇄 실패: ${result.error}`);
        } catch (error) {
            alert("인쇄 중 심각한 오류가 발생했습니다.");
        }
    };


    // JSX (기존과 동일)
    return (
        <KioskLayout
            logo={logo} banner={banner} setContrastLevel={setContrastLevel}
            zoomLevel={zoomLevel} setZoomLevel={setZoomLevel}
            voiceSettings={voiceSettings} setVoiceSettings={setVoiceSettings}
            showSubtitle={true}
            subtitle={liveSubtitle}
            setLiveSubtitle={setLiveSubtitle}
        >
            <div className={`w-full max-w-[900px] h-[1300px] relative rounded-xl overflow-hidden`}>
                <div className="h-full overflow-y-auto p-10 space-y-6 pt-40">

                    {messages.map((msg, idx) => (
                        <div key={msg.id} className={`flex items-end gap-4 ${
                            msg.role === 'user' || msg.role === 'interim' ? 'justify-end' : 'justify-start'
                        }`}>
                            {msg.role === 'assistant' && idx > 0 && (
                                <button
                                    onClick={() => handlePrintSingleMessage(msg.content)}
                                    className="p-3 mb-2 rounded-full text-gray-500 hover:bg-gray-200 active:bg-gray-300 focus:outline-none focus:ring-4 focus:ring-blue-500"
                                    title="이 답변 인쇄하기"
                                >
                                    <PrintIcon/>
                                </button>
                            )}
                            <div
                                className={`relative p-8 rounded-2xl max-w-[75%] text-[2rem] font-medium leading-relaxed ${
                                    msg.role === "user" ? "bg-blue-500 text-white bubble-user" :
                                        msg.role === "interim" ? "bg-blue-300 text-black bubble-user animate-pulse" :
                                            "bg-gray-200 text-black bubble-ai whitespace-pre-wrap"
                                }`}
                            >
                                {msg.content}
                                {msg.role === "user" ? (
                                    <div
                                        className="bubble-tail-user absolute -right-2 bottom-4 w-0 h-0 border-l-[16px] border-l-blue-500 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent"></div>
                                ) : msg.role === "interim" ? (
                                    <div
                                        className="bubble-tail-user absolute -right-2 bottom-4 w-0 h-0 border-l-[16px] border-l-blue-300 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent"></div>
                                ) : (
                                    <div
                                        className="bubble-tail-ai absolute -left-2 bottom-4 w-0 h-0 border-r-[16px] border-r-gray-200 border-t-[12px] border-t-transparent border-b-[12px] border-b-transparent"></div>
                                )}
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef}/>
                </div>

                {isSpeaking && !isListening && (
                    <div
                        className="absolute bottom-60 left-1/2 -translate-x-1/2 bg-black bg-opacity-70 text-white px-6 py-3 rounded-full">
                        <p className="text-2xl animate-pulse">답변중...</p>
                    </div>
                )}
                {isLoading && (
                    <div
                        className="absolute bottom-60 left-1/2 -translate-x-1/2 bg-yellow-600 bg-opacity-80 text-white px-6 py-3 rounded-full">

                    </div>
                )}

                <button
                    onClick={handleMicClick}
                    disabled={isLoading}
                    className={`absolute bottom-16 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full text-white flex items-center justify-center shadow-lg hover:opacity-90 active:opacity-80 z-10 transition-colors focus:outline-none focus:ring-4 focus:ring-blue-500 ${
                        isListening ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                    } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <MicIcon className="w-20 h-20"/>
                </button>
            </div>
        </KioskLayout>
    );
}