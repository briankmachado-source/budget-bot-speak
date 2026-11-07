// Intérprete de frases fijas en español (sin IA): recordatorios y clima.
export function norm(t: string) {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

export function parseAmount(t: string): number | null {
  const m = norm(t).match(/\$?\s*(\d[\d.,]*)\s*(mil\b|millon(?:es)?|k\b)?/);
  const half = /medio millon/.test(norm(t));
  if (!m) return half ? 500000 : null;
  const raw = m[1]!.replace(/[.,]+$/, "");
  let n: number;
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) n = Number(raw.replace(/[.,]/g, ""));
  else n = parseFloat(raw.replace(",", "."));
  if (!isFinite(n)) return null;
  const u = m[2];
  if (u === "mil" || u === "k") n *= 1000;
  else if (u?.startsWith("millon")) n *= 1_000_000;
  return Math.round(n);
}

/** Partes de un recordatorio; las que falten se preguntan. */
export type ReminderParts = {
  title: string | null;
  day: { offset: number; label: string } | null;
  time: { h: number; min: number } | null;
  /** "en 10 minutos": momento exacto, no necesita día ni hora. */
  exact: Date | null;
};

export type Command =
  | { kind: "reminder"; title: string; at: Date }
  | { kind: "reminder_partial"; parts: ReminderParts; question: string }
  | { kind: "weather"; city: string }
  | { kind: "cancel" }
  | { kind: "unknown" };

function bogotaParts(d: Date) {
  const b = new Date(d.getTime() - 5 * 3600e3);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth(), d: b.getUTCDate(), wd: b.getUTCDay() };
}
function bogotaDate(y: number, m: number, d: number, h: number, min: number) {
  return new Date(Date.UTC(y, m, d, h + 5, min));
}

export const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Días que faltan para el próximo `target` (0-6). Si hoy es ese día, cuenta 7. */
export function daysUntil(todayWd: number, target: number) {
  const diff = (target - todayWd + 7) % 7;
  return diff === 0 ? 7 : diff;
}

const KEYWORDS = /\b(recuerdame|recordarme|recordatorio|alarma|avisame|recuerda|ponme|crea|crear|agrega|pon)\b/g;

