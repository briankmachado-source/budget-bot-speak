export function toLocalDateTime(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function reminderChanges(current: { remind_at: string; notified: boolean; pushed: boolean }, title: string, when: string) {
  const date = new Date(when);
  if (!title.trim() || Number.isNaN(date.getTime())) throw new Error("Escribe qué recordar y cuándo");
  const remind_at = date.toISOString();
  const sameTime = date.getTime() === new Date(current.remind_at).getTime();
  return { title: title.trim(), remind_at, notified: sameTime ? current.notified : false, pushed: sameTime ? current.pushed : false };
}