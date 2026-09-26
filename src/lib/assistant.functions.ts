import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getWeather, type Weather } from "./weather.server";
export type { Weather };

export const CATEGORIES = [
  "Mercado",
  "Transporte",
  "Vivienda",
  "Servicios",
  "Salud",
  "Educación",
  "Entretenimiento",
  "Restaurantes",
  "Ropa",
  "Deudas",
  "Salario",
  "Ingresos extra",
  "Otros",
];

const resultSchema = z.object({
  action: z.enum(["create", "query", "weather", "remind", "unknown"]),
  type: z.enum(["expense", "income"]).nullable(),
  amount: z.number().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  city: z.string().nullable(),
  remind_at: z.string().nullable(),
  reply: z.string(),
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "type", "amount", "category", "description", "city", "remind_at", "reply"],
  properties: {
    action: { type: "string", enum: ["create", "query", "weather", "remind", "unknown"] },
    type: { type: ["string", "null"], enum: ["expense", "income", null] },
    amount: { type: ["number", "null"] },
    category: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    remind_at: { type: ["string", "null"] },
    reply: { type: "string" },
  },
};

const DEFAULT_CITY = "Bogotá";

function bogotaNow() {
  return new Date().toLocaleString("es-CO", {
    timeZone: "America/Bogota", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const DEFAULT_CITY = "Bogotá";

async function callModel(system: string, user: string, apiKey: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: system,
      input: [{ role: "user", content: user }],
      text: { format: { type: "json_schema", name: "finance_action", strict: true, schema: jsonSchema } },
    }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Demasiadas solicitudes, intenta en un momento.");
    if (res.status === 402) throw new Error("Se agotaron los créditos de IA del espacio de trabajo.");
    throw new Error(`Error del asistente (${res.status}) ${t.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const ev = JSON.parse(data);
          if (ev.type === "response.output_text.delta") text += ev.delta;
          if (ev.type === "error" || ev.type === "response.failed") {
            throw new Error(ev.error?.message ?? "El asistente falló");
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }
  return text;
}

export const runVoiceCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ text: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) throw new Error("Falta la configuración de IA.");

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const { data: rows } = await context.supabase
      .from("transactions")
      .select("type, amount, category, description, occurred_at")
      .gte("occurred_at", monthStart.toISOString())
      .order("occurred_at", { ascending: false })
      .limit(200);

    const byCat: Record<string, number> = {};
    let income = 0;
    let expense = 0;
    for (const r of rows ?? []) {
      const a = Number(r.amount);
      if (r.type === "income") income += a;
      else {
        expense += a;
        byCat[r.category] = (byCat[r.category] ?? 0) + a;
      }
    }

    const { data: pending } = await context.supabase
      .from("reminders")
      .select("title, remind_at")
      .eq("done", false)
      .order("remind_at")
      .limit(20);

    const system = `Eres "Atento", un asistente de voz de finanzas personales y recordatorios en Colombia. Moneda: pesos colombianos (COP).
Fecha y hora actual en Colombia (UTC-05:00): ${bogotaNow()}.
Interpreta el comando del usuario (transcrito de voz, puede tener errores) y responde SOLO con el JSON pedido.
- Si pide registrar un gasto o ingreso: action="create", type="expense"|"income", amount en pesos como número entero (ej. "400 mil" = 400000, "cuatrocientos mil" = 400000, "$400.000" = 400000, "un millón y medio" = 1500000), category exactamente una de: ${CATEGORIES.join(", ")}, description corta en español (ej. "Verduras"). Ignora saludos como "hola".
- Si pide un recordatorio o alarma ("recuérdame...", "ponme una alarma..."): action="remind", description = qué recordar, corto (ej. "Estar en la iglesia"), remind_at = fecha y hora ISO 8601 con offset -05:00 (ej. "2026-09-27T08:30:00-05:00"). Si solo dice un día sin hora, usa las 09:00. "en 2 días" = misma hora dentro de 2 días; "en 10 minutos" = ahora + 10 min. Si no queda claro cuándo, action="unknown" y pregunta.
- Si pregunta por sus finanzas o sus recordatorios: action="query" y responde con los datos de abajo.
- Si pregunta por el clima o el pronóstico: action="weather", city = nombre de la ciudad mencionada (ej. "Barranquilla") o null si no menciona ninguna. reply puede ser "".
- Si no entiendes o falta el monto: action="unknown" y pide aclaración.
- Campos que no aplican a la acción van en null.
reply: frase corta y natural en español para decir en voz alta, montos escritos como "400 mil pesos". Máximo 2 frases.
Resumen del mes actual: ingresos ${income} COP, gastos ${expense} COP, balance ${income - expense} COP. Gastos por categoría: ${JSON.stringify(byCat)}. Últimos movimientos: ${JSON.stringify((rows ?? []).slice(0, 10))}.
Recordatorios pendientes: ${JSON.stringify(pending ?? [])}.`;

    const raw = await callModel(system, data.text, apiKey);
    let parsed;
    try {
      parsed = resultSchema.parse(JSON.parse(raw));
    } catch {
      return { action: "unknown" as const, reply: "No te entendí bien, ¿puedes repetirlo?", transaction: null, weather: null };
    }

    if (parsed.action === "weather") {
      const city = parsed.city?.trim() || DEFAULT_CITY;
      const w = await getWeather(city).catch(() => null);
      if (!w) {
        return { action: "unknown" as const, reply: `No encontré el clima para ${city}.`, transaction: null, weather: null };
      }
      const rain = w.rainChance != null ? ` Probabilidad de lluvia del ${w.rainChance} por ciento.` : "";
      const reply = `En ${w.city} hace ${w.temp} grados, ${w.condition.toLowerCase()}. Hoy entre ${w.min} y ${w.max} grados.${rain}`;
      return { action: "weather" as const, reply, transaction: null, weather: w };
    }

    if (parsed.action === "remind") {
      const when = parsed.remind_at ? new Date(parsed.remind_at) : null;
      if (!when || isNaN(when.getTime()) || !parsed.description) {
        return { action: "unknown" as const, reply: "¿Para cuándo quieres el recordatorio?", transaction: null, weather: null };
      }
      const { error } = await context.supabase
        .from("reminders")
        .insert({ user_id: context.userId, title: parsed.description, remind_at: when.toISOString() });
      if (error) throw new Error("No pude guardar el recordatorio.");
      const label = when.toLocaleString("es-CO", {
        timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
      });
      return { action: "remind" as const, reply: `Listo, te recordaré ${parsed.description.toLowerCase()} el ${label}.`, transaction: null, weather: null };
    }

    if (parsed.action === "create") {
      if (!parsed.amount || parsed.amount <= 0) {
        return { action: "unknown" as const, reply: "¿Por qué monto quieres registrarlo?", transaction: null, weather: null };
      }
      const category = CATEGORIES.includes(parsed.category ?? "") ? parsed.category! : "Otros";
      const { data: tx, error } = await context.supabase
        .from("transactions")
        .insert({
          user_id: context.userId,
          type: parsed.type ?? "expense",
          amount: Math.round(parsed.amount),
          category,
          description: parsed.description,
        })
        .select()
        .single();
      if (error) throw new Error("No pude guardar el registro.");
      return { action: "create" as const, reply: parsed.reply, transaction: tx, weather: null };
    }
    return { action: parsed.action, reply: parsed.reply, transaction: null, weather: null };
  });
