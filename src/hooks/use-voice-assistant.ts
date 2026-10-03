import { useCallback, useEffect, useRef, useState } from "react";

const COMMAND_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 15_000;

// Tiempo de silencio antes de procesar el comando.
// 2 segundos.
const SILENCE_DELAY_MS = 2_000;

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

  // IMPORTANTE:
  // Evita que el reconocimiento vuelva a activarse
  // mientras Atento AI está hablando.
  const speakingRef = useRef(false);

  const mountedRef = useRef(true);

  const restartTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guarda todo lo que el usuario ha dicho antes
  // de llegar a los 2 segundos de silencio.
  const commandBufferRef = useRef("");

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
        speakingRef.current ||
        !mountedRef.current
      ) {
        return;
      }

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;

        if (
          !enabledRef.current ||
          busyRef.current ||
          speakingRef.current ||
          activeRef.current ||
          !mountedRef.current
        ) {
          return;
        }

        try {
          recRef.current?.start();
        } catch {
          activeRef.current = false;

          if (
            enabledRef.current &&
            !busyRef.current &&
            !speakingRef.current
          ) {
            startListening(700);
          }
        }
      }, delay);
    },
    [clearRestartTimer],
  );

  // ------------------------------------------------------------
  // DETENER MICRÓFONO
  // ------------------------------------------------------------

  const stopListening = useCallback(() => {
    clearRestartTimer();
    clearSilenceTimer();

    activeRef.current = false;

    try {
      recRef.current?.stop();
    } catch {}

  }, [
    clearRestartTimer,
    clearSilenceTimer,
  ]);

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

        // Marcar que Atento AI está hablando.
        // Esto impide que onend vuelva a activar el micrófono.
        speakingRef.current = true;

        // Detener cualquier reconocimiento que pudiera
        // haber quedado activo.
        try {
          recRef.current?.stop();
        } catch {}

        // Cancelar cualquier frase anterior.
        window.speechSynthesis.cancel();

        let finished = false;

        const finish = () => {
          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(timeout);

          // Atento AI ya terminó de hablar.
          speakingRef.current = false;

          resolve();
        };

        const timeout = setTimeout(
          finish,
          SPEECH_TIMEOUT_MS,
        );

        const utterance =
          new SpeechSynthesisUtterance(text);

        utterance.lang = "es-CO";

        utterance.rate = 1;
        utterance.pitch = 1;

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

        // Cuando termina de hablar.
        utterance.onend = finish;

        // Si ocurre un error también liberamos
        // el bloqueo del micrófono.
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

      // Evitar comandos duplicados.
      if (command === lastCommandRef.current) {
        return;
      }

      lastCommandRef.current = command;

      busyRef.current = true;

      clearSilenceTimer();

      // Limpiar el buffer antes de procesar.
      commandBufferRef.current = "";

      setInterim("");
      setStatus("processing");

      // --------------------------------------------------------
      // MUY IMPORTANTE:
      // apagar micrófono ANTES de procesar.
      // --------------------------------------------------------

      stopListening();

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

        // ------------------------------------------------------
        // ATENTO AI HABLA
        //
        // El micrófono permanece apagado durante toda
        // la respuesta.
        // ------------------------------------------------------

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

        setStatus("speaking");

        await speak(
          "No pude procesar eso. Intenta de nuevo.",
        );

      } finally {
        // Asegurarnos de que el bloqueo se libere.
        speakingRef.current = false;

        busyRef.current = false;

        if (mountedRef.current) {
          setStatus(
            enabledRef.current
              ? "listening"
              : "idle",
          );

          // ----------------------------------------------------
          // Cuando Atento AI termina de hablar,
          // volvemos a activar el micrófono.
          // ----------------------------------------------------

          if (
            enabledRef.current &&
            !speakingRef.current
          ) {
            startListening(300);
          }
        }
      }
    },
    [
      clearSilenceTimer,
      speak,
      startListening,
      stopListening,
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

    // Resultados provisionales.
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
        !busyRef.current &&
        !speakingRef.current
      ) {
        setStatus("listening");
      }
    };

    // ----------------------------------------------------------
    // RECIBE VOZ
    // ----------------------------------------------------------

    rec.onresult = (e: AnyRecognition) => {
      // Si Atento AI está hablando, ignoramos completamente
      // cualquier resultado que pudiera llegar.
      if (
        speakingRef.current ||
        busyRef.current
      ) {
        return;
      }

      let newFinalText = "";
      let newInterimText = "";

      for (
        let i = e.resultIndex;
        i < e.results.length;
        i++
      ) {
        const result = e.results[i];

        const transcript =
          result[0]?.transcript?.trim() ?? "";

        if (!transcript) {
          continue;
        }

        if (result.isFinal) {
          newFinalText += `${transcript} `;
        } else {
          newInterimText += `${transcript} `;
        }
      }

      newFinalText = newFinalText.trim();
      newInterimText = newInterimText.trim();

      // --------------------------------------------------------
      // AGREGAR TEXTO FINAL
      // --------------------------------------------------------

      if (newFinalText) {
        if (commandBufferRef.current) {
          commandBufferRef.current +=
            ` ${newFinalText}`;
        } else {
          commandBufferRef.current =
            newFinalText;
        }
      }

      // --------------------------------------------------------
      // MOSTRAR LO QUE ESTAMOS ESCUCHANDO
      // --------------------------------------------------------

      const displayText = [
        commandBufferRef.current,
        newInterimText,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (displayText) {
        setInterim(displayText);
      }

      // --------------------------------------------------------
      // REINICIAR LOS 2 SEGUNDOS DE SILENCIO
      // --------------------------------------------------------

      if (
        newFinalText ||
        newInterimText
      ) {
        clearSilenceTimer();

        silenceTimerRef.current =
          setTimeout(() => {
            silenceTimerRef.current = null;

            if (
              busyRef.current ||
              speakingRef.current ||
              !enabledRef.current
            ) {
              return;
            }

            const command =
              commandBufferRef.current.trim();

            if (command.length > 2) {
              void handle(command);
            }

          }, SILENCE_DELAY_MS);
      }
    };

    // ----------------------------------------------------------
    // RECONOCIMIENTO TERMINÓ
    // ----------------------------------------------------------

    rec.onend = () => {
      activeRef.current = false;

      // NO reiniciar el micrófono si:
      //
      // - el usuario lo desactivó
      // - estamos procesando
      // - Atento AI está hablando
      //
      if (
        enabledRef.current &&
        !busyRef.current &&
        !speakingRef.current
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

      // No intentar reiniciar mientras Atento AI habla.
      if (
        e.error !== "aborted" &&
        enabledRef.current &&
        !busyRef.current &&
        !speakingRef.current
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

      busyRef.current = false;
      speakingRef.current = false;
      activeRef.current = false;

      clearRestartTimer();
      clearSilenceTimer();

      commandBufferRef.current = "";

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

      commandBufferRef.current = "";

      try {
        rec.stop();
      } catch {}

      return;
    }

    // ----------------------------------------------------------
    // ACTIVAR
    // ----------------------------------------------------------

    lastCommandRef.current = "";
    commandBufferRef.current = "";

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

  // ------------------------------------------------------------
  // RESULTADO DEL HOOK
  // ------------------------------------------------------------

  return {
    status,
    enabled,
    interim,
    error,
    toggle,
    sendText: handle,
  };
}
