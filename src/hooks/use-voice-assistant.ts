import { useCallback, useEffect, useRef, useState } from "react";

const COMMAND_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 15_000;

// Espera después del último fragmento de voz antes de procesar.
const SILENCE_DELAY_MS = 3_000;

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

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastCommandRef = useRef("");

  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;

  // ------------------------------------------------------------
  // LIMPIAR TEMPORIZADOR DE REINICIO
  // ------------------------------------------------------------

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
    }

    restartTimerRef.current = null;
  }, []);

  // ------------------------------------------------------------
  // LIMPIAR TEMPORIZADOR DE SILENCIO
  // ------------------------------------------------------------

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }

    silenceTimerRef.current = null;
  }, []);

  // ------------------------------------------------------------
  // INICIAR ESCUCHA
  // ------------------------------------------------------------

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

  // ------------------------------------------------------------
  // RESPUESTA HABLADA
  // ------------------------------------------------------------

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

        let finished = false;

        const finish = () => {
          if (finished) {
            return;
          }

          finished = true;

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
            v.lang
              .toLowerCase()
              .startsWith("es"),
          );

        if (voice) {
          utterance.voice = voice;
        }

        utterance.onend = finish;
        utterance.onerror = finish;

        window.speechSynthesis.speak(
          utterance,
        );
      }),
    [],
  );

  // ------------------------------------------------------------
  // PROCESAR COMANDO
  // ------------------------------------------------------------

  const handle = useCallback(
    async (text: string) => {
      const command = text.trim();

      if (command.length < 3) {
        return;
      }

      if (
        busyRef.current ||
        !enabledRef.current
      ) {
        return;
      }

      // Evitar duplicados exactos.
      if (command === lastCommandRef.current) {
        return;
      }

      lastCommandRef.current = command;

      busyRef.current = true;

      clearSilenceTimer();

      setInterim("");
      setStatus("processing");

      // Detener reconocimiento mientras se procesa.
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
            startListening(300);
          }
        }
      }
    },
    [
      clearSilenceTimer,
      speak,
      startListening,
    ],
  );

  // ------------------------------------------------------------
  // CONFIGURAR RECONOCIMIENTO DE VOZ
  // ------------------------------------------------------------

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

    // Escucha continua.
    rec.continuous = true;

    // Necesitamos resultados provisionales.
    rec.interimResults = true;

    rec.maxAlternatives = 1;

    // ----------------------------------------------------------
    // COMIENZA A ESCUCHAR
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // RECIBE VOZ
    // ----------------------------------------------------------

    rec.onresult = (e: AnyRecognition) => {
      let finalText = "";
      let interimText = "";

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
          finalText += `${transcript} `;
        } else {
          interimText += `${transcript} `;
        }
      }

      finalText = finalText.trim();
      interimText = interimText.trim();

      // --------------------------------------------------------
      // SI HAY TEXTO FINAL
      // --------------------------------------------------------

      if (finalText) {
        clearSilenceTimer();

        setInterim(finalText);

        /*
         * No procesamos inmediatamente.
         *
         * Esperamos 3 segundos para darle tiempo a la persona
         * de continuar hablando.
         */

        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;

          if (
            busyRef.current ||
            !enabledRef.current
          ) {
            return;
          }

          const command = finalText.trim();

          if (command.length > 2) {
            void handle(command);
          }
        }, SILENCE_DELAY_MS);

        return;
      }

      // --------------------------------------------------------
      // RESULTADO PROVISIONAL
      // --------------------------------------------------------

      if (interimText) {
        setInterim(interimText);

        clearSilenceTimer();

        /*
         * Reiniciamos el temporizador cada vez que la persona
         * sigue hablando.
         *
         * Mientras continúe hablando, no se procesa.
         */

        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;

          if (
            busyRef.current ||
            !enabledRef.current
          ) {
            return;
          }

          const command = interimText.trim();

          if (command.length > 2) {
            void handle(command);
          }
        }, SILENCE_DELAY_MS);
      }
    };

    // ----------------------------------------------------------
    // CHROME DETUVO EL RECONOCIMIENTO
    // ----------------------------------------------------------

    rec.onend = () => {
      activeRef.current = false;

      if (
        enabledRef.current &&
        !busyRef.current
      ) {
        startListening(400);
      }
    };

    // ----------------------------------------------------------
    // ERRORES
    // ----------------------------------------------------------

    rec.onerror = (e: AnyRecognition) => {
      activeRef.current = false;

      if (e.error === "not-allowed") {
        enabledRef.current = false;

        setEnabled(false);
        setStatus("idle");

        setError(
          "El micrófono está bloqueado. Permite su uso en el navegador y vuelve a activarlo.",
        );

        clearRestartTimer();
        clearSilenceTimer();

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
            : 700,
        );
      }
    };

    recRef.current = rec;

    // ----------------------------------------------------------
    // LIMPIEZA
    // ----------------------------------------------------------

    return () => {
      mountedRef.current = false;

      enabledRef.current = false;

      clearRestartTimer();
      clearSilenceTimer();

      try {
        rec.stop();
      } catch {}

      try {
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, [
    clearRestartTimer,
    clearSilenceTimer,
    handle,
    startListening,
  ]);

  // ------------------------------------------------------------
  // ACTIVAR / DESACTIVAR
  // ------------------------------------------------------------

  const toggle = useCallback(() => {
    const rec = recRef.current;

    if (!rec) {
      return;
    }

    // ----------------------------------------------------------
    // DESACTIVAR
    // ----------------------------------------------------------

    if (enabledRef.current) {
      enabledRef.current = false;

      setEnabled(false);
      setStatus("idle");
      setInterim("");

      clearRestartTimer();
      clearSilenceTimer();

      try {
        rec.stop();
      } catch {}

      return;
    }

    // ----------------------------------------------------------
    // ACTIVAR
    // ----------------------------------------------------------

    lastCommandRef.current = "";

    enabledRef.current = true;

    setEnabled(true);
    setStatus("listening");
    setError(null);

    clearSilenceTimer();

    startListening();
  }, [
    clearRestartTimer,
    clearSilenceTimer,
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