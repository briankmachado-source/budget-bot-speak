import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Check, RotateCcw, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";

type Reminder = { id: string; title: string; remind_at: string; done: boolean; notified: boolean };

function PhoneToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (pushSupported()) void currentSubscription().then((s) => setOn(!!s)).catch(() => {});
  }, []);
  async function toggle() {
    setBusy(true);
    try {
      if (on) { await disablePush(); setOn(false); toast("Avisos al teléfono desactivados"); }
      else { await enablePush(); setOn(true); toast.success("Listo: te llegará un aviso a este dispositivo"); }
    } catch (e) {
      toast.error((e as Error).message || "No se pudieron activar los avisos. Abre la app en una pestaña propia.");
    } finally { setBusy(false); }
  }
  return (
    <Button variant={on ? "secondary" : "outline"} size="sm" onClick={toggle} disabled={busy}>
      <Smartphone className="mr-1 h-4 w-4" /> {on ? "Avisos activos" : "Avisar al teléfono"}
    </Button>
  );
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {}
}

function say(text: string) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-CO";
  window.speechSynthesis.speak(u);
}

const fmt = (d: string) =>
  new Date(d).toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function Reminders() {
  const qc = useQueryClient();
  const [ringing, setRinging] = useState<Reminder | null>(null);
  const firing = useRef(new Set<string>());

  const { data: items = [] } = useQuery({
    queryKey: ["reminders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reminders").select("*").order("remind_at").limit(200);
      if (error) throw error;
      return data as Reminder[];
    },
  });

  useEffect(() => {
    const check = async () => {
      const now = Date.now();
      for (const r of items) {
        if (r.done || r.notified || firing.current.has(r.id) || new Date(r.remind_at).getTime() > now) continue;
        firing.current.add(r.id);
        beep();
        say(`Recordatorio: ${r.title}`);
        toast(`⏰ ${r.title}`, { description: fmt(r.remind_at), duration: 20000 });
        setRinging(r);
        await supabase.from("reminders").update({ notified: true }).eq("id", r.id);
        qc.invalidateQueries({ queryKey: ["reminders"] });
      }
    };
    void check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, [items, qc]);

  async function setDone(id: string, done: boolean) {
    const { error } = await supabase.from("reminders").update({ done }).eq("id", id);
    if (error) toast.error("No se pudo actualizar");
    qc.invalidateQueries({ queryKey: ["reminders"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("reminders").delete().eq("id", id);
    if (error) toast.error("No se pudo eliminar");
    qc.invalidateQueries({ queryKey: ["reminders"] });
  }

  const pending = items.filter((r) => !r.done);
  const done = items.filter((r) => r.done).reverse().slice(0, 10);

  return (
    <>
      {ringing && (
        <div className="rounded-3xl border-2 border-primary bg-primary p-6 text-primary-foreground">
          <div className="flex items-center gap-3">
            <BellRing className="h-7 w-7 animate-bounce" />
            <div className="flex-1">
              <p className="text-xs opacity-70">Es la hora</p>
              <p className="text-lg font-semibold">{ringing.title}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => { void setDone(ringing.id, true); setRinging(null); }}>
              <Check className="mr-1 h-4 w-4" /> Hecho
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRinging(null)}>Cerrar</Button>
          </div>
        </div>
      )}
      <div className="rounded-3xl border bg-card p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Bell className="h-5 w-5" /> Recordatorios</h2>
          <PhoneToggle />
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin pendientes. Di "Atento, recuérdame mañana a las 8:30…"</p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((r) => {
              const overdue = new Date(r.remind_at).getTime() < Date.now();
              return (
                <li key={r.id} className="group flex items-center gap-3 py-3">
                  <button onClick={() => setDone(r.id, true)} aria-label="Marcar como hecho" className="flex h-6 w-6 items-center justify-center rounded-full border hover:border-primary hover:text-primary">
                    <Check className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>{fmt(r.remind_at)}</p>
                  </div>
                  <button onClick={() => remove(r.id)} aria-label="Eliminar" className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && (
          <>
            <p className="mb-1 mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Completados</p>
            <ul className="divide-y divide-border">
              {done.map((r) => (
                <li key={r.id} className="group flex items-center gap-3 py-2 text-muted-foreground">
                  <Check className="h-4 w-4 text-success" />
                  <p className="min-w-0 flex-1 truncate text-sm line-through">{r.title}</p>
                  <button onClick={() => setDone(r.id, false)} aria-label="Volver a pendiente" className="opacity-0 group-hover:opacity-100 hover:text-foreground"><RotateCcw className="h-4 w-4" /></button>
                  <button onClick={() => remove(r.id)} aria-label="Eliminar" className="opacity-0 group-hover:opacity-100 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
