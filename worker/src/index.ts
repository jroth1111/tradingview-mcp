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
  runMetadataProbe,
  runFirstBarProbe,
  type CandleRequest,
  type QuoteRequest,
  type TARequest,
  type SearchRequest,
  type IndicatorSearchRequest,
} from "./tradingview";
import {
  getBuiltinCatalog,
  getBuiltinCategories,
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
import {
  BACKTEST_JOB_TYPES,
  type BacktestJobType,
  buildCanonicalKey,
  buildJobId,
  type CanonicalJobInputs,
} from "./backtest-job-do";
import {
  ANALYZE_SYNC_BODY_LIMIT_BYTES,
  ensureRunnerRegistered,
  estimateAnalyzeBodySize,
  runAnalyze,
} from "./runners/dispatcher";
import { compilePine, runPine } from "./pine";
import { runStrategy, optimizeStrategy } from "./strategy";
import { modifyStudy, runStudyChain } from "./study-chain";
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
import {
  copyLayout,
  deleteLayout,
  getLayout,
  getUserSources,
  listCharts,
  mintChartToken,
  moveLayout,
  saveLayout,
} from "./charts";
import {
  listWatchlists,
  getWatchlist,
  createWatchlist,
  deleteWatchlist,
  appendSymbols,
  removeSymbols,
  replaceSymbols,
  renameWatchlist,
  updateMeta,
  replaceSymbol,
  getActiveWatchlist,
  setActiveWatchlist,
  type WatchlistListType,
  type WatchlistType,
} from "./watchlists";
import {
  getScriptInfo,
  getVersionsLast,
  getVersionsAll,
  isAuthToGet,
  listPineScripts,
  savePineScript,
  publishPineScript,
  deletePineScript,
  renamePineScript,
  copyPineScript,
  convertPineScript,
  parsePineTitle,
  translateLightSource,
  genPineAlert,
} from "./pine-crud";
import {
  getInTimeIv,
  getVolatilityChart,
  getExpiries,
  getStrikes,
  getOptionsChain,
  getGreeks,
  scanOptions,
  getOptionsMetainfo,
  OptionsValidationError,
  VOLATILITY_XAXIS_VALUES,
} from "./options";
import {
  scanV2,
  screenerMetainfo,
  getOrderedEnum,
  getColumnCatalog,
  listMarkets as listScannerMarkets,
  getSymbolFields,
  type Scan2Request,
} from "./scanner-v2";
import {
  getSymbolNews,
  getSymbolNewsView,
  getCategoryNews,
  getStoryJson,
} from "./news-mediator";
import {
  getEconomicEvents,
  getIposCalendar,
  getSplitsCalendar,
} from "./calendar";
import {
  listLineTools,
  listLineToolTemplates,
  loadLineToolTemplate,
  saveLineToolTemplate,
  deleteLineToolTemplate,
  isDrawingTool,
} from "./line-tools";
import {
  resolveSymbol as wwwResolveSymbol,
  resolveSymbolBatch,
  listStudyTemplatesStandard,
  getIdeasFeed,
  getTweetData,
  getPublicChats,
  getDmChats,
  getConversationStatus,
  getFundamentalsConfig,
  getSupportI18n,
  getBrokerPanel,
  getUserProfile as wwwGetUserProfile,
  updateUserProfile as wwwUpdateUserProfile,
} from "./www-api";
import {
  listFavoriteIndicators,
  addFavoriteIndicator,
  removeFavoriteIndicator,
  listFavoriteDrawings,
  addFavoriteDrawing,
  removeFavoriteDrawing,
  listRecentStudyTemplates,
  addRecentStudyTemplate,
  listSavedScreens,
  saveScreen,
  deleteSavedScreen,
  getRawPrefs,
} from "./user-prefs";
import * as wsVerbs from "./ws-verbs";
import * as wsEvents from "./ws-events";
import {
  countActiveForClient,
  registerStream,
  releaseStream,
  touchStream,
  lookupStream,
  MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT,
} from "./quote-stream-registry";
import {
  MAX_SYMBOLS_PER_STREAM_DEFAULT as QS_MAX_SYMBOLS_DEFAULT,
} from "./quote-stream-do";

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
      "/v1/indicators/inputs",
      "/v1/indicators/builtin",
      "/v1/indicators/categories",
      "/v1/pubscripts/library",
      "/v1/pubscripts/editors-picks",
      "/v1/pubscripts/batch",
      "/v1/pubscripts/suggest",
      "/v1/pubscripts/personal-access",
      "/v1/pubscripts/packages-store",
      "/v1/alerts/health",
      "/v1/alerts/list",
      "/v1/alerts/get",
      "/v1/alerts/create",
      "/v1/alerts/modify",
      "/v1/alerts/delete",
      "/v1/alerts/stop",
      "/v1/alerts/restart",
      "/v1/alerts/clone",
      "/v1/alerts/fires/list",
      "/v1/alerts/fires/delete",
      "/v1/alerts/fires/delete-all",
      "/v1/alerts/fires/delete-by-filter",
      "/v1/alerts/fires/offline",
      "/v1/alerts/fires/offline-controls",
      "/v1/alerts/fires/clear-offline",
      "/v1/alerts/fires/clear-offline-controls",
      "/v1/alerts/pine-alert",
      "/v1/study-templates/list",
      "/v1/study-templates/get",
      "/v1/study-templates/create",
      "/v1/study-templates/update",
      "/v1/study-templates/rename",
      "/v1/study-templates/delete",
      "/v1/study-templates/favorite",
      "/v1/drawing-templates/list",
      "/v1/drawing-templates/get",
      "/v1/drawing-templates/save",
      "/v1/drawing-templates/delete",
      "/v1/settings/load",
      "/v1/settings/save",
      "/v1/pine/compile",
      "/v1/pine/run",
      "/v1/strategy/run",
      "/v1/strategy/replay",
      "/v1/strategy/optimize",
      "/v1/study/chain",
      "/v1/study/modify",
      "/v1/chart-session/create",
      "/v1/chart-session/study/create",
      "/v1/chart-session/study/modify",
      "/v1/chart-session/close",
      "/v1/study/remove",
      "/v1/study/metadata",
      "/v1/study/get-first-bar-time",
      "/v1/study/data-quality",
      "/v1/study/timezone",
      "/v1/quote/hibernate",
      "/v1/series/modify",
      "/v1/series/timeframe",
      "/v1/replay/start",
      "/v1/replay/stop",
      "/v1/replay/set-resolution",
      "/v1/replay/get-depth",
      "/v1/pointset/create",
      "/v1/pointset/modify",
      "/v1/pointset/remove",
      "/v1/charts/list",
      "/v1/charts/token",
      "/v1/charts/layout",
      "/v1/charts/layout/user",
      "/v1/charts/layout/save",
      "/v1/charts/layout/delete",
      "/v1/charts/layout/copy",
      "/v1/charts/layout/move",
      "/v1/watchlists/list",
      "/v1/watchlists/get/:id",
      "/v1/watchlists/create",
      "/v1/watchlists/delete/:id",
      "/v1/watchlists/append/:id",
      "/v1/watchlists/remove-symbols/:id",
      "/v1/watchlists/replace/:id",
      "/v1/watchlists/rename/:id",
      "/v1/watchlists/update-meta/:id",
      "/v1/watchlists/replace-symbol",
      "/v1/watchlists/active",
      "/v1/watchlists/active/:id",
      "/v1/pine/script-info",
      "/v1/pine/versions",
      "/v1/pine/versions-all",
      "/v1/pine/auth",
      "/v1/pine/list",
      "/v1/pine/save",
      "/v1/pine/publish",
      "/v1/pine/delete",
      "/v1/pine/rename",
      "/v1/pine/copy",
      "/v1/pine/convert",
      "/v1/pine/parse-title",
      "/v1/pine/translate-light",
      "/v1/pine/translate-source",
      "/v1/pine/gen-alert",
      "/v1/options/iv/:symbol",
      "/v1/options/volatility-chart/:symbol",
      "/v1/options/expiries/:symbol",
      "/v1/options/strikes/:symbol",
      "/v1/options/chain/:symbol",
      "/v1/options/greeks/:contractSymbol",
      "/v1/options/scan",
      "/v1/options/metainfo",
      "/v1/scan2",
      "/v1/screener/metainfo",
      "/v1/screener/enum",
      "/v1/screener/columns",
      "/v1/screener/markets",
      "/v1/screener/symbol",
      "/v1/news/symbol",
      "/v1/news/symbol-view",
      "/v1/news/category",
      "/v1/news/story",
      "/v1/calendar/events",
      "/v1/calendar/ipos",
      "/v1/calendar/splits",
      "/v1/stream/alerts",
      "/v1/stream/news",
      "/v1/stream/notifications",
      "/v1/stream/alerts/poll",
      "/v1/stream/news/poll",
      "/v1/line-tools/tools",
      "/v1/line-tools/templates/list",
      "/v1/line-tools/templates/load",
      "/v1/line-tools/templates/save",
      "/v1/line-tools/templates/delete",
      "/v1/symbol/resolve",
      "/v1/symbol/resolve-batch",
      "/v1/study-templates/standard",
      "/v1/ideas/feed",
      "/v1/social/tweet",
      "/v1/chats/public",
      "/v1/chats/dm",
      "/v1/conversation-status",
      "/v1/financial/fundamentals-config",
      "/v1/support/i18n",
      "/v1/brokers/trading-panel",
      "/v1/user/profile",
      "/v1/user-prefs/favorites/indicators/list",
      "/v1/user-prefs/favorites/indicators/add",
      "/v1/user-prefs/favorites/indicators/remove",
      "/v1/user-prefs/favorites/drawings/list",
      "/v1/user-prefs/favorites/drawings/add",
      "/v1/user-prefs/favorites/drawings/remove",
      "/v1/user-prefs/recents/study-templates/list",
      "/v1/user-prefs/recents/study-templates/add",
      "/v1/user-prefs/saved-screens/list",
      "/v1/user-prefs/saved-screens/save",
      "/v1/user-prefs/saved-screens/delete",
      "/v1/user-prefs/raw",
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

// === P3 — typed indicator inputs ===
app.post("/v1/indicators/inputs", async (c) => {
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
    const result = await getTypedIndicatorInputs({
      id: body.id,
      version: body.version,
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

// === P4 — built-in indicator catalog ===
app.post("/v1/indicators/builtin", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      filter?: any;
      kind?: any;
      q?: string;
      fundamentalCategory?: string;
      cacheTtlSeconds?: number;
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getBuiltinCatalog({
      filter: body.filter,
      kind: body.kind,
      q: body.q,
      fundamentalCategory: body.fundamentalCategory,
      cacheTtlSeconds: body.cacheTtlSeconds,
      cache: c.env.CACHE_META,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/indicators/categories", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      cacheTtlSeconds?: number;
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getBuiltinCategories({
      cache: c.env.CACHE_META,
      cacheTtlSeconds: body.cacheTtlSeconds,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "indicators categories failed");
  }
});

// === P5 — pubscripts library ===
app.post("/v1/pubscripts/library", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      offset?: number;
      count?: number;
      sort?: string;
      isPaid?: boolean;
      type?: string;
    };
    const result = await getPubLibrary(body);
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/pubscripts/editors-picks", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as { type?: string };
    const result = await getPubEditorsPicks(body.type);
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/pubscripts/batch", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      scriptIdPart: string;
      showHidden?: boolean;
    };
    if (!body?.scriptIdPart) return c.json({ error: "scriptIdPart required" }, 400);
    const result = await getPubBatch(body.scriptIdPart, body.showHidden);
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/pubscripts/suggest", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { search: string };
    if (!body?.search) return c.json({ error: "search required" }, 400);
    const result = await getPubSuggest(body.search);
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/pubscripts/personal-access", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 400);
    const result = await getPubPersonalAccess(session.sessionId, session.sessionSign);
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/pubscripts/packages-store", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getScriptPackagesStore(session.sessionId, session.sessionSign);
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "bad request");
  }
});

// === P6 — alerts ===
const requireAlertsCtx = async (
  c: any,
  body: { username?: string; sessionId?: string; sessionSign?: string },
) => {
  const session = await resolveSession(c.env.CACHE_META, {
    sessionId: body?.sessionId,
    sessionSign: body?.sessionSign,
  });
  if (!session.sessionId) {
    return { error: c.json({ error: "sessionId required" }, 400) } as const;
  }
  if (!body?.username) {
    return { error: c.json({ error: "username required" }, 400) } as const;
  }
  return {
    session,
    ctx: {
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      username: body.username,
    },
  } as const;
};

app.get("/v1/alerts/health", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const result = await isAlertsAlive();
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "alerts health failed");
  }
});

