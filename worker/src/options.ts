// Options surfaces (P14)
// Source: /tmp/tv-recon/agents/09-options.md
//
// Hosts:
//   - options-charting.tradingview.com  (IV term structure + volatility curve)
//   - scanner.tradingview.com            (options/global scan2 + options metainfo)
//
// Worker proxies admin session for entitlement-gated greek values (OPRA realtime).
// Unauth callers may receive null cells. The Worker exposes that cleanly rather than
// hiding it.
//
// Endpoint mapping (recon §2/§7):
//   GET  options-charting/v1/in-time-iv/{SYM}?label-product=details_widget_in_time_iv_chart
//        -> getInTimeIv (term structure)
//   GET  options-charting/v1/volatility-chart/{SYM};{ROOT};{EXPIRY}?xaxis=strikes|moneyness
//        -> getVolatilityChart (smile/skew). xaxis enum strict: only strikes|moneyness.
//   POST scanner/global/scan2?label-product=symbols-options
//        -> getExpiries / getStrikes / getOptionsChain / getGreeks
//           (chain via global/scan2+filter is the documented fallback because the
//            options/scan2 'index' payload shape is unknown without an authed HAR;
//            see recon §3 / §9 lead.)
//   POST scanner/options/scan2?label-product=symbols-options
//        -> scanOptions (advanced passthrough; documented index lead in residuals).
//   GET  scanner/options/metainfo?label-product=symbols-options
//        -> getOptionsMetainfo (71-field schema)

const OPTIONS_CHARTING = "https://options-charting.tradingview.com";
const SCANNER = "https://scanner.tradingview.com";

const LABEL_IV = "details_widget_in_time_iv_chart";
const LABEL_VOL = "details_widget_volatility_chart";
const LABEL_OPT = "symbols-options";

