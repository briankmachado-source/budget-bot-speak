import { useCallback, useEffect, useRef, useState } from "react";

type RecResult = { isFinal: boolean; 0: { transcript: string } };
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
  onresult: ((e: RecEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

type Status = "idle" | "listening" | "processing" | "speaking" | "unsupported";

const WAKE = /^\s*(hola\s+)?(atento\s*(ai|ia|a\s*i)?)?[\s,.:!¡]*/i;
const AFTER_SPEECH_MS = 900;

function getCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function cleanForSpeech(t: string) {
  return t.replace(/[*_#`>|]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * Voice loop: one phrase per recognition session (continuous=false avoids the
 * repeated/duplicated words Chrome on Android produces in continuous mode).
 * The mic is fully off while waiting for the answer and while speaking, so the
 * assistant never hears itself; it restarts automatically afterwards.
 */
export function useVoiceAssistant(onCommand: (text: string) => Promise<string>) {
  const [status, setStatus] = useState<Status>("idle");
  const [enabled, setEnabled] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const enabledRef = useRef(false);
  const lockedRef = useRef(false); // processing or speaking
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = useRef({ text: "", at: 0 });
  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;

  useEffect(() => {
    if (!getCtor()) setStatus("unsupported");
  }, []);

  const schedule = useCallback((delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const rec = recRef.current;
      if (!rec || !enabledRef.current || lockedRef.current || activeRef.current) return;
      try {
        rec.start();
        activeRef.current = true;
        setStatus("listening");
      } catch {
        schedule(700);
      }
    }, delay);
  }, []);

  const speak = useCallback(async (text: string) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    const clean = cleanForSpeech(text);
    if (!synth || !clean) return;
    synth.cancel();
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "es-CO";
      const v = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith("es"));
      if (v) u.voice = v;
      const t = setTimeout(resolve, Math.min(60000, 4000 + clean.length * 90));
      u.onend = u.onerror = () => { clearTimeout(t); resolve(); };
      synth.speak(u);
    });
  }, []);

  const handle = useCallback(async (raw: string) => {
    const text = raw.replace(WAKE, "").trim();
    if (text.length < 2) return;
    const now = Date.now();
    if (text.toLowerCase() === lastRef.current.text && now - lastRef.current.at < 4000) return;
    lastRef.current = { text: text.toLowerCase(), at: now };

    lockedRef.current = true;
    try { recRef.current?.abort(); } catch { /* ignore */ }
    activeRef.current = false;
    setInterim("");
    setStatus("processing");
    try {
      const reply = await cmdRef.current(text);
      if (enabledRef.current) {
        setStatus("speaking");
        await speak(reply);
      }
    } finally {
      lockedRef.current = false;
      if (enabledRef.current) { setStatus("listening"); schedule(AFTER_SPEECH_MS); }
      else setStatus("idle");
    }
  }, [schedule, speak]);

  const enable = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) { setStatus("unsupported"); return; }
    const rec = new Ctor();
    rec.lang = "es-CO";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (lockedRef.current) return; // ignore anything heard while answering
      let fin = "", tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) fin += r[0].transcript; else tmp += r[0].transcript;
      }
      if (fin.trim()) void handle(fin);
      else setInterim(tmp.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Permite el micrófono en el navegador para usar la voz.");
        enabledRef.current = false;
        setEnabled(false);
        setStatus("idle");
      }
    };
    rec.onend = () => {
      activeRef.current = false;
      setInterim("");
      if (enabledRef.current && !lockedRef.current) schedule(250);
    };
    recRef.current = rec;
    enabledRef.current = true;
    setEnabled(true);
    setError(null);
    // Unlock speech synthesis on mobile with a user gesture.
    try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance("")); } catch { /* ignore */ }
    schedule(0);
  }, [handle, schedule]);

  const disable = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    try { recRef.current?.abort(); } catch { /* ignore */ }
    recRef.current = null;
    activeRef.current = false;
    window.speechSynthesis?.cancel();
    setInterim("");
    setStatus("idle");
  }, []);

  const toggle = useCallback(() => (enabledRef.current ? disable() : enable()), [enable, disable]);

  // Recover when returning to the app (the OS may kill the mic in background).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && enabledRef.current && !lockedRef.current) schedule(300); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timerRef.current) clearTimeout(timerRef.current);
      try { recRef.current?.abort(); } catch { /* ignore */ }
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, [schedule]);

  return { status, enabled, interim, error, toggle, speak };
}
