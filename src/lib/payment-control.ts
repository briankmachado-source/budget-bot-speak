export type Payment = { id: string; title: string; amount: number; due_on: string; paid: boolean };

export function paymentTotals(payments: Payment[], today: string) {
  return payments.reduce((totals, payment) => {
    if (payment.paid) return totals;
    totals.pending += Number(payment.amount);
    if (payment.due_on < today) totals.overdue += Number(payment.amount);
    totals.count += 1;
    return totals;
  }, { pending: 0, overdue: 0, count: 0 });
}

export function bogotaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}