/** Extrae qué, día y hora de una frase (sin exigir palabra clave). */
export function parseParts(t: string, now: Date): ReminderParts {
  let rest = ` ${t} `;
  let exact: Date | null = null;
  let day: ReminderParts["day"] = null;
  let time: ReminderParts["time"] = null;

  const rel = rest.match(/\ben (\d+|un|una|media) (minuto|minutos|hora|horas|dia|dias)\b/);
  if (rel) {
    const raw = rel[1]!;
    const n = raw === "un" || raw === "una" ? 1 : raw === "media" ? 0.5 : Number(raw);
    const unit = rel[2]!.startsWith("min") ? 60e3 : rel[2]!.startsWith("hora") ? 3600e3 : 86400e3;
    rest = rest.replace(rel[0], " ");
    exact = new Date(now.getTime() + n * unit);
  }

  const p = bogotaParts(now);
  if (!exact) {
    const wd = rest.match(/\b(?:(?:para |el |este |esta |proximo |el proximo )*)(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
    if (/\bpasado manana\b/.test(rest)) { day = { offset: 2, label: "pasado mañana" }; rest = rest.replace(/\b(para )?pasado manana\b/, " "); }
    else if (/\bmanana\b/.test(rest.replace(/\b(de|por|en) la manana\b/g, ""))) {
      day = { offset: 1, label: "mañana" };
      rest = rest.replace(/\b(para )?manana\b(?<!la manana)/, " ");
    } else if (/\bhoy\b/.test(rest)) { day = { offset: 0, label: "hoy" }; rest = rest.replace(/\b(para )?hoy\b/, " "); }
    else if (wd) {
      const target = WEEKDAYS[wd[1]!]!;
      day = { offset: daysUntil(p.wd, target), label: `el ${WEEKDAY_NAMES[target]}` };
      rest = rest.replace(wd[0], " ");
    }

    const tm = rest.match(/\b(?:a las?|para las?|las?)\s*(\d{1,2})(?::|\s)?(\d{2})?\s*(de la manana|de la tarde|de la noche|am|pm|a\.?\s?m\.?|p\.?\s?m\.?)?|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?\s?m\.?|p\.?\s?m\.?)/);
    if (tm) {
      let h = Number(tm[1] ?? tm[4]);
      const min = Number(tm[2] ?? tm[5] ?? 0);
      const suf = tm[3] ?? tm[6] ?? "";
      if (/tarde|noche|p/.test(suf) && h < 12) h += 12;
      if (/manana|a/.test(suf) && !/p/.test(suf) && h === 12) h = 0;
      if (h <= 23 && min <= 59) { time = { h, min }; rest = rest.replace(tm[0], " "); }
    }
  }

  const title = rest
    .replace(KEYWORDS, " ")
    .replace(/\b(de|por|en) la manana\b/g, " ")
    .replace(/^(\s*(que|de|para|a|el|la|me|una|un)\b)+/g, " ")
    .replace(/(\b(para|a|el|la|de)\s*)+$/g, " ")
    .replace(/\s+/g, " ").trim();
  return { title: title ? title[0]!.toUpperCase() + title.slice(1) : null, day, time, exact };
}

/** Une lo que se tenía con la respuesta del usuario (lo nuevo completa lo faltante). */
export function mergeParts(a: ReminderParts, b: ReminderParts): ReminderParts {
  return { title: a.title ?? b.title, day: a.day ?? b.day, time: a.time ?? b.time, exact: a.exact ?? b.exact };
}

function fmtTime(h: number, min: number) {
  const s = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, "0")} ${s}`;
}

/** Decide si el recordatorio está completo o qué preguntar. */
export function resolveParts(parts: ReminderParts, now: Date): Command {
  const { title, day, time, exact } = parts;
  if (exact && title) return { kind: "reminder", title, at: exact };
  if (title && day && time) {
    const p = bogotaParts(now);
    let at = bogotaDate(p.y, p.m, p.d + day.offset, time.h, time.min);
    if (at.getTime() <= now.getTime() && day.offset === 0) {
      return { kind: "reminder_partial", parts: { ...parts, time: null }, question: `Esa hora ya pasó hoy. ¿A qué hora te recuerdo ${title.toLowerCase()}?` };
    }
    return { kind: "reminder", title, at };
  }
  let question: string;
  if (exact) question = "¿Qué te recuerdo?";
  else if (!title && day && !time) question = `¿Qué te recuerdo para ${day.label} y a qué hora?`;
  else if (!title && !day && time) question = `¿Qué te recuerdo y para qué día a las ${fmtTime(time.h, time.min)}?`;
  else if (!title && day && time) question = `¿Qué te recuerdo para ${day.label} a las ${fmtTime(time.h, time.min)}?`;
  else if (!title) question = "¿Qué te recuerdo, qué día y a qué hora?";
  else if (day && !time) question = `¿Para ${day.label} a qué hora?`;
  else if (!day && time) question = `¿Para qué día a las ${fmtTime(time.h, time.min)}?`;
  else question = "¿Para qué día y hora?";
  return { kind: "reminder_partial", parts, question };
}

function clean(raw: string) {
  return norm(raw).replace(/^(hola|oye|ok)[\s,]+/, "").replace(/^atento\s*(ai|ia)?[\s,]*/, "").replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
}

/** Respuesta a una pregunta aclaratoria pendiente. */
export function continueReminder(pending: ReminderParts, raw: string, now = new Date()): Command {
  const t = clean(raw);
  if (/^(cancela|cancelar|olvidalo|no|nada|dejalo)\b/.test(t)) return { kind: "cancel" };
  const extra = parseParts(t, now);
  // Si ya teníamos título, lo nuevo no lo reemplaza; si no, el texto restante es el título.
  return resolveParts(mergeParts(pending, extra), now);
}

export function parseCommand(raw: string, now = new Date()): Command {
  const t = clean(raw);

  if (/\b(recuerdame|recordarme|recordatorio|alarma|avisame|recuerda)\b/.test(t)) {
    return resolveParts(parseParts(t, now), now);
  }

  if (/\b(clima|temperatura|llover|lluvia|llueve|tiempo hace)\b/.test(t)) {
    const m = t.match(/\b(?:en|de|para)\s+([a-z\s]+?)(?:\s+(?:hoy|manana|ahora))?$/);
    let city = m?.[1]?.trim() ?? "";
    city = city.replace(/^(el|la|los|las)\s+/, "").replace(/\b(clima|tiempo|temperatura)\b/g, "").trim();
    return { kind: "weather", city };
  }

  return { kind: "unknown" };
}
