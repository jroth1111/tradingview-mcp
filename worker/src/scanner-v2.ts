// Scanner v2 + screener catalog (P15)
//
// Hosts:
//   - scanner.tradingview.com         primary screener engine ({market}/scan2,
//                                     {market}/metainfo, /symbol, /enum/ordered)
//   - scanner-backend.tradingview.com  product-specific ordered enums
//                                     (metrics, metrics_full_name)
//   - screener-facade.tradingview.com  versioned column catalog
//
// All passthroughs are unauthenticated upstream — no session cookie required;
// HMAC auth is enforced at the Worker boundary by the caller. Aggressively
// cache metainfo / enum / column-catalog responses (24h) keyed by
// (host, path, query) into CACHE_META KV.
//
// Source map: /tmp/tv-recon/agents/04-scanner.md §2 + §9.

const SCANNER_HOST = "https://scanner.tradingview.com";
const SCANNER_BACKEND_HOST = "https://scanner-backend.tradingview.com";
const SCREENER_FACADE_HOST = "https://screener-facade.tradingview.com";

const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h

// Markets enum returned by GET /v1/screener/markets. Static list compiled from
// HAR observations + per-country routes documented in the TradingView screener
// UI; keep alphabetised within groups so the response is stable.
export const SCREENER_MARKETS = [
  // global / cross-asset
  "america",
  "australia",
  "bond",
  "coin",
  "global",
  "options",
  "crypto",
  "forex",
  "cfd",
  "futures",
  "economics2",
  // per-country (regional screeners)
  "brazil",
  "india",
  "japan",
  "korea",
  "hong_kong",
  "switzerland",
  "italy",
  "france",
  "germany",
  "spain",
  "uk",
  "taiwan",
  "mexico",
  "canada",
  "sweden",
  "denmark",
  "norway",
  "poland",
] as const;

export type MarketEnum = (typeof SCREENER_MARKETS)[number];

// Ordered-enum ids that live on scanner-backend.tradingview.com instead of
// scanner.tradingview.com. The HAR pinned only `metrics` / `metrics_full_name`
// here; everything else (sector, industry, country, exchange, currency_id,
// analyst_rating, technical_rating, cfi_code, etc.) routes to scanner.tv.
const BACKEND_ENUM_IDS = new Set<string>(["metrics", "metrics_full_name"]);

// Filter operations exposed in passthrough. Only the `operation` field on a
// filter / filter2 expression is whitelisted — the {left,right} payload is
// passed verbatim. This is documentation + a runtime guard against typos.
export const FILTER_OPERATIONS = [
  "equal",
  "nequal",
  "in_range",
  "greater",
  "less",
  "has",
  "has_none_of",
  "nempty",
  "match",
  "nmatch",
  "egreater",
  "eless",
  "crosses",
  "crosses_above",
  "crosses_below",
  "above%",
  "below%",
  "in_day_range",
  "not_in_range",
] as const;

export type Filter2Operation = (typeof FILTER_OPERATIONS)[number];

// ---------- Types ----------

export interface FilterExpression {
  left: string;
  operation: Filter2Operation | string;
  right: unknown;
}

export interface Filter2ExpressionNode {
  expression: FilterExpression;
}

export interface Filter2OperationNode {
  operation: {
    operator: "and" | "or";
    operands: Filter2Node[];
  };
}

export type Filter2Node = Filter2ExpressionNode | Filter2OperationNode;

export interface Filter2 {
  operator: "and" | "or";
  operands: Filter2Node[];
}

export interface ScanSort {
  sortBy: string;
  sortOrder?: "asc" | "desc";
  // Some upstream calls pass nullsFirst; preserve verbatim.
  nullsFirst?: boolean;
}

export interface ScanSymbolsBlock {
  tickers?: string[];
  query?: { types?: string[] };
  symbolset?: string[];
  // Watchlist refs / index refs surface here as well — pass through.
  [k: string]: unknown;
}

export interface Scan2Request {
  market: string;
  columns: string[];
  filter?: FilterExpression[];
  filter2?: Filter2;
  sort?: ScanSort;
  range?: [number, number];
  markets?: string[];
  columnsets?: string[];
  currency?: string;
  preset?: string;
  index_filters?: Array<{ name: string; values: string[] }>;
  symbols?: ScanSymbolsBlock;
  ignore_unknown_fields?: boolean;
  options?: { lang?: string; [k: string]: unknown };
  labelProduct?: string;
}