app.post("/v1/alerts/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      userId: string | number;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.userId == null) return c.json({ error: "userId required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listAlerts(r.ctx, body.userId);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "alerts list failed");
  }
});

app.post("/v1/alerts/get", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      alerts: number[];
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!Array.isArray(body?.alerts)) return c.json({ error: "alerts array required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await getAlertsBatch(r.ctx, body.alerts);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "alerts get failed");
  }
});

app.post("/v1/alerts/create", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      alert: any;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.alert) return c.json({ error: "alert required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await createAlert(r.ctx, body.alert);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "alerts create failed");
  }
});

app.post("/v1/alerts/modify", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      alert: { alert_id: number } & Record<string, any>;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.alert?.alert_id) return c.json({ error: "alert.alert_id required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await modifyRestartAlert(r.ctx, body.alert);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "alerts modify failed");
  }
});

const handleAlertBulkOp = async (
  c: any,
  fn: (ctx: any, ids: number[]) => Promise<any>,
  errLabel: string,
) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      alerts: number[];
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!Array.isArray(body?.alerts)) return c.json({ error: "alerts array required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await fn(r.ctx, body.alerts);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, errLabel);
  }
};

app.post("/v1/alerts/delete", (c) => handleAlertBulkOp(c, deleteAlerts, "alerts delete failed"));
app.post("/v1/alerts/stop", (c) => handleAlertBulkOp(c, stopAlerts, "alerts stop failed"));
app.post("/v1/alerts/restart", (c) => handleAlertBulkOp(c, restartAlerts, "alerts restart failed"));
app.post("/v1/alerts/clone", (c) => handleAlertBulkOp(c, cloneAlerts, "alerts clone failed"));

app.post("/v1/alerts/fires/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      limit?: number;
      alert_id?: number;
      before_time?: number;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listFires(r.ctx, {
      limit: body.limit,
      alert_id: body.alert_id,
      before_time: body.before_time,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "fires list failed");
  }
});

app.post("/v1/alerts/fires/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      fires: number[];
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!Array.isArray(body?.fires)) return c.json({ error: "fires array required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteFires(r.ctx, body.fires);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "fires delete failed");
  }
});

app.post("/v1/alerts/fires/delete-all", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteAllFires(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "fires delete-all failed");
  }
});

app.post("/v1/alerts/fires/delete-by-filter", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      alert_id?: number;
      before_time?: number;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteFiresByFilter(r.ctx, {
      alert_id: body.alert_id,
      before_time: body.before_time,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "fires delete-by-filter failed");
  }
});

app.post("/v1/alerts/fires/offline", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      limit?: number;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await getOfflineFires(r.ctx, body.limit);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "offline fires failed");
  }
});

app.post("/v1/alerts/fires/offline-controls", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await getOfflineFireControls(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "offline fire controls failed");
  }
});

app.post("/v1/alerts/fires/clear-offline", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      payloads: any[];
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!Array.isArray(body?.payloads)) return c.json({ error: "payloads array required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await clearOfflineFires(r.ctx, body.payloads);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "clear offline fires failed");
  }
});

app.post("/v1/alerts/fires/clear-offline-controls", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      payloads: any[];
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!Array.isArray(body?.payloads)) return c.json({ error: "payloads array required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const result = await clearOfflineFireControls(r.ctx, body.payloads);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "clear offline controls failed");
  }
});

app.post("/v1/alerts/pine-alert", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      alertInfo: any;
      alert: any;
      username: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.alertInfo) return c.json({ error: "alertInfo required" }, 400);
    if (!body?.alert) return c.json({ error: "alert required" }, 400);
    const r = await requireAlertsCtx(c, body);
    if ("error" in r) return r.error;
    const generated = await generatePineAlert(r.ctx.sessionId, r.ctx.sessionSign, body.alertInfo);
    const merged = { ...body.alert, ...generated };
    if (!merged.condition) merged.condition = { type: "pine_alert" };
    else if (!merged.condition.type) merged.condition.type = "pine_alert";
    const result = await createAlert(r.ctx, merged);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source, generated });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine-alert create failed");
  }
});

// === P10 — study-templates and drawing-templates ===
const requireTemplateCtx = async (
  c: any,
  body: { sessionId?: string; sessionSign?: string },
) => {
  const session = await resolveSession(c.env.CACHE_META, {
    sessionId: body?.sessionId,
    sessionSign: body?.sessionSign,
  });
  if (!session.sessionId) {
    return { error: c.json({ error: "sessionId required" }, 400) } as const;
  }
  return {
    session,
    ctx: { sessionId: session.sessionId, sessionSign: session.sessionSign },
  } as const;
};

app.post("/v1/study-templates/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listStudyTemplates(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-templates list failed");
  }
});

app.post("/v1/study-templates/get", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string | number;
      bucket?: "custom" | "standard" | "fundamentals";
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await getStudyTemplate(r.ctx, body.id, body.bucket ?? "custom");
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-template get failed");
  }
});

app.post("/v1/study-templates/create", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      name: string;
      content: string;
      meta_info?: any;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.name) return c.json({ error: "name required" }, 400);
    if (typeof body?.content !== "string") {
      return c.json({ error: "content must be a JSON-encoded string" }, 400);
    }
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await createStudyTemplate(r.ctx, {
      name: body.name,
      content: body.content,
      meta_info: body.meta_info,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-template create failed");
  }
});

app.post("/v1/study-templates/update", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string | number;
      name?: string;
      content?: string;
      meta_info?: any;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await updateStudyTemplate(r.ctx, body.id, {
      name: body.name,
      content: body.content,
      meta_info: body.meta_info,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-template update failed");
  }
});

app.post("/v1/study-templates/rename", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string | number;
      name: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    if (!body?.name) return c.json({ error: "name required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await renameStudyTemplate(r.ctx, body.id, body.name);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-template rename failed");
  }
});

app.post("/v1/study-templates/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteStudyTemplate(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-template delete failed");
  }
});

app.post("/v1/study-templates/favorite", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string | number;
      bucket?: "custom" | "standard";
      favorite?: boolean;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await setStudyTemplateFavorite(
      r.ctx,
      body.id,
      body.bucket ?? "custom",
      body.favorite ?? true,
    );
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-template favorite failed");
  }
});

app.post("/v1/drawing-templates/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool) return c.json({ error: "tool required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listDrawingTemplates(r.ctx, body.tool);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "drawing-templates list failed");
  }
});

