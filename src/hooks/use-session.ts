import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useSession() {
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
  return { session, ready };
}

export async function createThread() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Sin sesión");
  const { data, error } = await supabase.from("chat_threads").insert({ user_id: u.user.id }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