export interface Scan2DataRow {
  s: string; // symbol id e.g. "NASDAQ:AAPL"
  d: unknown[]; // column-aligned values
}

export interface Scan2Response {
  totalCount: number;
  data: Scan2DataRow[];
  params?: Record<string, unknown>;
  // scan2 sometimes echoes a cursor / scrollId for paged scans.
  cursor?: string;
  scrollId?: string;
}

export interface ScreenerMetainfoField {
  n: string; // name
  t: string; // type
  // Upstream sometimes returns `r` (range/options) and `id`/`tooltip`.
  [k: string]: unknown;
}

export interface ScreenerMetainfo {
  fields: ScreenerMetainfoField[];
  // Upstream may include `index_filters`, `presets`, `columnsets`, etc.
  [k: string]: unknown;
}

export interface OrderedEnumValue {
  id: string;
  name: string;
  options?: Record<string, unknown>;
}

export type OrderedEnum = Record<string, OrderedEnumValue[]>;

export interface ColumnCatalogEntry {
  name: string;
  title?: string;
  description?: string;
  type?: string;
  format?: string;
  // Upstream blob is large and shape-fluid; preserve verbatim.
  [k: string]: unknown;
}

export interface ColumnCatalog {
  version: string;
  columns: ColumnCatalogEntry[];
  // Upstream may also include `presets`, `columnsets`, `groups`.
  [k: string]: unknown;
}

// ---------- Internals ----------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const validateFilter2Node = (node: unknown, depth = 0): void => {
  if (depth > 16) throw new Error("filter2 nesting depth exceeded");
  if (!isPlainObject(node)) throw new Error("filter2 operand must be an object");

  if ("expression" in node) {
    const expr = (node as unknown as Filter2ExpressionNode).expression;
    if (!isPlainObject(expr)) throw new Error("filter2 expression must be an object");
    if (typeof expr.left !== "string" || !expr.left) {
      throw new Error("filter2 expression.left must be a non-empty string");
    }
    if (typeof expr.operation !== "string" || !expr.operation) {
      throw new Error("filter2 expression.operation must be a non-empty string");
    }
    return;
  }

  if ("operation" in node) {
    const op = (node as unknown as Filter2OperationNode).operation;
    if (!isPlainObject(op)) throw new Error("filter2 operation must be an object");
    if (op.operator !== "and" && op.operator !== "or") {
      throw new Error('filter2 operator must be "and" or "or"');
    }
    if (!Array.isArray(op.operands) || op.operands.length === 0) {
      throw new Error("filter2 operands must be a non-empty array");
    }
    for (const child of op.operands) validateFilter2Node(child, depth + 1);
    return;
  }

  throw new Error("filter2 operand must contain `expression` or `operation`");
};

const validateFilter2 = (filter2: Filter2): void => {
  if (!isPlainObject(filter2)) throw new Error("filter2 must be an object");
  if (filter2.operator !== "and" && filter2.operator !== "or") {
    throw new Error('filter2.operator must be "and" or "or"');
  }
  if (!Array.isArray(filter2.operands) || filter2.operands.length === 0) {
    throw new Error("filter2.operands must be a non-empty array");
  }
  for (const node of filter2.operands) validateFilter2Node(node, 1);
};

const cacheKey = (host: string, path: string, query: string): string =>
  `screener:${host}:${path}:${query}`;

