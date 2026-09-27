import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY = "BG5Uj3d4kok4J2PIIwDx7-u4prwJ0_sPQHlmXGoTtV4jigsRhd-XBdmFxh16KS9iMiGvPeaUM-FFtWHPD_BRggA";

function toBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("Este navegador no admite notificaciones. En iPhone, agrega Atento a la pantalla de inicio primero.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Debes permitir las notificaciones.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Inicia sesión primero.");
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: u.user.id, endpoint: sub.endpoint, p256dh: j.keys!["p256dh"]!, auth: j.keys!["auth"]! },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error("No se pudo guardar el dispositivo.");
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}
