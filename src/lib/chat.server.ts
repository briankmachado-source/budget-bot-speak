import { createOpenAI } from "@ai-sdk/openai";
import { streamText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createLovableAiGatewayRunIdFetch, getLovableAiGatewayRunId } from "./ai/run-id";
import { getWeather } from "./weather.server";
import { searchSong } from "./youtube.server";

export const CATEGORIES = [
  "Mercado", "Transporte", "Vivienda", "Servicios", "Salud", "Educación", "Entretenimiento",
  "Restaurantes", "Ropa", "Deudas", "Salario", "Ingresos extra", "Otros",
] as const;

function bogotaNow() {
  return new Date().toLocaleString("es-CO", {
    timeZone: "America/Bogota", weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function buildTools(sb: SupabaseClient<Database>, userId: string) {
  return {
    registrar_transaccion: tool({
      description: "Registra un gasto o ingreso del usuario en pesos colombianos.",
      inputSchema: z.object({
        tipo: z.enum(["expense", "income"]),
        monto: z.number().describe("Monto en pesos enteros. '400 mil' = 400000"),
        categoria: z.enum(CATEGORIES),
        descripcion: z.string().describe("Descripción corta, ej. 'Verduras'"),
      }),
      execute: async ({ tipo, monto, categoria, descripcion }) => {
        if (!monto || monto <= 0) return { ok: false, error: "Monto inválido" };
        const { data, error } = await sb.from("transactions")
          .insert({ user_id: userId, type: tipo, amount: Math.round(monto), category: categoria, description: descripcion })
          .select().single();
        if (error) return { ok: false, error: "No se pudo guardar" };
        return { ok: true, transaccion: data };
      },
    }),
    consultar_finanzas: tool({
      description: "Obtiene el resumen financiero del mes actual y los últimos movimientos del usuario.",
      inputSchema: z.object({}),
      execute: async () => {
        const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
        const { data: rows } = await sb.from("transactions")
          .select("type, amount, category, description, occurred_at")
          .gte("occurred_at", start.toISOString()).order("occurred_at", { ascending: false }).limit(200);
        let ingresos = 0, gastos = 0; const porCategoria: Record<string, number> = {};
        for (const r of rows ?? []) {
          const a = Number(r.amount);
          if (r.type === "income") ingresos += a;
          else { gastos += a; porCategoria[r.category] = (porCategoria[r.category] ?? 0) + a; }
        }
        return { ingresos, gastos, balance: ingresos - gastos, porCategoria, ultimos: (rows ?? []).slice(0, 10) };
      },
    }),
    consultar_recordatorios: tool({
      description: "Lista los recordatorios pendientes del usuario.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await sb.from("reminders").select("title, remind_at").eq("done", false).order("remind_at").limit(20);
        return { pendientes: data ?? [] };
      },
    }),
    crear_recordatorio: tool({
      description: "Crea un recordatorio o alarma.",
      inputSchema: z.object({
        titulo: z.string().describe("Qué recordar, corto"),
        fecha_iso: z.string().describe("Fecha y hora ISO 8601 con offset -05:00, ej. 2026-09-27T08:30:00-05:00"),
      }),
      execute: async ({ titulo, fecha_iso }) => {
        const when = new Date(fecha_iso);
        if (isNaN(when.getTime())) return { ok: false, error: "Fecha inválida" };
        const { error } = await sb.from("reminders").insert({ user_id: userId, title: titulo, remind_at: when.toISOString() });
        if (error) return { ok: false, error: "No se pudo guardar" };
        return { ok: true, titulo, remind_at: when.toISOString() };
      },
    }),
    consultar_clima: tool({
      description: "Consulta el clima actual y el pronóstico de hoy de una ciudad. Si no mencionan ciudad usa Bogotá.",
      inputSchema: z.object({ ciudad: z.string() }),
      execute: async ({ ciudad }) => {
        const w = await getWeather(ciudad || "Bogotá").catch(() => null);
        return w ? { ok: true, clima: w } : { ok: false, error: `No encontré el clima de ${ciudad}` };
      },
    }),
    poner_cancion: tool({
      description: "Busca y reproduce una canción o música en YouTube.",
      inputSchema: z.object({ busqueda: z.string().describe("Canción y artista, o género") }),
      execute: async ({ busqueda }) => {
        const song = await searchSong(busqueda).catch(() => null);
        return song ? { ok: true, cancion: song } : { ok: false, error: `No encontré "${busqueda}"` };
      },
    }),
    detener_musica: tool({
      description: "Detiene la música que está sonando.",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true, detenida: true }),
    }),
    guardar_recuerdo: tool({
      description: "Guarda en la memoria a largo plazo un dato duradero aprendido del usuario (datos personales, gustos, metas, hábitos, preferencias de respuesta, patrones de gasto). Úsala por iniciativa propia, sin pedir permiso, cada vez que aprendas algo útil para el futuro. No guardes datos ya memorizados.",
      inputSchema: z.object({
        contenido: z.string().describe("Hecho breve en tercera persona, ej. 'Vive en Medellín'"),
        categoria: z.enum(["personal", "preferencias", "finanzas", "metas", "habitos", "musica", "general"]),
      }),
      execute: async ({ contenido, categoria }) => {
        const { error } = await sb.from("ai_memories").insert({ user_id: userId, content: contenido.slice(0, 400), category: categoria });
        return error ? { ok: false } : { ok: true };
      },
    }),
    listar_recuerdos: tool({
      description: "Muestra lo que has aprendido del usuario. Úsala SOLO si el usuario lo pide explícitamente.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await sb.from("ai_memories").select("id, content, category").order("created_at", { ascending: false }).limit(100);
        return { recuerdos: data ?? [] };
      },
    }),
    olvidar_recuerdo: tool({
      description: "Borra recuerdos cuando el usuario lo pida. Pasa el texto a olvidar o 'todo' para borrar toda la memoria.",
      inputSchema: z.object({ buscar: z.string() }),
      execute: async ({ buscar }) => {
        let q = sb.from("ai_memories").delete().eq("user_id", userId);
        if (buscar.trim().toLowerCase() !== "todo") q = q.ilike("content", `%${buscar}%`);
        const { data, error } = await q.select("id");
        return error ? { ok: false } : { ok: true, borrados: data?.length ?? 0 };
      },
    }),
  };
}

