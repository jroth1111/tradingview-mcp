import { Hono } from "hono";
import {
  getCandles,
  getQuotes,
  getTechnicalAnalysis,
  searchSymbols,
  searchIndicators,
  getIndicatorMeta,
  getTypedIndicatorInputs,
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
import {
  getBuiltinCatalog,
  getPubLibrary,
  getPubEditorsPicks,
  getPubBatch,
  getPubSuggest,
  getPubPersonalAccess,
  getScriptPackagesStore,
} from "./pubscripts";
import {
  isAlertsAlive,
  listAlerts,
  getAlertsBatch,
  createAlert,
  modifyRestartAlert,
  deleteAlerts,
  stopAlerts,
  restartAlerts,
  cloneAlerts,
  listFires,
  deleteFires,
  deleteAllFires,
  deleteFiresByFilter,
  getOfflineFires,
  getOfflineFireControls,
  clearOfflineFires,
  clearOfflineFireControls,
  generatePineAlert,
} from "./alerts";
import {
  listStudyTemplates,
  getStudyTemplate,
  createStudyTemplate,
  updateStudyTemplate,
  renameStudyTemplate,
  deleteStudyTemplate,
  setStudyTemplateFavorite,
  listDrawingTemplates,
  getDrawingTemplate,
  saveDrawingTemplate,
  deleteDrawingTemplate,
  saveSettings,
  loadSettings,
} from "./templates";
import {
  getCachedCandles,
  getMeta,
  listAllR2Objects,
  restoreMeta,
  snapshotMeta,
  type MetaRecord,
} from "./cache";
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
import { classifyUpstreamError } from "./upstream-error";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", (c) => c.json({ ok: true }));

const isAuthError = (err: any) => classifyUpstreamError(err).category === "auth";

const errorPayload = (err: unknown, fallback: string) => {
  const classified = classifyUpstreamError(err, fallback);
  return {
    body: {
      error: classified.message,
      category: classified.category,
      retryable: classified.retryable,
    },
    status: classified.status,
    classified,
  };
};

const routeError = (c: any, err: unknown, fallback = "bad request") => {
  const { body, status } = errorPayload(err, fallback);
  return c.json(body, status);
};

const markStoredSessionSuccess = async (
  kv: KVNamespace,
  session: { source: "provided" | "stored" | "none" },
) => {
  if (session.source === "stored") {
    await clearAuthBlock(kv);
  }
};

class QueryParamError extends Error {
  constructor(public field: string, public value: string) {
    super(`invalid ${field}: ${value}`);
    this.name = "QueryParamError";
  }
}

const parseFiniteNumber = (raw: string | null | undefined, field: string): number | undefined => {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new QueryParamError(field, raw);
  return n;
};

const textEncoder = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hexToBytes = (input: string): Uint8Array | null => {
  if (input.length === 0 || input.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(input)) return null;
  const bytes = new Uint8Array(input.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(input.substr(i * 2, 2), 16);
  }
  return bytes;
};

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

  const sigBytes = hexToBytes(signature);
  if (!sigBytes) return c.json({ error: "Unauthorized" }, 401);

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
  const signatureBytes = sigBytes.buffer.slice(
    sigBytes.byteOffset,
    sigBytes.byteOffset + sigBytes.byteLength,
  ) as ArrayBuffer;
  const valid = await crypto.subtle.verify("HMAC", key, signatureBytes, textEncoder.encode(canonical));

  if (!valid) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
};

const requireAdminAuth = async (c: any): Promise<Response | null> => {
  const hasHmac = !!c.env.HMAC_SECRET && !!c.env.HMAC_CLIENT_ID;
  if (!hasHmac) return c.json({ error: "Admin HMAC not configured" }, 500);
  return await verifyHmacAuth(c);
};

const SESSION_STATUS_CANARY = {
  symbol: "ASX:MQG",
  timeframe: "1D",
  amount: 1,
  timeoutMs: 8000,
} as const;

app.get("/admin/session/status", async (c) => {
  const authResp = await requireAdminAuth(c);
  if (authResp) return authResp;
  const stored = await getStoredSession(c.env.CACHE_META);
  if (!stored) return c.json({ ok: false, reason: "not set" });
  const wasBlocked = isBlocked(stored);
  try {
    const token = await getAuthToken(stored.sessionId, stored.sessionSign);
    if (token === "unauthorized_user_token") {
      const candles = await getCandles({
        symbol: SESSION_STATUS_CANARY.symbol,
        timeframe: SESSION_STATUS_CANARY.timeframe,
        amount: SESSION_STATUS_CANARY.amount,
        sessionId: stored.sessionId,
        sessionSign: stored.sessionSign,
        timeoutMs: SESSION_STATUS_CANARY.timeoutMs,
      });
      if (candles.length === 0) throw new Error("Wrong or expired sessionid/sessionid_sign");
    }
    const recovered = await clearAuthBlock(c.env.CACHE_META);
    return c.json({ ok: true, recovered: wasBlocked, stored: recovered || stored });
  } catch (err: any) {
    const classified = classifyUpstreamError(err, "auth failure");
    if (classified.category === "auth") {
      await markAuthFailure(c.env.CACHE_META);
    }
    return c.json({
      ok: false,
      reason: classified.message,
      category: classified.category,
      retryable: classified.retryable,
      stored,
    });
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
      sessionSign?: string;
    };

    if (!body?.symbols || !Array.isArray(body.symbols) || body.symbols.length === 0) {
      return c.json({ error: "symbols array required" }, 400);
    }

    const results = await Promise.all(
      body.symbols.map(async (symbol) => {
        try {
          const session = await resolveSession(c.env.CACHE_META, {
            sessionId: body.sessionId,
            sessionSign: body.sessionSign,
          });
          const candles = await getCandles({
            symbol,
            amount: body.amount,
            timeframe: body.timeframe,
            endpoint: body.endpoint,
            sessionId: session.sessionId,
            sessionSign: session.sessionSign,
          });
          await markStoredSessionSuccess(c.env.CACHE_META, session);
          return { symbol, candles, authSource: session.source };
        } catch (err: any) {
          const { body: error, classified } = errorPayload(err, "unknown error");
          if (classified.category === "auth") await markAuthFailure(c.env.CACHE_META);
          return { symbol, ...error };
        }
      }),
    );

    return c.json({ results });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
  }
});

