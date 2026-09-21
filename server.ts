import { Hono } from "hono";

const app = new Hono();
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const REALTIME_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

// ---------- GIPHY ----------
// Tiny in-memory LRU-ish cache so rapid repeat queries don't burn quota.
const giphyCache = new Map<string, { at: number; data: unknown }>();
const GIPHY_TTL_MS = 1000 * 60 * 10;

app.get("/api/giphy", async (c) => {
  const q = c.req.query("q")?.trim();
  const limit = c.req.query("limit") ?? "9";
  if (!q) return c.json({ error: "missing q" }, 400);

  const key = process.env.GIPHY_API_KEY;
  if (!key) return c.json({ error: "GIPHY_API_KEY not set" }, 500);

  const cacheKey = `${q}:${limit}`;
  const cached = giphyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GIPHY_TTL_MS) {
    console.log(`[giphy] CACHE HIT  "${q}"`);
    return c.json({ cached: true, ...(cached.data as object) });
  }
  console.log(`[giphy] MISS       "${q}" → upstream`);

  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.searchParams.set("api_key", key);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", limit);
  url.searchParams.set("rating", "pg-13");

  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    console.log(`[giphy] UPSTREAM ERR "${q}" → ${r.status} ${body.slice(0, 120)}`);
    return c.json({ error: "upstream", status: r.status, body }, 500);
  }
  const json = (await r.json()) as { data: any[]; meta: unknown; pagination: unknown };
  console.log(`[giphy] OK         "${q}" → ${json.data?.length ?? 0} items`);

  const normalized = {
    query: q,
    items: json.data.map((g) => ({
      id: g.id,
      title: g.title,
      url: g.url,
      mp4: g.images?.original?.mp4,
      webp: g.images?.original?.webp,
      gif: g.images?.original?.url,
      preview_mp4: g.images?.preview?.mp4 ?? g.images?.fixed_height_small?.mp4,
      width: Number(g.images?.original?.width ?? 0),
      height: Number(g.images?.original?.height ?? 0),
    })),
  };
  giphyCache.set(cacheKey, { at: Date.now(), data: normalized });
  return c.json({ cached: false, ...normalized });
});

// ---------- BRAVE IMAGE SEARCH ----------
// Brave Free plan allows 1 req/s. We serialize calls to upstream with ~1.2s
// spacing so rapid-fire agent calls don't pile up into 429s. Cache hits skip
// the queue entirely.
const braveCache = new Map<string, { at: number; data: unknown }>();
const BRAVE_TTL_MS = 1000 * 60 * 10;
const BRAVE_SPACING_MS = 1200;
let braveChain: Promise<void> = Promise.resolve();
let braveLastAt = 0;

function queueBraveSlot(): Promise<void> {
  const prev = braveChain;
  braveChain = prev.then(async () => {
    const wait = Math.max(0, braveLastAt + BRAVE_SPACING_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    braveLastAt = Date.now();
  });
  return braveChain;
}

app.get("/api/brave/images", async (c) => {
  const q = c.req.query("q")?.trim();
  const count = c.req.query("count") ?? "20";
  if (!q) return c.json({ error: "missing q" }, 400);

  const key = process.env.BRAVE_API_KEY;
  if (!key) return c.json({ error: "BRAVE_API_KEY not set" }, 500);

  const cacheKey = `${q}:${count}`;
  const cached = braveCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BRAVE_TTL_MS) {
    console.log(`[brave] CACHE HIT  "${q}"`);
    return c.json({ cached: true, ...(cached.data as object) });
  }
  console.log(`[brave] MISS       "${q}" → upstream (queued)`);

  const url = new URL("https://api.search.brave.com/res/v1/images/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", count);
  url.searchParams.set("safesearch", "strict");
  const headers = {
    Accept: "application/json",
    "X-Subscription-Token": key,
  };

  await queueBraveSlot();
  let r = await fetch(url, { headers });
  if (r.status === 429) {
    console.log(`[brave] 429        "${q}" → retrying after spacing`);
    await new Promise((res) => setTimeout(res, BRAVE_SPACING_MS));
    braveLastAt = Date.now();
    r = await fetch(url, { headers });
  }
  if (!r.ok) {
    const body = await r.text();
    console.log(`[brave] UPSTREAM ERR "${q}" → ${r.status} ${body.slice(0, 120)}`);
    return c.json({ error: "upstream", status: r.status, body }, 500);
  }
  const json = (await r.json()) as { results?: any[] };
  console.log(`[brave] OK         "${q}" → ${json.results?.length ?? 0} items`);

  const normalized = {
    query: q,
    items: (json.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      source: r.source,
      page: r.properties?.url ?? r.url,
      image: r.properties?.url,
      thumbnail: r.thumbnail?.src,
      width: r.properties?.width ?? 0,
      height: r.properties?.height ?? 0,
    })),
  };
  braveCache.set(cacheKey, { at: Date.now(), data: normalized });
  return c.json({ cached: false, ...normalized });
});

