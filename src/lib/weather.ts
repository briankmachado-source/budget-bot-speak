// Clima directo desde el navegador con Open-Meteo (gratis, sin claves).
const CODES: Record<number, string> = {
  0: "Despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado",
  45: "Niebla", 48: "Niebla", 51: "Llovizna ligera", 53: "Llovizna", 55: "Llovizna intensa",
  61: "Lluvia ligera", 63: "Lluvia", 65: "Lluvia fuerte", 80: "Chubascos ligeros",
  81: "Chubascos", 82: "Chubascos fuertes", 95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta con granizo",
};

/** Probabilidad desde la que se considera lluvia significativa. */
export const RAIN_THRESHOLD = 30;

export type RainOutlook =
  | { kind: "today"; prob: number; time: string }
  | { kind: "later"; prob: number; time: string; day: string }
  | { kind: "none" };

export type Weather = {
  city: string;
  region: string | null;
  temp: number;
  max: number;
  min: number;
  rainChance: number | null;
  humidity: number;
  wind: number;
  condition: string;
  code: number;
  rain: RainOutlook;
};

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function ampm(hhmm: string) {
  const [hs, ms] = hhmm.split(":");
  const h = Number(hs);
  return `${h % 12 === 0 ? 12 : h % 12}:${ms} ${h >= 12 ? "PM" : "AM"}`;
}

/**
 * times: horas locales "YYYY-MM-DDTHH:mm"; nowLocal: hora local actual en el mismo formato.
 * Hoy (desde la hora actual): la hora con mayor probabilidad. Si no, la primera hora con lluvia de los días siguientes.
 */
export function findRain(times: string[], probs: (number | null)[], nowLocal: string): RainOutlook {
  const today = nowLocal.slice(0, 10);
  const hourNow = nowLocal.slice(0, 13);
  let best: { prob: number; t: string } | null = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (t.slice(0, 10) !== today || t.slice(0, 13) < hourNow) continue;
    const p = probs[i] ?? 0;
    if (p >= RAIN_THRESHOLD && (!best || p > best.prob)) best = { prob: p, t };
  }
  if (best) return { kind: "today", prob: best.prob, time: ampm(best.t.slice(11, 16)) };
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    if (t.slice(0, 10) <= today) continue;
    const p = probs[i] ?? 0;
    if (p >= RAIN_THRESHOLD) {
      const [y, m, d] = t.slice(0, 10).split("-").map(Number);
      const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
      return { kind: "later", prob: p, time: ampm(t.slice(11, 16)), day: DAYS[wd]! };
    }
  }
  return { kind: "none" };
}

export function rainText(r: RainOutlook) {
  if (r.kind === "today") return `La mayor probabilidad de lluvia es del ${r.prob}% hoy a las ${r.time}.`;
  if (r.kind === "later") return `Hoy sin lluvia; la próxima lluvia prevista es el ${r.day} a las ${r.time} con ${r.prob}% de probabilidad.`;
  return "Sin lluvia prevista para los próximos días.";
}

export function weatherSentence(w: Weather) {
  return `En ${w.city} hay ${w.temp} grados, ${w.condition.toLowerCase()}. Máxima ${w.max}, mínima ${w.min}. ${rainText(w.rain)}`;
}

async function forecast(lat: number, lon: number, city: string, region: string | null): Promise<Weather | null> {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&hourly=precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4`
  );
  if (!res.ok) return null;
  const f = await res.json();
  const code = Number(f.current?.weather_code ?? 0);
  return {
    city,
    region,
    temp: Math.round(f.current.temperature_2m),
    max: Math.round(f.daily.temperature_2m_max[0]),
    min: Math.round(f.daily.temperature_2m_min[0]),
    rainChance: f.daily.precipitation_probability_max?.[0] ?? null,
    humidity: Math.round(f.current.relative_humidity_2m),
    wind: Math.round(f.current.wind_speed_10m),
    condition: CODES[code] ?? "Variable",
    code,
    rain: findRain(f.hourly?.time ?? [], f.hourly?.precipitation_probability ?? [], String(f.current.time ?? "")),
  };
}

export async function getWeather(city: string): Promise<Weather | null> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=es`
    );
    if (!geoRes.ok) return null;
    const g = await geoRes.json();
    const results = (g.results ?? []) as Array<{ name: string; latitude: number; longitude: number; country_code: string; admin1?: string }>;
    const place = results.find((r) => r.country_code === "CO") ?? results[0];
    if (!place) return null;
    return await forecast(place.latitude, place.longitude, place.name, place.admin1 ?? null);
  } catch {
    return null;
  }
}

/** Clima por coordenadas del dispositivo. El nombre del lugar es opcional (servicio gratuito sin clave). */
export async function getWeatherByCoords(lat: number, lon: number): Promise<Weather | null> {
  let city = "Tu ubicación";
  let region: string | null = null;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=es`);
    if (r.ok) {
      const j = await r.json();
      city = j.city || j.locality || city;
      region = j.principalSubdivision || null;
    }
  } catch { /* sin nombre */ }
  try {
    return await forecast(lat, lon, city, region);
  } catch {
    return null;
  }
}
