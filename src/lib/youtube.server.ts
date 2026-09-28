export type Song = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
};

export async function searchSong(query: string): Promise<Song | null> {
  const key = process.env['YOUTUBE_API_KEY'];
  if (!key) throw new Error("Falta la clave de YouTube.");
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true` +
    `&videoCategoryId=10&maxResults=5&q=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: { title?: string; channelTitle?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
    }>;
  };
  const item = (json.items ?? []).find((i) => i.id?.videoId);
  if (!item?.id?.videoId) return null;
  const s = item.snippet ?? {};
  const decode = (t: string) =>
    t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return {
    videoId: item.id.videoId,
    title: decode(s.title ?? "Canción"),
    channel: decode(s.channelTitle ?? ""),
    thumbnail: s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? "",
  };
}
