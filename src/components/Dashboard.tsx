import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { LogOut, Mic, MicOff, Send, Trash2, ArrowDownRight, ArrowUpRight, Sun, Cloud, CloudRain, CloudLightning, CloudFog, X, Droplets, Wind, Play, Pause, Music } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runVoiceCommand, type Weather, type Song } from "@/lib/assistant.functions";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import { Button } from "@/components/ui/button";
import { Reminders } from "@/components/Reminders";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";


const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

type Tx = { id: string; type: string; amount: number; category: string; description: string | null; occurred_at: string };
type Msg = { role: "user" | "assistant"; text: string };

export function Dashboard({ email }: { email: string }) {
  const qc = useQueryClient();
  const run = useServerFn(runVoiceCommand);
  const [log, setLog] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [weather, setWeather] = useState<Weather | null>(null);
  const [song, setSong] = useState<Song | null>(null);


  const { data: txs = [] } = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as Tx[];
    },
  });

  const voice = useVoiceAssistant(async (cmd) => {
    setLog((l) => [...l, { role: "user", text: cmd }]);
    try {
      const r = await run({ data: { text: cmd } });
      setLog((l) => [...l, { role: "assistant", text: r.reply }]);
      if (r.action === "create") qc.invalidateQueries({ queryKey: ["transactions"] });
      if (r.weather) setWeather(r.weather);
      if (r.action === "remind") { qc.invalidateQueries({ queryKey: ["reminders"] }); toast.success(r.reply); }
      return r.reply;
    } catch (e) {
      const m = (e as Error).message || "Algo salió mal.";
      setLog((l) => [...l, { role: "assistant", text: m }]);
      return m;
    }
  });

  const stats = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    let income = 0;
    let expense = 0;
    const cats: Record<string, number> = {};
    for (const t of txs) {
      if (new Date(t.occurred_at) < start) continue;
      const a = Number(t.amount);
      if (t.type === "income") income += a;
      else {
        expense += a;
        cats[t.category] = (cats[t.category] ?? 0) + a;
      }
    }
    const byCat = Object.entries(cats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    return { income, expense, balance: income - expense, byCat };
  }, [txs]);

  async function remove(id: string) {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error("No se pudo eliminar");
    else qc.invalidateQueries({ queryKey: ["transactions"] });
  }

  const statusLabel = {
    idle: "Toca el micrófono para activarme",
    listening: 'Escuchando… di "Hola" o "Atento AI" y tu comando',
    processing: "Procesando…",
    speaking: "Respondiendo…",
    unsupported: "Tu navegador no soporta voz. Usa Chrome o escribe abajo.",
  }[voice.status];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Mic className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-none">Atento AI</h1>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
          <LogOut className="mr-2 h-4 w-4" /> Salir
        </Button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Assistant */}
        <section className="flex flex-col rounded-3xl border bg-card p-6">
          <div className="flex flex-col items-center py-6">
            <button
              onClick={voice.toggle}
              disabled={voice.status === "unsupported"}
              aria-label={voice.enabled ? "Desactivar escucha" : "Activar escucha"}
              className="relative flex h-36 w-36 items-center justify-center rounded-full"
            >
              {voice.enabled && <span className="orb-ring absolute inset-0 rounded-full bg-primary" />}
              <span
                className={cn(
                  "relative flex h-28 w-28 items-center justify-center rounded-full transition-colors",
                  voice.enabled ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                )}
              >
                {voice.enabled ? <Mic className="h-10 w-10" /> : <MicOff className="h-10 w-10" />}
              </span>
            </button>
            <p className="mt-5 text-center text-sm text-muted-foreground">{statusLabel}</p>
            {voice.error && <p className="mt-2 max-w-sm text-center text-sm text-destructive">{voice.error}</p>}
            {voice.interim && <p className="mt-2 text-center text-base italic">"{voice.interim}"</p>}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-background/40 p-4" style={{ maxHeight: 280, minHeight: 140 }}>
            {log.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Prueba: <span className="text-foreground">"Hola, registra pago por 400 mil de verduras"</span> o{" "}
                <span className="text-foreground">"Atento AI, ¿cuánto he gastado este mes?"</span> o{" "}<span className="text-foreground">"Hola, ¿cómo está el clima en Barranquilla?"</span>
              </p>
            )}
            {log.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" && "justify-end")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2 text-sm",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "text-foreground",
                  )}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              void voice.sendText(text.trim());
              setText("");
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="O escribe un comando…" />
            <Button type="submit" size="icon" disabled={voice.status === "processing"}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </section>

        {/* Panel */}
        <section className="space-y-6">
          {weather && <WeatherCard w={weather} onClose={() => setWeather(null)} />}
          <Reminders />
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Balance del mes" value={stats.balance} highlight />
            <Stat label="Ingresos" value={stats.income} />
            <Stat label="Gastos" value={stats.expense} />
          </div>

          <div className="rounded-3xl border bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">Gastos por categoría</h2>
            {stats.byCat.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay gastos este mes.</p>
            ) : (
              <div className="flex items-center gap-6">
                <div className="h-40 w-40 shrink-0">
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={stats.byCat} dataKey="value" innerRadius={45} outerRadius={70} stroke="none">
                        {stats.byCat.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => cop.format(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex-1 space-y-2 text-sm">
                  {stats.byCat.slice(0, 6).map((c, i) => (
                    <li key={c.name} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        {c.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{cop.format(c.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-3xl border bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">Movimientos</h2>
            {txs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tus registros aparecerán aquí.</p>
            ) : (
              <ul className="divide-y divide-border">
                {txs.slice(0, 15).map((t) => (
                  <li key={t.id} className="group flex items-center gap-3 py-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full bg-secondary",
                        t.type === "income" ? "text-success" : "text-destructive",
                      )}
                    >
                      {t.type === "income" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.description || t.category}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.category} · {new Date(t.occurred_at).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className={cn("text-sm font-semibold tabular-nums", t.type === "income" && "text-success")}>
                      {t.type === "income" ? "+" : "−"}
                      {cop.format(Number(t.amount))}
                    </span>
                    <button
                      onClick={() => remove(t.id)}
                      aria-label="Eliminar"
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-4", highlight ? "bg-primary text-primary-foreground" : "bg-card")}>
      <p className={cn("text-xs", highlight ? "opacity-70" : "text-muted-foreground")}>{label}</p>
      <p className="mt-1 truncate font-display text-lg font-bold tabular-nums md:text-xl">{cop.format(value)}</p>
    </div>
  );
}

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  if (code >= 95) return <CloudLightning className={className} />;
  if (code >= 51) return <CloudRain className={className} />;
  if (code >= 45) return <CloudFog className={className} />;
  if (code >= 2) return <Cloud className={className} />;
  return <Sun className={className} />;
}

function WeatherCard({ w, onClose }: { w: Weather; onClose: () => void }) {
  return (
    <div className="relative rounded-3xl border bg-card p-6">
      <button onClick={onClose} aria-label="Cerrar clima" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
      <p className="text-xs text-muted-foreground">Clima de hoy</p>
      <h2 className="text-lg font-semibold">
        {w.city}
        {w.region && <span className="font-normal text-muted-foreground"> · {w.region}</span>}
      </h2>
      <div className="mt-4 flex items-center gap-5">
        <WeatherIcon code={w.code} className="h-14 w-14 text-primary" />
        <div>
          <p className="font-display text-5xl font-bold tabular-nums leading-none">{w.temp}°</p>
          <p className="mt-1 text-sm text-muted-foreground">{w.condition}</p>
        </div>
        <div className="ml-auto space-y-1 text-right text-sm tabular-nums">
          <p>Máx {w.max}° · Mín {w.min}°</p>
          <p className="flex items-center justify-end gap-1 text-muted-foreground"><Droplets className="h-3.5 w-3.5" /> {w.rainChance ?? "–"}% lluvia · {w.humidity}% hum.</p>
          <p className="flex items-center justify-end gap-1 text-muted-foreground"><Wind className="h-3.5 w-3.5" /> {w.wind} km/h</p>
        </div>
      </div>
    </div>
  );
}
