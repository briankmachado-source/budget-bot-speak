import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_WORDS = ["atento ai", "atento", "hola"];

type Status = "idle" | "listening" | "processing" | "speaking" | "unsupported";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

export function useVoiceAssistant(onCommand: (text: string) => Promise<string>) {
  const [status, setStatus] = useState<Status>("idle");
  const [enabled, setEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<AnyRecognition>(null);
  const enabledRef = useRef(false);
  const busyRef = useRef(false);
  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return resolve();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-CO";
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.lang.startsWith("es"));
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }, []);

  const handle = useCallback(
    async (text: string) => {
      busyRef.current = true;
      setStatus("processing");
      try {
        recRef.current?.stop();
      } catch {}
      try {
        const reply = await cmdRef.current(text);
        setStatus("speaking");
        await speak(reply);
      } finally {
        busyRef.current = false;
        setStatus(enabledRef.current ? "listening" : "idle");
        if (enabledRef.current) {
          try {
            recRef.current?.start();
          } catch {}
        }
      }
    },
    [speak],
  );

  useEffect(() => {
    const SR =
      (window as AnyRecognition).SpeechRecognition ||
      (window as AnyRecognition).webkitSpeechRecognition;
    if (!SR) {
      setStatus("unsupported");
      return;
    }
    const rec = new SR();
    rec.lang = "es-CO";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: AnyRecognition) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript.trim();
        if (r.isFinal) {
          setInterim("");
          const lower = t.toLowerCase();
          const wake = WAKE_WORDS.find((w) => lower.includes(w));
          if (wake && !busyRef.current) {
            const rest = t.slice(lower.indexOf(wake) + wake.length).replace(/^[\s,.]+/, "");
            if (rest.length > 2) void handle(rest);
            else void speak("Te escucho.");
          }
        } else partial += t;
      }
      if (partial) setInterim(partial);
    };
    rec.onend = () => {
      if (enabledRef.current && !busyRef.current) {
        try {
          rec.start();
        } catch {}
      }
    };
    rec.onerror = (e: AnyRecognition) => {
      if (e.error === "not-allowed") {
        enabledRef.current = false;
        setEnabled(false);
        setStatus("idle");
      }
    };
    recRef.current = rec;
    return () => {
      enabledRef.current = false;
      try {
        rec.stop();
      } catch {}
    };
  }, [handle, speak]);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      setStatus("idle");
      try {
        rec.stop();
      } catch {}
    } else {
      enabledRef.current = true;
      setEnabled(true);
      setStatus("listening");
      try {
        rec.start();
      } catch {}
    }
  }, []);

  return { status, enabled, interim, toggle, sendText: handle };
}
