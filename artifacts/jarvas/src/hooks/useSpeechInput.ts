import { useRef, useState, useCallback } from "react";

// Web Speech API is not fully typed in all TS lib versions — use any-backed
// constructor so we compile without dom-speech-recognition polyfill types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

export interface SpeechInputHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onDenied: () => void;
}

export function useSpeechInput() {
  const [isListening, setIsListening] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const recognitionRef = useRef<AnySR>(null);

  const isSupported =
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = useCallback(
    (handlers: SpeechInputHandlers) => {
      if (!isSupported) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      const recognition = new SR();

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognitionRef.current = recognition;

      recognition.onresult = (event: AnySR) => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript as string;
          if (event.results[i].isFinal) final += t;
          else interim += t;
        }
        if (final) handlers.onFinal(final);
        else if (interim) handlers.onInterim(interim);
      };

      recognition.onerror = (event: AnySR) => {
        if (event.error === "not-allowed") {
          setPermissionDenied(true);
          handlers.onDenied();
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      try {
        recognition.start();
        setIsListening(true);
        setPermissionDenied(false);
      } catch {
        setIsListening(false);
      }
    },
    [isSupported],
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  return { isListening, isSupported, permissionDenied, start, stop };
}
