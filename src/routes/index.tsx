import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";
import { Dashboard } from "@/components/Dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atento AI — Asistente de voz para tus finanzas" },
      { name: "description", content: "Registra gastos e ingresos con tu voz y mira tus finanzas organizadas al instante." },
      { property: "og:title", content: "Atento AI — Asistente de voz para tus finanzas" },
      { property: "og:description", content: "Registra gastos e ingresos con tu voz y mira tus finanzas organizadas al instante." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="min-h-screen" />;
  if (!session) return <AuthScreen />;
  return <Dashboard email={session.user.email ?? ""} />;
}