app.post("/v1/drawing-templates/get", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      name: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool || !body?.name) return c.json({ error: "tool and name required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await getDrawingTemplate(r.ctx, body.tool, body.name);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "drawing-template get failed");
  }
});

app.post("/v1/drawing-templates/save", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      name: string;
      content: any;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool || !body?.name) return c.json({ error: "tool and name required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await saveDrawingTemplate(r.ctx, {
      tool: body.tool,
      name: body.name,
      content: body.content,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "drawing-template save failed");
  }
});

app.post("/v1/drawing-templates/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      name: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool || !body?.name) return c.json({ error: "tool and name required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteDrawingTemplate(r.ctx, body.tool, body.name);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "drawing-template delete failed");
  }
});

app.post("/v1/settings/load", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await loadSettings(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "settings load failed");
  }
});

app.post("/v1/settings/save", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      delta: Record<string, any>;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.delta || typeof body.delta !== "object") {
      return c.json({ error: "delta object required" }, 400);
    }
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await saveSettings(r.ctx, body.delta);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "settings save failed");
  }
});

// === Pine compile + run (P-Pine / la1) ==============================

app.post("/v1/pine/compile", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      source?: string;
      pineId?: string;
      version?: string;
      mode?: "eval" | "full" | "light";
      inputs?: Record<string, any>;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.source && !body?.pineId) {
      return c.json({ error: "source or pineId required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await compilePine({
      source: body.source,
      pineId: body.pineId,
      version: body.version,
      mode: body.mode,
      inputs: body.inputs,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine compile failed");
  }
});

app.post("/v1/pine/run", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      source?: string;
      pineId?: string;
      version?: string;
      inputs?: Record<string, any>;
      params?: Record<string, any>;
      timeframe?: string | number;
      bars?: number;
      parentSeriesId?: string;
      endpoint?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    if (!body?.source && !body?.pineId) {
      return c.json({ error: "source or pineId required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await runPine({
      symbol: body.symbol,
      source: body.source,
      pineId: body.pineId,
      version: body.version,
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
    return routeError(c, err, "pine run failed");
  }
});

// === Strategy run + optimize (P8 / g6v) =============================

app.post("/v1/strategy/run", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      studyId?: string;
      source?: string;
      properties?: Record<string, any>;
      inputs?: Record<string, any>;
      params?: Record<string, any>;
      timeframe?: string | number;
      bars?: number;
      endpoint?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    if (!body?.studyId && !body?.source) {
      return c.json({ error: "studyId or source required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await runStrategy({
      symbol: body.symbol,
      studyId: body.studyId,
      source: body.source,
      properties: body.properties,
      inputs: body.inputs,
      params: body.params,
      timeframe: body.timeframe,
      bars: body.bars,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "strategy run failed");
  }
});

// Strategy replay streams a finished run's trades and equity points as
// Server-Sent Events. The actual du-frame interception happens inside
// runStrategy via runStudy; this route emits the parsed nonseries outputs in
// per-bar order so consumers can render an equity/drawdown curve incrementally
// without buffering the full report.
app.post("/v1/strategy/replay", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
  if (!body?.studyId && !body?.source) {
    return c.json({ error: "studyId or source required" }, 400);
  }

  const session = await resolveSession(c.env.CACHE_META, {
    sessionId: body.sessionId,
    sessionSign: body.sessionSign,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let eventId = 0;
      const emit = (event: string, data: any) => {
        eventId += 1;
        controller.enqueue(
          encoder.encode(
            `id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };
      try {
        emit("status", { phase: "starting", studyId: body.studyId });
        const result = await runStrategy({
          symbol: body.symbol,
          studyId: body.studyId,
          source: body.source,
          properties: body.properties,
          inputs: body.inputs,
          params: body.params,
          timeframe: body.timeframe,
          bars: body.bars,
          endpoint: body.endpoint as any,
          sessionId: session.sessionId,
          sessionSign: session.sessionSign,
        });
        emit("status", { phase: "running" });

        for (const trade of result.trades) {
          emit("trade", trade);
        }
        for (const point of result.equity) {
          emit("equity", point);
        }
        emit("report", result.report);
        emit("done", {
          phase: "complete",
          totalTrades: result.report.total_trades ?? result.trades.length,
          equityPoints: result.equity.length,
          authSource: session.source,
        });
        if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
      } catch (err: any) {
        if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
        emit("error", {
          message: err?.message ?? String(err),
          category: err?.category ?? "upstream",
          code: err?.code,
          status: err?.status,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
});

app.post("/v1/strategy/analyze", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      trades?: number[];
      equity?: number[];
      iterations?: number;
      seed?: number;
      alpha?: number;
      periodsPerYear?: number;
      trialCount?: number;
      benchmarkReturns?: number[];
      candidateReturns?: number[][];
    };
    const size = estimateAnalyzeBodySize(body);
    if (size > ANALYZE_SYNC_BODY_LIMIT_BYTES) {
      return c.json(
        {
          error: "payload too large for sync analyze; submit as a job via /v1/jobs/submit with type=analyze",
          limit_bytes: ANALYZE_SYNC_BODY_LIMIT_BYTES,
          actual_bytes: size,
        },
        413,
      );
    }
    if (!Array.isArray(body?.trades) && !Array.isArray(body?.equity)) {
      return c.json({ error: "trades or equity required" }, 400);
    }
    const out = await runAnalyze({
      trades: body.trades ?? [],
      equity: body.equity ?? [],
      iterations: body.iterations,
      seed: body.seed,
      alpha: body.alpha,
      periodsPerYear: body.periodsPerYear,
      trialCount: body.trialCount,
      benchmarkReturns: body.benchmarkReturns,
      candidateReturns: body.candidateReturns,
    });
    return c.json({ result: out.result, durationMs: out.durationMs });
  } catch (err: any) {
    return routeError(c, err, "strategy analyze failed");
  }
});

app.post("/v1/strategy/optimize", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      studyId: string;
      baseInputs?: Record<string, any>;
      baseParams?: Record<string, any>;
      properties?: Record<string, any>;
      sweep: Record<string, any[]>;
      timeframe?: string | number;
      bars?: number;
      endpoint?: string;
      sessionId?: string;
      sessionSign?: string;
      concurrency?: number;
      metric?: string;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    if (!body?.studyId) return c.json({ error: "studyId required" }, 400);
    if (!body?.sweep || typeof body.sweep !== "object") {
      return c.json({ error: "sweep object required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await optimizeStrategy({
      symbol: body.symbol,
      studyId: body.studyId,
      baseInputs: body.baseInputs,
      baseParams: body.baseParams,
      properties: body.properties,
      sweep: body.sweep,
      timeframe: body.timeframe,
      bars: body.bars,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      concurrency: body.concurrency,
      metric: body.metric as any,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "strategy optimize failed");
  }
});

// === Study chain + short-lived modify (P7 / xu3) ====================

app.post("/v1/study/chain", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbol: string;
      timeframe?: string | number;
      bars?: number;
      studies: Array<{
        studyId: string;
        inputs?: Record<string, any>;
        params?: Record<string, any>;
        parentSlot?: string;
        slotName?: string;
      }>;
      endpoint?: string;
      sessionId?: string;
      sessionSign?: string;
      timeoutMs?: number;
    };
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    if (!Array.isArray(body?.studies) || body.studies.length === 0) {
      return c.json({ error: "studies array required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await runStudyChain({
      symbol: body.symbol,
      timeframe: body.timeframe,
      bars: body.bars,
      studies: body.studies,
      endpoint: body.endpoint as any,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      timeoutMs: body.timeoutMs,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study chain failed");
  }
});

app.post("/v1/study/modify", async (c) => {
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
    const result = await modifyStudy({
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
    return routeError(c, err, "study modify failed");
  }
});

// === Stateful chart-session DO (P9 / 2v6) ===========================
// All chart-session sub-routes require a sessionToken in the body. The
// token names a Durable Object instance; clients should pass the same
// token across /create -> /study/* -> /close to address the same DO.

const requireSessionToken = (body: any): string | Response => {
  if (!body || typeof body.sessionToken !== "string" || !body.sessionToken) {
    return Response.json({ error: "sessionToken (string) required" }, { status: 400 });
  }
  return body.sessionToken;
};

const forwardToChartSession = async (
  c: any,
  subPath: string,
  body: any,
  sessionToken: string,
): Promise<Response> => {
  const ns = (c.env as any).CHART_SESSION as {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init: RequestInit) => Promise<Response> };
  };
  const id = ns.idFromName(sessionToken);
  const stub = ns.get(id);
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  return stub.fetch(`https://chart-session.internal${subPath}`, init);
};

app.post("/v1/chart-session/create", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      sessionToken?: string;
      symbol: string;
      timeframe?: string | number;
      bars?: number;
      endpoint?: string;
      sessionId?: string;
      sessionSign?: string;
      timeoutMs?: number;
    };
    const tokenOrErr = requireSessionToken(body);
    if (typeof tokenOrErr !== "string") return tokenOrErr;
    if (!body?.symbol) return c.json({ error: "symbol required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const forwarded = await forwardToChartSession(c, "/create", {
      symbol: body.symbol,
      timeframe: body.timeframe,
      bars: body.bars,
      endpoint: body.endpoint,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      timeoutMs: body.timeoutMs,
    }, tokenOrErr);
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return forwarded;
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "chart-session create failed");
  }
});

app.post("/v1/chart-session/study/create", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      sessionToken?: string;
      studyId: string;
      inputs?: Record<string, any>;
      params?: Record<string, any>;
      parentSlot?: string;
      slotName?: string;
      timeoutMs?: number;
    };
    const tokenOrErr = requireSessionToken(body);
    if (typeof tokenOrErr !== "string") return tokenOrErr;
    if (!body?.studyId) return c.json({ error: "studyId required" }, 400);
    return await forwardToChartSession(c, "/study/create", {
      studyId: body.studyId,
      inputs: body.inputs,
      params: body.params,
      parentSlot: body.parentSlot,
      slotName: body.slotName,
      timeoutMs: body.timeoutMs,
    }, tokenOrErr);
  } catch (err: any) {
    return routeError(c, err, "chart-session study create failed");
  }
});