// ---------- UNSPLASH IMAGE SEARCH ----------
// Higher-quality stock photography than Brave. Landscape-only results
// suited for full-screen slide backgrounds. Free tier: 50 req/h demo,
// 5000 req/h production.
const unsplashCache = new Map<string, { at: number; data: unknown }>();
const UNSPLASH_TTL_MS = 1000 * 60 * 30;

app.get("/api/unsplash", async (c) => {
  const q = c.req.query("q")?.trim();
  const count = c.req.query("count") ?? "10";
  if (!q) return c.json({ error: "missing q" }, 400);

  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return c.json({ error: "UNSPLASH_ACCESS_KEY not set" }, 500);

  const cacheKey = `${q}:${count}`;
  const cached = unsplashCache.get(cacheKey);
  if (cached && Date.now() - cached.at < UNSPLASH_TTL_MS) {
    console.log(`[unsplash] CACHE HIT  "${q}"`);
    return c.json({ cached: true, ...(cached.data as object) });
  }
  console.log(`[unsplash] MISS       "${q}" → upstream`);

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", count);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");

  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Version": "v1",
      Authorization: `Client-ID ${key}`,
    },
  });
  if (!r.ok) {
    const body = await r.text();
    console.log(`[unsplash] UPSTREAM ERR "${q}" → ${r.status} ${body.slice(0, 120)}`);
    return c.json({ error: "upstream", status: r.status, body }, 500);
  }
  const json = (await r.json()) as { results?: any[] };
  console.log(`[unsplash] OK         "${q}" → ${json.results?.length ?? 0} items`);

  const normalized = {
    query: q,
    items: (json.results ?? []).map((p) => ({
      title: p.alt_description ?? p.description ?? "",
      source: `Unsplash / ${p.user?.name ?? ""}`,
      page: p.links?.html,
      image: p.urls?.regular,
      thumbnail: p.urls?.small,
      width: p.width ?? 0,
      height: p.height ?? 0,
      color: p.color,
    })),
  };
  unsplashCache.set(cacheKey, { at: Date.now(), data: normalized });
  return c.json({ cached: false, ...normalized });
});

app.post("/api/token", async (c) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return c.json({ error: "OPENAI_API_KEY not set" }, 500);

  const model = process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL;
  const reasoningEffort = process.env.OPENAI_REALTIME_REASONING_EFFORT?.trim();
  if (reasoningEffort && !REALTIME_REASONING_EFFORTS.has(reasoningEffort)) {
    return c.json(
      {
        error: "invalid OPENAI_REALTIME_REASONING_EFFORT",
        allowed: [...REALTIME_REASONING_EFFORTS],
      },
      500,
    );
  }

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model,
        ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      },
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    return c.json({ error: "upstream", status: r.status, body: text }, 500);
  }
  return c.json({ ...(await r.json()), model });
});

export default { port: 8787, fetch: app.fetch };
