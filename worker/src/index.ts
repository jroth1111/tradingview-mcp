import { Hono } from "hono";
import {
  getCandles,
  getQuotes,
  getTechnicalAnalysis,
  searchSymbols,
  searchIndicators,
  getIndicatorMeta,
  getPrivateIndicators,
  getUserProfile,
  runStudy,
  backfillCandles,
  createReplay,
  fetchNews,
  fetchFundamentals,
  runScan,
  getMovers,
  fetchIdeas,
  fetchMinds,
  fetchNewsContent,
  getAuthToken,
  getTaSummary,
  resolveSymbol,
  getMarketOverview,
  getSectorMovers,
  getStreamBootstrap,
  loginUser,
  getIndustryMovers,
  getDividendCalendar,
  getEarningsCalendar,
  listMarkets,
  listFundamentalFields,
  listNewsMeta,
  listTimeframes,
  type CandleRequest,
  type QuoteRequest,
  type TARequest,
  type SearchRequest,
  type IndicatorSearchRequest,
} from "./tradingview";
import { getCachedCandles, getMeta, restoreMeta, snapshotMeta, type MetaRecord } from "./cache";
import { FetchCoordinator } from "./fetch-coordinator";
import { runSelfTests } from "./selftest";
import { runIntegration } from "./tests/integration";
import { pruneCache } from "./prune";
import {
  clearAuthBlock,
  getStoredSession,
  isBlocked,
  markAuthFailure,
  setStoredSession,
  type StoredSession,
} from "./auth-store";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", (c) => c.json({ ok: true }));

const isAuthError = (err: any) => {
  const msg = (err?.message || "").toLowerCase();
  return (
    msg.includes("sessionid") ||
    msg.includes("expired") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden")
  );
};

const textEncoder = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

let cachedHmacKey: CryptoKey | null = null;
let cachedSecret: string | null = null;

const getHmacKey = async (secret: string) => {
  if (cachedHmacKey && cachedSecret === secret) return cachedHmacKey;
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedHmacKey = key;
  cachedSecret = secret;
  return key;
};

const verifyHmacAuth = async (c: any): Promise<Response | null> => {
  const secret = c.env.HMAC_SECRET as string | undefined;
  const clientIdEnv = c.env.HMAC_CLIENT_ID as string | undefined;
  if (!secret || !clientIdEnv) return c.json({ error: "Auth not configured" }, 500);

  const auth = c.req.header("authorization") || "";
  const [scheme, token] = auth.split(" ");
  if (!scheme || scheme.toLowerCase() !== "hmac" || !token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const [clientId, signature] = token.split(":");
  if (!clientId || !signature || clientId !== clientIdEnv) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const timestamp = c.req.header("x-timestamp");
  if (!timestamp) return c.json({ error: "Missing timestamp" }, 401);

  const now = Date.now();
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return c.json({ error: "Invalid timestamp" }, 401);
  const skewMs = Math.abs(now - tsNum);
  if (skewMs > 5 * 60 * 1000) {
    return c.json({ error: "Timestamp skew too large" }, 401);
  }

  const url = new URL(c.req.url);
  const method = c.req.method.toUpperCase();
  const bodyBuf = await c.req.raw.clone().arrayBuffer();
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", bodyBuf));

  const canonical = [method, url.pathname + url.search, bodyHash, timestamp].join("\n");
  const key = await getHmacKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, textEncoder.encode(canonical));
  const expectedHex = hex(expected);

  if (expectedHex !== signature) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
};

const requireAdminAuth = async (c: any): Promise<Response | null> => {
  const hasHmac = !!c.env.HMAC_SECRET && !!c.env.HMAC_CLIENT_ID;
  if (!hasHmac) return c.json({ error: "Admin HMAC not configured" }, 500);
  return await verifyHmacAuth(c);
};