// Cache-backed candles (R2 + KV)
app.get("/cache/:symbol/:tf", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const symbol = c.req.param("symbol");
  const tf = c.req.param("tf");
  const url = new URL(c.req.url);
  const providedSessionId = url.searchParams.get("sessionId") || undefined;
  const endpoint = url.searchParams.get("endpoint") || undefined;
  const maxTotalRaw = url.searchParams.get("maxTotalBytes") || c.env.CACHE_MAX_TOTAL_BYTES;
  const maxFetchesRaw = url.searchParams.get("maxFetchesPerMinute") || c.env.CACHE_MAX_FETCHES_PER_MINUTE;

  let from: number | undefined;
  let to: number | undefined;
  let total: number | undefined;
  let maxApproxBytes: number | undefined;
  let maxTotalBytes: number | undefined;
  let maxFetchesPerMinute: number | undefined;
  try {
    from = parseFiniteNumber(url.searchParams.get("from"), "from");
    to = parseFiniteNumber(url.searchParams.get("to"), "to");
    total = parseFiniteNumber(url.searchParams.get("total"), "total");
    maxApproxBytes = parseFiniteNumber(url.searchParams.get("maxBytes"), "maxBytes");
    maxTotalBytes = parseFiniteNumber(maxTotalRaw, "maxTotalBytes");
    maxFetchesPerMinute = parseFiniteNumber(maxFetchesRaw, "maxFetchesPerMinute");
  } catch (err: any) {
    if (err instanceof QueryParamError) return c.json({ error: err.message }, 400);
    throw err;
  }

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
        from,
        to,
        total,
        sessionId: session.sessionId,
        sessionSign: session.sessionSign,
        endpoint,
        maxApproxBytes,
        maxTotalBytes,
        maxFetchesPerMinute,
      }),
    }));
    const result = (await cacheResp.json()) as any;
    const responseBody = {
      candles: result.candles,
      meta: result.meta,
      partial: result.partial,
      upstreamError: result.upstreamError,
      authSource: session.source,
    };
    if (result.upstreamError) {
      if (result.upstreamError.category === "auth") {
        await markAuthFailure(c.env.CACHE_META);
      }
      if (!result.candles?.length) {
        return c.json(responseBody, result.upstreamError.status || 503);
      }
    } else {
      await markStoredSessionSuccess(c.env.CACHE_META, session);
    }
    return c.json(responseBody);
  } catch (err: any) {
    if (providedSessionId === undefined && isAuthError(err)) {
      await markAuthFailure(c.env.CACHE_META);
    }
    return routeError(c, err, "cache error");
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
    return routeError(c, err, "status error");
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
    const listed = await listAllR2Objects(c.env.CACHE_DATA, { prefix });
    for (const obj of listed) {
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
    return routeError(c, err, "invalidate error");
  }
});

app.post("/cache/snapshot", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const key = await snapshotMeta(c.env.CACHE_META, c.env.CACHE_DATA);
    return c.json({ ok: true, key });
  } catch (err: any) {
    return routeError(c, err, "snapshot error");
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
    return routeError(c, err, "restore error");
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
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getQuotes({
      ...body,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
      sessionSign?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const state = await createReplay({
      symbol: body.symbol,
      timeframe: body.timeframe,
      startTime: body.startTime,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ state, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/auth-token", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { sessionId?: string; sessionSign?: string };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const token = await getAuthToken(session.sessionId, session.sessionSign);
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ token, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ profile, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
      sessionSign?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const meta = await resolveSymbol({
      symbol: body.symbol,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ meta, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
      sessionSign?: string;
      endpoint?: string;
      symbol?: string;
      timeframe?: string | number;
      fields?: string[];
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const bootstrap = await getStreamBootstrap({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      endpoint: body.endpoint as any,
      symbol: body.symbol,
      timeframe: body.timeframe,
      fields: body.fields,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ bootstrap, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/study", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      studyId: string;
      inputs?: Record<string, any>;
      params?: Record<string, any>;
      timeframe?: string | number;
      bars?: number;
      parentSeriesId?: string;
      endpoint?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.symbol || !body?.studyId) {
      return c.json({ error: "symbol and studyId required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await runStudy({
      symbol: body.symbol,
      studyId: body.studyId,
      inputs: body.inputs,
      params: body.params,
      timeframe: body.timeframe,
      bars: body.bars,
      parentSeriesId: body.parentSeriesId,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
      sessionSign?: string;
      delayMs?: number;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const candles = await backfillCandles({
      symbol: body.symbol,
      timeframe: body.timeframe,
      total: body.total,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      delayMs: body.delayMs,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ symbol: body.symbol, candles, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
    return routeError(c, err, "bad request");
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
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
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
