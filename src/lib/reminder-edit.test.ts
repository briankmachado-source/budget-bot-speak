import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderChanges } from "./reminder-edit";

test("Permite editar el título y la fecha de un recordatorio", () => {
  assert.deepEqual(reminderChanges({ remind_at: "2026-11-08T14:00:00Z", notified: true }, " Llamar al médico ", "2026-11-09T15:30:00Z"), {
    title: "Llamar al médico", remind_at: "2026-11-09T15:30:00.000Z", notified: false,
  });
});
test("Editar solo el título conserva el aviso ya enviado", () => {
  assert.equal(reminderChanges({ remind_at: "2026-11-08T14:00:00Z", notified: true }, "Llamar", "2026-11-08T14:00:00Z").notified, true);
});