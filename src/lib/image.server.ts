const BASE = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-image-2.5-sunburst";

async function toBlob(src: string): Promise<Blob> {
  const m = src.match(/^data:([^;]+);base64,(.*)$/);
  if (m) {
    const bin = atob(m[2]!);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  }
  const r = await fetch(src);
  if (!r.ok) throw new Error("No pude leer la imagen");
  return await r.blob();
}

// Reads an image SSE stream (or JSON) and returns the final base64 image.
async function readImage(res: Response): Promise<string> {
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Demasiadas solicitudes de imagen, intenta en un momento.");
    if (res.status === 402) throw new Error("Se agotaron los créditos de IA.");
    throw new Error(`Error de imagen (${res.status}) ${t.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("event-stream")) {
    const j = (await res.json()) as { data?: { b64_json?: string }[] };
    const b = j.data?.[0]?.b64_json;
    if (!b) throw new Error("No se generó imagen");
    return b;
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", last: string | undefined, final: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      try {
        const ev = JSON.parse(data) as { type?: string; b64_json?: string; error?: { message?: string } };
        if (ev.error || ev.type?.endsWith("error")) throw new Error(ev.error?.message ?? "Error al generar la imagen");
        if (ev.b64_json) { last = ev.b64_json; if (ev.type?.endsWith("completed")) final = ev.b64_json; }
      } catch (e) { if (e instanceof Error && !(e instanceof SyntaxError)) throw e; }
    }
  }
  const out = final ?? last;
  if (!out) throw new Error("No se generó imagen");
  return out;
}

export async function transformImage(prompt: string, source?: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Falta la configuración de IA.");
  let res: Response;
  if (source) {
    const form = new FormData();
    const blob = await toBlob(source);
    form.append("image", new File([blob], "input.png", { type: blob.type || "image/png" }));
    form.append("prompt", prompt);
    form.append("model", MODEL);
    form.append("stream", "true");
    form.append("partial_images", "1");
    res = await fetch(`${BASE}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  } else {
    res = await fetch(`${BASE}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, stream: true, partial_images: 1 }),
    });
  }
  return readImage(res);
}

export async function saveImage(userId: string, b64: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const path = `${userId}/${crypto.randomUUID()}.png`;
  const { error } = await supabaseAdmin.storage.from("ai-images").upload(path, bytes, { contentType: "image/png" });
  if (error) throw new Error("No se pudo guardar la imagen");
  const { data, error: e2 } = await supabaseAdmin.storage.from("ai-images").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (e2 || !data) throw new Error("No se pudo guardar la imagen");
  return data.signedUrl;
}
