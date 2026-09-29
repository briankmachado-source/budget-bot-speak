import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_WORDS = ["atento ai", "atento", "hola"];

const COMMAND_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 15_000;
const INTERIM_FALLBACK_MS = 1_100;

type Status =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "unsupported";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

export function useVoiceAssistant(
  onCommand: (text: string) => Promise<string>,
) {
  const [status, setStatus] = useState<Status>("idle");
  const [enabled, setEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<AnyRecognition>(null);

  const enabledRef = useRef(false);
  const busyRef = useRef(false);
  const activeRef = useRef(false);
  const mountedRef = useRef(true);

  const restartTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const interimTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const armedUntilRef = useRef(0);
  const lastCommandRef = useRef("");

  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
    }

    restartTimerRef.current = null;
  }, []);

  const clearInterimTimer = useCallback(() => {
    if (interimTimerRef.current) {
      clearTimeout(interimTimerRef.current);
    }

    interimTimerRef.current = null;
  }, []);

  const startListening = useCallback(
    (delay = 0) => {
      clearRestartTimer();

      if (
        !enabledRef.current ||
        busyRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;

        if (
          !enabledRef.current ||
          busyRef.current ||
          activeRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        try {
          recRef.current?.start();
        } catch {
          activeRef.current = false;
          startListening(700);
        }
      }, delay);
    },
    [clearRestartTimer],
  );

  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (
          typeof window === "undefined" ||
          !window.speechSynthesis
        ) {
          resolve();
          return;
        }

        window.speechSynthesis.cancel();

        let settled = false;

        const finish = () => {
          if (settled) return;

          settled = true;
          clearTimeout(timeout);
          resolve();
        };

        const timeout = setTimeout(
          finish,
          SPEECH_TIMEOUT_MS,
        );

        const utterance =
          new SpeechSynthesisUtterance(text);

        utterance.lang = "es-CO";

        const voice = window.speechSynthesis
          .getVoices()
          .find((v) =>
            v.lang.toLowerCase().startsWith("es"),
          );

        if (voice) {
          utterance.voice = voice;
        }

        utterance.onend = finish;
        utterance.onerror = finish;

        window.speechSynthesis.speak(utterance);
      }),
    [],
  );

  const handle = useCallback(
    async (text: string) => {
      const command = text.trim();

      if (
        command.length < 3 ||
        busyRef.current ||
        !enabledRef.current
      ) {
        return;
      }

      // Evita ejecutar dos veces el mismo comando.
      if (command === lastCommandRef.current) {
        return;
      }

      lastCommandRef.current = command;

      busyRef.current = true;
      armedUntilRef.current = 0;

      clearInterimTimer();

      setStatus("processing");
      setInterim("");

      try {
        recRef.current?.stop();
      } catch {}

      try {
        const reply = await Promise.race([
          cmdRef.current(command),

          new Promise<string>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  "El asistente tardó demasiado en responder.",
                ),
              );
            }, COMMAND_TIMEOUT_MS);
          }),
        ]);

        if (!mountedRef.current) {
          return;
        }

        setStatus("speaking");

        await speak(reply);
      } catch (e) {
        if (!mountedRef.current) {
          return;
        }

        const message =
          e instanceof Error
            ? e.message
            : "No pude procesar tu comando.";

        setError(message);

        await speak(
          "No pude procesar eso. Intenta de nuevo.",
        );
      } finally {
        busyRef.current = false;

        if (mountedRef.current) {
          setStatus(
            enabledRef.current
              ? "listening"
              : "idle",
          );

          if (enabledRef.current) {
            startListening(250);
          }
        }
      }
    },
    [
      clearInterimTimer,
      speak,
      startListening,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;

    const SR =
      (window as AnyRecognition).SpeechRecognition ||
      (window as AnyRecognition)
        .webkitSpeechRecognition;

    if (!SR) {
      setStatus("unsupported");
      return;
    }

    const rec = new SR();

    rec.lang = "es-CO";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      activeRef.current = true;

      setError(null);

      if (
        enabledRef.current &&
        !busyRef.current
      ) {
        setStatus("listening");
      }
    };

    rec.onresult = (e: AnyRecognition) => {
      let partial = "";

      for (
        let i = e.resultIndex;
        i < e.results.length;
        i++
      ) {
        const result = e.results[i];

        const transcript =
          result[0].transcript.trim();

        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          clearInterimTimer();

          setInterim("");

          const lower =
            transcript.toLowerCase();

          const wake = WAKE_WORDS.find((word) =>
            lower.includes(word),
          );

          const isArmed =
            Date.now() <
            armedUntilRef.current;

          if (
            (wake || isArmed) &&
            !busyRef.current
          ) {
            if (!wake) {
              armedUntilRef.current = 0;

              void handle(transcript);
            } else {
              const startIndex =
                lower.indexOf(wake) +
                wake.length;

              const rest = transcript
                .slice(startIndex)
                .replace(/^[\s,.!?]+/, "");

              if (rest.length > 2) {
                void handle(rest);
              } else {
                armedUntilRef.current =
                  Date.now() + 10_000;

                setInterim("Te escucho…");
              }
            }
          }
        } else {
          partial += `${transcript} `;
        }
      }

      partial = partial.trim();

      if (
        !partial ||
        busyRef.current
      ) {
        return;
      }

      setInterim(partial);

      clearInterimTimer();

      /*
       * Algunos navegadores móviles pueden quedarse
       * demasiado tiempo entregando únicamente resultados
       * provisionales. Después de un pequeño intervalo,
       * intentamos convertirlos en comando.
       */
      interimTimerRef.current = setTimeout(() => {
        interimTimerRef.current = null;

        if (
          busyRef.current ||
          !enabledRef.current
        ) {
          return;
        }

        const lower =
          partial.toLowerCase();

        const wake = WAKE_WORDS.find((word) =>
          lower.includes(word),
        );

        const isArmed =
          Date.now() <
          armedUntilRef.current;

        if (!wake && !isArmed) {
          return;
        }

        if (wake) {
          const startIndex =
            lower.indexOf(wake) +
            wake.length;

          const rest = partial
            .slice(startIndex)
            .replace(/^[\s,.!?]+/, "");

          if (rest.length > 2) {
            void handle(rest);
          } else {
            armedUntilRef.current =
              Date.now() + 10_000;

            setInterim("Te escucho…");
          }
        } else {
          armedUntilRef.current = 0;

          void handle(partial);
        }
      }, INTERIM_FALLBACK_MS);
    };

    rec.onend = () => {
      activeRef.current = false;

      /*
       * Chrome/Android puede cerrar SpeechRecognition
       * aunque continuous=true.
       *
       * Lo reiniciamos automáticamente.
       */
      if (
        enabledRef.current &&
        !busyRef.current
      ) {
        startListening(300);
      }
    };

    rec.onerror = (e: AnyRecognition) => {
      activeRef.current = false;

      if (e.error === "not-allowed") {
        enabledRef.current = false;

        setEnabled(false);
        setStatus("idle");

        setError(
          "El micrófono está bloqueado. Permite su uso en el navegador y vuelve a tocarlo.",
        );

        clearRestartTimer();
        clearInterimTimer();

        return;
      }

      if (e.error === "audio-capture") {
        setError(
          "No pude acceder al micrófono. Revisa que no esté siendo usado por otra aplicación.",
        );
      } else if (
        e.error !== "aborted" &&
        e.error !== "no-speech"
      ) {
        setError(
          "La escucha se interrumpió. Reintentando…",
        );
      }

      if (
        e.error !== "aborted" &&
        enabledRef.current &&
        !busyRef.current
      ) {
        startListening(
          e.error === "network"
            ? 1500
            : 600,
        );
      }
    };

    recRef.current = rec;

    return () => {
      mountedRef.current = false;

      enabledRef.current = false;

      clearRestartTimer();
      clearInterimTimer();

      try {
        rec.stop();
      } catch {}

      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, [
    clearInterimTimer,
    clearRestartTimer,
    handle,
    startListening,
  ]);

  const toggle = useCallback(() => {
    const rec = recRef.current;

    if (!rec) {
      return;
    }

    if (enabledRef.current) {
      enabledRef.current = false;

      setEnabled(false);
      setStatus("idle");
      setInterim("");

      clearRestartTimer();
      clearInterimTimer();

      try {
        rec.stop();
      } catch {}

      return;
    }

    lastCommandRef.current = "";

    enabledRef.current = true;

    setEnabled(true);
    setStatus("listening");
    setError(null);

    startListening();
  }, [
    clearInterimTimer,
    clearRestartTimer,
    startListening,
  ]);

  return {
    status,
    enabled,
    interim,
    error,
    toggle,
    sendText: handle,
  };
}