async function buildContext(sb: SupabaseClient<Database>) {
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
  const in48 = new Date(Date.now() + 48 * 3600e3).toISOString();
  const [mem, tx, rem] = await Promise.all([
    sb.from("ai_memories").select("content, category").order("created_at", { ascending: false }).limit(80),
    sb.from("transactions").select("type, amount, category").gte("occurred_at", start.toISOString()).limit(500),
    sb.from("reminders").select("title, remind_at").eq("done", false).lte("remind_at", in48).order("remind_at").limit(10),
  ]);
  let ing = 0, gas = 0; const cat: Record<string, number> = {};
  for (const r of tx.data ?? []) {
    const a = Number(r.amount);
    if (r.type === "income") ing += a; else { gas += a; cat[r.category] = (cat[r.category] ?? 0) + a; }
  }
  const memories = (mem.data ?? []).map((m) => `- [${m.category}] ${m.content}`).join("\n") || "(aún nada)";
  const top = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, v]) => `${c}: ${v}`).join(", ");
  const reminders = (rem.data ?? []).map((r) => `- ${r.title} (${new Date(r.remind_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })})`).join("\n") || "(ninguno)";
  return `MEMORIA A LARGO PLAZO DEL USUARIO:\n${memories}\n\nESTADO ACTUAL (para ser proactivo):\nMes: ingresos ${ing}, gastos ${gas}, balance ${ing - gas}. Mayores gastos: ${top || "sin datos"}.\nRecordatorios próximos 48h:\n${reminders}`;
}

export async function streamChat(request: Request, sb: SupabaseClient<Database>, userId: string, messages: ModelMessage[]) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Falta la configuración de IA.");
  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
  const context = await buildContext(sb).catch(() => "");
  const system = `Eres "Atento AI", un asistente conversacional por voz, autónomo y con aprendizaje continuo, para usuarios en Colombia. Respondes siempre en español.
Fecha y hora actual en Colombia (UTC-05:00): ${bogotaNow()}.
Los mensajes suelen venir transcritos de voz y pueden tener errores: interpreta la intención. Ignora saludos o palabras de activación como "hola" o "Atento AI".
Puedes hablar de cualquier tema (cultura, ciencia, cocina, consejos, cálculos, traducciones, programación). No tienes noticias ni resultados deportivos en tiempo real: dilo con honestidad.
Usa las herramientas cuando el usuario pida: registrar gastos/ingresos (moneda COP, montos enteros), consultar sus finanzas o recordatorios, crear recordatorios (si solo da día sin hora usa 09:00; "en N minutos/días" se calcula desde ahora; si no queda claro cuándo, pregunta), clima, poner o detener música.

APRENDIZAJE CONTINUO: cada vez que detectes un dato duradero del usuario (nombre, familia, ciudad, trabajo, metas, gustos, hábitos, patrones de gasto, cómo prefiere que le respondas) llama a guardar_recuerdo en silencio, sin anunciarlo. Usa siempre la memoria para personalizar (llámalo por su nombre, usa su ciudad para el clima, su música favorita, su estilo preferido). Si un dato cambia, guarda el nuevo. Solo muestra o borra recuerdos si el usuario lo pide.

PROACTIVIDAD AVANZADA: anticípate. Cuando sea oportuno y breve, agrega una observación útil: gasto inusual o categoría alta, balance negativo, recordatorio próximo, sugerencia de crear un recordatorio cuando mencione un compromiso, o de registrar un gasto que mencione de pasada. Si registra un gasto repetido, sugiere un presupuesto. No seas insistente: máximo una sugerencia por respuesta.

${context}

Tus respuestas se leen en voz alta: sé natural y conciso (normalmente 1 a 4 frases), escribe montos como "400 mil pesos". Usa listas o markdown solo cuando el usuario pida algo largo o estructurado.`;

  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    system,
    messages,
    tools: buildTools(sb, userId),
    stopWhen: stepCountIs(50),
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  return { result, runIdFetch };
}
