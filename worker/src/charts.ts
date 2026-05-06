// Chart layouts + chart-token JWT (P11)
// Surfaces:
//   - https://www.tradingview.com/my-charts/        (cookie auth, returns Layout[])
//   - https://www.tradingview.com/chart-token/      (cookie auth, mints RS512 JWT)
//   - https://charts-storage.tradingview.com/charts-storage/{get,save,remove,copy,move}/...
//
// Token caching: Worker mints chart-tokens server-side per (userId,layoutId) pair.
//   KV key  : `chart-token:${userId}:${layoutId}`  (in CACHE_META)
//   Value   : { token, iat, exp, type, layoutId, ownerId, shared, cachedAt }
//   TTL     : (exp - iat - 60s) clamped to >=60s; 401/403 from charts-storage
//             invalidates the cache and triggers a single re-mint.
//   Tokens are NEVER exposed to clients; charts.ts is a server-only mediator.
//
// charts-storage upstream envelope is `{success:bool, payload:any, error?:string}`.
// On non-2xx, throw. On 401/403, the caller (mintChartToken consumers) re-mints
// once via the `refreshOnAuth` helper.
//
// chart_id observed in HAR: "1" (numeric tab) and "_shared" (shared sources).
// includeOwnerSource=1 used on shared loads.

const TV_WWW = "https://www.tradingview.com";
const CHARTS_STORAGE = "https://charts-storage.tradingview.com";

