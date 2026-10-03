import { useCallback, useEffect, useRef, useState } from "react";

const COMMAND_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 60_000;
const SILENCE_DELAY_MS = 2_000;

// Tiempo que esperamos DESPUÉS de que Atento AI termina de hablar
// antes de volver a encender el reconocimiento.
const RESTART_AFTER_SPEECH_MS = 2_000;

// Pequeña espera cuando Chrome termina el reconocimiento por su cuenta.
const RESTART_AFTER_RECOGNITION_END_MS = 400;

type RecognitionResult = {
  0?: {
    transcript?: string;
  };
  isFinal: boolean;
};

type RecognitionEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: RecognitionResult | undefined;
  };
};

type RecognitionErrorEvent = {
  error?: string;
};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => Recognition;

type WindowWithRecognition = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

type Status =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "unsupported";

export function useVoiceAssistant(
  onCommand: (text: string) => Promise<string>,
) {
  const [status, setStatus] = useState<Status>("idle");
  const [enabled, setEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);

  const enabledRef = useRef(false);
  const busyRef = useRef(false);
  const activeRef = useRef(false);

  // BLOQUEO PRINCIPAL.
  // Mientras Atento AI habla, el reconocimiento no puede procesar nada.
  const speakingRef = useRef(false);

  // Mantiene bloqueado el micrófono hasta esta fecha.
  // Sirve para evitar que el reconocimiento capture el final
  // de la voz de Atento AI.
  const cooldownUntilRef = useRef(0);

  const mountedRef = useRef(true);

  const restartTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const silenceTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const commandBufferRef = useRef("");

  const lastCommandRef = useRef("");

  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;

  // ------------------------------------------------------------
  // LIMPIAR TIMER DE REINICIO
  // ------------------------------------------------------------

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  // ------------------------------------------------------------
  // LIMPIAR TIMER DE SILENCIO
  // ------------------------------------------------------------

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // ------------------------------------------------------------
  // ABORTAR COMPLETAMENTE EL RECONOCIMIENTO
  // ------------------------------------------------------------

  const abortRecognition = useCallback(() => {
    activeRef.current = false;

    const rec = recRef.current;

    if (!rec) {
      return;
    }

    try {
      rec.abort();
    } catch {
      // El reconocimiento ya estaba detenido.
    }
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

      // Si todavía estamos dentro del período de protección,
      // esperamos el tiempo restante.
      const cooldownRemaining = Math.max(
        0,
        cooldownUntilRef.current - Date.now(),
      );

      const waitTime = Math.max(
        delay,
        cooldownRemaining,
      );

      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;

        if (
          !enabledRef.current ||
          busyRef.current ||
          speakingRef.current ||
          activeRef.current ||
          !mountedRef.current ||
          Date.now() < cooldownUntilRef.current
        ) {
          return;
        }

        const rec = recRef.current;

        if (!rec) {
          return;
        }

        try {
          rec.start();
        } catch {
          activeRef.current = false;

          if (
            enabledRef.current &&
            !busyRef.current &&
            !speakingRef.current
          ) {
            restartTimerRef.current = setTimeout(() => {
              restartTimerRef.current = null;
              startListening();
            }, 700);
          }
        }
      }, waitTime);
    },
    [clearRestartTimer],
  );

  // ------------------------------------------------------------
  // DETENER MICRÓFONO
  // ------------------------------------------------------------

  const stopListening = useCallback(() => {
    clearRestartTimer();
    clearSilenceTimer();
    abortRecognition();
  }, [
    abortRecognition,
    clearRestartTimer,
    clearSilenceTimer,
  ]);

  // ------------------------------------------------------------
  // ESPERA
  // ------------------------------------------------------------

  const wait = useCallback(
    (milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
    [],
  );

  // ------------------------------------------------------------
  // HABLAR
  // ------------------------------------------------------------

  const speak = useCallback(
    async (text: string): Promise<void> => {
      // BLOQUEAR ANTES DE CUALQUIER OPERACIÓN DE AUDIO.
      speakingRef.current = true;

      // Bloqueo indefinido mientras habla.
      cooldownUntilRef.current = Number.MAX_SAFE_INTEGER;

      clearRestartTimer();
      clearSilenceTimer();

      // APAGAR COMPLETAMENTE EL RECONOCIMIENTO.
      abortRecognition();

      setInterim("");

      if (
        typeof window === "undefined" ||
        typeof window.speechSynthesis === "undefined" ||
        typeof SpeechSynthesisUtterance === "undefined"
      ) {
        await wait(RESTART_AFTER_SPEECH_MS);

        cooldownUntilRef.current = Date.now();
        speakingRef.current = false;

        return;
      }

      const synth = window.speechSynthesis;

      // Cancelar cualquier audio anterior.
      synth.cancel();

      await new Promise<void>((resolve) => {
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
        utterance.rate = 1;
        utterance.pitch = 1;

        const voice = synth
          .getVoices()
          .find((item) =>
            item.lang
              .toLowerCase()
              .startsWith("es"),
          );

        if (voice) {
          utterance.voice = voice;
        }

        utterance.onend = finish;
        utterance.onerror = finish;

        synth.speak(utterance);
      });

      // --------------------------------------------------------
      // AQUÍ ESTÁ LA PROTECCIÓN CONTRA EL ECO.
      //
      // Aunque speechSynthesis ya terminó, NO encendemos
      // inmediatamente el micrófono.
      // --------------------------------------------------------

      cooldownUntilRef.current =
        Date.now() + RESTART_AFTER_SPEECH_MS;

      await wait(RESTART_AFTER_SPEECH_MS);

      // Finaliza el bloqueo.
      cooldownUntilRef.current = Date.now();

      speakingRef.current = false;
    },
    [
      abortRecognition,
      clearRestartTimer,
      clearSilenceTimer,
      wait,
    ],
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
        !enabledRef.current ||
        speakingRef.current