app.get("/admin/session/status", async (c) => {
  const authResp = await requireAdminAuth(c);
  if (authResp) return authResp;
  const stored = await getStoredSession(c.env.CACHE_META);
  if (!stored) return c.json({ ok: false, reason: "not set" });
  if (isBlocked(stored)) return c.json({ ok: false, reason: "blocked", stored });
  try {
    const token = await getAuthToken(stored.sessionId, stored.sessionSign);
    if (token === "unauthorized_user_token") throw new Error("Wrong or expired sessionid/sessionid_sign");
    return c.json({ ok: true, stored });
  } catch (err: any) {
    await markAuthFailure(c.env.CACHE_META);
    return c.json({ ok: false, reason: err?.message || "auth failure", stored });
  }
});

app.post("/admin/session", async (c) => {
  const authResp = await requireAdminAuth(c);
  if (authResp) return authResp;
  const body = (await c.req.json()) as { sessionId?: string; sessionSign?: string };
  if (!body?.sessionId) return c.json({ error: "sessionId required" }, 400);
  const stored = await setStoredSession(c.env.CACHE_META, body.sessionId, body.sessionSign);
  return c.json({ ok: true, stored });
});

app.post("/admin/session/unblock", async (c) => {
  const authResp = await requireAdminAuth(c);
  if (authResp) return authResp;
  const stored = await clearAuthBlock(c.env.CACHE_META);
  return c.json({ ok: true, stored });
});

const resolveSession = async (
  kv: KVNamespace,
  provided?: { sessionId?: string; sessionSign?: string },
): Promise<{ sessionId?: string; sessionSign?: string; source: "provided" | "stored" | "none" }> => {
  const stored = await getStoredSession(kv);
  if (stored && !isBlocked(stored)) {
    return { sessionId: stored.sessionId, sessionSign: stored.sessionSign, source: "stored" };
  }
  if (provided?.sessionId) return { ...provided, source: "provided" };
  return { source: "none", sessionId: undefined, sessionSign: undefined };
};

app.post("/v1/candles", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbols: string[];
      timeframe?: CandleRequest["timeframe"];
      amount?: number;
      endpoint?: CandleRequest["endpoint"];
      sessionId?: string;
    };

    if (!body?.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return c.json({ error: "symbols array required" }, 400);
    }

    const results = await Promise.all(
      body.symbols.map(async (symbol) => {
        try {
          const session = await resolveSession(c.env.CACHE_META, {
            sessionId: body.sessionId,
          });
          const candles = await getCandles({
            symbol,
            amount: body.amount,
            timeframe: body.timeframe,
            endpoint: body.endpoint,
            sessionId: session.sessionId,
          });
          return { symbol, candles, authSource: session.source };
        } catch (err: any) {
          return { symbol, error: err?.message ?? "unknown error" };
        }
      }),
    );

    return c.json({ results });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

// Cache-backed candles (R2 + KV)
app.get("/cache/:symbol/:tf", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const symbol = c.req.param("symbol");
  const tf = c.req.param("tf");
  const url = new URL(c.req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const total = url.searchParams.get("total");
  const providedSessionId = url.searchParams.get("sessionId") || undefined;
  const endpoint = url.searchParams.get("endpoint") || undefined;
  const maxBytes = url.searchParams.get("maxBytes");
  const maxTotal = url.searchParams.get("maxTotalBytes") || c.env.CACHE_MAX_TOTAL_BYTES;
  const maxFetches = url.searchParams.get("maxFetchesPerMinute") || c.env.CACHE_MAX_FETCHES_PER_MINUTE;

  try {
    const session = await resolveSession(c.env.CACHE_META, { sessionId: providedSessionId });
    const coordinatorId = c.env.FETCH_COORDINATOR.idFromName(`${symbol}:${tf}`);
    const coordinator = c.env.FETCH_COORDINATOR.get(coordinatorId);
    const cacheResp = await coordinator.fetch(new Request("https://cache.local/fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol,
        timeframe: tf,
        from: from ? Number(from) : undefined,
        to: to ? Number(to) : undefined,
        total: total ? Number(total) : undefined,
        sessionId: session.sessionId,
        endpoint,
        maxApproxBytes: maxBytes ? Number(maxBytes) : undefined,
        maxTotalBytes: maxTotal ? Number(maxTotal) : undefined,
        maxFetchesPerMinute: maxFetches ? Number(maxFetches) : undefined,
      }),
    }));
    const result = (await cacheResp.json()) as any;
    return c.json({
      candles: result.candles,
      meta: result.meta,
      partial: result.partial,
      authSource: session.source,
    });
  } catch (err: any) {
    if (providedSessionId === undefined && isAuthError(err)) {
      await markAuthFailure(c.env.CACHE_META);
    }
    return c.json({ error: err?.message ?? "cache error" }, 500);
  }
});

