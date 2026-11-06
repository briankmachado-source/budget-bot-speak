import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Mic, MicOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";
import { WeatherCard } from "@/components/WeatherCard";
import { Reminders } from "@/components/Reminders";
import { PaymentPanel } from "@/components/PaymentPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/hooks/use-session";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import { getWeather, type Weather } from "@/lib/weather";
import { parseCommand } from "@/lib/commands";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atento AI — Pagos pendientes y recordatorios" },
      { name: "description", content: "Controla pagos pendientes y vencidos en pesos colombianos y organiza tus recordatorios por voz." },
      { property: "og:title", content: "Atento AI — Pagos pendientes y recordatorios" },
      { property: "og:description", content: "Organiza tus pagos pendientes y recordatorios, y consulta el clima." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const STATUS: Record<string, string> = {
  idle: "Voz apagada", listening: "Escuchando…", processing: "Procesando…", speaking: "Hablando…", unsupported: "Tu navegador no admite voz",
};

function Index() {
  const { session, ready } = useSession();
  if (!ready) return <div className="min-h-screen" />;
  if (!session) return <AuthScreen />;
  return <Home userId={session.user.id} email={session.user.email ?? ""} />;
}

function Home({ userId, email }: { userId: string; email: string }) {
  const qc = useQueryClient();
  const [weather, setWeather] = useState<Weather | null>(null);

  async function loadWeather(city: string) {
    const w = await getWeather(city);
    if (w) setWeather(w);
    return w;
  }

  async function onCommand(text: string): Promise<string> {
    const c = parseCommand(text);
    switch (c.kind) {
      case "reminder": {
        const { error } = await supabase.from("reminders").insert({ user_id: userId, title: c.title, remind_at: c.at.toISOString() });
        if (error) return "No pude guardar el recordatorio.";
        qc.invalidateQueries({ queryKey: ["reminders"] });
        const when = c.at.toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "long", hour: "numeric", minute: "2-digit" });
        return `Listo, te lo recuerdo ${when}: ${c.title}.`;
      }
      case "weather": {
        const w = await loadWeather(c.city);
        return w ? `En ${w.city} hay ${w.temp} grados, ${w.condition.toLowerCase()}. Máxima ${w.max}, mínima ${w.min}.` : `No encontré el clima de ${c.city}.`;
      }
      default:
        return "No entendí. Prueba: recuérdame mañana a las 9 llamar al médico, o clima en Medellín.";
    }
  }

  const voice = useVoiceAssistant(onCommand);

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-6">
      {weather && <WeatherCard w={weather} onClose={() => setWeather(null)} />}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Atento AI</h1>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
          <LogOut className="mr-1 h-4 w-4" /> Salir
        </Button>
      </header>

      <section className="rounded-3xl border bg-card p-5">
        <div className="flex items-center gap-4">
          <Button
            size="lg"
            variant={voice.enabled ? "default" : "secondary"}
            onClick={voice.toggle}
            disabled={voice.status === "unsupported"}
            className="h-14 rounded-full px-6"
          >
            {voice.enabled ? <Mic className="mr-2 h-5 w-5" /> : <MicOff className="mr-2 h-5 w-5" />}
            {voice.enabled ? "Voz activa" : "Activar voz"}
          </Button>
          <div className="min-w-0 text-sm">
            <p className="font-medium">{STATUS[voice.status]}</p>
            <p className="truncate text-muted-foreground">{voice.interim || "Di: “recuérdame mañana a las 9 pagar el arriendo”"}</p>
          </div>
        </div>
        {voice.error && <p className="mt-3 text-sm text-destructive">{voice.error}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Frases: “recuérdame mañana a las 9 pagar el arriendo”, “recuérdame en 10 minutos sacar la ropa”, “clima en Cali”.
        </p>
      </section>

      <WeatherSearch
        onSearch={async (c) => {
          const w = await loadWeather(c);
          if (!w) {
            toast.error(`No encontré el clima de ${c}`);
            return `No encontré el clima de ${c}.`;
          }
          return `En ${w.city} hay ${w.temp} grados, ${w.condition.toLowerCase()}. Máxima ${w.max}, mínima ${w.min}.`;
        }}
      />
      <ReminderForm userId={userId} />
      <Reminders />
      <PaymentPanel />
    </div>
  );
}

function ReminderForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [timeFocused, setTimeFocused] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const at = new Date(when);
    if (!title.trim() || isNaN(at.getTime())) { toast.error("Escribe qué recordar y cuándo"); return; }
    const { error } = await supabase.from("reminders").insert({ user_id: userId, title: title.trim(), remind_at: at.toISOString() });
    if (error) { toast.error("No se pudo guardar"); return; }
    toast.success("Recordatorio creado");
    setTitle(""); setWhen("");
    qc.invalidateQueries({ queryKey: ["reminders"] });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Nuevo recordatorio</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Qué recordar" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="relative">
          <Input
            type="datetime-local"
            aria-label="Establecer fecha y hora"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            onFocus={() => setTimeFocused(true)}
            onBlur={() => setTimeFocused(false)}
            className={cn(
              "h-14 pb-1 pt-5",
              !when && !timeFocused && "text-transparent",
            )}
          />
          <span
            className={cn(
              "pointer-events-none absolute left-3 text-muted-foreground transition-all",
              !when && !timeFocused
                ? "top-1/2 -translate-y-1/2 text-sm"
                : "top-1.5 text-[11px] font-medium uppercase tracking-wide",
            )}
          >
            Establecer fecha y hora
          </span>
        </div>
      </div>
      <Button type="submit"><Plus className="mr-1 h-4 w-4" /> Crear</Button>
    </form>
  );
}

function WeatherSearch({ onSearch }: { onSearch: (city: string) => Promise<string> }) {
  const [city, setCity] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!city.trim() || busy) return;
    setBusy(true);
    setReply(await onSearch(city.trim()));
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl border bg-card p-5">
      <div className="flex gap-2">
        <Input placeholder="Consultar clima de una ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Buscando…" : "Ver clima"}
        </Button>
      </div>
      {reply && <p className="rounded-2xl bg-secondary/50 p-3 text-sm font-medium">{reply}</p>}
    </form>
  );
}