app.post("/v1/chart-session/study/modify", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      sessionToken?: string;
      slotName: string;
      inputs: Record<string, any>;
      params?: Record<string, any>;
      timeoutMs?: number;
    };
    const tokenOrErr = requireSessionToken(body);
    if (typeof tokenOrErr !== "string") return tokenOrErr;
    if (!body?.slotName) return c.json({ error: "slotName required" }, 400);
    if (!body?.inputs || typeof body.inputs !== "object") {
      return c.json({ error: "inputs object required" }, 400);
    }
    return await forwardToChartSession(c, "/study/modify", {
      slotName: body.slotName,
      inputs: body.inputs,
      params: body.params,
      timeoutMs: body.timeoutMs,
    }, tokenOrErr);
  } catch (err: any) {
    return routeError(c, err, "chart-session study modify failed");
  }
});

app.post("/v1/chart-session/close", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { sessionToken?: string };
    const tokenOrErr = requireSessionToken(body);
    if (typeof tokenOrErr !== "string") return tokenOrErr;
    return await forwardToChartSession(c, "/close", {}, tokenOrErr);
  } catch (err: any) {
    return routeError(c, err, "chart-session close failed");
  }
});

// === P17 WebSocket protocol depth ====================================
// Stateful (require sessionToken; forward to the ChartSession DO):
//   /v1/study/remove, /v1/quote/hibernate, /v1/study/data-quality,
//   /v1/study/timezone, /v1/series/modify, /v1/series/timeframe,
//   /v1/replay/{start,stop,set-resolution,get-depth},
//   /v1/pointset/{create,modify,remove}
// Stateless (transient probes; no session needed):
//   /v1/study/metadata, /v1/study/get-first-bar-time

const forwardChartSessionVerb = async (
  c: any,
  subPath: string,
  fields: string[],
): Promise<Response> => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, any>;
    const tokenOrErr = requireSessionToken(body);
    if (typeof tokenOrErr !== "string") return tokenOrErr;
    const forward: Record<string, any> = {};
    for (const f of fields) {
      if (body[f] !== undefined) forward[f] = body[f];
    }
    return await forwardToChartSession(c, subPath, forward, tokenOrErr);
  } catch (err: any) {
    return routeError(c, err, `chart-session ${subPath.slice(1)} failed`);
  }
};

app.post("/v1/study/remove", (c) => forwardChartSessionVerb(c, "/study/remove", ["slotName"]));
app.post("/v1/quote/hibernate", (c) => forwardChartSessionVerb(c, "/quote/hibernate", []));
app.post("/v1/study/data-quality", (c) =>
  forwardChartSessionVerb(c, "/quality", ["quality"]),
);
app.post("/v1/study/timezone", (c) => forwardChartSessionVerb(c, "/timezone", ["tz"]));
app.post("/v1/series/modify", (c) =>
  forwardChartSessionVerb(c, "/series/modify", [
    "seriesId",
    "sourceId",
    "symbolId",
    "timeframe",
    "count",
  ]),
);
app.post("/v1/series/timeframe", (c) =>
  forwardChartSessionVerb(c, "/series/timeframe", [
    "seriesId",
    "sourceId",
    "timeframe",
    "range",
  ]),
);
app.post("/v1/replay/start", (c) =>
  forwardChartSessionVerb(c, "/replay/start", ["slot", "args"]),
);
app.post("/v1/replay/stop", (c) => forwardChartSessionVerb(c, "/replay/stop", ["slot"]));
app.post("/v1/replay/set-resolution", (c) =>
  forwardChartSessionVerb(c, "/replay/set-resolution", ["slot", "timeframe"]),
);
app.post("/v1/replay/get-depth", (c) =>
  forwardChartSessionVerb(c, "/replay/get-depth", ["slot", "timeoutMs"]),
);
app.post("/v1/pointset/create", (c) =>
  forwardChartSessionVerb(c, "/pointset/create", ["pointsetId", "args"]),
);
app.post("/v1/pointset/modify", (c) =>
  forwardChartSessionVerb(c, "/pointset/modify", ["pointsetId", "args"]),
);
app.post("/v1/pointset/remove", (c) =>
  forwardChartSessionVerb(c, "/pointset/remove", ["pointsetId"]),
);

app.post("/v1/study/metadata", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
      endpoint?: any;
      timeoutMs?: number;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await runMetadataProbe({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      endpoint: body.endpoint,
      timeoutMs: body.timeoutMs,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ok: true, metadata: result.payload, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "studies metadata probe failed");
  }
});

app.post("/v1/study/get-first-bar-time", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      symbol?: string;
      timeframe?: string;
      sessionId?: string;
      sessionSign?: string;
      endpoint?: any;
      timeoutMs?: number;
    };
    if (!body.symbol) return c.json({ error: "symbol required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await runFirstBarProbe({
      symbol: body.symbol,
      timeframe: body.timeframe,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      endpoint: body.endpoint,
      timeoutMs: body.timeoutMs,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({
      ok: true,
      symbol: body.symbol,
      timeframe: body.timeframe ?? "1D",
      firstBarTime: result.firstBarTime,
      authSource: session.source,
    });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "first bar time probe failed");
  }
});


// === P11 charts-storage (tradingview-elb) ============================
const resolveChartUserId = async (
  c: any,
  session: { sessionId?: string; sessionSign?: string },
  body: { userId?: string | number },
): Promise<string | number | null> => {
  if (body?.userId !== undefined && body.userId !== null && body.userId !== "") {
    return body.userId;
  }
  if (!session.sessionId) return null;
  try {
    const profile = await getUserProfile({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    return profile?.id ?? null;
  } catch {
    return null;
  }
};

app.post("/v1/charts/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; sessionSign?: string };
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const layouts = await listCharts({ sessionId: session.sessionId, sessionSign: session.sessionSign });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ layouts, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts list failed");
  }
});

app.post("/v1/charts/token", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      layout?: string;
      force?: boolean;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.layout) return c.json({ error: "layout required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const rec = await mintChartToken(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      body.layout,
      { force: !!body.force },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({
      iat: rec.iat,
      exp: rec.exp,
      type: rec.type,
      layoutId: rec.layoutId,
      ownerId: rec.ownerId,
      shared: rec.shared,
      cachedAt: rec.cachedAt,
      authSource: session.source,
    });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "chart-token mint failed");
  }
});

app.post("/v1/charts/layout", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      layout?: string;
      chart_id?: string | number;
      symbol?: string;
      includeOwnerSource?: boolean;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.layout) return c.json({ error: "layout required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const result = await getLayout(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      { layoutId: body.layout, chartId: body.chart_id, symbol: body.symbol, includeOwnerSource: body.includeOwnerSource },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts layout failed");
  }
});

app.post("/v1/charts/layout/user", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      layout?: string;
      symbol?: string;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.layout) return c.json({ error: "layout required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const result = await getUserSources(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      { layoutId: body.layout, symbol: body.symbol },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts user sources failed");
  }
});

app.post("/v1/charts/layout/save", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      layout?: string;
      chart_id?: string | number;
      content?: any;
      name?: string;
      symbol?: string;
      resolution?: string;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.layout) return c.json({ error: "layout required" }, 400);
    if (body.content === undefined || body.content === null) return c.json({ error: "content required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const result = await saveLayout(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      {
        layoutId: body.layout,
        chartId: body.chart_id,
        content: body.content,
        name: body.name,
        symbol: body.symbol,
        resolution: body.resolution,
      },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts layout save failed");
  }
});

app.post("/v1/charts/layout/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      layout?: string;
      chart_id?: string | number;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.layout) return c.json({ error: "layout required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const result = await deleteLayout(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      { layoutId: body.layout, chartId: body.chart_id },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts layout delete failed");
  }
});

app.post("/v1/charts/layout/copy", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      from_layout?: string;
      to_layout?: string;
      chart_id?: string | number;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.from_layout || !body?.to_layout) return c.json({ error: "from_layout and to_layout required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const result = await copyLayout(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      { fromLayout: body.from_layout, toLayout: body.to_layout, chartId: body.chart_id },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts layout copy failed");
  }
});

app.post("/v1/charts/layout/move", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      from_layout?: string;
      to_layout?: string;
      chart_id?: string | number;
      userId?: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.from_layout || !body?.to_layout) return c.json({ error: "from_layout and to_layout required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, body);
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 401);
    const userId = await resolveChartUserId(c, session, body);
    if (userId === null) return c.json({ error: "userId required" }, 400);
    const result = await moveLayout(
      { sessionId: session.sessionId, sessionSign: session.sessionSign, userId, kv: c.env.CACHE_META },
      { fromLayout: body.from_layout, toLayout: body.to_layout, chartId: body.chart_id },
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "charts layout move failed");
  }
});

