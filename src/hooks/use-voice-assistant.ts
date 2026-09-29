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