import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_WORDS = ["atento ai", "atento", "hola"];

type Status = "idle" | "listening" | "processing" | "speaking" | "unsupported";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

export function useVoiceAssistant(onCommand: (text: string) => Promise<string>) {
  const [status, setStatus] = useState<Status>("idle");
  const [enabled, setEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<AnyRecognition>(null);
  const enabledRef = useRef(false);
  const busyRef = useRef(false);
  const activeRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armedUntilRef = useRef(0);
  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const startListening = useCallback(
    (delay = 0) => {
      clearRestartTimer();
      if (!enabledRef.current || busyRef.current) return;

      const run = () => {
        if (!enabledRef.current || busyRef.current) return;

        const rec = recRef.current;
        if (!rec) return;

        const alreadyListening = activeRef.current || rec.state === "listening";
        if (alreadyListening) return;

        try {
          rec.start();
        } catch {
          activeRef.current = false;
          restartTimerRef.current = setTimeout(() => startListening(400), 400);
        }
      };

      restartTimerRef.current = setTimeout(run, delay);
    },
    [clearRestartTimer],
  );

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return resolve();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-CO";
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.lang.toLowerCase().startsWith("es"));
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }, []);

  const handle = useCallback(
    async (text: string) => {
      busyRef.current = true;
      armedUntilRef.current = 0;
      setStatus("processing");
      setInterim("");

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
        startListening(250);
      }
    },
    [speak, startListening],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SR =
      (window as AnyRecognition).SpeechRecognition ||
      (window as AnyRecognition).webkitSpeechRecognition;

    const isSecureContext =
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (!SR) {
      setStatus("unsupported");
      setError("Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.");
      return;
    }

    if (!isSecureContext) {
      setStatus("idle");
      setError("El reconocimiento de voz solo funciona en HTTPS o localhost.");
      return;
    }

    const rec = new SR();
    rec.lang = "es-CO";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => {
      activeRef.current = true;
      setError(null);
      if (enabledRef.current && !busyRef.current) setStatus("listening");
    };

    rec.onresult = (e: AnyRecognition) => {
      let partial = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript.trim();

        if (r.isFinal) {
          setInterim("");
          const lower = t.toLowerCase();
          const wake = WAKE_WORDS.find((w) => lower.includes(w));
          const isArmed = Date.now() < armedUntilRef.current;

          if ((wake || isArmed) && !busyRef.current) {
            if (!wake) {
              armedUntilRef.current = 0;
              if (t.length > 2) void handle(t);
              continue;
            }

            const rest = t.slice(lower.indexOf(wake) + wake.length).replace(/^[\s,.]+/, "");

            if (rest.length > 2) {
              void handle(rest);
            } else {
              armedUntilRef.current = Date.now() + 10_000;
              setInterim("Te escucho…");
            }
          }
        } else {
          partial += t;
        }
      }

      if (partial) setInterim(partial);
    };

    rec.onend = () => {
      activeRef.current = false;
      if (enabledRef.current && !busyRef.current) {
        startListening(300);
      }
    };

    rec.onerror = (e: AnyRecognition) => {
      activeRef.current = false;

      if (["not-allowed", "service-not-allowed"].includes(e.error)) {
        enabledRef.current = false;
        setEnabled(false);
        setStatus("idle");
        setError("El micrófono está bloqueado. Permite su uso en el navegador y vuelve a intentarlo.");
        clearRestartTimer();
        return;
      }

      if (["audio-capture", "network", "no-speech"].includes(e.error)) {
        setError("No pude capturar tu voz. Revisa el micrófono y vuelve a intentarlo.");
      }

      if (e.error !== "aborted" && enabledRef.current && !busyRef.current) {
        startListening(800);
      }
    };

    recRef.current = rec;

    return () => {
      enabledRef.current = false;
      clearRestartTimer();
      try {
        rec.stop();
      } catch {}
    };
  }, [clearRestartTimer, handle, startListening]);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;

    if (enabledRef.current) {
      enabledRef.current = false;
      setEnabled(false);
      setStatus("idle");
      setInterim("");
      clearRestartTimer();
      try {
        rec.stop();
      } catch {}
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    setStatus("listening");
    setError(null);
    startListening();
  }, [clearRestartTimer, startListening]);

  return { status, enabled, interim, error, toggle, sendText: handle };
}