/**
 * hooks/useSpeechOutput.ts — Backward-compatibility shim.
 *
 * Delegates to the global SpeechManager via useSpeechSession.
 * New code should use useSpeechSession directly.
 */

import { useSpeechSession } from "./useSpeechSession";

export function useSpeechOutput() {
  const session = useSpeechSession();
  return {
    isSpeaking: session.isSpeaking,
    speakingMsgId: session.currentMsgId,
    isSupported: session.isSupported,
    speak: (msgId: string, text: string) => session.speak(msgId, text),
    stop: session.stop,
  };
}
