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

export type Command =
  | { kind: "reminder"; title: string; at: Date }
  | { kind: "weather"; city: string }
  | { kind: "unknown" };

function bogotaParts(d: Date) {
  const b = new Date(d.getTime() - 5 * 3600e3);
  return { y: b.getUTCFullYear(), m: b.getUTCMonth(), d: b.getUTCDate(), h: b.getUTCHours(), min: b.getUTCMinutes() };
}
function bogotaDate(y: number, m: number, d: number, h: number, min: number) {
  return new Date(Date.UTC(y, m, d, h + 5, min));
}

function parseWhen(t: string, now: Date): { at: Date | null; rest: string } {
  let rest = t;
  const rel = rest.match(/\ben (\d+|un|una|media) (minuto|minutos|hora|horas|dia|dias)\b/);
  if (rel) {
    const raw = rel[1]!;
    const n = raw === "un" || raw === "una" ? 1 : raw === "media" ? 0.5 : Number(raw);
    const unit = rel[2]!.startsWith("min") ? 60e3 : rel[2]!.startsWith("hora") ? 3600e3 : 86400e3;
    rest = rest.replace(rel[0], " ");
    return { at: new Date(now.getTime() + n * unit), rest };
  }
  const p = bogotaParts(now);
  let dayOffset = 0;
  let hasDay = false;
  if (/\bpasado manana\b/.test(rest)) { dayOffset = 2; hasDay = true; rest = rest.replace(/\bpasado manana\b/, " "); }
  else if (/\bmanana\b/.test(rest) && !/\bde la manana\b|\bpor la manana\b|\ben la manana\b/.test(rest)) { dayOffset = 1; hasDay = true; rest = rest.replace(/\bmanana\b/, " "); }
  else if (/\bhoy\b/.test(rest)) { hasDay = true; rest = rest.replace(/\bhoy\b/, " "); }
  const tm = rest.match(/\ba las? (\d{1,2})(?::|\s)?(\d{2})?\s*(de la manana|de la tarde|de la noche|am|pm|a\.m\.|p\.m\.)?/);
  let h = 9, min = 0, hasTime = false;
  if (tm) {
    hasTime = true;
    h = Number(tm[1]); min = tm[2] ? Number(tm[2]) : 0;
    const suf = tm[3] ?? "";
    if (/tarde|noche|pm|p\.m/.test(suf) && h < 12) h += 12;
    if (/manana|am|a\.m/.test(suf) && h === 12) h = 0;
    rest = rest.replace(tm[0], " ");
  }
  if (!hasDay && !hasTime) return { at: null, rest };
  let at = bogotaDate(p.y, p.m, p.d + dayOffset, h, min);
  if (!hasDay && at.getTime() <= now.getTime()) at = bogotaDate(p.y, p.m, p.d + 1, h, min);
  return { at, rest };
}

export function parseCommand(raw: string, now = new Date()): Command {
  const t = norm(raw).replace(/^(hola|oye|ok)[\s,]+/, "").replace(/^atento\s*(ai|ia)?[\s,]*/, "").trim();

  if (/\b(recuerdame|recordatorio|alarma|avisame|recuerda)\b/.test(t)) {
    const { at, rest } = parseWhen(t, now);
    const title = rest
      .replace(/\b(recuerdame|recordatorio|alarma|avisame|recuerda|ponme|crea|crear|agrega|pon|una|un)\b/g, " ")
      .replace(/^(\s*(que|de|para|a|el|la)\b)+/g, " ").replace(/\s+/g, " ").trim();
    if (!at) return { kind: "unknown" };
    return { kind: "reminder", title: title ? title[0]!.toUpperCase() + title.slice(1) : "Recordatorio", at };
  }

  if (/\b(clima|temperatura|llover|lluvia|llueve|tiempo hace)\b/.test(t)) {
    const m = t.match(/\b(?:en|de|para)\s+([a-z\s]+?)(?:\s+(?:hoy|manana|ahora))?$/);
    let city = m?.[1]?.trim() ?? "";
    city = city.replace(/^(el|la|los|las)\s+/, "").replace(/\b(clima|tiempo|temperatura)\b/g, "").trim();
    return { kind: "weather", city: city || "Bogotá" };
  }

  return { kind: "unknown" };
}