// === P12 watchlists (tradingview-9oz) ================================
const requireWatchlistCtx = async (
  c: any,
  body: { sessionId?: string; sessionSign?: string; csrfToken?: string },
) => {
  const session = await resolveSession(c.env.CACHE_META, {
    sessionId: body?.sessionId,
    sessionSign: body?.sessionSign,
  });
  if (!session.sessionId) {
    return { error: c.json({ error: "sessionId required" }, 400) } as const;
  }
  return {
    session,
    ctx: {
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
      csrfToken: body?.csrfToken,
    },
  } as const;
};

app.get("/v1/watchlists/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const type = (url.searchParams.get("type") || "all") as WatchlistListType;
    const r = await requireWatchlistCtx(c, {});
    if ("error" in r) return r.error;
    const result = await listWatchlists(r.ctx, type);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlists list failed");
  }
});

app.get("/v1/watchlists/get/:id", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const r = await requireWatchlistCtx(c, {});
    if ("error" in r) return r.error;
    const result = await getWatchlist(r.ctx, id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist get failed");
  }
});

app.post("/v1/watchlists/create", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      name: string;
      symbols?: string[];
      sessionId?: string;
      sessionSign?: string;
      csrfToken?: string;
    };
    if (!body?.name) return c.json({ error: "name required" }, 400);
    const r = await requireWatchlistCtx(c, body);
    if ("error" in r) return r.error;
    const result = await createWatchlist(r.ctx, { name: body.name, symbols: body.symbols });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist create failed");
  }
});

app.post("/v1/watchlists/delete/:id", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
      csrfToken?: string;
    };
    const r = await requireWatchlistCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteWatchlist(r.ctx, id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist delete failed");
  }
});

const handleWatchlistSymbolOp = async (
  c: any,
  fn: (ctx: any, id: string, symbols: string[]) => Promise<any>,
  errLabel: string,
) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const raw = await c.req.json();
    let symbols: string[] | undefined;
    let auth: { sessionId?: string; sessionSign?: string; csrfToken?: string } = {};
    if (Array.isArray(raw)) {
      symbols = raw;
    } else if (raw && typeof raw === "object") {
      symbols = Array.isArray(raw.symbols) ? raw.symbols : undefined;
      auth = {
        sessionId: raw.sessionId,
        sessionSign: raw.sessionSign,
        csrfToken: raw.csrfToken,
      };
    }
    if (!Array.isArray(symbols)) return c.json({ error: "symbols array required" }, 400);
    const r = await requireWatchlistCtx(c, auth);
    if ("error" in r) return r.error;
    const result = await fn(r.ctx, id, symbols);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, errLabel);
  }
};

app.post("/v1/watchlists/append/:id", (c) =>
  handleWatchlistSymbolOp(c, appendSymbols, "watchlist append failed"));
app.post("/v1/watchlists/remove-symbols/:id", (c) =>
  handleWatchlistSymbolOp(c, removeSymbols, "watchlist remove failed"));
app.post("/v1/watchlists/replace/:id", (c) =>
  handleWatchlistSymbolOp(c, replaceSymbols, "watchlist replace failed"));

app.post("/v1/watchlists/rename/:id", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = (await c.req.json()) as {
      name: string;
      sessionId?: string;
      sessionSign?: string;
      csrfToken?: string;
    };
    if (!body?.name) return c.json({ error: "name required" }, 400);
    const r = await requireWatchlistCtx(c, body);
    if ("error" in r) return r.error;
    const result = await renameWatchlist(r.ctx, id, body.name);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist rename failed");
  }
});

app.post("/v1/watchlists/update-meta/:id", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = (await c.req.json()) as {
      description: string;
      sessionId?: string;
      sessionSign?: string;
      csrfToken?: string;
    };
    if (typeof body?.description !== "string") {
      return c.json({ error: "description string required" }, 400);
    }
    const r = await requireWatchlistCtx(c, body);
    if ("error" in r) return r.error;
    const result = await updateMeta(r.ctx, id, body.description);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist update-meta failed");
  }
});

app.post("/v1/watchlists/replace-symbol", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      type: WatchlistType;
      id: number | string;
      old: string;
      new: string;
      sessionId?: string;
      sessionSign?: string;
      csrfToken?: string;
    };
    if (body?.type !== "custom" && body?.type !== "colored") {
      return c.json({ error: "type must be 'custom' or 'colored'" }, 400);
    }
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    if (!body?.old || !body?.new) return c.json({ error: "old and new symbols required" }, 400);
    const r = await requireWatchlistCtx(c, body);
    if ("error" in r) return r.error;
    const result = await replaceSymbol(r.ctx, {
      type: body.type,
      id: body.id,
      old: body.old,
      new: body.new,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist replace-symbol failed");
  }
});

app.get("/v1/watchlists/active", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const r = await requireWatchlistCtx(c, {});
    if ("error" in r) return r.error;
    const result = await getActiveWatchlist(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist active get failed");
  }
});

app.post("/v1/watchlists/active/:id", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = c.req.param("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
      csrfToken?: string;
    };
    const r = await requireWatchlistCtx(c, body);
    if ("error" in r) return r.error;
    const result = await setActiveWatchlist(r.ctx, id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "watchlist active set failed");
  }
});

// === P13 pine-crud (tradingview-smh) =================================
const requirePineCtx = async (
  c: any,
  body: { sessionId?: string; sessionSign?: string },
  { writeOp = false }: { writeOp?: boolean } = {},
) => {
  const session = await resolveSession(c.env.CACHE_META, {
    sessionId: body?.sessionId,
    sessionSign: body?.sessionSign,
  });
  if (writeOp && !session.sessionId) {
    return { error: c.json({ error: "sessionId required" }, 400) } as const;
  }
  return {
    session,
    ctx: {
      sessionId: session.sessionId ?? "",
      sessionSign: session.sessionSign,
    },
  } as const;
};

app.get("/v1/pine/script-info", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = new URL(c.req.url).searchParams.get("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const r = await requirePineCtx(c, {}, { writeOp: false });
    if ("error" in r) return r.error;
    const result = await getScriptInfo(r.ctx, id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine script-info failed");
  }
});

app.get("/v1/pine/versions", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = new URL(c.req.url).searchParams.get("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const r = await requirePineCtx(c, {});
    if ("error" in r) return r.error;
    const result = await getVersionsLast(r.ctx, id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine versions failed");
  }
});

app.get("/v1/pine/versions-all", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const id = new URL(c.req.url).searchParams.get("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const r = await requirePineCtx(c, {});
    if ("error" in r) return r.error;
    const result = await getVersionsAll(r.ctx, id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine versions-all failed");
  }
});

app.get("/v1/pine/auth", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const id = url.searchParams.get("id");
    const version = url.searchParams.get("version");
    if (!id) return c.json({ error: "id required" }, 400);
    if (!version) return c.json({ error: "version required" }, 400);
    const r = await requirePineCtx(c, {});
    if ("error" in r) return r.error;
    const result = await isAuthToGet(r.ctx, id, version);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine auth check failed");
  }
});

app.get("/v1/pine/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const filter = new URL(c.req.url).searchParams.get("filter");
    if (!filter) return c.json({ error: "filter required" }, 400);
    const r = await requirePineCtx(c, {});
    if ("error" in r) return r.error;
    const result = await listPineScripts(r.ctx.sessionId ? r.ctx : null, filter);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (err?.code === "filter_not_allowed") {
      return c.json({ error: err.message, category: "validation" }, 400);
    }
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine list failed");
  }
});

app.post("/v1/pine/save", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      mode: "new" | "next" | "new_draft" | "next_draft";
      source: string;
      id?: string; name?: string;
      allowOverwrite?: boolean; allowCreateNew?: boolean; allowUseExistingDraft?: boolean;
      sessionId?: string; sessionSign?: string;
    };
    if (!body?.source) return c.json({ error: "source required" }, 400);
    if (!body?.mode) return c.json({ error: "mode required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await savePineScript(r.ctx, body);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine save failed");
  }
});

app.post("/v1/pine/publish", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      mode: "new" | "next";
      source: string; id?: string;
      access?: "open" | "protected" | "invite_only";
      extra?: Record<string, any>; name?: string;
      sessionId?: string; sessionSign?: string;
    };
    if (!body?.source) return c.json({ error: "source required" }, 400);
    if (!body?.mode) return c.json({ error: "mode required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await publishPineScript(r.ctx, body);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine publish failed");
  }
});

app.post("/v1/pine/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { id: string; sessionId?: string; sessionSign?: string };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await deletePineScript(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine delete failed");
  }
});

app.post("/v1/pine/rename", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string; name: string; force?: boolean;
      sessionId?: string; sessionSign?: string;
    };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    if (!body?.name) return c.json({ error: "name required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await renamePineScript(r.ctx, body);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine rename failed");
  }
});

app.post("/v1/pine/copy", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { id: string; name?: string; sessionId?: string; sessionSign?: string };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await copyPineScript(r.ctx, body);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine copy failed");
  }
});

app.post("/v1/pine/convert", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      source: string; version_to: string;
      sessionId?: string; sessionSign?: string;
    };
    if (!body?.source) return c.json({ error: "source required" }, 400);
    if (!body?.version_to) return c.json({ error: "version_to required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await convertPineScript(r.ctx, body);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine convert failed");
  }
});

app.post("/v1/pine/parse-title", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { source: string; sessionId?: string; sessionSign?: string };
    if (!body?.source) return c.json({ error: "source required" }, 400);
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await parsePineTitle(r.ctx, body.source);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine parse-title failed");
  }
});

app.get("/v1/pine/translate-light", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const id = url.searchParams.get("id");
    const version = url.searchParams.get("version");
    if (!id) return c.json({ error: "id required" }, 400);
    if (!version) return c.json({ error: "version required" }, 400);
    const r = await requirePineCtx(c, {});
    if ("error" in r) return r.error;
    const result = await translateLightSource(r.ctx, id, version);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine translate-light failed");
  }
});