const cookieHeader = (sessionId: string, sessionSign?: string): Record<string, string> => ({
  cookie: sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`,
});

export interface ChartCallContext {
  sessionId: string;
  sessionSign?: string;
}

export interface MintContext extends ChartCallContext {
  userId: string | number;
  kv: KVNamespace;
}

export interface ChartTokenRecord {
  token: string;
  iat: number;
  exp: number;
  type: string;
  layoutId: string;
  ownerId: number;
  shared: boolean;
  cachedAt: number;
}

const TOKEN_KEY_PREFIX = "chart-token:";
const MIN_KV_TTL_SECONDS = 60;

const tokenKvKey = (userId: string | number, layoutId: string) =>
  `${TOKEN_KEY_PREFIX}${userId}:${layoutId}`;

// base64url decode for JWT payload inspection. Returns the decoded JSON object,
// or throws "malformed jwt" if either segmenting or JSON parse fails.
const decodeJwtPayload = (token: string): Record<string, any> => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed jwt: expected 3 segments");
  const segment = parts[1];
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  let json: string;
  try {
    json = atob(base64);
  } catch {
    throw new Error("malformed jwt: invalid base64");
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("malformed jwt: invalid claims json");
  }
};

const readJsonOrThrow = async (resp: Response, route: string): Promise<any> => {
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

// ---------- Token mint + cache ----------

const fetchChartTokenFromUpstream = async (
  ctx: ChartCallContext,
  userId: string | number,
  layoutId: string,
): Promise<ChartTokenRecord> => {
  const url = `${TV_WWW}/chart-token/?image_url=${encodeURIComponent(layoutId)}&user_id=${encodeURIComponent(String(userId))}`;
  const resp = await fetch(url, { headers: cookieHeader(ctx.sessionId, ctx.sessionSign) });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `chart-token mint failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  const data: any = await resp.json();
  const token: string | undefined = data?.token;
  if (!token || typeof token !== "string") {
    throw new Error("chart-token mint: upstream returned no token");
  }
  const claims = decodeJwtPayload(token);
  const iat = Number(claims.iat);
  const exp = Number(claims.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat) {
    throw new Error("malformed jwt: missing or invalid iat/exp");
  }
  return {
    token,
    iat,
    exp,
    type: String(claims.type ?? ""),
    layoutId: String(claims.layoutId ?? layoutId),
    ownerId: Number(claims.ownerId ?? 0),
    shared: Boolean(claims.shared),
    cachedAt: Math.floor(Date.now() / 1000),
  };
};

export const mintChartToken = async (
  ctx: MintContext,
  layoutId: string,
  opts: { force?: boolean } = {},
): Promise<ChartTokenRecord> => {
  if (!layoutId) throw new Error("layoutId required");
  const key = tokenKvKey(ctx.userId, layoutId);

  if (!opts.force) {
    const cached = await ctx.kv.get<ChartTokenRecord>(key, { type: "json" });
    if (cached && cached.token && cached.exp - 60 > Math.floor(Date.now() / 1000)) {
      return cached;
    }
  }

  const fresh = await fetchChartTokenFromUpstream(ctx, ctx.userId, layoutId);
  // KV TTL = (exp - iat - 60s); clamp to MIN_KV_TTL_SECONDS so KV does not reject.
  const ttl = Math.max(MIN_KV_TTL_SECONDS, fresh.exp - fresh.iat - 60);
  await ctx.kv.put(key, JSON.stringify(fresh), { expirationTtl: ttl });
  return fresh;
};

export const invalidateChartToken = async (
  kv: KVNamespace,
  userId: string | number,
  layoutId: string,
): Promise<void> => {
  await kv.delete(tokenKvKey(userId, layoutId));
};

// Run an upstream charts-storage call with a fresh token, retrying once on 401/403
// by invalidating the KV cache and re-minting. The callback receives the JWT
// string and must produce a fully-formed Response. We surface non-401/403 errors
// straight through.
const withTokenRefresh = async <T>(
  ctx: MintContext,
  layoutId: string,
  call: (token: string) => Promise<Response>,
): Promise<{ resp: Response; data: T }> => {
  let record = await mintChartToken(ctx, layoutId);
  let resp = await call(record.token);
  if (resp.status === 401 || resp.status === 403) {
    await invalidateChartToken(ctx.kv, ctx.userId, layoutId);
    record = await mintChartToken(ctx, layoutId, { force: true });
    resp = await call(record.token);
  }
  const data = (await readJsonOrThrow(resp, "charts-storage")) as T;
  return { resp, data };
};

// ---------- /my-charts/ ----------

export interface MyChartsRow {
  id: number | string;
  image_url: string;
  symbol: string;
  short_name?: string;
  name?: string;
  resolution?: string;
  pro_symbol?: string;
  expression?: string;
  created?: string;
  modified?: string;
  created_timestamp?: number;
  modified_iso?: string;
  interval?: string;
  url?: string;
  favorite?: boolean;
}

export const listCharts = async (ctx: ChartCallContext): Promise<MyChartsRow[]> => {
  const resp = await fetch(`${TV_WWW}/my-charts/`, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  const data = await readJsonOrThrow(resp, "GET /my-charts/");
  // Upstream returns a bare array.
  if (Array.isArray(data)) return data as MyChartsRow[];
  if (Array.isArray((data as any)?.results)) return (data as any).results as MyChartsRow[];
  return [];
};

// ---------- charts-storage layout ops ----------

interface LayoutQuery {
  layoutId: string;
  chartId?: string | number;
  symbol?: string;
  includeOwnerSource?: boolean;
}

const buildLayoutQuery = (
  jwt: string,
  q: LayoutQuery,
  extras: Record<string, string | number | undefined> = {},
): string => {
  const params = new URLSearchParams();
  params.set("layout_id", q.layoutId);
  if (q.chartId !== undefined && q.chartId !== null && q.chartId !== "") {
    params.set("chart_id", String(q.chartId));
  }
  if (q.symbol) params.set("symbol", q.symbol);
  if (q.includeOwnerSource) params.set("includeOwnerSource", "1");
  for (const [k, v] of Object.entries(extras)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  params.set("jwt", jwt);
  return params.toString();
};

export interface LayoutResponse {
  success: boolean;
  payload?: any;
  error?: string;
}

export const getLayout = async (
  ctx: MintContext,
  q: { layoutId: string; chartId?: string | number; symbol?: string; includeOwnerSource?: boolean },
): Promise<LayoutResponse> => {
  if (!q.layoutId) throw new Error("layoutId required");
  const { data } = await withTokenRefresh<LayoutResponse>(ctx, q.layoutId, (token) => {
    const qs = buildLayoutQuery(token, q);
    return fetch(
      `${CHARTS_STORAGE}/charts-storage/get/layout/${encodeURIComponent(q.layoutId)}/sources?${qs}`,
    );
  });
  return data;
};

export const getUserSources = async (
  ctx: MintContext,
  q: { layoutId: string; symbol?: string },
): Promise<LayoutResponse> => {
  if (!q.layoutId) throw new Error("layoutId required");
  const { data } = await withTokenRefresh<LayoutResponse>(ctx, q.layoutId, (token) => {
    const qs = buildLayoutQuery(token, { layoutId: q.layoutId, symbol: q.symbol });
    return fetch(`${CHARTS_STORAGE}/charts-storage/get/user/sources?${qs}`);
  });
  return data;
};

export interface SaveLayoutBody {
  layoutId: string;
  chartId?: string | number;
  content: any; // sources object or pre-stringified JSON
  name?: string;
  symbol?: string;
  resolution?: string;
}

export const saveLayout = async (
  ctx: MintContext,
  body: SaveLayoutBody,
): Promise<LayoutResponse> => {
  if (!body?.layoutId) throw new Error("layoutId required");
  if (body.content === undefined || body.content === null) {
    throw new Error("content required");
  }
  const form = new FormData();
  form.set(
    "content",
    typeof body.content === "string" ? body.content : JSON.stringify(body.content),
  );
  if (body.name) form.set("name", body.name);
  if (body.symbol) form.set("symbol", body.symbol);
  if (body.resolution) form.set("resolution", body.resolution);
  const { data } = await withTokenRefresh<LayoutResponse>(ctx, body.layoutId, (token) => {
    const qs = buildLayoutQuery(token, {
      layoutId: body.layoutId,
      chartId: body.chartId,
      symbol: body.symbol,
    });
    return fetch(
      `${CHARTS_STORAGE}/charts-storage/save/layout/${encodeURIComponent(body.layoutId)}/sources?${qs}`,
      { method: "POST", body: form },
    );
  });
  return data;
};

export const deleteLayout = async (
  ctx: MintContext,
  body: { layoutId: string; chartId?: string | number },
): Promise<LayoutResponse> => {
  if (!body?.layoutId) throw new Error("layoutId required");
  const { data } = await withTokenRefresh<LayoutResponse>(ctx, body.layoutId, (token) => {
    const qs = buildLayoutQuery(token, { layoutId: body.layoutId, chartId: body.chartId });
    return fetch(
      `${CHARTS_STORAGE}/charts-storage/remove/layout/${encodeURIComponent(body.layoutId)}/sources?${qs}`,
      { method: "POST" },
    );
  });
  return data;
};

export const copyLayout = async (
  ctx: MintContext,
  body: { fromLayout: string; toLayout: string; chartId?: string | number },
): Promise<LayoutResponse> => {
  if (!body?.fromLayout || !body?.toLayout) {
    throw new Error("fromLayout and toLayout required");
  }
  // Token must be minted for the source layout (the one we are reading sources
  // out of); the destination layoutId is encoded in the path / form. Lead — the
  // upstream isn't in the captured HAR; we follow the parallel save/get shape.
  const form = new FormData();
  form.set("to_layout_id", body.toLayout);
  if (body.chartId !== undefined) form.set("chart_id", String(body.chartId));
  const { data } = await withTokenRefresh<LayoutResponse>(ctx, body.fromLayout, (token) => {
    const qs = buildLayoutQuery(token, { layoutId: body.fromLayout, chartId: body.chartId });
    return fetch(
      `${CHARTS_STORAGE}/charts-storage/copy/layout/${encodeURIComponent(body.fromLayout)}/sources?${qs}`,
      { method: "POST", body: form },
    );
  });
  return data;
};

export const moveLayout = async (
  ctx: MintContext,
  body: { fromLayout: string; toLayout: string; chartId?: string | number },
): Promise<LayoutResponse> => {
  if (!body?.fromLayout || !body?.toLayout) {
    throw new Error("fromLayout and toLayout required");
  }
  const form = new FormData();
  form.set("to_layout_id", body.toLayout);
  if (body.chartId !== undefined) form.set("chart_id", String(body.chartId));
  const { data } = await withTokenRefresh<LayoutResponse>(ctx, body.fromLayout, (token) => {
    const qs = buildLayoutQuery(token, { layoutId: body.fromLayout, chartId: body.chartId });
    return fetch(
      `${CHARTS_STORAGE}/charts-storage/move/layout/${encodeURIComponent(body.fromLayout)}/sources?${qs}`,
      { method: "POST", body: form },
    );
  });
  return data;
};

// Internal helpers exported for test inspection.
export const __test = { decodeJwtPayload, tokenKvKey };
