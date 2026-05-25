import { useState, useCallback, useRef } from "react";

// Strip markdown so Jarvis reads clean prose instead of symbols
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "code block omitted")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/>\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

export function useSpeechOutput() {
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const isSupported =
    typeof window !== "undefined" && !!window.speechSynthesis;

  const isSpeaking = speakingMsgId !== null;

  const speak = useCallback(
    (msgId: string, text: string) => {
      if (!isSupported) return;
      window.speechSynthesis.cancel();

      const cleaned = stripMarkdown(text);
      if (!cleaned) return;

      const utt = new SpeechSynthesisUtterance(cleaned);
      utt.rate = 1.05;
      utt.pitch = 0.88;
      utt.volume = 1;

      // Prefer a natural English voice; fall back to whatever is available
      const pickVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        return (
          voices.find(
            (v) =>
              /daniel|alex|samantha|google.*en|en-us/i.test(v.name) &&
              v.lang.startsWith("en"),
          ) ??
          voices.find((v) => v.lang.startsWith("en")) ??
          null
        );
      };

      const voice = pickVoice();
      if (voice) utt.voice = voice;
      else {
        // voices may not be loaded yet — retry once after a short delay
        window.speechSynthesis.onvoiceschanged = () => {
          const v2 = pickVoice();
          if (v2) utt.voice = v2;
          window.speechSynthesis.onvoiceschanged = null;
        };
      }

      utt.onstart = () => setSpeakingMsgId(msgId);
      utt.onend = () => setSpeakingMsgId(null);
      utt.onerror = () => setSpeakingMsgId(null);

      utteranceRef.current = utt;
      window.speechSynthesis.speak(utt);
    },
    [isSupported],
  );

  const stop = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setSpeakingMsgId(null);
    utteranceRef.current = null;
  }, [isSupported]);

  return { isSpeaking, speakingMsgId, isSupported, speak, stop };
}