// Direct pine-facade/translate_source surface — full-source compile that
// returns metaInfo + ilTemplate. /v1/pine/compile dispatches to the same
// helper via mode="full"; this route exists as a documented one-purpose
// alias for callers who only need the raw-source compile leg without the
// mode parameter.
app.post("/v1/pine/translate-source", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      source?: string;
      version?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.source) return c.json({ error: "source required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await compilePine({
      mode: "full",
      source: body.source,
      version: body.version,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine translate-source failed");
  }
});

app.post("/v1/pine/gen-alert", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      source?: string; alert_info?: any; inputs?: Record<string, any>;
      sessionId?: string; sessionSign?: string;
    };
    const r = await requirePineCtx(c, body, { writeOp: true });
    if ("error" in r) return r.error;
    const result = await genPineAlert(r.ctx, body);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "pine gen-alert failed");
  }
});

// === P14 options (tradingview-nh9) ===================================
const parseRange = (raw: string | null): [number, number] | undefined => {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n))) {
      return [Number(v[0]), Number(v[1])];
    }
  } catch {}
  return undefined;
};

const optionsRouteError = (c: any, err: unknown) => {
  if (err instanceof OptionsValidationError) {
    return c.json({ error: err.message, category: "bad_request", retryable: false }, 400);
  }
  return routeError(c, err, "options error");
};

