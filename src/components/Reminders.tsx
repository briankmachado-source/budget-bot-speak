import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Check, RotateCcw, Smartphone, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentSubscription, disablePush, enablePush, pushSupported } from "@/lib/push";
import { DeleteButton } from "@/components/DeleteButton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReminderDateInput } from "@/components/ReminderDateInput";
import { reminderChanges, toLocalDateTime } from "@/lib/reminder-edit";

type Reminder = { id: string; title: string; remind_at: string; done: boolean; notified: boolean; pushed: boolean };

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
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editWhen, setEditWhen] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit(reminder: Reminder) {
    setEditTitle(reminder.title);
    setEditWhen(toLocalDateTime(reminder.remind_at));
    setEditing(reminder);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || saving) return;
    setSaving(true);
    try {
      const changes = reminderChanges(editing, editTitle, editWhen);
      const { data, error } = await supabase.from("reminders").update(changes).eq("id", editing.id).select().single();
      if (error) throw error;
      qc.setQueryData<Reminder[]>(["reminders"], (old = []) => old.map((r) => r.id === editing.id ? data as Reminder : r));
      if (changes.remind_at !== editing.remind_at) {
        firing.current.delete(editing.id);
        if (ringing?.id === editing.id) setRinging(null);
      } else if (ringing?.id === editing.id) setRinging(data as Reminder);
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["reminders"] });
      toast.success("Recordatorio actualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el recordatorio");
    } finally { setSaving(false); }
  }

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
    if (error) { toast.error("No se pudo actualizar"); return; }
    qc.setQueryData<Reminder[]>(["reminders"], (old = []) => old.map((r) => r.id === id ? { ...r, done } : r));
    if (done && ringing?.id === id) setRinging(null);
    await qc.invalidateQueries({ queryKey: ["reminders"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("reminders").delete().eq("id", id);
    if (error) { toast.error("No se pudo borrar el recordatorio"); throw error; }
    qc.setQueryData<Reminder[]>(["reminders"], (old = []) => old.filter((r) => r.id !== id));
    if (ringing?.id === id) setRinging(null);
    firing.current.delete(id);
    await qc.invalidateQueries({ queryKey: ["reminders"] });
    toast.success("Recordatorio borrado");
  }

  const pending = items.filter((r) => !r.done);
  const done = items.filter((r) => r.done).reverse();

  return (
    <>
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Editar recordatorio</DialogTitle></DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <Input aria-label="Qué recordar" placeholder="Qué recordar" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} disabled={saving} />
            <ReminderDateInput value={editWhen} onChange={setEditWhen} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Bell className="h-5 w-5" /> Recordatorios</h2>
          <PhoneToggle />
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin recordatorios pendientes.</p>
        ) : (
          <ul className="divide-y divide-border">
            {pending.map((r) => {
              const overdue = new Date(r.remind_at).getTime() < Date.now();
              return (
                <li key={r.id} className="group flex items-center gap-3 py-3">
                  <Button variant="outline" size="icon" onClick={() => setDone(r.id, true)} aria-label={`Marcar como hecho ${r.title}`} title="Marcar como hecho" className="shrink-0"><Check /></Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className={cn("text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>{fmt(r.remind_at)}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => startEdit(r)} aria-label={`Editar recordatorio ${r.title}`} title="Editar recordatorio" className="shrink-0"><Pencil className="h-4 w-4" /></Button>
                  <DeleteButton label={`recordatorio ${r.title}`} onDelete={() => remove(r.id)} />
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
                  <Button variant="ghost" size="icon" onClick={() => setDone(r.id, false)} aria-label={`Volver a pendiente ${r.title}`} title="Volver a pendiente"><RotateCcw /></Button>
                  <Button variant="ghost" size="icon" onClick={() => startEdit(r)} aria-label={`Editar recordatorio ${r.title}`} title="Editar recordatorio" className="shrink-0"><Pencil className="h-4 w-4" /></Button>
                  <DeleteButton label={`recordatorio ${r.title}`} onDelete={() => remove(r.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
