import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { paymentTotals, parsePendingInstallments } from "./payment-control";

describe("Control de pendientes de pago", () => {
  test("Guarda el número de cuotas pendientes sin modificar el monto", () => {
    const installments = parsePendingInstallments("12");
    assert.equal(installments, 12);
    assert.equal(paymentTotals([{ id: "cuotas", title: "Crédito", amount: 400000, due_on: "2026-11-05", paid: false, pending_installments: installments }], "2026-11-04").pending, 400000);
  });
  test("Las cuotas pendientes son enteros positivos o quedan sin especificar", () => {
    assert.equal(parsePendingInstallments(""), null);
    for (const invalid of ["0", "-1", "1.5", "texto", "2147483648"]) assert.throws(() => parsePendingInstallments(invalid));
  });
  test("Los pagos pagados no son pendientes", () => {
    const totals = paymentTotals([
      { id: "1", title: "Arriendo", amount: 400000, due_on: "2026-11-05", paid: false },
      { id: "2", title: "Luz", amount: 50000, due_on: "2026-11-01", paid: true },
    ], "2026-11-04");
    assert.deepEqual(totals, { pending: 400000, overdue: 0, count: 1 });
  });
  test("Un pago que vence hoy no está vencido", () => {
    const totals = paymentTotals([
      { id: "1", title: "Agua", amount: 50000, due_on: "2026-11-04", paid: false },
      { id: "2", title: "Luz", amount: 100000, due_on: "2026-11-03", paid: false },
    ], "2026-11-04");
    assert.equal(totals.overdue, 100000);
  });
});