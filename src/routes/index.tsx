import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, Mic, MicOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";
import { FinancePanel } from "@/components/FinancePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/hooks/use-session";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import { fetchWeather } from "@/lib/weather.functions";
import { CATEGORIES, guessCategory, parseAmount, parseCommand } from "@/lib/commands";
import type { Weather } from "@/lib/weather.server";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atento AI — Tus finanzas y recordatorios por voz" },
      { name: "description", content: "Registra gastos e ingresos, crea recordatorios y consulta el clima hablando o con botones. Panel de finanzas en pesos colombianos." },
      { property: "og:title", content: "Atento AI — Tus finanzas y recordatorios por voz" },
      { property: "og:description", content: "Registra gastos, crea recordatorios y consulta el clima por voz o con botones." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
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
  const getWeather = useServerFn(fetchWeather);
  const [weather, setWeather] = useState<Weather | null>(null);

  async function loadWeather(city: string) {
    const w = await getWeather({ data: { city } }).catch(() => null);
    if (w) setWeather(w);
    return w;
  }

  async function onCommand(text: string): Promise<string> {
    const c = parseCommand(text);
    switch (c.kind) {
      case "transaction": {
        const { error } = await supabase.from("transactions").insert({ user_id: userId, type: c.type, amount: c.amount, category: c.category, description: c.description });
        if (error) return "No pude guardar el movimiento.";
        qc.invalidateQueries({ queryKey: ["transactions"] });
        return `Listo, registré ${c.type === "income" ? "un ingreso" : "un gasto"} de ${cop.format(c.amount).replace(/\s/g, " ")} en ${c.category}.`;
      }
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
      case "summary": {
        const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
        const { data } = await supabase.from("transactions").select("type, amount").gte("occurred_at", start.toISOString());
        let inc = 0, exp = 0;
        for (const r of data ?? []) (r.type === "income" ? (inc += Number(r.amount)) : (exp += Number(r.amount)));
        return `Este mes tienes ingresos por ${cop.format(inc)}, gastos por ${cop.format(exp)} y un balance de ${cop.format(inc - exp)}.`;
      }
      default:
        return "No entendí. Prueba: registra pago de 400 mil de verduras, recuérdame mañana a las 9 llamar al médico, o clima en Medellín.";
    }
  }

  const voice = useVoiceAssistant(onCommand);

  return (
    <div className="mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-6">
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
            <p className="truncate text-muted-foreground">{voice.interim || "Di: “registra pago de 400 mil de verduras”"}</p>
          </div>
        </div>
        {voice.error && <p className="mt-3 text-sm text-destructive">{voice.error}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Frases: “registra gasto de 50 mil en taxi”, “ingreso de 2 millones de salario”, “recuérdame mañana a las 9 pagar el arriendo”, “recuérdame en 10 minutos sacar la ropa”, “clima en Cali”, “resumen del mes”.
        </p>
      </section>

      <TransactionForm userId={userId} />
      <ReminderForm userId={userId} />
      <FinancePanel weather={weather} onCloseWeather={() => setWeather(null)} />
      <WeatherSearch onSearch={async (c) => { if (!(await loadWeather(c))) toast.error(`No encontré el clima de ${c}`); }} />
    </div>
  );
}

function TransactionForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseAmount(amount);
    if (!n || n <= 0) { toast.error("Escribe un monto válido"); return; }
    const category = cat || guessCategory(desc, type === "income");
    const { error } = await supabase.from("transactions").insert({ user_id: userId, type, amount: n, category, description: desc.trim() || null });
    if (error) { toast.error("No se pudo guardar"); return; }
    toast.success("Movimiento registrado");
    setAmount(""); setDesc(""); setCat("");
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-3xl border bg-card p-5">
      <h2 className="text-lg font-semibold">Registrar movimiento</h2>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={type === "expense" ? "default" : "secondary"} onClick={() => setType("expense")}>Gasto</Button>
        <Button type="button" size="sm" variant={type === "income" ? "default" : "secondary"} onClick={() => setType("income")}>Ingreso</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Input inputMode="numeric" placeholder="Monto (ej. 400000)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input placeholder="Descripción (ej. Verduras)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">Categoría automática</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <Button type="submit"><Plus className="mr-1 h-4 w-4" /> Agregar</Button>
    </form>
  );
}

function ReminderForm({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");

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
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <Button type="submit"><Plus className="mr-1 h-4 w-4" /> Crear</Button>
    </form>
  );
}

function WeatherSearch({ onSearch }: { onSearch: (city: string) => void }) {
  const [city, setCity] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (city.trim()) onSearch(city.trim()); }}
      className="flex gap-2 rounded-3xl border bg-card p-5"
    >
      <Input placeholder="Consultar clima de una ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
      <Button type="submit" variant="secondary">Ver clima</Button>
    </form>
  );
}
