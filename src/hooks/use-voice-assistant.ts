import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_AFTER_RESPONSE = 2000;

interface SpeechRecognitionEventLike extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function useAtentoVoice(
  onUserText: (text: string) => Promise<string>
) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bloquea el reconocimiento mientras Atento está hablando.
  const assistantSpeakingRef = useRef(false);

  // Indica que el usuario detuvo manualmente el micrófono.
  const manuallyStoppedRef = useRef(false);

  // Evita la referencia circular entre startListening y speak.
  const speakRef = useRef<(text: string) => void>(() => {});

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  const stopListening = useCallback(() => {
    manuallyStoppedRef.current = true;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    try {
      recognitionRef.current?.abort();
    } catch (error) {
      console.log("Error deteniendo reconocimiento:", error);
    }

    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      console.error("Speech Recognition no está disponible.");
      return;
    }

    // Nunca activar el micrófono mientras Atento habla.
    if (assistantSpeakingRef.current) {
      console.log("Micrófono bloqueado: Atento está hablando.");
      return;
    }

    // No escuchar mientras se está procesando la solicitud.
    if (isProcessing) {
      return;
    }

    manuallyStoppedRef.current = false;

    try {
      recognitionRef.current?.abort();
    } catch {}

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "es-CO";

    recognition.onstart = () => {
      if (assistantSpeakingRef.current || isProcessing) {
        recognition.abort();
        return;
      }

      setIsListening(true);
    };

    recognition.onresult = async (
      event: SpeechRecognitionEventLike
    ) => {
      // Ignorar cualquier sonido capturado mientras Atento habla.
      if (assistantSpeakingRef.current || isProcessing) {
        console.log("Resultado ignorado: Atento está ocupado.");
        return;
      }

      // Obtener el último resultado de forma segura.
      const lastResult =
        event.results[event.results.length - 1];

      if (!lastResult) {
        return;
      }

      const alternative = lastResult[0];

      if (!alternative) {
        return;
      }

      const text = alternative.transcript.trim();

      if (!text) {
        return;
      }

      // Apagar inmediatamente el micrófono.
      try {
        recognition.abort();
      } catch {}

      setIsListening(false);
      setIsProcessing(true);

      try {
        // Enviar el texto al asistente.
        const response = await onUserText(text);

        setIsProcessing(false);

        // Hablar usando la referencia para evitar
        // problemas de declaración circular.
        speakRef.current(response);
      } catch (error) {
        console.error(
          "Error procesando mensaje:",
          error
        );

        setIsProcessing(false);

        speakRef.current(
          "Lo siento, tuve un problema procesando tu solicitud."
        );
      }
    };

    recognition.onerror = (event) => {
      console.log(
        "Speech recognition:",
        event.error
      );

      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition
