import { useState, useRef, useEffect } from "react";
import KioskLayout from "../../components/layout/KioskLayout";
import ChatMessage from "../../components/chat/ChatMessage"; // 새로 만든 UI 컴포넌트
import MicIcon from "../../assets/icons/mic.svg?react";
import logo from "../../assets/images/logo.png";

// ✅ 훅 Import
import { useLanguage } from "../../hooks/useLanguage";
import { useStt } from "../../hooks/useStt";
import { useTts } from "../../hooks/useTts";

const INTERIM_MESSAGE_ID = "interim-message-id";

export default function AIDialogue({
                                       banner,
                                       setContrastLevel,
                                       zoomLevel,
                                       setZoomLevel,
                                       voiceSettings,
                                       setVoiceSettings,
                                       // isSpeaking, setIsSpeaking // 훅 내부에서 처리하므로 props 의존성 낮춤
                                   }) {
    // 1. 언어 훅 (중복 제거)
    const { lang } = useLanguage();
    const isKorean = lang === 'ko';

    // 2. 상태 관리
    const [messages, setMessages] = useState([{
        id: crypto.randomUUID(),
        role: "assistant",
        content: isKorean ? "안녕하세요! 무엇을 도와드릴까요?" : "Hello! How can I help you?"
    }]);

    // 기본 자막
    const [liveSubtitle, setLiveSubtitle] = useState(
        isKorean ? "안녕하세요! 하나 AI 도우미입니다." : "Hello! I'm Hana AI Assistant."
    );

    const [isLoading, setIsLoading] = useState(false);
    const chatEndRef = useRef(null);

    // 3. TTS 훅 (큐 관리, 재생 로직 통합)
    const { addText, stopTts } = useTts(lang);

    // 4. STT 훅 (마이크, 녹음, 결과 수신 통합)
    const { isListening, startRecording, stopRecording } = useStt({
        lang,
        // (A) 중간 결과: 화면에 회색 말풍선(interim)으로 표시
        onInterim: (text) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.id === INTERIM_MESSAGE_ID) {
                    return [...prev.slice(0, -1), { id: INTERIM_MESSAGE_ID, role: "interim", content: text }];
                }
                return [...prev, { id: INTERIM_MESSAGE_ID, role: "interim", content: text }];
            });
        },
        // (B) 최종 결과: 진짜 말풍선으로 바꾸고 AI 전송
        onResult: (text) => {
            // interim 제거
            setMessages(prev => prev.filter(m => m.id !== INTERIM_MESSAGE_ID));
            // AI 전송 로직 호출
            submitSttMessage(text);
        },
        onError: (err) => {
            setMessages(prev => prev.filter(m => m.id !== INTERIM_MESSAGE_ID));
            console.error("STT Error:", err);
            // 에러 시 사용자에게 알림 (필요 시 주석 해제)
            // alert("음성 인식 중 오류가 발생했습니다.");
        }
    });

    // 5. AI 요청 로직
    const submitSttMessage = async (text) => {
        if (!text?.trim()) return;

        stopTts(); // 말 시작하면 읽던 TTS 끊기
        setIsLoading(true);

        const userMsg = { id: crypto.randomUUID(), role: "user", content: text };

        // 메시지 업데이트 (사용자 질문 + 빈 AI 답변칸 생성)
        setMessages(prev => [
            ...prev,
            userMsg,
            { id: crypto.randomUUID(), role: "assistant", content: "" }
        ]);

        // 이전 대화 내역 추출 (API 전송용 - interim 제외)
        const history = messages
            .filter(m => m.role !== 'interim')
            .map(({ role, content }) => ({ role, content }));

        // 현재 질문도 히스토리에 포함
        history.push({ role: 'user', content: text });

        // 백엔드로 전송
        try {
            window.electronAPI.submitSttForAI(text, history, lang);
        } catch (e) {
            console.error("AI Request Failed:", e);
            setIsLoading(false);
            setMessages(prev => {
                const newMsgs = [...prev];
                const lastIdx = newMsgs.length - 1;
                newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: "오류가 발생했습니다. 다시 시도해주세요." };
                return newMsgs;
            });
        }
    };

    // 6. AI 스트리밍 수신 (useEffect)
    useEffect(() => {
        // 청크 수신
        const removeChunk = window.electronAPI.onAIChunk((chunk) => {
            setIsLoading(false);

            // TTS 큐에 넣기
            addText(chunk);

            // 화면 업데이트 (스트리밍 텍스트 붙이기)
            setMessages(prev => {
                const lastIdx = prev.findLastIndex(m => m.role === 'assistant');
                if (lastIdx !== -1) {
                    const newMsgs = [...prev];
                    newMsgs[lastIdx] = {
                        ...newMsgs[lastIdx],
                        content: (newMsgs[lastIdx].content || "") + chunk
                    };
                    return newMsgs;
                }
                return prev;
            });
        });

        // 스트림 종료
        const removeEnd = window.electronAPI.onAIStreamEnd(() => {
            setIsLoading(false);
            // console.log("Stream Ended");
        });

        // 에러 발생
        const removeError = window.electronAPI.onAIError((err) => {
            setIsLoading(false);
            console.error("AI Stream Error:", err);
        });

        return () => {
            removeChunk();
            removeEnd();
            removeError();
        };
    }, [addText]);

    // 스크롤 자동 이동
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // 화면 이탈 시 정리
    useEffect(() => {
        return () => {
            stopTts();
            stopRecording();
        };
    }, [stopTts, stopRecording]);


    // 렌더링
    return (
        <KioskLayout
            logo={logo}
            banner={banner}
            setContrastLevel={setContrastLevel}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            voiceSettings={voiceSettings}
            setVoiceSettings={setVoiceSettings}
            showSubtitle={true}
            subtitle={liveSubtitle}
            setLiveSubtitle={setLiveSubtitle}
        >
            <div className="w-full max-w-[900px] h-[1300px] relative rounded-xl overflow-hidden">

                {/* 대화창 영역 */}
                <div className="h-full overflow-y-auto p-10 space-y-6 pt-40">
                    {messages.map((msg) => (
                        <ChatMessage
                            key={msg.id}
                            msg={msg}
                            onPrint={(content) => window.electronAPI.print(content)}
                        />
                    ))}

                    {/* 로딩 인디케이터 */}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-gray-200 p-6 rounded-2xl animate-pulse text-2xl text-gray-500 font-bold">
                                AI가 답변을 생각 중입니다...
                            </div>
                        </div>
                    )}

                    <div ref={chatEndRef}/>
                </div>

                {/* 마이크 버튼 */}
                <button
                    onClick={isListening ? stopRecording : startRecording}
                    className={`absolute bottom-16 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full text-white flex items-center justify-center shadow-lg transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-blue-500 ${
                        isListening
                            ? 'bg-red-600 animate-pulse scale-110'
                            : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
                    }`}
                >
                    <MicIcon className="w-20 h-20"/>
                </button>
            </div>
        </KioskLayout>
    );
}