const readJson = async (resp: Response, route: string): Promise<unknown> => {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`,
    );
  }
  return resp.json();
};

const cachedFetch = async <T>(
  cache: KVNamespace | undefined,
  host: string,
  path: string,
  query: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
): Promise<{ value: T; cached: boolean }> => {
  if (!cache) {
    const value = await fetcher();
    return { value, cached: false };
  }
  const key = cacheKey(host, path, query);
  const raw = await cache.get(key);
  if (raw) {
    try {
      return { value: JSON.parse(raw) as T, cached: true };
    } catch {
      // fall through and re-fetch on parse failure
    }
  }
  const value = await fetcher();
  await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  return { value, cached: false };
};

// ---------- Public API ----------

/**
 * POST scanner.tv/{market}/scan2 — full v2 envelope with filter / filter2 /
 * markets[] / columnsets / currency / preset / index_filters / symbols /
 * ignore_unknown_fields / options.
 */
export const scanV2 = async (req: Scan2Request): Promise<Scan2Response> => {
  if (!req.market) throw new Error("market required");
  if (!Array.isArray(req.columns) || req.columns.length === 0) {
    throw new Error("columns required");
  }
  if (req.filter2) validateFilter2(req.filter2);
  if (req.filter) {
    if (!Array.isArray(req.filter)) throw new Error("filter must be an array");
    for (const f of req.filter) {
      if (!isPlainObject(f) || typeof f.left !== "string" || typeof f.operation !== "string") {
        throw new Error("filter entries must be {left, operation, right}");
      }
    }
  }
  if (req.range) {
    if (
      !Array.isArray(req.range) ||
      req.range.length !== 2 ||
      typeof req.range[0] !== "number" ||
      typeof req.range[1] !== "number"
    ) {
      throw new Error("range must be [start, end] of numbers");
    }
  }

  const body: Record<string, unknown> = { columns: req.columns };
  if (req.filter !== undefined) body.filter = req.filter;
  if (req.filter2 !== undefined) body.filter2 = req.filter2;
  if (req.sort !== undefined) body.sort = req.sort;
  if (req.range !== undefined) body.range = req.range;
  if (req.markets !== undefined) body.markets = req.markets;
  if (req.columnsets !== undefined) body.columnsets = req.columnsets;
  if (req.currency !== undefined) body.currency = req.currency;
  if (req.preset !== undefined) body.preset = req.preset;
  if (req.index_filters !== undefined) body.index_filters = req.index_filters;
  if (req.symbols !== undefined) body.symbols = req.symbols;
  if (req.ignore_unknown_fields !== undefined) {
    body.ignore_unknown_fields = req.ignore_unknown_fields;
  }
  if (req.options !== undefined) body.options = req.options;

  const url = new URL(`${SCANNER_HOST}/${encodeURIComponent(req.market)}/scan2`);
  if (req.labelProduct) url.searchParams.set("label-product", req.labelProduct);

  const resp = await fetch(url.toString(), {
    method: "POST",
    // Upstream prefers text/plain for the scan2 body (HAR confirms scan/scan2
    // both use text/plain;charset=UTF-8). The body is still JSON-encoded.
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(body),
  });

  return (await readJson(resp, `POST /${req.market}/scan2`)) as Scan2Response;
};

/**
 * POST scanner.tv/{market}/metainfo — column dictionary for a market. Cached
 * 24h (the dictionary is stable across calls within a market/version).
 */
export const screenerMetainfo = async (
  market: string,
  opts: { labelProduct?: string; cache?: KVNamespace; cacheTtlSeconds?: number } = {},
): Promise<{ value: ScreenerMetainfo; cached: boolean }> => {
  if (!market) throw new Error("market required");

  const url = new URL(`${SCANNER_HOST}/${encodeURIComponent(market)}/metainfo`);
  if (opts.labelProduct) url.searchParams.set("label-product", opts.labelProduct);

  return cachedFetch<ScreenerMetainfo>(
    opts.cache,
    SCANNER_HOST,
    `/${market}/metainfo`,
    url.search,
    async () => {
      const resp = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: "{}",
      });
      return (await readJson(resp, `POST /${market}/metainfo`)) as ScreenerMetainfo;
    },
    opts.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
  );
};

/**
 * GET enum/ordered — taxonomy lookups. Routes to scanner.tv by default; ids
 * tied to product metrics (metrics, metrics_full_name) live on
 * scanner-backend.tv. When mixed-id requests arrive, the call is split per
 * host and merged.
 */
export const getOrderedEnum = async (
  ids: string[] | string,
  opts: {
    lang?: string;
    labelProduct?: string;
    cache?: KVNamespace;
    cacheTtlSeconds?: number;
  } = {},
): Promise<{ value: OrderedEnum; cached: boolean }> => {
  const idList = (Array.isArray(ids) ? ids : String(ids).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (idList.length === 0) throw new Error("ids required");

  const backendIds = idList.filter((id) => BACKEND_ENUM_IDS.has(id));
  const scannerIds = idList.filter((id) => !BACKEND_ENUM_IDS.has(id));

  const fetchHost = async (host: string, ids: string[]): Promise<OrderedEnum> => {
    const url = new URL(`${host}/enum/ordered`);
    url.searchParams.set("id", ids.join(","));
    if (opts.lang) url.searchParams.set("lang", opts.lang);
    if (opts.labelProduct) url.searchParams.set("label-product", opts.labelProduct);

    const path = "/enum/ordered";
    const { value, cached } = await cachedFetch<OrderedEnum>(
      opts.cache,
      host,
      path,
      url.search,
      async () => {
        const resp = await fetch(url.toString(), { method: "GET" });
        return (await readJson(resp, `GET ${host}${path}`)) as OrderedEnum;
      },
      opts.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
    );
    // surface cache hit upward via a sentinel on the closure
    (fetchHost as unknown as { __lastCached?: boolean }).__lastCached = cached;
    return value;
  };

  let allCached = true;
  const merged: OrderedEnum = {};

  if (scannerIds.length > 0) {
    const v = await fetchHost(SCANNER_HOST, scannerIds);
    Object.assign(merged, v);
    allCached =
      allCached && Boolean((fetchHost as unknown as { __lastCached?: boolean }).__lastCached);
  }
  if (backendIds.length > 0) {
    const v = await fetchHost(SCANNER_BACKEND_HOST, backendIds);
    Object.assign(merged, v);
    allCached =
      allCached && Boolean((fetchHost as unknown as { __lastCached?: boolean }).__lastCached);
  }

  return { value: merged, cached: allCached };
};

/**
 * GET screener-facade.tv/screener-facade/api/v1/columns?version= — versioned
 * column catalog. Cached 24h keyed by version.
 */
export const getColumnCatalog = async (
  version: string | number | undefined,
  opts: { cache?: KVNamespace; cacheTtlSeconds?: number } = {},
): Promise<{ value: ColumnCatalog; cached: boolean }> => {
  const url = new URL(`${SCREENER_FACADE_HOST}/screener-facade/api/v1/columns`);
  if (version !== undefined && version !== null && String(version).length > 0) {
    url.searchParams.set("version", String(version));
  }

  return cachedFetch<ColumnCatalog>(
    opts.cache,
    SCREENER_FACADE_HOST,
    "/screener-facade/api/v1/columns",
    url.search,
    async () => {
      const resp = await fetch(url.toString(), { method: "GET" });
      const body = (await readJson(resp, "GET /screener-facade/api/v1/columns")) as
        | ColumnCatalog
        | { columns?: ColumnCatalogEntry[]; [k: string]: unknown };
      // Normalise: ensure the `version` echoed back is preserved on the cached
      // object so callers can detect stale catalogs without re-decoding query.
      const resolvedVersion = String(
        version ?? (body as { version?: unknown }).version ?? "",
      );
      const resolvedColumns: ColumnCatalogEntry[] = Array.isArray(
        (body as { columns?: unknown }).columns,
      )
        ? ((body as { columns?: ColumnCatalogEntry[] }).columns as ColumnCatalogEntry[])
        : [];
      const normalised: ColumnCatalog = {
        ...body,
        version: resolvedVersion,
        columns: resolvedColumns,
      };
      return normalised;
    },
    opts.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS,
  );
};

/**
 * Static market list — no upstream call; the catalog is owned by the Worker
 * and exposed for client consumption.
 */
export const listMarkets = (): { markets: MarketEnum[] } => ({
  markets: [...SCREENER_MARKETS] as MarketEnum[],
});

/**
 * GET scanner.tv/symbol — single-symbol field fetch. The caller supplies the
 * exchange-prefixed symbol and the field list to project. `no_404=true` makes
 * the upstream return JSON nulls instead of a 404 for unresolved symbols.
 */
export const getSymbolFields = async (req: {
  symbol: string;
  fields: string[];
  no_404?: boolean;
  labelProduct?: string;
}): Promise<unknown> => {
  if (!req.symbol || !req.symbol.includes(":")) {
    throw new Error("symbol must include exchange prefix, e.g. NASDAQ:AAPL");
  }
  if (!Array.isArray(req.fields) || req.fields.length === 0) {
    throw new Error("fields required");
  }

  const url = new URL(`${SCANNER_HOST}/symbol`);
  url.searchParams.set("symbol", req.symbol.toUpperCase());
  url.searchParams.set("fields", req.fields.join(","));
  if (req.no_404) url.searchParams.set("no_404", "true");
  if (req.labelProduct) url.searchParams.set("label-product", req.labelProduct);

  const resp = await fetch(url.toString(), { method: "GET" });
  return readJson(resp, "GET /symbol");
};

// Internal exports for tests
export const __internals = {
  SCANNER_HOST,
  SCANNER_BACKEND_HOST,
  SCREENER_FACADE_HOST,
  BACKEND_ENUM_IDS,
  DEFAULT_CACHE_TTL_SECONDS,
  cacheKey,
  validateFilter2,
};
