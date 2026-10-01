import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";
import { useSession, createThread } from "@/hooks/use-session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atento AI — Tu asistente conversacional por voz" },
      { name: "description", content: "Conversa por voz con Atento AI: pregunta lo que quieras, registra gastos, crea recordatorios, consulta el clima y pon música." },
      { property: "og:title", content: "Atento AI — Tu asistente conversacional por voz" },
      { property: "og:description", content: "Conversa por voz con Atento AI: pregunta lo que quieras y gestiona tus finanzas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, ready } = useSession();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;
    (async () => {
      const { data } = await supabase.from("chat_threads").select("id").order("updated_at", { ascending: false }).limit(1);
      const id = data?.[0]?.id ?? (await createThread());
      navigate({ to: "/chat/$threadId", params: { threadId: id }, replace: true });
    })();
  }, [session, navigate]);

  if (!ready) return <div className="min-h-screen" />;
  if (!session) return <AuthScreen />;
  return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Abriendo tu conversación…</div>;
}
