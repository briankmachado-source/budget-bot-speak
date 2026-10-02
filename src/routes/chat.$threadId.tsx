import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type ToolUIPart } from "ai";
import { LogOut, Mic, MicOff, Plus, Trash2, PanelRight, AudioLines } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";
import { FinancePanel, WeatherCard, MusicPlayer } from "@/components/FinancePanel";
import { useSession, createThread } from "@/hooks/use-session";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools, PromptInputButton } from "@/components/ai-elements/prompt-input";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Weather } from "@/lib/weather.server";
import type { Song } from "@/lib/youtube.server";

export const Route = createFileRoute("/chat/$threadId")({
  head: () => ({
    meta: [
      { title: "Conversación — Atento AI" },
      { name: "description", content: "Habla con Atento AI por voz o texto: preguntas, finanzas, recordatorios, clima y música." },
      { property: "og:title", content: "Conversación — Atento AI" },
      { property: "og:description", content: "Tu asistente conversacional por voz." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChatRoute,
});

const TOOL_LABELS: Record<string, string> = {
  registrar_transaccion: "Registrar movimiento",
  consultar_finanzas: "Consultar finanzas",
  consultar_recordatorios: "Consultar recordatorios",
  crear_recordatorio: "Crear recordatorio",
  consultar_clima: "Consultar clima",
  poner_cancion: "Buscar canción",
  detener_musica: "Detener música",
};

function ChatRoute() {
  const { threadId } = Route.useParams();
  const { session, ready } = useSession();
  if (!ready) return <div className="min-h-screen" />;
  if (!session) return <AuthScreen />;
  return <ChatShell threadId={threadId} email={session.user.email ?? ""} />;
}

function ChatShell({ threadId, email }: { threadId: string; email: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState<"panel" | "historial">("panel");
  const [song, setSong] = useState<Song | null>(null);
  const [weather, setWeather] = useState<Weather | null>(null);

  const threads = useQuery({
    queryKey: ["threads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("chat_threads").select("id, title, updated_at").order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const history = useQuery({
    queryKey: ["thread-messages", threadId],
    queryFn: async () => {
      const { data, error } = await supabase.from("chat_messages").select("message_id, role, parts").eq("thread_id", threadId).order("created_at");
      if (error) throw error;
      return data.map((r) => ({ id: r.message_id, role: r.role, parts: r.parts }) as unknown as UIMessage);
    },
    staleTime: Infinity,
  });

  async function newThread() {
    try {
      const id = await createThread();
      await qc.invalidateQueries({ queryKey: ["threads"] });
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    } catch {
      toast.error("No se pudo crear la conversación");
    }
  }

  async function removeThread(id: string) {
    const { error } = await supabase.from("chat_threads").delete().eq("id", id);
    if (error) { toast.error("No se pudo eliminar"); return; }
    await qc.invalidateQueries({ queryKey: ["threads"] });
    if (id === threadId) {
      const next = threads.data?.find((t) => t.id !== id);
      if (next) navigate({ to: "/chat/$threadId", params: { threadId: next.id } });
      else newThread();
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card/40 md:flex">
        <div className="flex items-center gap-2 p-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <AudioLines className="h-4 w-4" />
          </span>
          <span className="font-display text-lg font-bold">Atento AI</span>
        </div>
        <div className="px-3">
          <Button onClick={newThread} variant="secondary" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" /> Nueva conversación
          </Button>
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2">
          {threads.data?.map((t) => (
            <div key={t.id} className={cn("group flex items-center rounded-lg", t.id === threadId ? "bg-secondary" : "hover:bg-secondary/60")}>
              <Link to="/chat/$threadId" params={{ threadId: t.id }} className="min-w-0 flex-1 truncate px-3 py-2 text-sm">
                {t.title}
              </Link>
              <button onClick={() => removeThread(t.id)} aria-label="Eliminar conversación" className="mr-2 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <p className="truncate px-1 text-xs text-muted-foreground">{email}</p>
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={() => supabase.auth.signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Salir
          </Button>
        </div>
      </aside>

      {/* Chat */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-2">
          <div className="flex items-center gap-2 md:hidden">
            <Button size="icon" variant="ghost" onClick={newThread} aria-label="Nueva conversación"><Plus className="h-5 w-5" /></Button>
            <span className="font-display font-bold">Atento AI</span>
          </div>
          <p className="hidden truncate text-sm text-muted-foreground md:block">
            {threads.data?.find((t) => t.id === threadId)?.title ?? ""}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setPanel((p) => !p)}>
            <PanelRight className="mr-2 h-4 w-4" /> Panel
          </Button>
        </header>
        {history.isSuccess ? (
          <ChatWindow
            key={threadId}
            threadId={threadId}
            initialMessages={history.data}
            onSong={setSong}
            onWeather={setWeather}
            onDataChanged={() => {
              qc.invalidateQueries({ queryKey: ["transactions"] });
              qc.invalidateQueries({ queryKey: ["reminders"] });
              qc.invalidateQueries({ queryKey: ["threads"] });
            }}
          />
        ) : (
          <div className="flex-1" />
        )}
      </main>

      {/* Side panel */}
      <aside className={cn("w-full shrink-0 overflow-y-auto border-l bg-background p-4 lg:block lg:w-[400px]", panel ? "fixed inset-0 z-40 block lg:static" : "hidden")}>
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex rounded-lg bg-secondary p-1 text-sm" role="tablist">
            {(["panel", "historial"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("rounded-md px-3 py-1 capitalize", tab === t ? "bg-background font-medium" : "text-muted-foreground")}
              >
                {t === "panel" ? "Panel" : "Historial"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setPanel(false)}>Cerrar</Button>
        </div>
        {tab === "panel" ? (
          <FinancePanel song={null} weather={null} onCloseSong={() => {}} onCloseWeather={() => {}} />
        ) : (
          <div className="space-y-1">
            <Button onClick={() => { setPanel(false); newThread(); }} variant="secondary" className="mb-2 w-full justify-start gap-2">
              <Plus className="h-4 w-4" /> Nueva conversación
            </Button>
            {threads.data?.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay conversaciones.</p>}
            {threads.data?.map((t) => (
              <div key={t.id} className={cn("group flex items-center rounded-lg", t.id === threadId ? "bg-secondary" : "hover:bg-secondary/60")}>
                <Link to="/chat/$threadId" params={{ threadId: t.id }} onClick={() => setPanel(false)} className="min-w-0 flex-1 px-3 py-2">
                  <p className="truncate text-sm">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.updated_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </Link>
                <button onClick={() => removeThread(t.id)} aria-label="Eliminar conversación" className="mr-2 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* Floating music always mounted so it keeps playing */}
      {(song || weather) && (
        <div className="fixed bottom-48 right-4 z-30 w-80 space-y-3 lg:right-[416px]">
          {weather && <WeatherCard w={weather} onClose={() => setWeather(null)} />}
          {song && <MusicPlayer song={song} onClose={() => setSong(null)} />}
        </div>
      )}
    </div>
  );
}

function textOf(m: UIMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ")
    .replace(/```[\s\S]*?```/g, " ").replace(/[*_#>`~|]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/\s+/g, " ").trim();
}

function ChatWindow({
  threadId, initialMessages, onSong, onWeather, onDataChanged,
}: {
  threadId: string;
  initialMessages: UIMessage[];
  onSong: (s: Song | null) => void;
  onWeather: (w: Weather) => void;
  onDataChanged: () => void;
}) {
  const [input, setInput] = useState("");
  const pending = useRef<((t: string) => void) | null>(null);
  const handled = useRef(new Set<string>());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (url, init) => {
          const { data } = await supabase.auth.getSession();
          const headers = new Headers(init?.headers);
          if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
          return fetch(url, { ...init, headers });
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onFinish: ({ message }) => {
      onDataChanged();
      pending.current?.(textOf(message) || "Listo.");
      pending.current = null;
    },
    onError: (e) => {
      const m = e.message?.includes("429") ? "Demasiadas solicitudes, intenta en un momento." : e.message?.includes("402") ? "Se agotaron los créditos de IA." : "No pude responder. Intenta de nuevo.";
      toast.error(m);
      pending.current?.(m);
      pending.current = null;
    },
  });

  // Mark tool calls loaded from history as already handled.
  useEffect(() => {
    for (const m of initialMessages) for (const p of m.parts) if ("toolCallId" in p) handled.current.add(p.toolCallId as string);
  }, [initialMessages]);

  // React to new tool outputs (music, weather).
  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts) {
        if (!p.type.startsWith("tool-")) continue;
        const tp = p as ToolUIPart;
        if (tp.state !== "output-available" || handled.current.has(tp.toolCallId)) continue;
        handled.current.add(tp.toolCallId);
        const out = tp.output as { cancion?: Song; clima?: Weather; detenida?: boolean };
        if (out?.cancion) onSong(out.cancion);
        if (out?.detenida) onSong(null);
        if (out?.clima) onWeather(out.clima);
        if (tp.type === "tool-crear_recordatorio" || tp.type === "tool-registrar_transaccion") onDataChanged();
      }
    }
  }, [messages, onSong, onWeather, onDataChanged]);

  const busy = status === "submitted" || status === "streaming";

  const voice = useVoiceAssistant(
    (text) =>
      new Promise<string>((resolve) => {
        pending.current = resolve;
        void sendMessage({ text });
      }),
  );

  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy]);

  const last = messages[messages.length - 1];
  const waiting = status === "submitted" || (status === "streaming" && last?.role === "assistant" && !last.parts.some((p) => p.type === "text" && p.text));

  const statusLabel = {
    idle: "Toca el micrófono para hablar",
    listening: voice.interim ? `"${voice.interim}"` : "Escuchando… habla cuando quieras",
    processing: "Pensando…",
    speaking: "Respondiendo…",
    unsupported: "Tu navegador no soporta voz. Usa Chrome o escribe.",
  }[voice.status];

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<AudioLines className="h-10 w-10 text-primary" />}
              title="¿En qué te ayudo hoy?"
              description='Prueba: "Registra 400 mil de verduras", "¿Cómo está el clima en Barranquilla?", "Recuérdame mañana a las 8 pagar el arriendo" o pregúntame lo que quieras.'
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.parts.map((p, i) => {
                    if (p.type === "text") return m.role === "user" ? <p key={i}>{p.text}</p> : <MessageResponse key={i}>{p.text}</MessageResponse>;
                    if (p.type.startsWith("tool-")) {
                      const tp = p as ToolUIPart;
                      const name = tp.type.slice(5);
                      return (
                        <Tool key={i} defaultOpen={false}>
                          <ToolHeader type={tp.type} state={tp.state} title={TOOL_LABELS[name] ?? name} />
                          <ToolContent>
                            <ToolInput input={tp.input} />
                            <ToolOutput output={tp.output} errorText={tp.errorText} />
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {waiting && <Shimmer className="text-sm">Pensando…</Shimmer>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <p className={cn("mb-2 truncate text-center text-xs", voice.error ? "text-destructive" : "text-muted-foreground")}>
          {voice.error ?? statusLabel}
        </p>
        <PromptInput
          onSubmit={(msg) => {
            const t = msg.text?.trim();
            if (!t || busy) return;
            void sendMessage({ text: t });
            setInput("");
          }}
        >
          <PromptInputTextarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe o habla con Atento AI…" autoFocus />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton
                onClick={voice.toggle}
                disabled={voice.status === "unsupported"}
                aria-label={voice.enabled ? "Apagar micrófono" : "Encender micrófono"}
                className={cn(voice.enabled && "bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                {voice.enabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                <span>{voice.enabled ? "Escuchando" : "Voz"}</span>
              </PromptInputButton>
            </PromptInputTools>
            <PromptInputSubmit status={status} onClick={busy ? (e) => { e.preventDefault(); stop(); } : undefined} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}
