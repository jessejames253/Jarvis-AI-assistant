/**
 * useSpeechOutput — robust SpeechSynthesis hook for iOS Safari / mobile
 *
 * Fixes addressed:
 *  1. iOS cancel→speak gap: 120ms delay after cancel() before queuing new utterance
 *  2. Stuck synth heartbeat: resume() every 5s while speaking (known iOS bug)
 *  3. Tab visibility recovery: resume() on visibilitychange if paused
 *  4. Watchdog timer: force-resets state if onend never fires (estimated duration + buffer)
 *  5. Unmount safety: mountedRef prevents setState after component gone, full cancel on cleanup
 *  6. Error filtering: "interrupted"/"canceled" errors ignored (iOS fires on intentional cancel)
 *  7. Voice loading: addEventListener instead of onvoiceschanged assignment
 *  8. Utterance GC: ref kept alive for full duration
 *  9. Debug logging: [Speech] prefix on all key events
 */

import { useState, useCallback, useRef, useEffect } from "react";

const HEARTBEAT_MS = 5_000;
const CANCEL_GAP_MS = 120;   // iOS needs a brief pause between cancel() and speak()
const WATCHDOG_BUFFER_MS = 6_000;
const WORDS_PER_MIN = 140;

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

function slog(event: string, ...rest: unknown[]) {
  console.debug("[Speech]", event, ...rest);
}

export function useSpeechOutput() {
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const watchdogRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gapTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);

  const isSupported =
    typeof window !== "undefined" && !!window.speechSynthesis;

  // ── helpers ────────────────────────────────────────────────────────────────

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const clearGapTimer = useCallback(() => {
    if (gapTimerRef.current !== null) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
  }, []);

  /** Hard-reset everything. Safe to call from any state. */
  const forceReset = useCallback(
    (reason: string) => {
      slog("recovery triggered:", reason);
      clearWatchdog();
      clearGapTimer();
      if (isSupported) window.speechSynthesis.cancel();
      utteranceRef.current = null;
      if (mountedRef.current) setSpeakingMsgId(null);
    },
    [isSupported, clearWatchdog, clearGapTimer],
  );

  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) slog("voices loaded:", voices.length);
    return (
      voices.find(
        (v) =>
          /daniel|alex|samantha|google.*en|en-us/i.test(v.name) &&
          v.lang.startsWith("en"),
      ) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null
    );
  }, []);

  // ── effects ────────────────────────────────────────────────────────────────

  /** Heartbeat: iOS Safari stalls the synth mid-sentence without this. */
  useEffect(() => {
    if (!isSupported) return;
    const id = setInterval(() => {
      const ss = window.speechSynthesis;
      if (ss.speaking && !ss.paused) ss.resume();
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [isSupported]);

  /** Tab visibility: resume if the synth was paused by iOS when tab went to background. */
  useEffect(() => {
    if (!isSupported) return;
    const handler = () => {
      if (document.visibilityState === "visible") {
        const ss = window.speechSynthesis;
        if (ss.paused) {
          slog("tab visible — resuming paused synth");
          ss.resume();
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [isSupported]);

  /** Unmount: cancel everything, block further setState. */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearWatchdog();
      clearGapTimer();
      if (isSupported) {
        slog("speech cancelled (unmount)");
        window.speechSynthesis.cancel();
      }
    };
  }, [isSupported, clearWatchdog, clearGapTimer]);

  // ── public API ─────────────────────────────────────────────────────────────

  const speak = useCallback(
    (msgId: string, text: string) => {
      if (!isSupported) return;

      const cleaned = stripMarkdown(text);
      if (!cleaned) return;

      // Cancel anything currently running
      slog("speech cancelled (new speak request)");
      clearWatchdog();
      clearGapTimer();
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      if (mountedRef.current) setSpeakingMsgId(null);

      // iOS drops the utterance if speak() follows cancel() too quickly
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        if (!mountedRef.current) return;

        const utt = new SpeechSynthesisUtterance(cleaned);
        utt.rate   = 1.05;
        utt.pitch  = 0.88;
        utt.volume = 1;

        // Assign voice, or defer until voiceschanged fires
        const voice = pickVoice();
        if (voice) {
          utt.voice = voice;
        } else {
          const onChanged = () => {
            const v = pickVoice();
            if (v) utt.voice = v;
            window.speechSynthesis.removeEventListener("voiceschanged", onChanged);
          };
          window.speechSynthesis.addEventListener("voiceschanged", onChanged);
        }

        utt.onstart = () => {
          slog("speech started:", msgId);
          clearWatchdog();
          if (mountedRef.current) setSpeakingMsgId(msgId);

          // Watchdog fires if onend is never called (iOS GC / synth crash)
          const wordCount = cleaned.split(/\s+/).length;
          const estimatedMs =
            Math.max(10_000, Math.ceil((wordCount / WORDS_PER_MIN) * 60_000)) +
            WATCHDOG_BUFFER_MS;
          watchdogRef.current = setTimeout(() => {
            slog("speech watchdog fired — forcing reset");
            forceReset("watchdog timeout after " + estimatedMs + "ms");
          }, estimatedMs);
        };

        utt.onend = () => {
          slog("speech ended:", msgId);
          clearWatchdog();
          utteranceRef.current = null;
          if (mountedRef.current) setSpeakingMsgId(null);
        };

        utt.onerror = (e: SpeechSynthesisErrorEvent) => {
          // iOS fires "interrupted" or "canceled" when we call cancel() ourselves — not a real error
          if (e.error === "interrupted" || e.error === "canceled") {
            slog("speech cancelled/interrupted (expected):", e.error);
            return;
          }
          slog("speech error:", e.error);
          clearWatchdog();
          utteranceRef.current = null;
          if (mountedRef.current) setSpeakingMsgId(null);
        };

        // Hold a ref to prevent GC before onend fires
        utteranceRef.current = utt;
        window.speechSynthesis.speak(utt);
        slog("speech queued:", msgId);
      }, CANCEL_GAP_MS);
    },
    [isSupported, pickVoice, clearWatchdog, clearGapTimer, forceReset],
  );

  const stop = useCallback(() => {
    if (!isSupported) return;
    slog("speech cancelled (stop)");
    clearWatchdog();
    clearGapTimer();
    window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeakingMsgId(null);
  }, [isSupported, clearWatchdog, clearGapTimer]);

  return {
    isSpeaking: speakingMsgId !== null,
    speakingMsgId,
    isSupported,
    speak,
    stop,
  };
}
