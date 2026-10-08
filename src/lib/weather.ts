const CODES: Record<number, string> = {
  0: "Despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado",
  45: "Niebla", 48: "Niebla", 51: "Llovizna ligera", 53: "Llovizna", 55: "Llovizna intensa",
  61: "Lluvia ligera", 63: "Lluvia", 65: "Lluvia fuerte", 80: "Chubascos ligeros",
  81: "Chubascos", 82: "Chubascos fuertes", 95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta con granizo",
};

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
};

export async function getWeather(city: string): Promise<Weather | null> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=es`
    );
    if (!geoRes.ok) return null;
    const g = await geoRes.json();
    const results = (g.results ?? []) as Array<{
      name: string;
      latitude: number;
      longitude: number;
      country_code: string;
      admin1?: string;
    }>;

    // Prioriza Colombia ("CO") si existe coincidencia, de lo contrario toma el primer resultado
    const place = results.find((r) => r.country_code === "CO") ?? results[0];
    if (!place) return null;

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`
    );
    if (!weatherRes.ok) return null;
    const f = await weatherRes.json();

    const code = Number(f.current?.weather_code ?? 0);
    return {
      city: place.name,
      region: place.admin1 ?? null,
      temp: Math.round(f.current.temperature_2m),
      max: Math.round(f.daily.temperature_2m_max[0]),
      min: Math.round(f.daily.temperature_2m_min[0]),
      rainChance: f.daily.precipitation_probability_max?.[0] ?? null,
      humidity: Math.round(f.current.relative_humidity_2m),
      wind: Math.round(f.current.wind_speed_10m),
      condition: CODES[code] ?? "Variable",
      code,
    };
  } catch {
    return null;
  }
  }
      