const cookieHeader = (sessionId?: string, sessionSign?: string): Record<string, string> => {
  if (!sessionId) return {};
  return {
    cookie: sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`,
  };
};

// === Types (mirrors packages/tradingview-core types; helper-local for now) ===

export interface IVTermSpan {
  value: number;
  unit: "d" | "w" | "m" | "y";
}

export interface IVTermPoint {
  span: IVTermSpan;
  value: number;
}

export interface VolatilityCurvePlot {
  optionSeriesId: string;
  plot: { y: Array<number | null> };
}

export interface VolatilityCurve {
  xAxis: Array<number | null>;
  plots: VolatilityCurvePlot[];
}

export interface OptionGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  iv: number | null;
}

export interface OptionContract {
  symbol: string | null;
  strike: number | null;
  expiration: string | null;
  type: "call" | "put" | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  iv: number | null;
  openInterest: number | null;
  theoreticalPrice: number | null;
  underlying: string | null;
}

export interface OptionsMetainfoField {
  name: string;
  type: string;
  [key: string]: any;
}

export interface OptionsMetainfo {
  fields: OptionsMetainfoField[];
  raw: any;
}

// === xaxis enum (strict allowlist) ===

export const VOLATILITY_XAXIS_VALUES = ["strikes", "moneyness"] as const;
export type VolatilityXAxis = (typeof VOLATILITY_XAXIS_VALUES)[number];

export class OptionsValidationError extends Error {
  constructor(public readonly field: string, public readonly value: string) {
    super(`invalid ${field}: ${value}`);
    this.name = "OptionsValidationError";
  }
}

const assertXAxis = (xaxis: string): VolatilityXAxis => {
  if ((VOLATILITY_XAXIS_VALUES as readonly string[]).includes(xaxis)) {
    return xaxis as VolatilityXAxis;
  }
  throw new OptionsValidationError("xaxis", xaxis);
};

// === Symbol parsing helpers ===

const splitExchangeRoot = (symbol: string): { root: string } => {
  const colon = symbol.indexOf(":");
  const root = colon >= 0 ? symbol.slice(colon + 1) : symbol;
  return { root };
};

// === HTTP helper ===

const readJson = async (resp: Response, route: string): Promise<any> => {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  return resp.json();
};

// === Standard scan2 column families (recon §3 / §4) ===

// Column ordering used to flatten f[] -> typed contract.
// Fixed order — must match request column order so f[i] aligns with COLS[i].
export const CHAIN_COLUMNS = [
  "name",
  "strike",
  "expiration",
  "option-type",
  "bid",
  "ask",
  "delta",
  "gamma",
  "theta",
  "vega",
  "rho",
  "iv",
  "open_interest",
  "theoretical_price",
  "root",
] as const;

const GREEKS_COLUMNS = [
  "name",
  "delta",
  "gamma",
  "theta",
  "vega",
  "rho",
  "iv",
] as const;

const EXPIRIES_COLUMNS = ["expiration"] as const;
const STRIKES_COLUMNS = ["strike", "option-type"] as const;

// === In-time IV (term structure) ===

export interface InTimeIvRequest {
  symbol: string;
  sessionId?: string;
  sessionSign?: string;
}

export const getInTimeIv = async (
  req: InTimeIvRequest,
): Promise<{ symbol: string; points: IVTermPoint[]; raw: any }> => {
  if (!req.symbol) throw new OptionsValidationError("symbol", "");
  const url = new URL(`${OPTIONS_CHARTING}/v1/in-time-iv/${encodeURIComponent(req.symbol)}`);
  url.searchParams.set("label-product", LABEL_IV);
  const resp = await fetch(url.toString(), {
    headers: cookieHeader(req.sessionId, req.sessionSign),
  });
  const data = await readJson(resp, "GET in-time-iv");
  const realIvs: any[] = Array.isArray(data?.["real-ivs"]) ? data["real-ivs"] : [];
  const points: IVTermPoint[] = realIvs
    .filter((p) => p && p.span && typeof p.span.value === "number" && p.span.unit)
    .map((p) => ({
      span: { value: Number(p.span.value), unit: p.span.unit as IVTermSpan["unit"] },
      value: typeof p.value === "number" ? p.value : Number(p.value) || 0,
    }));
  return { symbol: req.symbol, points, raw: data };
};

// === Volatility chart (smile/skew) ===

export interface VolatilityChartRequest {
  symbol: string;
  root?: string; // defaults to root portion of symbol
  expiry: string; // YYYYMMDD
  xaxis: string;
  sessionId?: string;
  sessionSign?: string;
}

export const getVolatilityChart = async (
  req: VolatilityChartRequest,
): Promise<{
  symbol: string;
  root: string;
  expiry: string;
  xaxis: VolatilityXAxis;
  curve: VolatilityCurve;
  raw: any;
}> => {
  if (!req.symbol) throw new OptionsValidationError("symbol", "");
  if (!req.expiry) throw new OptionsValidationError("expiry", "");
  const xaxis = assertXAxis(req.xaxis); // throws OptionsValidationError on bad enum
  const root = req.root || splitExchangeRoot(req.symbol).root;
  const path = `${encodeURIComponent(req.symbol)};${encodeURIComponent(root)};${encodeURIComponent(req.expiry)}`;
  const url = new URL(`${OPTIONS_CHARTING}/v1/volatility-chart/${path}`);
  url.searchParams.set("xaxis", xaxis);
  url.searchParams.set("label-product", LABEL_VOL);
  const resp = await fetch(url.toString(), {
    headers: cookieHeader(req.sessionId, req.sessionSign),
  });
  const data = await readJson(resp, "GET volatility-chart");
  const xAxisRaw = Array.isArray(data?.["x-axis"]?.x) ? data["x-axis"].x : [];
  const plots: VolatilityCurvePlot[] = Array.isArray(data?.plots)
    ? data.plots.map((p: any) => ({
        optionSeriesId: String(p?.optionSeriesId ?? ""),
        plot: { y: Array.isArray(p?.plot?.y) ? p.plot.y : [] },
      }))
    : [];
  return {
    symbol: req.symbol,
    root,
    expiry: req.expiry,
    xaxis,
    curve: { xAxis: xAxisRaw, plots },
    raw: data,
  };
};

// === scan2 wrapper ===

export type Scan2Path = "global/scan2" | "options/scan2";

export interface Scan2Body {
  filter?: any[];
  columns?: string[];
  range?: [number, number];
  sort?: { sortBy: string; sortOrder: "asc" | "desc" };
  markets?: string[];
  symbols?: { tickers?: string[]; query?: { types: string[] } };
  index?: any; // accepted for options/scan2 passthrough; recon lead.
  options?: { lang?: string };
  [k: string]: any;
}

export interface Scan2Response {
  totalCount?: number;
  data: Array<{ s: string; d: any[] }>;
  fields?: string[];
}

const callScan2 = async (
  path: Scan2Path,
  body: Scan2Body,
  sessionId?: string,
  sessionSign?: string,
): Promise<Scan2Response> => {
  const url = `${SCANNER}/${path}?label-product=${LABEL_OPT}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...cookieHeader(sessionId, sessionSign),
    },
    body: JSON.stringify({ options: { lang: "en" }, ...body }),
  });
  const data = await readJson(resp, `POST ${path}`);
  return {
    totalCount: data?.totalCount,
    data: Array.isArray(data?.data) ? data.data : [],
    fields: Array.isArray(data?.fields) ? data.fields : Array.isArray(body.columns) ? body.columns : [],
  };
};

const underlyingFilter = (symbol: string) => ({
  left: "underlying_symbol",
  operation: "equal",
  right: symbol,
});

