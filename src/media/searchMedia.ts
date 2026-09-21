// Thin client wrapper over /api/giphy and /api/brave/images. Returns the
// first usable result for a query. Tiny in-memory LRU so the agent can
// call set_background({query:"tokyo"}) twice in a row without thrash.

export interface ResolvedMedia {
  kind: "image" | "video";
  url: string;
}

const cache = new Map<string, ResolvedMedia>();
const MAX = 32;

function cacheKey(type: "gif" | "image", query: string) {
  return `${type}:${query.trim().toLowerCase()}`;
}

function remember(key: string, value: ResolvedMedia) {
  if (cache.size >= MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, value);
}

export async function searchMedia({
  type,
  query,
}: {
  type: "gif" | "image";
  query: string;
}): Promise<ResolvedMedia | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const key = cacheKey(type, trimmed);
  const hit = cache.get(key);
  if (hit) {
    console.log(`[media] client-cache HIT  ${type} "${trimmed}" → ${hit.url.slice(0, 80)}`);
    return hit;
  }

  try {
    if (type === "gif") {
      const r = await fetch(`/api/giphy?q=${encodeURIComponent(trimmed)}&limit=5`);
      if (!r.ok) {
        console.log(`[media] gif FAIL "${trimmed}" → ${r.status}`);
        return null;
      }
      const j = await r.json();
      const first = (j.items ?? []).find((i: { mp4?: string }) => !!i.mp4) as
        | { mp4?: string }
        | undefined;
      if (!first?.mp4) {
        console.log(`[media] gif NO-MP4 "${trimmed}" (${j.items?.length ?? 0} items)`);
        return null;
      }
      const resolved: ResolvedMedia = { kind: "video", url: first.mp4 };
      console.log(`[media] gif OK    "${trimmed}" → ${resolved.url.slice(0, 80)}`);
      remember(key, resolved);
      return resolved;
    }

    const r = await fetch(`/api/unsplash?q=${encodeURIComponent(trimmed)}&count=10`);
    if (!r.ok) {
      console.log(`[media] img FAIL "${trimmed}" → ${r.status}`);
      return null;
    }
    const j = await r.json();
    const first = (j.items ?? []).find((i: { image?: string }) => !!i.image) as
      | { image?: string }
      | undefined;
    if (!first?.image) {
      console.log(`[media] img NO-URL "${trimmed}" (${j.items?.length ?? 0} items)`);
      return null;
    }
    const resolved: ResolvedMedia = { kind: "image", url: first.image };
    console.log(`[media] img OK    "${trimmed}" → ${resolved.url.slice(0, 80)}`);
    remember(key, resolved);
    return resolved;
  } catch (e) {
    console.log(`[media] exception ${type} "${trimmed}"`, e);
    return null;
  }
}