app.get("/v1/options/iv/:symbol", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getInTimeIv({
      symbol: c.req.param("symbol"),
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.get("/v1/options/volatility-chart/:symbol", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const url = new URL(c.req.url);
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getVolatilityChart({
      symbol: c.req.param("symbol"),
      root: url.searchParams.get("root") || undefined,
      expiry: url.searchParams.get("expiry") || "",
      xaxis: url.searchParams.get("xaxis") || "",
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.get("/v1/options/expiries/:symbol", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const url = new URL(c.req.url);
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getExpiries({
      symbol: c.req.param("symbol"),
      range: parseRange(url.searchParams.get("range")),
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.get("/v1/options/strikes/:symbol", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const url = new URL(c.req.url);
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getStrikes({
      symbol: c.req.param("symbol"),
      expiry: url.searchParams.get("expiry") || undefined,
      range: parseRange(url.searchParams.get("range")),
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.get("/v1/options/chain/:symbol", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const url = new URL(c.req.url);
    const typeRaw = url.searchParams.get("type");
    const type =
      typeRaw === "call" || typeRaw === "put" || typeRaw === "both" ? typeRaw : undefined;
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getOptionsChain({
      symbol: c.req.param("symbol"),
      expiry: url.searchParams.get("expiry") || undefined,
      type,
      range: parseRange(url.searchParams.get("range")),
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.get("/v1/options/greeks/:contractSymbol", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getGreeks({
      contractSymbol: c.req.param("contractSymbol"),
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.post("/v1/options/scan", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const body = (await c.req.json()) as Parameters<typeof scanOptions>[0];
    const session = await resolveSession(c.env.CACHE_META);
    const out = await scanOptions({
      ...body,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

app.get("/v1/options/metainfo", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  try {
    const session = await resolveSession(c.env.CACHE_META);
    const out = await getOptionsMetainfo({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ ...out, authSource: session.source });
  } catch (err) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return optionsRouteError(c, err);
  }
});

// === P15 scanner-v2 (tradingview-rfy) ================================
app.post("/v1/scan2", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as Scan2Request;
    const result = await scanV2(body);
    return c.json(result);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/screener/metainfo", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { market?: string; labelProduct?: string };
    if (!body?.market) return c.json({ error: "market required" }, 400);
    const { value, cached } = await screenerMetainfo(body.market, {
      labelProduct: body.labelProduct,
      cache: c.env.CACHE_META,
    });
    return c.json({ metainfo: value, cached });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/screener/enum", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const ids = c.req.query("ids");
    if (!ids) return c.json({ error: "ids required" }, 400);
    const { value, cached } = await getOrderedEnum(ids, {
      lang: c.req.query("lang") || undefined,
      labelProduct: c.req.query("labelProduct") || undefined,
      cache: c.env.CACHE_META,
    });
    return c.json({ enum: value, cached });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/screener/columns", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const version = c.req.query("version");
    const { value, cached } = await getColumnCatalog(version, { cache: c.env.CACHE_META });
    return c.json({ catalog: value, cached });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/screener/markets", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    return c.json(listScannerMarkets());
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/screener/symbol", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const symbol = c.req.query("symbol");
    const fields = c.req.query("fields");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    if (!fields) return c.json({ error: "fields required" }, 400);
    const data = await getSymbolFields({
      symbol,
      fields: fields.split(",").map((s) => s.trim()).filter(Boolean),
      no_404: c.req.query("no_404") === "true",
      labelProduct: c.req.query("labelProduct") || undefined,
    });
    return c.json({ data });
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

// === P16 news-mediator + calendar (tradingview-fn9) ==================
app.get("/v1/news/symbol", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const out = await getSymbolNews({
      symbol,
      lang: url.searchParams.get("lang") || undefined,
      client: url.searchParams.get("client") || undefined,
      streaming: url.searchParams.get("streaming") === "true",
      cursor: url.searchParams.get("cursor") || undefined,
    });
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/news/symbol-view", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const symbol = url.searchParams.get("symbol");
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const out = await getSymbolNewsView({
      symbol,
      lang: url.searchParams.get("lang") || undefined,
      client: url.searchParams.get("client") || undefined,
    });
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/news/category", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const out = await getCategoryNews({
      market: url.searchParams.get("market") || undefined,
      country: url.searchParams.get("country") || undefined,
      tag: url.searchParams.get("tag") || undefined,
      priority: url.searchParams.get("priority") || undefined,
      symbol: url.searchParams.get("symbol") || undefined,
      lang: url.searchParams.get("lang") || undefined,
      client: url.searchParams.get("client") || undefined,
      streaming: url.searchParams.get("streaming") === "true",
      cursor: url.searchParams.get("cursor") || undefined,
    });
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/news/story", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const id = url.searchParams.get("id");
    if (!id) return c.json({ error: "id required" }, 400);
    const out = await getStoryJson({ id, lang: url.searchParams.get("lang") || undefined });
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.get("/v1/calendar/events", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const url = new URL(c.req.url);
    const minImportanceRaw = url.searchParams.get("minImportance");
    const out = await getEconomicEvents({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
      countries: url.searchParams.get("countries")?.split(",").map((s) => s.trim()).filter(Boolean),
      minImportance: minImportanceRaw != null ? Number(minImportanceRaw) : undefined,
    });
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/calendar/ipos", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      from?: number;
      to?: number;
      countries?: string[];
      markets?: string[];
      fields?: string[];
    };
    const out = await getIposCalendar(body);
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

app.post("/v1/calendar/splits", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      from?: number;
      to?: number;
      markets?: string[];
      fields?: string[];
    };
    const out = await getSplitsCalendar(body);
    return c.json(out);
  } catch (err: any) {
    return routeError(c, err, "bad request");
  }
});

// === Slice B: BacktestJob job orchestration (tradingview-e1q) =======
//
// `submit` accepts a job description plus a CanonicalJobInputs envelope. We
// hash that envelope into a canonical key, fold in the optional
// `idempotencyKey`, look up the resulting jobId in CACHE_META; if absent we
// allocate a fresh DO instance addressed by jobId and forward submit. All
// other routes (status, events, result, cancel) just route to the DO
// addressed by jobId.

const WORKER_VERSION = "slice-b@2026-05-07";

const getBacktestJobNamespace = (env: any) =>
  env.BACKTEST_JOB as {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  };

const getBacktestJobStub = (env: any, jobId: string) => {
  const ns = getBacktestJobNamespace(env);
  return ns.get(ns.idFromName(jobId));
};

interface SubmitBody {
  type?: string;
  idempotencyKey?: string;
  inputs?: CanonicalJobInputs;
  payload?: Record<string, unknown>;
}

app.post("/v1/jobs/submit", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  ensureRunnerRegistered();

  let body: SubmitBody;
  try {
    body = (await c.req.json()) as SubmitBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!body?.type || !(BACKTEST_JOB_TYPES as readonly string[]).includes(body.type)) {
    return c.json(
      { error: `type must be one of ${BACKTEST_JOB_TYPES.join(", ")}` },
      400,
    );
  }
  if (!body.inputs || typeof body.inputs !== "object") {
    return c.json({ error: "inputs envelope required for canonical key" }, 400);
  }

  const inputs: CanonicalJobInputs = {
    ...body.inputs,
    workerVersion: WORKER_VERSION,
  };
  const canonicalKey = await buildCanonicalKey(inputs);
  const indexKey = `backtest_job_idx:${body.idempotencyKey ?? "_"}:${canonicalKey}`;

  const existingJobId = await c.env.CACHE_META.get(indexKey);
  const jobId = existingJobId ?? buildJobId(canonicalKey, body.idempotencyKey);

  const stub = getBacktestJobStub(c.env, jobId);
  const submitResp = await stub.fetch("https://backtest-job.internal/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobId,
      type: body.type as BacktestJobType,
      canonicalKey,
      idempotencyKey: body.idempotencyKey,
      workerVersion: WORKER_VERSION,
      submittedAt: Date.now(),
      payload: body.payload ?? {},
    }),
  });

  if (submitResp.ok && !existingJobId) {
    await c.env.CACHE_META.put(indexKey, jobId, { expirationTtl: 60 * 60 * 24 * 30 });
  }

  const submitJson = (await submitResp.json()) as {
    jobId?: string;
    deduped?: boolean;
    status?: string;
  };
  return c.json(
    {
      jobId: submitJson.jobId ?? jobId,
      deduped: Boolean(submitJson.deduped) || Boolean(existingJobId),
      status: submitJson.status ?? "queued",
      canonicalKey,
    },
    submitResp.status as any,
  );
});

app.get("/v1/jobs/:jobId/status", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const jobId = c.req.param("jobId");
  const resp = await getBacktestJobStub(c.env, jobId).fetch(
    "https://backtest-job.internal/status",
    { method: "GET" },
  );
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
});

app.get("/v1/jobs/:jobId/events", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const jobId = c.req.param("jobId");
  const url = new URL(c.req.url);
  const since = url.searchParams.get("since");
  const lastEventId = c.req.header("Last-Event-ID");
  const target = `https://backtest-job.internal/events${since ? `?since=${encodeURIComponent(since)}` : ""}`;
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (lastEventId) headers["Last-Event-ID"] = lastEventId;
  return getBacktestJobStub(c.env, jobId).fetch(target, { method: "GET", headers });
});

app.get("/v1/jobs/:jobId/result", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const jobId = c.req.param("jobId");
  const resp = await getBacktestJobStub(c.env, jobId).fetch(
    "https://backtest-job.internal/result",
    { method: "GET" },
  );
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
});

app.post("/v1/jobs/:jobId/cancel", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const jobId = c.req.param("jobId");
  const resp = await getBacktestJobStub(c.env, jobId).fetch(
    "https://backtest-job.internal/cancel",
    { method: "POST" },
  );
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
});

// === P18 stream bridge (tradingview-zkz) =============================
const forwardToStreamBridge = async (
  c: any,
  subPath: string,
  body: any,
  sessionToken: string,
  init?: RequestInit,
): Promise<Response> => {
  const ns = (c.env as any).STREAM_BRIDGE as {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  };
  const id = ns.idFromName(sessionToken);
  const stub = ns.get(id);
  const req: RequestInit = init ?? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  return stub.fetch(`https://stream-bridge.internal${subPath}`, req);
};

const requireStreamSessionToken = (raw: string | null): string | Response => {
  if (!raw) {
    return Response.json({ error: "sessionToken (string) required" }, { status: 400 });
  }
  return raw;
};

app.get("/v1/stream/alerts", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const tokenOrErr = requireStreamSessionToken(c.req.query("sessionToken") ?? null);
  if (typeof tokenOrErr !== "string") return tokenOrErr;
  const session = await resolveSession(c.env.CACHE_META, {});
  await forwardToStreamBridge(c, "/subscribe-alerts", {
    sessionId: session.sessionId,
    sessionSign: session.sessionSign,
    privateChannel: (session as any).privateChannel,
    includePublic: true,
  }, tokenOrErr);
  return forwardToStreamBridge(c, "/sse", null, tokenOrErr, {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
});

app.get("/v1/stream/news", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const tokenOrErr = requireStreamSessionToken(c.req.query("sessionToken") ?? null);
  if (typeof tokenOrErr !== "string") return tokenOrErr;
  const session = await resolveSession(c.env.CACHE_META, {});
  const symbolsCsv = c.req.query("symbols");
  const symbols = symbolsCsv ? symbolsCsv.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
  await forwardToStreamBridge(c, "/subscribe-news", {
    sessionId: session.sessionId,
    sessionSign: session.sessionSign,
    symbols,
  }, tokenOrErr);
  return forwardToStreamBridge(c, "/sse", null, tokenOrErr, {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
});

app.get("/v1/stream/notifications", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const tokenOrErr = requireStreamSessionToken(c.req.query("sessionToken") ?? null);
  if (typeof tokenOrErr !== "string") return tokenOrErr;
  const session = await resolveSession(c.env.CACHE_META, {});
  await forwardToStreamBridge(c, "/subscribe-news", {
    sessionId: session.sessionId,
    sessionSign: session.sessionSign,
  }, tokenOrErr);
  return forwardToStreamBridge(c, "/sse", null, tokenOrErr, {
    method: "GET",
    headers: { accept: "text/event-stream" },
  });
});

app.post("/v1/stream/alerts/poll", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const body = (await c.req.json()) as { sessionToken?: string; since?: string; limit?: number };
  const tokenOrErr = requireStreamSessionToken(body?.sessionToken ?? null);
  if (typeof tokenOrErr !== "string") return tokenOrErr;
  return forwardToStreamBridge(c, "/poll", { since: body.since, limit: body.limit, channel: "alerts" }, tokenOrErr);
});

app.post("/v1/stream/news/poll", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const body = (await c.req.json()) as { sessionToken?: string; since?: string; limit?: number };
  const tokenOrErr = requireStreamSessionToken(body?.sessionToken ?? null);
  if (typeof tokenOrErr !== "string") return tokenOrErr;
  return forwardToStreamBridge(c, "/poll", { since: body.since, limit: body.limit, channel: "news" }, tokenOrErr);
});

// === Slice F: local-watchlist real-time streaming (tradingview-1nt) ==
const QUOTE_STREAM_INTERNAL_URL = "https://quote-stream.internal";

const getQuoteStreamStub = (env: CloudflareBindings, streamId: string) => {
  const ns = (env as any).QUOTE_STREAM as {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  };
  return ns.get(ns.idFromName(streamId));
};

const generateStreamId = () =>
  `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

app.post("/v1/quotes/stream/subscribe", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      symbols?: string[];
      fields?: string[];
      includeMinuteBars?: boolean;
      timeframe?: string | number;
      sessionId?: string;
      sessionSign?: string;
      endpoint?: string;
    };
    if (!Array.isArray(body?.symbols) || body.symbols.length === 0) {
      return c.json({ error: "symbols (non-empty array) required" }, 400);
    }
    if (body.symbols.length > QS_MAX_SYMBOLS_DEFAULT) {
      return c.json(
        {
          error: "max_symbols_exceeded",
          limit: QS_MAX_SYMBOLS_DEFAULT,
          requested: body.symbols.length,
        },
        400,
      );
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    if (!session.sessionId) {
      return c.json({ error: "admin session required" }, 401);
    }
    const hmacClient = (c.env as any).HMAC_CLIENT_ID as string;
    const streamId = generateStreamId();
    const reg = await registerStream({
      kv: c.env.CACHE_META,
      hmacClient,
      streamId,
    });
    if (!reg.ok) {
      return c.json(
        {
          error: "quota_exceeded",
          limit: reg.limit,
          active: reg.active,
        },
        429,
      );
    }
    const stub = getQuoteStreamStub(c.env, streamId);
    const initResp = await stub.fetch(`${QUOTE_STREAM_INTERNAL_URL}/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        streamId,
        hmacClient,
        symbols: body.symbols,
        fields: body.fields,
        includeMinuteBars: !!body.includeMinuteBars,
        timeframe: body.timeframe,
        sessionId: session.sessionId,
        sessionSign: session.sessionSign,
        endpoint: body.endpoint,
      }),
    });
    if (!initResp.ok) {
      await releaseStream(c.env.CACHE_META, streamId);
      const initBody = await initResp.json().catch(() => ({}));
      if (initResp.status === 401) {
        await markAuthFailure(c.env.CACHE_META);
      }
      return c.json(initBody, initResp.status as any);
    }
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    const initBody = (await initResp.json()) as Record<string, unknown>;
    return c.json({ ...initBody, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "quote stream subscribe failed");
  }
});

app.get("/v1/quotes/stream/:id/sse", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const streamId = c.req.param("id");
  const entry = await lookupStream(c.env.CACHE_META, streamId);
  if (!entry) return c.json({ error: "stream not found" }, 404);
  await touchStream(c.env.CACHE_META, streamId);
  const stub = getQuoteStreamStub(c.env, streamId);
  const lastEventId = c.req.header("last-event-id");
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (lastEventId) headers["last-event-id"] = lastEventId;
  const resp = await stub.fetch(`${QUOTE_STREAM_INTERNAL_URL}/sse`, {
    method: "GET",
    headers,
  });
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
});