app.get("/cache/:symbol/:tf/status", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const symbol = c.req.param("symbol");
  const tf = c.req.param("tf");
  try {
    const meta = await getMeta(c.env.CACHE_META, symbol, tf);
    return c.json({ meta });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "status error" }, 500);
  }
});

app.post("/cache/:symbol/:tf/invalidate", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const symbol = c.req.param("symbol");
  const tf = c.req.param("tf");
  try {
    const meta = await c.env.CACHE_META.get<MetaRecord>(`meta:${symbol}:${tf}`, { type: "json" });
    // Delete meta
    await c.env.CACHE_META.delete(`meta:${symbol}:${tf}`);
    await c.env.CACHE_META.delete(`hot:${symbol}:${tf}`);
    // Best-effort: delete chunk objects with prefix
    const prefix = `candles/${symbol}/${tf}/`;
    const listed = await c.env.CACHE_DATA.list({ prefix });
    for (const obj of listed.objects || []) {
      if (obj?.key) {
        await c.env.CACHE_DATA.delete(obj.key);
      }
    }
    // adjust totals
    if (meta?.approx_bytes) {
      const totals = (await c.env.CACHE_META.get<{ approx_bytes?: number }>("_cache:totals", {
        type: "json",
      })) || { approx_bytes: 0 };
      const next = Math.max(0, (totals.approx_bytes || 0) - meta.approx_bytes);
      await c.env.CACHE_META.put("_cache:totals", JSON.stringify({ approx_bytes: next }));
    }
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "invalidate error" }, 500);
  }
});

app.post("/cache/snapshot", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const key = await snapshotMeta(c.env.CACHE_META, c.env.CACHE_DATA);
    return c.json({ ok: true, key });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "snapshot error" }, 500);
  }
});

app.post("/cache/restore", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const body = (await c.req.json()) as { key: string };
    if (!body?.key) return c.json({ error: "key required" }, 400);
    const res = await restoreMeta(c.env.CACHE_META, c.env.CACHE_DATA, body.key);
    return c.json({ ok: true, ...res });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "restore error" }, 500);
  }
});

app.get("/cache/selftest", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const results = runSelfTests();
  const ok = results.every((r) => r.ok);
  return c.json({ ok, results });
});

app.get("/cache/integration-test", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const result = await runIntegration();
  return c.json(result);
});

