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

  // Bloqueo fundamental para evitar que el micrófono
  // capture la voz del asistente.
  const assistantSpeakingRef = useRef(false);

  const manuallyStoppedRef = useRef(false);

  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  /**
   * Detiene completamente el reconocimiento.
   */
  const stopListening = useCallback(() => {
    manuallyStoppedRef.current = true;

    try {
      recognitionRef.current?.abort();
    } catch (error) {
      console.log("Error deteniendo reconocimiento:", error);
    }

    setIsListening(false);
  }, []);

  /**
   * Habla la respuesta de Atento AI.
   *
   * MUY IMPORTANTE:
   * primero bloqueamos el micrófono,
   * después comenzamos a hablar.
   */
  const speak = useCallback(
    (text: string) => {
      if (!text?.trim()) {
        return;
      }

      // Cancelar cualquier respuesta anterior.
      window.speechSynthesis.cancel();

      // APAGAR MICRÓFONO ANTES DE HABLAR
      assistantSpeakingRef.current = true;

      try {
        recognitionRef.current?.abort();
      } catch {}

      setIsListening(false);
      setIsSpeaking(true);

      const utterance = new SpeechSynthesisUtterance(text);

      utterance.lang = "es-CO";
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onstart = () => {
        assistantSpeakingRef.current = true;
        setIsSpeaking(true);
        setIsListening(false);
      };

      utterance.onend = () => {
        setIsSpeaking(false);

        /*
         * MUY IMPORTANTE:
         * todavía NO encendemos el micrófono.
         *
         * Esperamos 2 segundos para que el audio
         * termine de desaparecer del ambiente.
         */
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
        }

        silenceTimerRef.current = setTimeout(() => {
          assistantSpeakingRef.current = false;

          if (!manuallyStoppedRef.current) {
            startListening();
          }
        }, SILENCE_AFTER_RESPONSE);
      };

      utterance.onerror = () => {
        setIsSpeaking(false);

        silenceTimerRef.current = setTimeout(() => {
          assistantSpeakingRef.current = false;

          if (!manuallyStoppedRef.current) {
            startListening();
          }
        }, SILENCE_AFTER_RESPONSE);
      };

      window.speechSynthesis.speak(utterance);
    },
    []
  );

  /**
   * Inicia reconocimiento de voz.
   */
  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      console.error("Speech Recognition no está disponible.");
      return;
    }

    // NUNCA escuchar mientras la IA habla.
    if (assistantSpeakingRef.current) {
      console.log("Micrófono bloqueado: Atento está hablando.");
      return;
    }

    // Si está procesando la respuesta tampoco escucha.
    if (isProcessing) {
      return;
    }

    manuallyStoppedRef.current = false;

    try {
      // Limpiar reconocimiento anterior.
      recognitionRef.current?.abort();
    } catch {}

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "es-CO";

    recognition.onstart = () => {
      // Segunda barrera de seguridad.
      if (assistantSpeakingRef.current) {
        recognition.abort();
        return;
      }

      setIsListening(true);
    };

    recognition.onresult = async (
      event: SpeechRecognitionEventLike
    ) => {
      /*
       * Si por alguna razón llegó un resultado mientras
       * la IA estaba hablando, LO IGNORAMOS.
       */
      if (assistantSpeakingRef.current) {
        console.log("Resultado ignorado: el asistente está hablando.");
        return;
      }

      const text =
        event.results[event.results.length - 1][0].transcript.trim();

      if (!text) {
        return;
      }

      // APAGAR MICRÓFONO INMEDIATAMENTE.
      try {
        recognition.abort();
      } catch {}

      setIsListening(false);
      setIsProcessing(true);

      try {
        // Aquí llamamos a tu IA.
        const response = await onUserText(text);

        setIsProcessing(false);

        // La IA responde.
        speak(response);
      } catch (error) {
        console.error("Error procesando mensaje:", error);

        setIsProcessing(false);

        speak(
          "Lo siento, tuve un problema procesando tu solicitud."
        );
      }
    };

    recognition.onerror = (event) => {
      console.log("Speech recognition:", event.error);

      setIsListening(false);

      // Estos errores no deben producir bucles.
      if (
        event.error === "aborted" ||
        event.error === "no-speech"
      ) {
        return;
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.log("No se pudo iniciar el micrófono:", error);
    }
  }, [SpeechRecognition, isProcessing, onUserText, speak]);

  /**
   * Limpieza al salir de la pantalla.
   */
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {}

      window.speechSynthesis.cancel();

      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
    };
  }, []);

  return {
    isListening,
    isSpeaking,
    isProcessing,
    startListening,
    stopListening,
    speak,
  };
}
