import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_WORDS = ["atento ai", "atento", "hola"];

// Tiempo máximo esperando respuesta de la IA
const COMMAND_TIMEOUT_MS = 20_000;

// Tiempo máximo esperando que termine la respuesta de voz
const SPEECH_TIMEOUT_MS = 15_000;

// Tiempo que esperamos antes de convertir un resultado provisional
// en un comando. Antes era 1.1 segundos.
const INTERIM_FALLBACK_MS = 3_000;

// Tiempo disponible para completar el comando después de decir
// "Hola", "Atento" o "Atento AI".
const ARMED_TIMEOUT_MS = 15_000;

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
  // LIMPIAR TEMPORIZADOR DE RESULTADO PROVISIONAL
  // ------------------------------------------------------------

  const clearInterimTimer = useCallback(() => {
    if (interimTimerRef.current) {
      clearTimeout(interimTimerRef.current);
    }

    interimTimerRef.current = null;
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

          // Si Chrome todavía considera activo el reconocimiento,
          // esperamos un poco y volvemos a intentar.
          startListening(700);
        }
      }, delay);
    },
    [clearRestartTimer],
  );

  // ------------------------------------------------------------
  // RESPUESTA DE VOZ
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

        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

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

      // Evitamos comandos demasiado cortos.
      if (command.length < 3) {
        return;
      }

      // No procesamos dos comandos simultáneamente.
      if (busyRef.current) {
        return;
      }

      // El asistente debe estar activado.
      if (!enabledRef.current) {
        return;
      }

      // Evita ejecutar dos veces exactamente el mismo comando.
      if (command === lastCommandRef.current) {
        return;
      }

      lastCommandRef.current = command;

      busyRef.current = true;

      // Ya no estamos esperando un comando después de la palabra
      // de activación.
      armedUntilRef.current = 0;

      clearInterimTimer();

      setStatus("processing");
      setInterim("");

      // Detenemos temporalmente el reconocimiento mientras
      // procesamos el comando.
      try {
        recRef.current?.stop();
      } catch {}

      try {
        // Damos máximo 20 segundos para que la IA responda.
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

          // Volvemos automáticamente a escuchar.
          if (enabledRef.current) {
            startListening(300);
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

  // ------------------------------------------------------------
  // CONFIGURAR SPEECH RECOGNITION
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

    // Mantener escucha continua.
    rec.continuous = true;

    // Permitir resultados provisionales.
    rec.interimResults = true;

    // Solo necesitamos la primera alternativa.
    rec.maxAlternatives = 1;

    // ----------------------------------------------------------
    // CUANDO EMPIEZA A ESCUCHAR
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
    // CUANDO RECIBE VOZ
    // ----------------------------------------------------------

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

        // ------------------------------------------------------
        // RESULTADO FINAL
        // ------------------------------------------------------

        if (result.isFinal) {
          clearInterimTimer();

          setInterim("");

          const lower =
            transcript.toLowerCase();

          const wake =
            WAKE_WORDS.find((word) =>
              lower.includes(word),
            );

          const isArmed =
            Date.now() <
            armedUntilRef.current;

          // Si detectamos palabra de activación o ya estamos
          // esperando el comando.
          if (
            (wake || isArmed) &&
            !busyRef.current
          ) {
            // --------------------------------------------------
            // YA ESTABA ARMADO
            // --------------------------------------------------

            if (!wake) {
              armedUntilRef.current = 0;

              void handle(transcript);

              continue;
            }

            // --------------------------------------------------
            // ENCONTRAMOS "HOLA", "ATENTO", ETC.
            // --------------------------------------------------

            const startIndex =
              lower.indexOf(wake) +
              wake.length;

            const rest = transcript
              .slice(startIndex)
              .replace(
                /^[\s,.!?]+/,
                "",
              );

            // Si la persona dijo:
            //
            // "Hola cuánto dinero tengo"
            //
            // procesamos directamente.
            if (rest.length > 2) {
              void handle(rest);
            } else {
              // Si solamente dijo:
              //
              // "Hola"
              //
              // esperamos el comando.
              armedUntilRef.current =
                Date.now() +
                ARMED_TIMEOUT_MS;

              setInterim(
                "Te escucho…",
              );
            }
          }
        }

        // ------------------------------------------------------
        // RESULTADO PROVISIONAL
        // ------------------------------------------------------

        else {
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

      // Mostrar lo que está entendiendo el asistente.
      setInterim(partial);

      // Reiniciamos el contador cada vez que llega nuevo audio.
      clearInterimTimer();

      /*
       * Algunos navegadores móviles entregan resultados
       * provisionales durante demasiado tiempo.
       *
       * Esperamos 3 segundos SIN nuevo resultado antes de
       * intentar procesar el comando.
       */
      interimTimerRef.current =
        setTimeout(() => {
          interimTimerRef.current = null;

          if (
            busyRef.current ||
            !enabledRef.current
          ) {
            return;
          }

          const lower =
            partial.toLowerCase();

          const wake =
            WAKE_WORDS.find((word) =>
              lower.includes(word),
            );

          const isArmed =
            Date.now() <
            armedUntilRef.current;

          // Todavía no hay palabra de activación.
          if (!wake && !isArmed) {
            return;
          }

          // ----------------------------------------------------
          // TIENE PALABRA DE ACTIVACIÓN
          // ----------------------------------------------------

          if (wake) {
            const startIndex =
              lower.indexOf(wake) +
              wake.length;

            const rest = partial
              .slice(startIndex)
              .replace(
                /^[\s,.!?]+/,
                "",
              );

            if (rest.length > 2) {
              void handle(rest);
            } else {
              armedUntilRef.current =
                Date.now() +
                ARMED_TIMEOUT_MS;

              setInterim(
                "Te escucho…",
              );
            }
          }

          // ----------------------------------------------------
          // YA ESTABA ESPERANDO EL COMANDO
          // ----------------------------------------------------

          else {
            armedUntilRef.current = 0;

            void handle(partial);
          }
        }, INTERIM_FALLBACK_MS);
    };

    // ----------------------------------------------------------
    // CUANDO CHROME DETIENE EL RECONOCIMIENTO
    // ----------------------------------------------------------

    rec.onend = () => {
      activeRef.current = false;

      /*
       * Chrome/Android puede cerrar SpeechRecognition
       * incluso con continuous=true.
       *
       * Si el asistente sigue activado, lo reiniciamos.
       */
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

      // --------------------------------------------------------
      // MICRÓFONO BLOQUEADO
      // --------------------------------------------------------

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

      // --------------------------------------------------------
      // PROBLEMA CON EL MICRÓFONO
      // --------------------------------------------------------

      if (e.error === "audio-capture") {
        setError(
          "No pude acceder al micrófono. Revisa que no esté siendo usado por otra aplicación.",
        );
      }

      // --------------------------------------------------------
      // OTROS ERRORES
      // --------------------------------------------------------

      else if (
        e.error !== "aborted" &&
        e.error !== "no-speech"
      ) {
        setError(
          "La escucha se interrumpió. Reintentando…",
        );
      }

      // --------------------------------------------------------
      // RECUPERACIÓN AUTOMÁTICA
      // --------------------------------------------------------

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

  // ------------------------------------------------------------
  // BOTÓN ACTIVAR / DESACTIVAR
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

      armedUntilRef.current = 0;

      clearRestartTimer();
      clearInterimTimer();

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

    armedUntilRef.current = 0;

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