app.post("/v1/quotes", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as QuoteRequest;
    if (!body?.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return c.json({ error: "symbols array required" }, 400);
    }
    const result = await getQuotes(body);
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.get("/", (c) =>
  c.json({
    service: "cloudflare-tw-data",
    endpoints: [
      "/health",
      "/v1/candles",
      "/v1/quotes",
      "/v1/ta",
      "/v1/search",
      "/v1/indicators/search",
      "/v1/indicators/meta",
      "/v1/indicators/private",
      "/v1/study",
      "/v1/backfill",
      "/v1/replay",
      "/v1/news",
      "/v1/fundamentals",
      "/v1/scan",
      "/v1/auth-token",
      "/v1/movers",
      "/v1/ideas",
      "/v1/minds",
      "/v1/resolve",
      "/v1/ta/summary",
      "/v1/markets/overview",
      "/v1/markets/sector-movers",
      "/v1/markets/industry-movers",
      "/v1/login",
      "/v1/calendar/dividends",
      "/v1/calendar/earnings",
      "/v1/stream/bootstrap",
      "/v1/meta/markets",
      "/v1/meta/news",
      "/v1/meta/fundamentals",
      "/v1/meta/timeframes",
      "/v1/me",
    ],
    note:
      "Provide sessionId from your TradingView browser session and use endpoint=prodata for premium feeds.",
  }),
);

app.post("/v1/ta", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as TARequest;
    if (!body?.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return c.json({ error: "symbols array required" }, 400);
    }
    const result = await getTechnicalAnalysis(body);
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/indicators/private", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { sessionId?: string; sessionSign?: string };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body?.sessionId,
      sessionSign: body?.sessionSign,
    });
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 400);
    const result = await getPrivateIndicators({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/replay", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      timeframe?: string | number;
      startTime?: number;
      endpoint?: string;
      sessionId?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const state = await createReplay({
      symbol: body.symbol,
      timeframe: body.timeframe,
      startTime: body.startTime,
      endpoint: body.endpoint as any,
      sessionId: (await resolveSession(c.env.CACHE_META, { sessionId: body.sessionId })).sessionId,
    });
    return c.json({ state });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/news", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      provider?: string;
      area?: string;
      section?: string;
      language?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const items = await fetchNews(body);
    return c.json({ symbol: body.symbol, items });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/news/content", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { url: string };
    if (!body?.url) return c.json({ error: "url required" }, 400);
    const content = await fetchNewsContent(body);
    return c.json({ content });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/fundamentals", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      fields?: string[];
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const result = await fetchFundamentals(body);
    return c.json(result.status === "success" ? { data: result.data } : { error: result.error });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/scan", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      market?: string;
      symbols?: string[];
      filter?: any[];
      columns?: string[];
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    };
    const result = await runScan(body);
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/auth-token", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { sessionId?: string };
    const session = await resolveSession(c.env.CACHE_META, { sessionId: body.sessionId });
    const token = await getAuthToken(session.sessionId);
    return c.json({ token, authSource: session.source });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/movers", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      market?: string;
      type?: "gainers" | "losers" | "volume";
      limit?: number;
    };
    const movers = await getMovers(body);
    return c.json({ movers });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/ideas", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { symbol: string; limit?: number };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const ideas = await fetchIdeas(body);
    return c.json({ ideas });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/me", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { sessionId?: string; sessionSign?: string };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body?.sessionId,
      sessionSign: body?.sessionSign,
    });
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 400);
    const profile = await getUserProfile({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    return c.json({ profile, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/minds", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      sort?: "recent" | "popular" | "trending";
      limit?: number;
      cursor?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const result = await fetchMinds(body);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/ta/summary", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { symbol: string; timeframe?: string };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const summary = await getTaSummary(body.symbol, body.timeframe || "1D");
    return c.json({ symbol: body.symbol, timeframe: body.timeframe || "1D", summary });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/resolve", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      endpoint?: string;
      sessionId?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, { sessionId: body.sessionId });
    const meta = await resolveSymbol({
      symbol: body.symbol,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
    });
    return c.json({ meta, authSource: session.source });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/markets/overview", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      market?: string;
      sort?: "market_cap" | "volume" | "change" | "price" | "volatility";
      limit?: number;
    };
    const overview = await getMarketOverview(body);
    return c.json({ overview });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/markets/sector-movers", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      market?: string;
      sector: string;
      type?: "gainers" | "losers" | "volume";
      limit?: number;
    };
    if (!body?.sector) return c.json({ error: "sector required" }, 400);
    const movers = await getSectorMovers(body);
    return c.json({ movers });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/markets/industry-movers", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      market?: string;
      industry: string;
      type?: "gainers" | "losers" | "volume";
      limit?: number;
    };
    if (!body?.industry) return c.json({ error: "industry required" }, 400);
    const movers = await getIndustryMovers(body);
    return c.json({ movers });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/login", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      username: string;
      password: string;
      remember?: boolean;
      userAgent?: string;
    };
    if (!body?.username || !body?.password) {
      return c.json({ error: "username and password required" }, 400);
    }
    const result = await loginUser(body);
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/calendar/dividends", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      timestampFrom?: number;
      timestampTo?: number;
      markets?: string[];
      fields?: string[];
    };
    const events = await getDividendCalendar(body);
    return c.json({ events });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/calendar/earnings", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      timestampFrom?: number;
      timestampTo?: number;
      markets?: string[];
      fields?: string[];
    };
    const events = await getEarningsCalendar(body);
    return c.json({ events });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.get("/v1/meta/markets", (c) => c.json({ markets: listMarkets() }));