const expirationFilter = (expiry: string) => ({
  left: "expiration",
  operation: "equal",
  right: expiry,
});

const optionTypeFilter = (type: "call" | "put") => ({
  left: "option-type",
  operation: "equal",
  right: type,
});

// === Expiries (distinct) ===

export interface ExpiriesRequest {
  symbol: string;
  sessionId?: string;
  sessionSign?: string;
  range?: [number, number];
}

export const getExpiries = async (
  req: ExpiriesRequest,
): Promise<{ symbol: string; expiries: string[]; count: number }> => {
  if (!req.symbol) throw new OptionsValidationError("symbol", "");
  const resp = await callScan2(
    "global/scan2",
    {
      filter: [underlyingFilter(req.symbol)],
      columns: [...EXPIRIES_COLUMNS],
      range: req.range || [0, 5000],
    },
    req.sessionId,
    req.sessionSign,
  );
  const seen = new Set<string>();
  for (const row of resp.data) {
    const exp = row?.d?.[0];
    if (typeof exp === "string" && exp.length > 0) seen.add(exp);
    else if (typeof exp === "number") seen.add(String(exp));
  }
  const expiries = Array.from(seen).sort();
  return { symbol: req.symbol, expiries, count: expiries.length };
};

// === Strikes (distinct) ===

export interface StrikesRequest {
  symbol: string;
  expiry?: string;
  sessionId?: string;
  sessionSign?: string;
  range?: [number, number];
}

export interface StrikeEntry {
  strike: number;
  type: "call" | "put";
}

export const getStrikes = async (
  req: StrikesRequest,
): Promise<{ symbol: string; expiry: string | null; strikes: StrikeEntry[]; count: number }> => {
  if (!req.symbol) throw new OptionsValidationError("symbol", "");
  const filter: any[] = [underlyingFilter(req.symbol)];
  if (req.expiry) filter.push(expirationFilter(req.expiry));
  const resp = await callScan2(
    "global/scan2",
    {
      filter,
      columns: [...STRIKES_COLUMNS],
      range: req.range || [0, 5000],
    },
    req.sessionId,
    req.sessionSign,
  );
  const seen = new Map<string, StrikeEntry>();
  for (const row of resp.data) {
    const strike = row?.d?.[0];
    const type = row?.d?.[1];
    if (typeof strike === "number" && (type === "call" || type === "put")) {
      const key = `${strike}:${type}`;
      if (!seen.has(key)) seen.set(key, { strike, type });
    }
  }
  const strikes = Array.from(seen.values()).sort((a, b) =>
    a.strike !== b.strike ? a.strike - b.strike : a.type < b.type ? -1 : 1,
  );
  return { symbol: req.symbol, expiry: req.expiry || null, strikes, count: strikes.length };
};

// === Chain row flatten ===

const flattenChainRow = (
  row: { s: string; d: any[] },
  fields: string[],
): OptionContract => {
  const idx = (name: string) => fields.indexOf(name);
  const cell = <T = any>(name: string): T | null => {
    const i = idx(name);
    if (i < 0) return null;
    const v = row.d?.[i];
    return v == null ? null : (v as T);
  };
  const optType = cell<string>("option-type");
  const strike = cell<number>("strike");
  const expiration = cell<string | number>("expiration");
  return {
    symbol: cell<string>("name") ?? row.s ?? null,
    strike: typeof strike === "number" ? strike : strike != null ? Number(strike) : null,
    expiration:
      expiration == null
        ? null
        : typeof expiration === "number"
          ? String(expiration)
          : expiration,
    type: optType === "call" || optType === "put" ? optType : null,
    bid: cell<number>("bid"),
    ask: cell<number>("ask"),
    delta: cell<number>("delta"),
    gamma: cell<number>("gamma"),
    theta: cell<number>("theta"),
    vega: cell<number>("vega"),
    rho: cell<number>("rho"),
    iv: cell<number>("iv"),
    openInterest: cell<number>("open_interest"),
    theoreticalPrice: cell<number>("theoretical_price"),
    underlying: cell<string>("root"),
  };
};

// === Chain ===

export interface OptionsChainRequest {
  symbol: string;
  expiry?: string;
  type?: "call" | "put" | "both";
  range?: [number, number];
  sessionId?: string;
  sessionSign?: string;
}

