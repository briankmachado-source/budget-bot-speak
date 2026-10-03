import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, type UIMessage } from "ai";
import type { Database, Json } from "@/integrations/supabase/types";
import { streamChat } from "@/lib/chat.server";
import { withLovableAiGatewayRunIdHeader } from "@/lib/ai/run-id";

function titleFrom(m: UIMessage) {
  const t = m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
  return t.length > 48 ? t.slice(0, 48) + "…" : t || "Nueva conversación";
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = process.env["SUPABASE_URL"]!;
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
        const auth = request.headers.get("authorization");
        const token = auth?.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("No autorizado", { status: 401 });
        const sb = createClient<Database>(url, key, {
          global: {
            headers: { Authorization: `Bearer ${token}`, apikey: key },
          },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: authErr } = await sb.auth.getUser(token);
        if (authErr || !userData.user) return new Response("No autorizado", { status: 401 });
        const userId = userData.user.id;

        const body = (await request.json().catch(() => null)) as { id?: string; messages?: UIMessage[] } | null;
        const threadId = body?.id;
        const messages = body?.messages;
        if (!threadId || !Array.isArray(messages) || messages.length === 0) {
          return new Response("Solicitud inválida", { status: 400 });
        }
        const { data: thread } = await sb.from("chat_threads").select("id, title").eq("id", threadId).maybeSingle();
        if (!thread) return new Response("Conversación no encontrada", { status: 404 });

        const last = messages[messages.length - 1]!;
        if (last.role === "user") {
          const { error } = await sb.from("chat_messages").upsert(
            { message_id: last.id, thread_id: threadId, user_id: userId, role: "user", parts: last.parts as unknown as Json },
            { onConflict: "message_id" },
          );
          if (error) console.error("save user msg", error);
          const patch: { updated_at: string; title?: string } = { updated_at: new Date().toISOString() };
          if (thread.title === "Nueva conversación") patch.title = titleFrom(last);
          await sb.from("chat_threads").update(patch).eq("id", threadId);
        }

        try {
          let lastImage: string | undefined;
          for (const m of messages) for (const p of m.parts as Array<Record<string, unknown>>) {
            if (p["type"] === "file" && String(p["mediaType"] ?? "").startsWith("image/")) lastImage = String(p["url"]);
            if (p["type"] === "tool-editar_imagen" && p["state"] === "output-available") {
              const o = p["output"] as { imagen_url?: string } | undefined;
              if (o?.imagen_url) lastImage = o.imagen_url;
            }
          }
          const { result, runIdFetch } = await streamChat(request, sb, userId, await convertToModelMessages(messages), lastImage);
          const res = result.toUIMessageStreamResponse({
            originalMessages: messages,
            sendReasoning: true,
            onFinish: async ({ responseMessage }) => {
              if (responseMessage.role !== "assistant" || responseMessage.parts.length === 0) return;
              const { error } = await sb.from("chat_messages").upsert(
                { message_id: responseMessage.id, thread_id: threadId, user_id: userId, role: "assistant", parts: responseMessage.parts as unknown as Json },
                { onConflict: "message_id" },
              );
              if (error) console.error("save assistant msg", error);
            },
            onError: (e) => {
              const m = e instanceof Error ? e.message : String(e);
              if (m.includes("429")) return "Demasiadas solicitudes, intenta en un momento.";
              if (m.includes("402")) return "Se agotaron los créditos de IA.";
              return "El asistente tuvo un problema. Intenta de nuevo.";
            },
          });
          return withLovableAiGatewayRunIdHeader(res, runIdFetch);
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
  },
});