app.post("/v1/quotes/stream/:id/update", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const streamId = c.req.param("id");
  const entry = await lookupStream(c.env.CACHE_META, streamId);
  if (!entry) return c.json({ error: "stream not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    add?: string[];
    remove?: string[];
  };
  await touchStream(c.env.CACHE_META, streamId);
  const stub = getQuoteStreamStub(c.env, streamId);
  const resp = await stub.fetch(`${QUOTE_STREAM_INTERNAL_URL}/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
});

app.post("/v1/quotes/stream/:id/close", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const streamId = c.req.param("id");
  const stub = getQuoteStreamStub(c.env, streamId);
  const resp = await stub.fetch(`${QUOTE_STREAM_INTERNAL_URL}/close`, { method: "POST" });
  await releaseStream(c.env.CACHE_META, streamId);
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
});

app.get("/v1/quotes/stream/active", async (c) => {
  const authResp = await verifyHmacAuth(c);
  if (authResp) return authResp;
  const hmacClient = (c.env as any).HMAC_CLIENT_ID as string;
  const reg = await c.env.CACHE_META.get<Record<string, { hmacClient: string; registeredAt: number; lastSeen: number }>>(
    "quotes:active-streams",
    { type: "json" },
  );
  const all = reg ?? {};
  const active = countActiveForClient(all, hmacClient);
  const entries = Object.entries(all)
    .filter(([, v]) => v.hmacClient === hmacClient)
    .map(([streamId, v]) => ({ streamId, registeredAt: v.registeredAt, lastSeen: v.lastSeen }));
  return c.json({ active, limit: MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT, streams: entries });
});

// === P19 line-tools (tradingview-34p) ================================
app.post("/v1/line-tools/tools", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    return c.json({ result: listLineTools() });
  } catch (err: any) {
    return routeError(c, err, "line-tools tools failed");
  }
});

app.post("/v1/line-tools/templates/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool) return c.json({ error: "tool required" }, 400);
    if (!isDrawingTool(body.tool)) return c.json({ error: `unknown drawing tool: ${body.tool}` }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listLineToolTemplates(r.ctx, body.tool);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "line-tools templates list failed");
  }
});

app.post("/v1/line-tools/templates/load", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      templateName: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool || !body?.templateName) {
      return c.json({ error: "tool and templateName required" }, 400);
    }
    if (!isDrawingTool(body.tool)) return c.json({ error: `unknown drawing tool: ${body.tool}` }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await loadLineToolTemplate(r.ctx, body.tool, body.templateName);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "line-tools template load failed");
  }
});

app.post("/v1/line-tools/templates/save", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      name: string;
      content: any;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool || !body?.name) return c.json({ error: "tool and name required" }, 400);
    if (!isDrawingTool(body.tool)) return c.json({ error: `unknown drawing tool: ${body.tool}` }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await saveLineToolTemplate(r.ctx, {
      tool: body.tool,
      name: body.name,
      content: body.content,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "line-tools template save failed");
  }
});

app.post("/v1/line-tools/templates/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      tool: string;
      name: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.tool || !body?.name) return c.json({ error: "tool and name required" }, 400);
    if (!isDrawingTool(body.tool)) return c.json({ error: `unknown drawing tool: ${body.tool}` }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteLineToolTemplate(r.ctx, body.tool, body.name);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "line-tools template delete failed");
  }
});

// === P20 www.tradingview.com REST surfaces (tradingview-lol) =========
app.post("/v1/symbol/resolve", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      q: string;
      hl?: boolean;
      exchange?: string;
      type?: string;
      lang?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.q) return c.json({ error: "q required" }, 400);
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await wwwResolveSymbol({
      q: body.q,
      hl: body.hl,
      exchange: body.exchange,
      type: body.type,
      lang: body.lang,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "symbol resolve failed");
  }
});

app.post("/v1/symbol/resolve-batch", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      queries: Array<string | { q: string; hl?: boolean; exchange?: string }>;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!Array.isArray(body?.queries) || body.queries.length === 0) {
      return c.json({ error: "queries array required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await resolveSymbolBatch(
      { sessionId: session.sessionId, sessionSign: session.sessionSign },
      body.queries,
    );
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "symbol resolve-batch failed");
  }
});

app.post("/v1/study-templates/standard", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await listStudyTemplatesStandard({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "study-templates standard failed");
  }
});

app.post("/v1/ideas/feed", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      symbol?: string;
      sort?: "recent" | "popular";
      offset?: number;
      count?: number;
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getIdeasFeed({
      symbol: body.symbol,
      sort: body.sort,
      offset: body.offset,
      count: body.count,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "ideas feed failed");
  }
});

app.post("/v1/social/tweet", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as { id: string };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const result = await getTweetData(body.id);
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "tweet data failed");
  }
});

app.post("/v1/chats/public", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      limit?: number;
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getPublicChats(
      { sessionId: session.sessionId, sessionSign: session.sessionSign },
      body.limit,
    );
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "chats public failed");
  }
});

app.post("/v1/chats/dm", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      limit?: number;
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    if (!session.sessionId) {
      return c.json({ error: "sessionId required (DM list is admin-only)" }, 400);
    }
    const result = await getDmChats(
      { sessionId: session.sessionId, sessionSign: session.sessionSign },
      body.limit,
    );
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "chats dm failed");
  }
});

app.post("/v1/conversation-status", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      room_id: string | number;
      offset?: number;
      stat_symbol?: string;
      stat_interval?: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.room_id == null || body.room_id === "") {
      return c.json({ error: "room_id required" }, 400);
    }
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getConversationStatus({
      room_id: body.room_id,
      offset: body.offset,
      stat_symbol: body.stat_symbol,
      stat_interval: body.stat_interval,
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "conversation status failed");
  }
});

app.post("/v1/financial/fundamentals-config", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      forceRefresh?: boolean;
      cacheTtlSeconds?: number;
    };
    const result = await getFundamentalsConfig({
      cache: c.env.CACHE_META,
      cacheTtlSeconds: body.cacheTtlSeconds,
      forceRefresh: body.forceRefresh,
    });
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "fundamentals-config failed");
  }
});

app.post("/v1/support/i18n", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      language?: string;
      forceRefresh?: boolean;
      cacheTtlSeconds?: number;
    };
    const result = await getSupportI18n({
      language: body.language,
      cache: c.env.CACHE_META,
      cacheTtlSeconds: body.cacheTtlSeconds,
      forceRefresh: body.forceRefresh,
    });
    return c.json({ result });
  } catch (err: any) {
    return routeError(c, err, "support i18n failed");
  }
});

app.post("/v1/brokers/trading-panel", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    const result = await getBrokerPanel({
      sessionId: session.sessionId,
      sessionSign: session.sessionSign,
    });
    if (session.sessionId) await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "brokers trading-panel failed");
  }
});

app.post("/v1/user/profile", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      update?: boolean;
      fields?: Record<string, string>;
      sessionId?: string;
      sessionSign?: string;
    };
    const session = await resolveSession(c.env.CACHE_META, {
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
    });
    if (!session.sessionId) return c.json({ error: "sessionId required" }, 400);
    const result = body.update
      ? await wwwUpdateUserProfile({
          ctx: { sessionId: session.sessionId, sessionSign: session.sessionSign },
          fields: body.fields ?? {},
        })
      : await wwwGetUserProfile({
          sessionId: session.sessionId,
          sessionSign: session.sessionSign,
        });
    await markStoredSessionSuccess(c.env.CACHE_META, session);
    return c.json({ result, authSource: session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "user profile failed");
  }
});

// === P21 user-prefs / TVSettings (tradingview-c7d) ===================
app.post("/v1/user-prefs/favorites/indicators/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listFavoriteIndicators(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "favorite-indicators list failed");
  }
});

app.post("/v1/user-prefs/favorites/indicators/add", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await addFavoriteIndicator(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "favorite-indicators add failed");
  }
});

app.post("/v1/user-prefs/favorites/indicators/remove", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await removeFavoriteIndicator(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "favorite-indicators remove failed");
  }
});

app.post("/v1/user-prefs/favorites/drawings/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listFavoriteDrawings(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "favorite-drawings list failed");
  }
});

app.post("/v1/user-prefs/favorites/drawings/add", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await addFavoriteDrawing(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "favorite-drawings add failed");
  }
});

app.post("/v1/user-prefs/favorites/drawings/remove", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.id) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await removeFavoriteDrawing(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "favorite-drawings remove failed");
  }
});

app.post("/v1/user-prefs/recents/study-templates/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listRecentStudyTemplates(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "recents list failed");
  }
});

app.post("/v1/user-prefs/recents/study-templates/add", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      id: string | number;
      sessionId?: string;
      sessionSign?: string;
    };
    if (body?.id == null) return c.json({ error: "id required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await addRecentStudyTemplate(r.ctx, body.id);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "recents add failed");
  }
});

app.post("/v1/user-prefs/saved-screens/list", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await listSavedScreens(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "saved-screens list failed");
  }
});

app.post("/v1/user-prefs/saved-screens/save", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      name: string;
      market?: string;
      columns?: string[];
      filter?: any;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.name) return c.json({ error: "name required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await saveScreen(r.ctx, {
      name: body.name,
      market: body.market,
      columns: body.columns,
      filter: body.filter,
    });
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "saved-screens save failed");
  }
});

app.post("/v1/user-prefs/saved-screens/delete", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json()) as {
      name: string;
      sessionId?: string;
      sessionSign?: string;
    };
    if (!body?.name) return c.json({ error: "name required" }, 400);
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await deleteSavedScreen(r.ctx, body.name);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "saved-screens delete failed");
  }
});

app.post("/v1/user-prefs/raw", async (c) => {
  try {
    const authResp = await verifyHmacAuth(c);
    if (authResp) return authResp;
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string;
      sessionSign?: string;
    };
    const r = await requireTemplateCtx(c, body);
    if ("error" in r) return r.error;
    const result = await getRawPrefs(r.ctx);
    await markStoredSessionSuccess(c.env.CACHE_META, r.session);
    return c.json({ result, authSource: r.session.source });
  } catch (err: any) {
    if (isAuthError(err)) await markAuthFailure(c.env.CACHE_META);
    return routeError(c, err, "user-prefs raw failed");
  }
});

// Module-level marker to retain ws-verbs/ws-events imports after tree-shaking.
// P17 stateless route surface deferred (see tradingview-aau): chart-session DO
// sub-routes (/quality, /timezone, /series/*, /pointset/*, etc.) not yet wired,
// so live HTTP routes would 404. The wsVerbs/wsEvents helpers remain exported
// for unit tests and direct import by future DO sub-route handlers.
export const __ws_protocol_module_handle = { wsVerbs, wsEvents } as const;

export default app;
export { FetchCoordinator };
export { ChartSession } from "./chart-session-do";
export { StreamBridge } from "./stream-do";
export { BacktestJob } from "./backtest-job-do";
export { QuoteStream } from "./quote-stream-do";

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
