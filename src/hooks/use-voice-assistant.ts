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