app.get("/v1/meta/news", (c) => c.json(listNewsMeta()));
app.get("/v1/meta/fundamentals", (c) => c.json(listFundamentalFields()));
app.get("/v1/meta/timeframes", (c) => c.json({ timeframes: listTimeframes() }));

app.post("/v1/stream/bootstrap", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      sessionId?: string;
      endpoint?: string;
      symbol?: string;
      timeframe?: string | number;
      fields?: string[];
    };
    const bootstrap = await getStreamBootstrap({
      sessionId: (await resolveSession(c.env.CACHE_META, { sessionId: body.sessionId })).sessionId,
      endpoint: body.endpoint as any,
      symbol: body.symbol,
      timeframe: body.timeframe,
      fields: body.fields,
    });
    return c.json({ bootstrap });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/search", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as SearchRequest;
    if (!body?.query) return c.json({ error: "query required" }, 400);
    const result = await searchSymbols(body);
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/study", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      studyId: string;
      script?: string;
      inputs?: Record<string, any>;
      endpoint?: string;
      sessionId?: string;
    };
    if (!body?.symbol || !body?.studyId) {
      return c.json({ error: "symbol and studyId required" }, 400);
    }
    const result = await runStudy({
      symbol: body.symbol,
      studyId: body.studyId,
      script: body.script,
      inputs: body.inputs,
      endpoint: body.endpoint as any,
      sessionId: (await resolveSession(c.env.CACHE_META, { sessionId: body.sessionId })).sessionId,
    });
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/backfill", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      timeframe?: string | number;
      total?: number;
      endpoint?: string;
      sessionId?: string;
      delayMs?: number;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const candles = await backfillCandles({
      symbol: body.symbol,
      timeframe: body.timeframe,
      total: body.total,
      endpoint: body.endpoint as any,
      sessionId: (await resolveSession(c.env.CACHE_META, { sessionId: body.sessionId })).sessionId,
      delayMs: body.delayMs,
    });
    return c.json({ symbol: body.symbol, candles });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/indicators/search", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as IndicatorSearchRequest;
    if (!body?.query) return c.json({ error: "query required" }, 400);
    const result = await searchIndicators(body);
    return c.json({ result });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

app.post("/v1/indicators/meta", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string;
      version?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getIndicatorMeta({
      ...body,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    return c.json({ error: err?.message ?? "bad request" }, 400);
  }
});

export default app;
export { FetchCoordinator };

// Scheduled snapshot (cron)
export const scheduled: ExportedHandlerScheduledHandler<CloudflareBindings> = async (
  _event,
  env,
  ctx,
) => {
  ctx.waitUntil(
    (async () => {
      try {
        const key = await snapshotMeta(env.CACHE_META, env.CACHE_DATA);
        console.log(`[cron] snapshot written: ${key}`);
      } catch (err: any) {
        console.log("[cron] snapshot failed", err?.message || err);
      }
      try {
        const pruned = await pruneCache(env.CACHE_META, env.CACHE_DATA, Number(env.CACHE_MAX_TOTAL_BYTES || 0));
        console.log(`[cron] prune result`, pruned);
      } catch (err: any) {
        console.log("[cron] prune failed", err?.message || err);
      }
    })(),
  );
};
