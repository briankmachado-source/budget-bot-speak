import { createFileRoute } from "@tanstack/react-router";
import { VAPID_PUBLIC_KEY } from "@/lib/push";

export const Route = createFileRoute("/api/public/reminder-push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env["REMINDER_CRON_TOKEN"];
        const auth = request.headers.get("authorization") ?? "";
        if (!token || auth !== `Bearer ${token}`) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildPushPayload } = await import("@block65/webcrypto-web-push");

        // Claim due reminders atomically so parallel calls don't double-send.
        const { data: due, error } = await supabaseAdmin
          .from("reminders")
          .update({ pushed: true })
          .eq("pushed", false)
          .eq("done", false)
          .lte("remind_at", new Date().toISOString())
          .select("id, user_id, title")
          .limit(100);
        if (error) {
          console.error(error);
          return new Response("error", { status: 500 });
        }
        if (!due?.length) return Response.json({ sent: 0 });

        const userIds = [...new Set(due.map((r) => r.user_id))];
        const { data: subs = [] } = await supabaseAdmin
          .from("push_subscriptions")
          .select("id, user_id, endpoint, p256dh, auth")
          .in("user_id", userIds);

        const vapid = {
          subject: "mailto:avisos@atento.app",
          publicKey: VAPID_PUBLIC_KEY,
          privateKey: process.env["VAPID_PRIVATE_KEY"]!,
        };
        const origin = new URL(request.url).origin;
        let sent = 0;
        for (const r of due) {
          for (const s of (subs ?? []).filter((x) => x.user_id === r.user_id)) {
            try {
              const payload = await buildPushPayload(
                {
                  data: JSON.stringify({ title: "⏰ Atento", body: r.title, url: `${origin}/?reminder=${r.id}`, tag: r.id }),
                  options: { ttl: 3600, urgency: "high" },
                },
                { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
                vapid,
              );
              const res = await fetch(s.endpoint, payload);
              if (res.status === 404 || res.status === 410) {
                await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
              } else if (res.ok) sent++;
            } catch (e) {
              console.error("push failed", e);
            }
          }
        }
        return Response.json({ sent });
      },
    },
  },
});
