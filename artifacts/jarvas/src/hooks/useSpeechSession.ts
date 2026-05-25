/**
 * hooks/useSpeechSession.ts — React adapter for the global SpeechManager singleton.
 *
 * Subscribe once on mount, unsubscribe on unmount. Snapshot updates
 * propagate to all mounted consumers via a single shared subscriber.
 *
 * Returned controls:
 *   speak(msgId, text)       — interrupt-speak (cancel current, speak this)
 *   queue(msgId, text)       — enqueue without interrupting (auto-speak use-case)
 *   stop()                   — cancelAll
 *   toggle(msgId, text)      — speak if not active, stop if already speaking this msg
 *   setAutoSpeak(bool)       — persist auto-speak preference
 *   unlock()                 — iOS audio context unlock on first gesture
 */

import { useState, useEffect, useCallback } from "react";
import { SpeechManager, type SpeechSnapshot } from "@/lib/speechManager";

export type { SpeechSnapshot };
export type { SpeechState } from "@/lib/speechManager";

export interface SpeechSession extends SpeechSnapshot {
  /** True while state is speaking or paused */
  isSpeaking: boolean;
  /** True while any non-idle, non-error state is active */
  isActive: boolean;
  /** True when this specific msgId is the active utterance */
  isSpeakingMsg: (msgId: string) => boolean;
  isSupported: boolean;
  speak: (msgId: string, text: string) => void;
  queue: (msgId: string, text: string, priority?: number) => void;
  stop: () => void;
  toggle: (msgId: string, text: string) => void;
  setAutoSpeak: (val: boolean) => void;
  unlock: () => void;
}

export function useSpeechSession(): SpeechSession {
  const manager = SpeechManager.getInstance();
  const [snap, setSnap] = useState<SpeechSnapshot>(() => manager.getSnapshot());

  useEffect(() => {
    return manager.subscribe(setSnap);
  }, [manager]);

  const speak = useCallback(
    (msgId: string, text: string) =>
      manager.enqueue(msgId, text, { interrupt: true }),
    [manager],
  );

  const queue = useCallback(
    (msgId: string, text: string, priority = 0) =>
      manager.enqueue(msgId, text, { interrupt: false, priority }),
    [manager],
  );

  const stop = useCallback(() => manager.cancelAll(), [manager]);

  const toggle = useCallback(
    (msgId: string, text: string) => {
      const s = manager.getSnapshot();
      if (s.currentMsgId === msgId && s.state !== "idle" && s.state !== "error") {
        manager.cancelAll();
      } else {
        manager.enqueue(msgId, text, { interrupt: true });
      }
    },
    [manager],
  );

  const setAutoSpeak = useCallback(
    (val: boolean) => manager.setAutoSpeak(val),
    [manager],
  );

  const unlock = useCallback(() => manager.unlock(), [manager]);

  const isSpeakingMsg = useCallback(
    (msgId: string) =>
      snap.currentMsgId === msgId &&
      (snap.state === "speaking" ||
        snap.state === "paused" ||
        snap.state === "preparing"),
    [snap],
  );

  return {
    ...snap,
    isSpeaking: snap.state === "speaking" || snap.state === "paused",
    isActive:
      snap.state !== "idle" &&
      snap.state !== "error" &&
      snap.state !== "recovering",
    isSpeakingMsg,
    isSupported: manager.isSupported,
    speak,
    queue,
    stop,
    toggle,
    setAutoSpeak,
    unlock,
  };
}
