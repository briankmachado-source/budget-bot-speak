import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, RotateCcw, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/DeleteButton";
import { parseAmount } from "@/lib/commands";
import { bogotaToday, paymentTotals, parsePendingInstallments, type Payment } from "@/lib/payment-control";
import { cn } from "@/lib/utils";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
export function PaymentPanel() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [installments, setInstallments] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: payments = [], isPending, isError } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*").order("due_on");
      if (error) throw error;
      return data as Payment[];
    },
  });
  const today = bogotaToday();
  const totals = paymentTotals(payments, today);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const n = parseAmount(amount);
    if (!title.trim() || !n || n <= 0 || !due) { toast.error("Completa el concepto, un monto válido y el vencimiento"); return; }
    let count: number | null;
    try { count = parsePendingInstallments(installments); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Revisa las cuotas pendientes"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.from("payments").insert({ title: title.trim(), amount: n, due_on: due, pending_installments: count }).select().single();
      if (error) throw error;
      qc.setQueryData<Payment[]>(["payments"], (old = []) => [...old, data].sort((a, b) => a.due_on.localeCompare(b.due_on)));
      setTitle(""); setAmount(""); setDue(""); setInstallments("");
      toast.success("Pago pendiente agregado");
      await qc.invalidateQueries({ queryKey: ["payments"] });
    } catch { toast.error("No se pudo guardar el pago"); } finally { setBusy(false); }
  }
  async function mark(payment: Payment) {
    const { error } = await supabase.from("payments").update({ paid: !payment.paid }).eq("id", payment.id);
    if (error) { toast.error("No se pudo actualizar el pago"); return; }
    qc.setQueryData<Payment[]>(["payments"], (old = []) => old.map((p) => p.id === payment.id ? { ...p, paid: !payment.paid } : p));
    await qc.invalidateQueries({ queryKey: ["payments"] });
  }
  async function remove(id: string) {
    const { error } = await supabase.from("payments").delete().eq("id", id);
    if (error) { toast.error("No se pudo borrar el pago"); throw error; }
    qc.setQueryData<Payment[]>(["payments"], (old = []) => old.filter((p) => p.id !== id));
    await qc.invalidateQueries({ queryKey: ["payments"] });
    toast.success("Pago borrado");
  }
  function rows(paid: boolean) {
    return payments.filter((p) => p.paid === paid).map((p) => <li key={p.id} className="flex items-center gap-2 py-3">
      <Button variant="outline" size="icon" className="shrink-0" aria-label={paid ? `Volver a pendiente ${p.title}` : `Marcar pagado ${p.title}`} title={paid ? "Volver a pendiente" : "Marcar pagado"} onClick={() => mark(p)}>{paid ? <RotateCcw /> : <Check />}</Button>
      <div className="min-w-0 flex-1"><p className={cn("break-words text-sm font-medium", paid && "text-muted-foreground line-through")}>{p.title}</p><p className={cn("text-xs", !paid && p.due_on < today ? "text-destructive" : "text-muted-foreground")}>{!paid && p.due_on < today ? "Vencido · " : "Vence · "}{new Date(`${p.due_on}T12:00:00`).toLocaleDateString("es-CO")}</p><p className="text-sm font-semibold tabular-nums">{cop.format(Number(p.amount))}</p></div>
      {p.pending_installments != null && !paid && <span className="max-w-20 shrink-0 text-center text-xs text-muted-foreground"><span className="block text-sm font-semibold text-foreground">{p.pending_installments}</span>{p.pending_installments === 1 ? "cuota pendiente" : "cuotas pendientes"}</span>}
      <DeleteButton label={`pago ${p.title}`} onDelete={() => remove(p.id)} />
    </li>);
  }
  return <section className="space-y-4 border-t py-5">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Wallet className="h-5 w-5" />Control de pagos pendientes</h2>
    <div className="grid grid-cols-2 gap-4"><div><p className="text-xs text-muted-foreground">Por pagar · {totals.count}</p><p className="break-words font-display text-xl font-bold">{cop.format(totals.pending)}</p></div><div><p className="text-xs text-muted-foreground">Vencidos</p><p className="break-words font-display text-xl font-bold text-destructive">{cop.format(totals.overdue)}</p></div></div>
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3"><label className="space-y-1 text-xs text-muted-foreground">Concepto<Input aria-label="Concepto del pago" placeholder="Ej. Arriendo" required value={title} onChange={(e) => setTitle(e.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">Monto<Input aria-label="Monto del pago" inputMode="decimal" placeholder="Ej. 400000" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label className="min-w-0 space-y-1 text-xs text-muted-foreground">Vencimiento<Input aria-label="Vencimiento del pago" type="date" required value={due} onChange={(e) => setDue(e.target.value)} /></label></div>
      <label className="block space-y-1 text-xs text-muted-foreground">Cuotas pendientes (opcional)<Input aria-label="Cuotas pendientes" type="number" min="1" max="2147483647" step="1" inputMode="numeric" placeholder="Ej. 12" value={installments} onChange={(e) => setInstallments(e.target.value)} className="sm:max-w-48" /></label>
      <Button type="submit" disabled={busy}><Plus />{busy ? "Guardando…" : "Agregar pago pendiente"}</Button>
    </form>
    {isPending ? <p className="text-sm text-muted-foreground">Cargando pagos…</p> : isError ? <p role="alert" className="text-sm text-destructive">No se pudieron cargar los pagos.</p> : <><ul className="divide-y divide-border">{rows(false)}</ul>{totals.count === 0 && <p className="text-sm text-muted-foreground">No tienes pagos pendientes.</p>}{payments.some((p) => p.paid) && <details><summary className="cursor-pointer text-sm font-medium text-muted-foreground">Pagados</summary><ul className="divide-y divide-border">{rows(true)}</ul></details>}</>}
  </section>;
}