export const getOptionsChain = async (
  req: OptionsChainRequest,
): Promise<{
  symbol: string;
  expiry: string | null;
  type: "call" | "put" | "both";
  contracts: OptionContract[];
  totalCount?: number;
  fields: string[];
}> => {
  if (!req.symbol) throw new OptionsValidationError("symbol", "");
  const type = req.type || "both";
  const filter: any[] = [underlyingFilter(req.symbol)];
  if (req.expiry) filter.push(expirationFilter(req.expiry));
  if (type !== "both") filter.push(optionTypeFilter(type));
  // Fall back on global/scan2 + filter — recon §9 documents this as the chain
  // path until options/scan2 'index' payload shape is captured from authed HAR.
  const resp = await callScan2(
    "global/scan2",
    {
      filter,
      columns: [...CHAIN_COLUMNS],
      range: req.range || [0, 200],
    },
    req.sessionId,
    req.sessionSign,
  );
  const fields = resp.fields && resp.fields.length ? resp.fields : [...CHAIN_COLUMNS];
  const contracts = resp.data.map((row) => flattenChainRow(row, fields));
  return {
    symbol: req.symbol,
    expiry: req.expiry || null,
    type,
    contracts,
    totalCount: resp.totalCount,
    fields,
  };
};

// === Greeks (single contract convenience) ===

export interface GreeksRequest {
  contractSymbol: string;
  sessionId?: string;
  sessionSign?: string;
}

export const getGreeks = async (
  req: GreeksRequest,
): Promise<{ contractSymbol: string; greeks: OptionGreeks; raw: any }> => {
  if (!req.contractSymbol) throw new OptionsValidationError("contractSymbol", "");
  const resp = await callScan2(
    "global/scan2",
    {
      symbols: { tickers: [req.contractSymbol], query: { types: [] } },
      columns: [...GREEKS_COLUMNS],
      range: [0, 1],
    },
    req.sessionId,
    req.sessionSign,
  );
  const fields = resp.fields && resp.fields.length ? resp.fields : [...GREEKS_COLUMNS];
  const row = resp.data[0];
  const cell = (name: string): number | null => {
    if (!row) return null;
    const i = fields.indexOf(name);
    if (i < 0) return null;
    const v = row.d?.[i];
    return typeof v === "number" ? v : v == null ? null : Number(v) || null;
  };
  const greeks: OptionGreeks = {
    delta: cell("delta"),
    gamma: cell("gamma"),
    theta: cell("theta"),
    vega: cell("vega"),
    rho: cell("rho"),
    iv: cell("iv"),
  };
  return { contractSymbol: req.contractSymbol, greeks, raw: resp };
};

// === Advanced scan passthrough ===

export interface ScanOptionsRequest {
  filter?: any[];
  columns?: string[];
  range?: [number, number];
  sort?: { sortBy: string; sortOrder: "asc" | "desc" };
  markets?: string[];
  symbols?: { tickers?: string[]; query?: { types: string[] } };
  index?: any;
  // Use 'options/scan2' (advanced) by default. Caller may opt to fall back to
  // global/scan2 by setting variant:'global'. Recon §3 documents that
  // options/scan2 currently rejects all probed index shapes; if the upstream
  // returns 400, we surface that error verbatim.
  variant?: "options" | "global";
  sessionId?: string;
  sessionSign?: string;
}

export const scanOptions = async (req: ScanOptionsRequest): Promise<Scan2Response> => {
  const variant: Scan2Path = req.variant === "global" ? "global/scan2" : "options/scan2";
  const body: Scan2Body = {};
  if (req.filter) body.filter = req.filter;
  if (req.columns) body.columns = req.columns;
  if (req.range) body.range = req.range;
  if (req.sort) body.sort = req.sort;
  if (req.markets) body.markets = req.markets;
  if (req.symbols) body.symbols = req.symbols;
  if (req.index !== undefined) body.index = req.index;
  return callScan2(variant, body, req.sessionId, req.sessionSign);
};

// === Metainfo (71-field schema) ===

export interface OptionsMetainfoRequest {
  sessionId?: string;
  sessionSign?: string;
}

export const getOptionsMetainfo = async (
  req: OptionsMetainfoRequest = {},
): Promise<OptionsMetainfo> => {
  const url = `${SCANNER}/options/metainfo?label-product=${LABEL_OPT}`;
  const resp = await fetch(url, { headers: cookieHeader(req.sessionId, req.sessionSign) });
  const data = await readJson(resp, "GET options/metainfo");
  const rawFields: any[] = Array.isArray(data?.fields)
    ? data.fields
    : Array.isArray(data?.data?.fields)
      ? data.data.fields
      : [];
  const fields: OptionsMetainfoField[] = rawFields.map((f: any) => ({
    name: String(f?.n ?? f?.name ?? ""),
    type: String(f?.t ?? f?.type ?? ""),
    ...f,
  }));
  return { fields, raw: data };
};

// Internal: exposed for testing only.
export const __internal = {
  assertXAxis,
  splitExchangeRoot,
  flattenChainRow,
  CHAIN_COLUMNS,
};
