// Minimal TradingView websocket client tuned for Cloudflare Workers/Hono.
// Derived from the tvws codebase but trimmed to a small, dependency-free module.

import { RawWebSocket } from "./tv-raw-socket";
import {
  TIMEFRAME_MAP,
  TRADINGVIEW_WS_ENDPOINTS,
  VALID_TIMEFRAMES,
  frameTradingViewMessage,
  normalizeTradingViewPayload,
  type TradingviewEndpoint,
} from "../../packages/tradingview-core/src";
import { UpstreamError, toUpstreamError } from "./upstream-error";

export type { Candle } from "../../packages/tradingview-core/src";
import type { Candle } from "../../packages/tradingview-core/src";

const MAX_BATCH_SIZE = 20000; // aligns with TradingView Premium bar caps

type TradingviewEvent = { name: string; params: any[] };
type Subscriber = (event: TradingviewEvent) => void;
type Unsubscriber = () => void;

interface TradingviewConnection {
  subscribe: (handler: Subscriber) => Unsubscriber;
  send: (name: string, params: any[]) => void;
  close: () => Promise<void>;
}

export interface CandleRequest {
  symbol: string;
  timeframe?: string | number;
  amount?: number;
  endpoint?: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  timeoutMs?: number;
  debug?: boolean;
  to?: number; // optional end timestamp for the batch
}

// Handles Engine.IO / Socket.IO prefixes and returns the segment that contains TradingView netstrings.
const normalizePayload = (payload: string) => {
  return normalizeTradingViewPayload(payload);
};

export const listTimeframes = () => Array.from(VALID_TIMEFRAMES);

export const validateTimeframe = (tf: string | number): string => {
  const tfStr = typeof tf === "number" ? tf.toString() : tf;
  if (VALID_TIMEFRAMES.has(tfStr)) return tfStr;
  const mapped = TIMEFRAME_MAP.get(tfStr.toLowerCase());
  if (mapped) return mapped;
  throw new Error(`Invalid timeframe: ${tf}`);
};

const generateSessionId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const processRawCandles = (raw: any[], amount?: number): Candle[] => {
  const slice = amount ? raw.slice(0, amount) : raw;
  return slice.map((c) => ({
    timestamp: c.v[0],
    open: c.v[1],
    high: c.v[2],
    low: c.v[3],
    close: c.v[4],
    volume: c.v[5] ?? 0,
  }));
};

export const trimIncomingCandlesForBatch = <T>(
  incoming: T[],
  existing: T[],
  batchSize: number,
): T[] => {
  if (incoming.length <= batchSize) return incoming;
  if (existing.length === 0) return incoming.slice(0, batchSize);
  return incoming.slice(0, -existing.length);
};

const parseMessage = (message: string) => {
  if (!message) return [];
  const normalized = normalizePayload(message.toString());
  return normalized
    .split(/~m~\d+~m~/)
    .slice(1)
    .map((event) => {
      if (event.startsWith("~h~")) {
        return { type: "ping", data: `~m~${event.length}~m~${event}` };
      }
      const parsed = JSON.parse(event);
      if (parsed["session_id"]) return { type: "session", data: parsed };
      return { type: "event", data: parsed };
    });
};

export const getAuthToken = async (sessionId?: string, sessionSign?: string): Promise<string> => {
  if (!sessionId) return "unauthorized_user_token";
  const cookie = sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`;
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const resp = await fetch("https://www.tradingview.com/disclaimer/", {
        method: "GET",
        headers: { Cookie: cookie },
      });
      if (!resp.ok) {
        throw new UpstreamError(`auth token request failed: ${resp.status} ${resp.statusText}`, {
          category:
            resp.status === 401 || resp.status === 403
              ? "auth"
              : resp.status === 429
                ? "rate_limit"
                : "upstream",
          retryable: resp.status === 429 || resp.status >= 500,
          status: resp.status,
        });
      }
      const text = await resp.text();
      const match = text.match(/"auth_token":"(.+?)"/);
      return match ? match[1] : "unauthorized_user_token";
    } catch (err) {
      const upstreamError = toUpstreamError(err, "auth token request failed");
      if (!upstreamError.retryable || attempt === maxAttempts - 1) {
        throw upstreamError;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 2000)));
    }
  }
  return "unauthorized_user_token";
};

const connect = async (opts: {
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  timeoutMs?: number;
  debug?: boolean;
}): Promise<TradingviewConnection> => {
  const preferred = opts.endpoint && TRADINGVIEW_WS_ENDPOINTS[opts.endpoint] ? opts.endpoint : "prodata";
  const fallback = Object.keys(TRADINGVIEW_WS_ENDPOINTS).filter((k) => k !== preferred);
  const attempts = [preferred, ...fallback] as TradingviewEndpoint[];
  const token = await getAuthToken(opts.sessionId, opts.sessionSign);
  let lastError: any;

  for (const ep of attempts) {
    const wsUrl = TRADINGVIEW_WS_ENDPOINTS[ep];
    const socket = new RawWebSocket(wsUrl, {
      sessionId: opts.sessionId,
      sessionSign: opts.sessionSign,
      debug: opts.debug,
    });
    const subscribers = new Set<Subscriber>();

    const subscribe = (handler: Subscriber): Unsubscriber => {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    };

    const send = (name: string, params: any[]) => {
      const framed = frameTradingViewMessage(name, params);
      // Fire-and-forget; consumers expect a sync signature
      socket.sendText(framed).catch(() => {});
    };

    const close = async () => {
      subscribers.clear();
      await socket.close();
    };

    try {
      const connection = await new Promise<TradingviewConnection>((resolve, reject) => {
        let ready = false;
        const timeout = setTimeout(() => {
          if (!ready) {
            socket.close().catch(() => {});
            reject(new Error("Connection timeout to TradingView"));
          }
        }, opts.timeoutMs ?? 10000);

        socket.onError = (err) => {
          if (!ready) {
            clearTimeout(timeout);
            reject(err);
          }
        };

        socket.onClose = (err) => {
          if (!ready) {
            clearTimeout(timeout);
            reject(err ?? new Error("Connection closed"));
          }
        };

        socket.onText = (text) => {
          if (text === "2") {
            // Engine.IO ping -> pong
            socket.sendText("3").catch(() => {});
            return;
          }

          const payloads = parseMessage(text);
          for (const payload of payloads) {
            switch (payload.type) {
              case "ping":
                socket.sendText(payload.data).catch(() => {});
                break;
              case "session":
                ready = true;
                clearTimeout(timeout);
                send("set_auth_token", [token]);
                resolve({ subscribe, send, close });
                break;
              case "event":
                subscribers.forEach((handler) =>
                  handler({ name: payload.data.m, params: payload.data.p }),
                );
                break;
              default:
                break;
            }
          }
        };

        socket
          .connect(opts.timeoutMs ?? 10000)
          .catch((err) => {
            clearTimeout(timeout);
            reject(err);
          });
      });

      return connection;
    } catch (err) {
      lastError = toUpstreamError(err, "TradingView WebSocket connection failed");
      await socket.close().catch(() => {});
      // try next endpoint with a tiny backoff
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
  }

  throw lastError || new Error("Failed to connect to any TradingView endpoint");
};

export const getCandles = async (req: CandleRequest): Promise<Candle[]> => {
  const timeframe = validateTimeframe(req.timeframe ?? "60");
  const batchSize = Math.min(req.amount ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE);
  const chartSession = generateSessionId("cs");

  const connection = await connect({
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    timeoutMs: req.timeoutMs,
    debug: req.debug,
  });

  return new Promise<Candle[]>((resolve, reject) => {
    let rawCandles: any[] = [];
    let completed = false;
    let fetches = 0;

    const unsubscribe = connection.subscribe((event) => {
      try {
        if (event.name === "timescale_update") {
          const sessionData = event.params[1];
          const seriesKey = Object.keys(sessionData).find(
            (k) => k.startsWith("sds_") && sessionData[k].s,
          );
          if (seriesKey) {
            let newCandles = sessionData[seriesKey].s;
            // When upstream returns more bars than the batch we asked for, trim
            // overlap with bars we already have. -rawCandles.length collapses
            // to -0 (=== 0) when rawCandles is empty, which would discard the
            // entire first batch - guard explicitly.
            newCandles = trimIncomingCandlesForBatch(newCandles, rawCandles, batchSize);
            rawCandles = newCandles.concat(rawCandles);
          }
          return;
        }

        if (event.name === "series_completed" || event.name === "symbol_error") {
          const loaded = rawCandles.length;
          const needMore =
            loaded > 0 && loaded % batchSize === 0 && (!req.amount || loaded < req.amount);

          if (needMore && fetches < 500) {
            fetches += 1;
            connection.send("request_more_data", [chartSession, "sds_1", batchSize]);
            return;
          }

          completed = true;
          unsubscribe();
          connection.close().catch(() => {});
          resolve(processRawCandles(rawCandles, req.amount));
        }
      } catch (err) {
        completed = true;
        unsubscribe();
        connection.close().catch(() => {});
        reject(err);
      }
    });

    // Kick off the chart session
    try {
      connection.send("chart_create_session", [chartSession, ""]);
      connection.send("resolve_symbol", [
        chartSession,
        "sds_sym_1",
        "=" + JSON.stringify({ symbol: req.symbol, adjustment: "splits" }),
      ]);
      connection.send("create_series", [
        chartSession,
        "sds_1",
        "s1",
        "sds_sym_1",
        timeframe,
        batchSize,
        req.to ?? "",
      ]);
    } catch (err) {
      completed = true;
      unsubscribe();
      connection.close().catch(() => {});
      reject(err);
    }

    // Total timeout guard
    const ttl = setTimeout(() => {
      if (!completed) {
        unsubscribe();
        connection.close().catch(() => {});
        reject(new Error("Timed out fetching candles"));
      }
      clearTimeout(ttl);
    }, req.timeoutMs ?? 20000);
  });
};

// === QUOTES ===
export interface QuoteRequest {
  symbols: string[];
  fields?: string[];
  endpoint?: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  timeoutMs?: number;
}

export type QuoteResult = Record<string, any>;

export const DEFAULT_QUOTE_FIELDS = [
  "lp",
  "ch",
  "chp",
  "volume",
  "bid",
  "ask",
  "high_price",
  "low_price",
  "open_price",
  "prev_close_price",
  "lp_time",
  "currency_code",
  "exchange",
  "pro_name",
];

export const getQuotes = async (req: QuoteRequest): Promise<QuoteResult> => {
  if (!req.symbols || req.symbols.length === 0) {
    throw new Error("symbols array required");
  }

  const quoteSession = generateSessionId("qs");
  const connection = await connect({
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    timeoutMs: req.timeoutMs,
  });

  return new Promise<QuoteResult>((resolve, reject) => {
    const quotes = new Map<string, any>();
    let completed = false;

    const unsubscribe = connection.subscribe((event) => {
      try {
        if (event.name === "qsd") {
          const q = event.params[1];
          if (q?.n && q?.s) {
            const prev = quotes.get(q.n) || {};
            quotes.set(q.n, { ...prev, ...q.s });
          }
        }

        if (event.name === "quote_completed") {
          completed = true;
          unsubscribe();
          connection.close().catch(() => {});
          const obj: QuoteResult = {};
          quotes.forEach((v, k) => {
            obj[k] = v;
          });
          resolve(obj);
        }
      } catch (err) {
        completed = true;
        unsubscribe();
        connection.close().catch(() => {});
        reject(err);
      }
    });

    try {
      const fields = req.fields && req.fields.length ? req.fields : DEFAULT_QUOTE_FIELDS;
      connection.send("quote_create_session", [quoteSession]);
      connection.send("quote_set_fields", [quoteSession, ...fields]);
      connection.send("quote_add_symbols", [quoteSession, ...req.symbols]);
    } catch (err) {
      completed = true;
      unsubscribe();
      connection.close().catch(() => {});
      reject(err);
    }

    const ttl = setTimeout(() => {
      if (!completed) {
        unsubscribe();
        connection.close().catch(() => {});
        const obj: QuoteResult = {};
        quotes.forEach((v, k) => {
          obj[k] = v;
        });
        resolve(obj);
      }
      clearTimeout(ttl);
    }, req.timeoutMs ?? 8000);
  });
};

// === TECHNICAL ANALYSIS (scanner) ===
// Lightweight port of TradingView-API getTA / tradingview-ta approach.
const SCAN_URL = "https://scanner.tradingview.com/global/scan";
const SCAN_INDICATORS = ["Recommend.Other", "Recommend.All", "Recommend.MA"];
const SCAN_TIMEFRAMES = ["1", "5", "15", "60", "240", "1D", "1W", "1M"];

export interface TARequest {
  symbols: string[]; // e.g., ["NASDAQ:AAPL"]
  timeframes?: string[]; // optional subset of SCAN_TIMEFRAMES
}

export type TAResult = Record<
  string,
  {
    [timeframe: string]: {
      Other?: number;
      All?: number;
      MA?: number;
    };
  }
>;

export const getTechnicalAnalysis = async (req: TARequest): Promise<TAResult> => {
  if (!req.symbols || req.symbols.length === 0) {
    throw new Error("symbols array required");
  }
  const tfs = req.timeframes && req.timeframes.length ? req.timeframes : SCAN_TIMEFRAMES;
  const cols = tfs
    .map((tf) => SCAN_INDICATORS.map((i) => (tf !== "1D" ? `${i}|${tf}` : i)))
    .flat();

  const body = {
    symbols: { tickers: req.symbols, query: { types: [] } },
    columns: cols,
  };

  const resp = await fetch(SCAN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`TA scan failed: ${resp.status} ${resp.statusText}`);
  }

  const data: any = await resp.json();
  if (!data.data || !Array.isArray(data.data)) return {};

  const result: TAResult = {};

  data.data.forEach((row: any, idx: number) => {
    const symbol = req.symbols[idx] || `symbol_${idx}`;
    result[symbol] = {};
    const values: number[] = row.d || [];

    cols.forEach((col, i) => {
      const [name, period] = col.split("|");
      const tf = period || "1D";
      if (!result[symbol][tf]) result[symbol][tf] = {};
      const key = name.split(".").pop() || name;
      // TradingView uses scaled advice [-1,1]; mirror TradingView-API rounding:
      result[symbol][tf][key as "Other" | "All" | "MA"] =
        Math.round(values[i] * 1000) / 500;
    });
  });

  return result;
};

// Convenience: single-symbol TA summary for one timeframe
export const getTaSummary = async (symbol: string, timeframe: string = "1D") => {
  if (!symbol) throw new Error("symbol required");
  const tf = timeframe || "1D";
  const cols = SCAN_INDICATORS.map((i) => (tf !== "1D" ? `${i}|${tf}` : i));

  const body = {
    symbols: { tickers: [symbol], query: { types: [] } },
    columns: cols,
  };

  const resp = await fetch(SCAN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`TA summary failed: ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  if (!data?.data || !data.data[0]) return {};

  const summary: Record<string, number> = {};
  const vals: number[] = data.data[0].d || [];
  cols.forEach((col, i) => {
    const key = col.split("|")[0].split(".").pop() || col;
    summary[key] = Math.round(vals[i] * 1000) / 500;
  });
  return summary;
};

// === SYMBOL SEARCH (symbol_search v3) ===
export interface SearchRequest {
  query: string; // e.g., "NASDAQ:AAPL" or "AAPL"
  filter?: "stock" | "futures" | "forex" | "cfd" | "crypto" | "index" | "economic";
  offset?: number;
}

export interface SearchResult {
  id: string;
  exchange: string;
  fullExchange: string;
  symbol: string;
  description: string;
  type: string;
}

export const searchSymbols = async (req: SearchRequest): Promise<SearchResult[]> => {
  if (!req.query) throw new Error("query required");

  const parts = req.query.toUpperCase().replace(/ /g, "+").split(":");
  const exchange = parts.length === 2 ? parts[0] : undefined;
  const text = parts.pop() || req.query;

  const url = new URL("https://symbol-search.tradingview.com/symbol_search/v3");
  url.searchParams.set("text", text);
  if (exchange) url.searchParams.set("exchange", exchange);
  if (req.filter) url.searchParams.set("search_type", req.filter);
  if (req.offset !== undefined) url.searchParams.set("start", req.offset.toString());

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: { origin: "https://www.tradingview.com" },
  });

  if (!resp.ok) throw new Error(`search failed: ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  if (!data?.symbols) return [];

  return data.symbols.map((s: any) => {
    const ex = s.exchange.split(" ")[0];
    const id = s.prefix ? `${s.prefix}:${s.symbol}` : `${ex.toUpperCase()}:${s.symbol}`;
    return {
      id,
      exchange: ex,
      fullExchange: s.exchange,
      symbol: s.symbol,
      description: s.description,
      type: s.type,
    };
  });
};

// === INDICATOR SEARCH & METADATA ===
export interface IndicatorSearchRequest {
  query: string;
}

export interface IndicatorSearchResult {
  id: string;
  version: string;
  name: string;
  author: { username: string };
  access: "open_source" | "closed_source" | "invite_only" | "other";
  type: "study" | "strategy" | "other";
}

// Combine built-in list and public scripts (simplified vs TradingView-API)
export const searchIndicators = async (
  req: IndicatorSearchRequest,
): Promise<IndicatorSearchResult[]> => {
  if (!req.query) throw new Error("query required");

  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

  // Fetch built-ins
  const builtIns: any[] = [];
  for (const filter of ["standard", "candlestick", "fundamental"]) {
    const resp = await fetch("https://pine-facade.tradingview.com/pine-facade/list?" + new URLSearchParams({ filter }));
    if (resp.ok) {
      const data: any = await resp.json();
      builtIns.push(...data);
    }
  }

  const pubResp = await fetch(
    "https://www.tradingview.com/pubscripts-suggest-json?" +
      new URLSearchParams({ search: req.query.replace(/ /g, "%20") }),
  );
  const pubData: any = pubResp.ok ? await pubResp.json() : { results: [] };

  const builtMatches = builtIns
    .filter(
      (i) =>
        norm(i.scriptName).includes(norm(req.query)) ||
        norm(i.extra?.shortDescription || "").includes(norm(req.query)),
    )
    .map((ind) => ({
      id: ind.scriptIdPart,
      version: ind.version,
      name: ind.scriptName,
      author: { username: "@TRADINGVIEW@" },
      access: "closed_source" as const,
      type: (ind.extra && ind.extra.kind) ? ind.extra.kind : "study",
    }));

  const pubMatches = (pubData.results || []).map((ind: any) => ({
    id: ind.scriptIdPart,
    version: ind.version,
    name: ind.scriptName,
    author: { username: ind.author?.username || "unknown" },
    access: (["open_source", "closed_source", "invite_only"][ind.access - 1] as any) || "other",
    type: (ind.extra && ind.extra.kind) ? ind.extra.kind : "study",
  }));

  return [...builtMatches, ...pubMatches];
};

export interface IndicatorMetaRequest {
  id: string;
  version?: string;
  sessionId?: string;
  sessionSign?: string;
}

export interface IndicatorMeta {
  id: string;
  version: string;
  description?: string;
  shortDescription?: string;
  inputs: any[];
  plots: any[];
  script?: string;
  metaInfo?: any;
}

export const getIndicatorMeta = async (req: IndicatorMetaRequest): Promise<IndicatorMeta> => {
  if (!req.id) throw new Error("id required");
  const indicId = req.id.replace(/ |%/g, "%25");
  const ver = req.version || "last";
  const url = `https://pine-facade.tradingview.com/pine-facade/translate/${indicId}/${ver}`;

  const headers: Record<string, string> = {};
  if (req.sessionId) {
    headers["cookie"] = req.sessionSign
      ? `sessionid=${req.sessionId};sessionid_sign=${req.sessionSign}`
      : `sessionid=${req.sessionId}`;
  }

  const resp = await fetch(url, { method: "GET", headers });
  if (!resp.ok) throw new Error(`indicator fetch failed: ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  if (!data?.success || !data?.result?.metaInfo) {
    throw new Error(`indicator not available: ${data?.reason || "unknown"}`);
  }

  const meta = data.result.metaInfo;
  return {
    id: meta.scriptIdPart || indicId,
    version: meta.pine?.version || ver,
    description: meta.description,
    shortDescription: meta.shortDescription,
    inputs: meta.inputs || [],
    plots: meta.plots || [],
    script: data.result.ilTemplate,
    // Expose full TradingView metaInfo for advanced consumers
    metaInfo: meta,
  };
};

// === TYPED INDICATOR INPUTS (derived from metaInfo.inputs) ===
// Translates the verbose INPUT_* enum to the 13 short-form StudyInputType values.
const INPUT_TYPE_MAP: Record<string, string> = {
  integer: "integer",
  INPUT_INTEGER: "integer",
  float: "float",
  INPUT_FLOAT: "float",
  price: "price",
  INPUT_PRICE: "price",
  bool: "bool",
  INPUT_BOOL: "bool",
  text: "text",
  INPUT_STRING: "text",
  INPUT_TEXT: "text",
  text_area: "text_area",
  INPUT_TEXT_AREA: "text_area",
  symbol: "symbol",
  INPUT_SYMBOL: "symbol",
  session: "session",
  INPUT_SESSION: "session",
  source: "source",
  INPUT_SOURCE: "source",
  resolution: "resolution",
  INPUT_RESOLUTION: "resolution",
  INPUT_TIMEFRAME: "resolution",
  time: "time",
  INPUT_TIME: "time",
  bar_time: "bar_time",
  INPUT_BAR_TIME: "bar_time",
  color: "color",
  INPUT_COLOR: "color",
};

export interface TypedInput {
  id: string;
  name: string;
  type: string;
  defval?: any;
  minval?: number;
  maxval?: number;
  step?: number;
  options?: any[];
  group?: string;
  inline?: string;
  tooltip?: string;
  isHidden?: boolean;
  isFake?: boolean;
}

export const getTypedIndicatorInputs = async (
  req: IndicatorMetaRequest,
): Promise<{ id: string; version: string; inputs: TypedInput[] }> => {
  const meta = await getIndicatorMeta(req);
  const inputs: TypedInput[] = (meta.inputs || []).map((mi: any) => {
    const rawType = String(mi.type || "");
    const type = INPUT_TYPE_MAP[rawType] || rawType.toLowerCase().replace(/^input_/, "") || "text";
    const out: TypedInput = {
      id: mi.id,
      name: mi.name || mi.id,
      type,
      defval: mi.defval,
    };
    if (mi.min != null) out.minval = mi.min;
    if (mi.max != null) out.maxval = mi.max;
    if (mi.step != null) out.step = mi.step;
    if (Array.isArray(mi.options)) out.options = mi.options;
    if (mi.group) out.group = mi.group;
    if (mi.inline) out.inline = mi.inline;
    if (mi.tooltip) out.tooltip = mi.tooltip;
    if (mi.isHidden) out.isHidden = true;
    if (mi.isFake) out.isFake = true;
    return out;
  });
  return { id: meta.id, version: meta.version, inputs };
};

export interface PrivateIndicator {
  id: string;
  version: string;
  name: string;
  access: string;
  type: string;
}

export const getPrivateIndicators = async (req: {
  sessionId: string;
  sessionSign?: string;
}): Promise<PrivateIndicator[]> => {
  if (!req.sessionId) throw new Error("sessionId required for private indicators");
  const headers: Record<string, string> = {
    cookie: req.sessionSign
      ? `sessionid=${req.sessionId};sessionid_sign=${req.sessionSign}`
      : `sessionid=${req.sessionId}`,
  };
  const resp = await fetch("https://pine-facade.tradingview.com/pine-facade/list?filter=saved", {
    headers,
  });
  if (!resp.ok) throw new Error(`private indicators fetch failed: ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  if (!Array.isArray(data)) return [];
  return data.map((ind: any) => ({
    id: ind.scriptIdPart,
    version: ind.version,
    name: ind.scriptName,
    access: "private",
    type: ind.extra?.kind || "study",
  }));
};

// === USER PROFILE (session-based) ===
export interface UserProfile {
  id?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  reputation?: number;
  following?: number;
  followers?: number;
  session?: string;
}

export const getUserProfile = async (req: {
  sessionId: string;
  sessionSign?: string;
  location?: string;
}): Promise<UserProfile> => {
  if (!req.sessionId) throw new Error("sessionId required");
  const url = req.location || "https://www.tradingview.com/";
  const headers: Record<string, string> = {
    cookie: req.sessionSign
      ? `sessionid=${req.sessionId};sessionid_sign=${req.sessionSign}`
      : `sessionid=${req.sessionId}`,
  };
  const resp = await fetch(url, {
    headers,
    redirect: "manual",
  });
  const text = await resp.text();
  if (!text.includes("auth_token")) {
    throw new Error("Wrong or expired sessionid/sessionid_sign");
  }
  const extract = (regex: RegExp) => regex.exec(text)?.[1];
  return {
    id: extract(/"id":([0-9]{1,10}),/),
    username: extract(/"username":"(.*?)"/),
    firstName: extract(/"first_name":"(.*?)"/),
    lastName: extract(/"last_name":"(.*?)"/),
    reputation: parseFloat(extract(/"reputation":(.*?),/) || "0"),
    following: parseFloat(extract(/,"following":([0-9]*?),/) || "0"),
    followers: parseFloat(extract(/,"followers":([0-9]*?),/) || "0"),
    session: req.sessionId,
  };
};

// === RUN STUDY (verified create_study 6-arg shape, du frame accumulator) ===
//
// Wire format (recon 2026-05-07):
//   create_study [cs, st_slot, turnaround, parent_series_id, indicator_id_with_version, inputs]
//   du.params[1][st_slot] = { t: turnaround, st: [{i, v: [v0, v1, ...]}], ns?: {...non-series outputs...} }
//
// Plot output rides du, NOT study_completed. The previous implementation read
// study_completed.params[1] which is always empty.
export interface StudyRequest {
  symbol: string;
  studyId: string; // canonical "STD;RSI", "PUB;<hash>", "USER;<id>", or pre-qualified "STD;RSI@tv-basicstudies-241!"
  script?: string; // accepted by the route contract; retained for source-backed study flows
  inputs?: Record<string, any>; // raw wire form {in_0, in_1, ...}
  params?: Record<string, any>; // friendly {name: value} mapped via metainfo
  timeframe?: string | number; // default "60"
  bars?: number; // default 300
  parentSeriesId?: string; // sds_1 (default) or stN for study-on-study
  endpoint?: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  timeoutMs?: number;
}

export interface StudyPlot {
  id: string;
  name: string;
  type: string;
  data: Array<{ ts: number; value: any }>;
}

export interface StudyResult {
  symbol: string;
  studyId: string;
  studyVersion: string;
  wireId: string;
  timeframe: string;
  bars: number;
  plots: StudyPlot[];
  nonseries?: Record<string, any>;
}

const SOURCE_ALIASES = new Set([
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
  "volume",
]);

interface ResolvedWireId {
  wireId: string;
  version: string;
}

const resolveStudyWireId = async (
  rawId: string,
  sessionId?: string,
  sessionSign?: string,
): Promise<ResolvedWireId> => {
  // Already qualified — extract version segment for return only.
  if (rawId.includes("@")) {
    const versionMatch = rawId.match(/@[a-z-]+-([0-9]+)!?$/);
    return { wireId: rawId, version: versionMatch?.[1] ?? "last" };
  }

  const headers: Record<string, string> = {};
  if (sessionId) {
    headers["cookie"] = sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`;
  }
  const versionsUrl = `https://pine-facade.tradingview.com/pine-facade/versions/${encodeURIComponent(rawId)}/last`;
  let version = "last";
  try {
    const resp = await fetch(versionsUrl, { headers });
    if (resp.ok) {
      const data: any = await resp.json();
      const v = Array.isArray(data) ? data[0]?.version : data?.version;
      if (v != null) version = String(v);
    }
  } catch {
    // tolerate network blips on version lookup; "last" works as a fallback
  }

  if (rawId.startsWith("PUB;") || rawId.startsWith("USER;")) {
    return { wireId: `Script$${rawId}@tv-scripting-101!`, version };
  }
  if (rawId.startsWith("STD;")) {
    const ns = version === "last" ? "tv-basicstudies" : `tv-basicstudies-${version}`;
    return { wireId: `${rawId}@${ns}!`, version };
  }
  // Bare legacy id like "RSI" — treat as basicstudies.
  const ns = version === "last" ? "tv-basicstudies" : `tv-basicstudies-${version}`;
  return { wireId: `${rawId}@${ns}!`, version };
};

const buildInputsDict = (
  rawInputs: Record<string, any> | undefined,
  paramsByName: Record<string, any> | undefined,
  meta: { inputs: any[] } | null,
  parentSeriesId: string,
): Record<string, any> => {
  const inputs: Record<string, any> = { ...(rawInputs ?? {}) };

  if (paramsByName && meta) {
    for (const [name, value] of Object.entries(paramsByName)) {
      const found = (meta.inputs || []).find((mi: any) => mi.name === name || mi.id === name);
      if (!found) continue;
      inputs[found.id] = value;
    }
  }

  if (meta) {
    for (const mi of meta.inputs || []) {
      const id = mi.id as string;
      if (!(id in inputs)) continue;
      const t = (mi.type as string) || "";
      const v = inputs[id];
      // Source-typed: rewrite friendly aliases into "<seriesId>$<plotName>"
      if (t === "source" && typeof v === "string") {
        if (SOURCE_ALIASES.has(v)) {
          inputs[id] = `${parentSeriesId}$${v}`;
        }
      }
      // Symbol-typed: wrap bare strings in {type:"symbol", value}
      if (t === "symbol" && typeof v === "string") {
        inputs[id] = { type: "symbol", value: v };
      }
    }
  }

  return inputs;
};

const isUnixSeconds = (n: any): boolean =>
  typeof n === "number" && n > 1_000_000_000 && n < 4_000_000_000;

const buildStudyPlots = (
  meta: { plots?: any[] } | null,
  rowsBySlot: Record<string, Array<{ i: number; v: any[] }>>,
  studySlot: string,
  seriesIndexToTs: Map<number, number>,
): StudyPlot[] => {
  const rows = rowsBySlot[studySlot] || [];
  if (rows.length === 0) return [];

  const sortedRows = [...rows].sort((a, b) => a.i - b.i);
  // Detect whether v[0] looks like a unix-seconds timestamp.
  const sample = sortedRows[0]?.v ?? [];
  const tsIsFirst = sample.length > 0 && isUnixSeconds(sample[0]);

  const plotDefs = (meta?.plots || []).filter((p: any) => p?.type !== "no_series");
  const numPlotChannels = tsIsFirst ? sample.length - 1 : sample.length;
  const plotCount = plotDefs.length || numPlotChannels;

  const plots: StudyPlot[] = [];
  for (let pi = 0; pi < plotCount; pi += 1) {
    const def = plotDefs[pi] || {};
    const data: Array<{ ts: number; value: any }> = [];
    for (const row of sortedRows) {
      const ts = tsIsFirst
        ? Number(row.v[0])
        : (seriesIndexToTs.get(row.i) ?? row.i);
      const value = tsIsFirst ? row.v[pi + 1] : row.v[pi];
      if (value == null) continue;
      data.push({ ts, value });
    }
    plots.push({
      id: def.id || `plot_${pi}`,
      name: def.title || def.id || `plot_${pi}`,
      type: def.type || "line",
      data,
    });
  }
  return plots;
};

export const runStudy = async (req: StudyRequest): Promise<StudyResult> => {
  if (!req.symbol || !req.studyId) {
    throw new Error("symbol and studyId required");
  }

  const timeframe = validateTimeframe(req.timeframe ?? "60");
  const bars = Math.max(1, Math.min(req.bars ?? 300, MAX_BATCH_SIZE));
  const parentSeriesId = req.parentSeriesId ?? "sds_1";

  // Resolve the wire id and (best-effort) metainfo for plot/input mapping.
  const [{ wireId, version }, metaResult] = await Promise.allSettled([
    resolveStudyWireId(req.studyId, req.sessionId, req.sessionSign),
    getIndicatorMeta({
      id: req.studyId.split("@")[0],
      sessionId: req.sessionId,
      sessionSign: req.sessionSign,
    }).catch(() => null as any),
  ]).then((r) => [
    r[0].status === "fulfilled" ? r[0].value : { wireId: req.studyId, version: "last" },
    r[1].status === "fulfilled" ? r[1].value : null,
  ]) as [ResolvedWireId, IndicatorMeta | null];

  const meta = metaResult;
  const inputsDict = buildInputsDict(req.inputs, req.params, meta, parentSeriesId);

  const chartSession = generateSessionId("cs");
  const studySlot = "st1";

  const connection = await connect({
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    timeoutMs: req.timeoutMs,
  });

  return new Promise<StudyResult>((resolve, reject) => {
    let settled = false;
    const rowsBySlot: Record<string, Array<{ i: number; v: any[] }>> = {};
    const nonseriesBySlot: Record<string, Record<string, any>> = {};
    const seriesIndexToTs = new Map<number, number>();
    let seriesReady = false;

    const finish = (err: any | null, _result?: StudyResult) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      connection.close().catch(() => {});
      if (err) reject(err);
      else resolve(_result!);
    };

    const buildResult = (): StudyResult => ({
      symbol: req.symbol,
      studyId: req.studyId,
      studyVersion: version,
      wireId,
      timeframe,
      bars,
      plots: buildStudyPlots(meta, rowsBySlot, studySlot, seriesIndexToTs),
      nonseries: nonseriesBySlot[studySlot],
    });

    const unsubscribe = connection.subscribe((event) => {
      try {
        if (event.name === "timescale_update") {
          const sessionData = event.params[1] || {};
          const seriesKey = Object.keys(sessionData).find(
            (k) => k === parentSeriesId && sessionData[k]?.s,
          );
          if (seriesKey) {
            const seriesBars: any[] = sessionData[seriesKey].s;
            for (const bar of seriesBars) {
              if (bar?.i != null && Array.isArray(bar.v) && isUnixSeconds(bar.v[0])) {
                seriesIndexToTs.set(bar.i, bar.v[0]);
              }
            }
          }
          return;
        }

        if (event.name === "series_completed") {
          if (!seriesReady) {
            seriesReady = true;
            // Now safe to create the study; some upstream paths reject if sent before series_completed.
            try {
              connection.send("create_study", [
                chartSession,
                studySlot,
                "",
                parentSeriesId,
                wireId,
                inputsDict,
              ]);
            } catch (err) {
              finish(err);
            }
          }
          return;
        }

        if (event.name === "du") {
          const slotMap = event.params[1] || {};
          for (const [slot, payload] of Object.entries<any>(slotMap)) {
            const rows = (payload?.st || []) as Array<{ i: number; v: any[] }>;
            if (rows.length > 0) {
              if (!rowsBySlot[slot]) rowsBySlot[slot] = [];
              rowsBySlot[slot].push(...rows);
            }
            if (payload?.ns) {
              nonseriesBySlot[slot] = { ...(nonseriesBySlot[slot] || {}), ...payload.ns };
            }
          }
          return;
        }

        if (event.name === "study_completed") {
          // study_completed carries [slot, turnaround] only. Resolve from accumulated du.
          finish(null, buildResult());
          return;
        }

        if (event.name === "study_error") {
          const reason = event.params?.[2];
          const detail = event.params?.[3];
          const err = new Error(`study_error: ${reason ?? "unknown"}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
          (err as any).reason = reason;
          (err as any).detail = detail;
          finish(err);
          return;
        }

        if (event.name === "symbol_error") {
          finish(new Error(`symbol_error: ${JSON.stringify(event.params)}`));
        }
      } catch (err) {
        finish(err);
      }
    });

    try {
      connection.send("chart_create_session", [chartSession, ""]);
      connection.send("resolve_symbol", [
        chartSession,
        "sds_sym_1",
        "=" + JSON.stringify({ symbol: req.symbol, adjustment: "splits" }),
      ]);
      connection.send("create_series", [
        chartSession,
        parentSeriesId,
        "s1",
        "sds_sym_1",
        timeframe,
        bars,
        "",
      ]);
      // create_study fires after series_completed in the subscriber.
    } catch (err) {
      finish(err);
    }

    const ttl = setTimeout(() => {
      if (!settled) {
        // If we received any du rows already, surface them as a partial result rather than time out.
        if ((rowsBySlot[studySlot] || []).length > 0) {
          finish(null, buildResult());
        } else {
          finish(new Error("Timed out running study"));
        }
      }
      clearTimeout(ttl);
    }, req.timeoutMs ?? 15000);
  });
};

// === BACKFILL PAGINATION (multi-window) ===
// Utility to fetch deep history by looping getCandles until a limit or exhaustion.
export interface BackfillRequest {
  symbol: string;
  timeframe?: string | number;
  total?: number; // desired total bars
  endpoint?: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  delayMs?: number;
}

export const backfillCandles = async (req: BackfillRequest): Promise<Candle[]> => {
  const total = req.total ?? 40000;
  const chunk = Math.min(total, MAX_BATCH_SIZE);
  let remaining = total;
  let cursor: number | undefined = undefined;
  const all: Candle[] = [];

  while (remaining > 0) {
    const amount = Math.min(remaining, MAX_BATCH_SIZE);
    // If cursor set, we request up to cursor (exclusive)
    const candles = await getCandles({
      symbol: req.symbol,
      timeframe: req.timeframe,
      amount,
      endpoint: req.endpoint,
      sessionId: req.sessionId,
      sessionSign: req.sessionSign,
      to: cursor,
    });
    if (!candles.length) break;
    const oldest = candles[candles.length - 1]?.timestamp;
    all.push(...candles);
    remaining -= candles.length;
    if (!oldest || candles.length < amount) break;
    cursor = oldest;
    if (req.delayMs) {
      await new Promise((r) => setTimeout(r, req.delayMs));
    }
  }

  // Deduplicate by timestamp (keep earliest occurrence)
  const dedup = new Map<number, Candle>();
  all.forEach((c) => {
    if (!dedup.has(c.timestamp)) dedup.set(c.timestamp, c);
  });
  return Array.from(dedup.values()).sort((a, b) => a.timestamp - b.timestamp);
};

// === NEWS HEADLINES (lightweight from tradingview-scraper pattern) ===
export const NEWS_PROVIDERS = ["all", "finnhub", "benzinga", "seekingalpha", "thestreet", "barrons"];
export const NEWS_AREAS = ["world", "americas", "europe", "asia", "oceania", "africa"];
export const NEWS_SECTIONS = ["all", "esg", "financial_statement", "press_release"];
export const NEWS_LANGUAGES = ["en", "es", "de", "fr", "it", "pt", "ru", "zh", "ja"];

export interface NewsRequest {
  symbol: string; // e.g., "NASDAQ:AAPL" or "BINANCE:BTCUSDT"
  provider?: string; // e.g., "all"
  area?: string; // e.g., "world", "americas"
  section?: string; // "all" | "esg" | "financial_statement" | "press_release"
  language?: string; // e.g., "en"
}

export interface NewsItem {
  title: string;
  link: string;
  published: number;
  source: string;
  symbols: string[];
  urgency?: number;
}

export const fetchNews = async (req: NewsRequest): Promise<NewsItem[]> => {
  if (!req.symbol) throw new Error("symbol required");

  const url = new URL("https://news-headlines.tradingview.com/v2/view/headlines/symbol");
  url.searchParams.set("client", "web");
  url.searchParams.set("lang", req.language || "en");
  url.searchParams.set("area", req.area || "world");
  url.searchParams.set("provider", req.provider || "all");
  url.searchParams.set("section", req.section || "all");
  url.searchParams.set("streaming", "");
  url.searchParams.set("symbol", req.symbol);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`news fetch failed: ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  if (!data?.items) return [];

  return (data.items as any[]).map((item) => ({
    title: item.headline,
    link: item.url,
    published: item.published,
    source: item.source,
    symbols: item.symbols || [],
    urgency: item.urgency,
  }));
};

export interface NewsContentRequest {
  url: string; // full TradingView news article URL or path starting with /
}

export interface NewsContent {
  title?: string;
  body?: string;
  published?: string;
  raw?: string;
}

export const fetchNewsContent = async (req: NewsContentRequest): Promise<NewsContent> => {
  if (!req.url) throw new Error("url required");
  const fullUrl = req.url.startsWith("http")
    ? req.url
    : `https://www.tradingview.com${req.url.startsWith("/") ? req.url : "/" + req.url}`;

  const resp = await fetch(fullUrl);
  if (!resp.ok) throw new Error(`news content fetch failed: ${resp.status} ${resp.statusText}`);
  const html = await resp.text();

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const bodyMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const timeMatch = html.match(/<time[^>]*datetime="([^"]+)"/i);

  return {
    title: titleMatch ? titleMatch[1].trim() : undefined,
    body: bodyMatch ? bodyMatch[1].trim() : undefined,
    published: timeMatch ? timeMatch[1] : undefined,
    raw: html,
  };
};

// === META HELPERS (lists) ===
export const listMarkets = () => [
  "america",
  "australia",
  "canada",
  "germany",
  "india",
  "uk",
  "crypto",
  "forex",
  "global",
];

export const listFundamentalFields = () => ({
  all: FUNDAMENTAL_FIELDS,
});

export const listNewsMeta = () => ({
  providers: NEWS_PROVIDERS,
  areas: NEWS_AREAS,
  sections: NEWS_SECTIONS,
  languages: NEWS_LANGUAGES,
});

// === REPLAY HELPERS (minimal) ===
export interface ReplayRequest {
  symbol: string;
  timeframe?: string | number;
  startTime?: number; // timestamp to start replay
  endpoint?: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  timeoutMs?: number;
}

export interface ReplayState {
  sessionId: string;
  position: number;
  playing: boolean;
  speed?: number;
}

export const createReplay = async (req: ReplayRequest): Promise<ReplayState> => {
  if (!req.symbol) throw new Error("symbol required");
  const connection = await connect({
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    timeoutMs: req.timeoutMs,
  });

  const replaySession = generateSessionId("rs_");

  return new Promise<ReplayState>((resolve, reject) => {
    let state: ReplayState = {
      sessionId: replaySession,
      position: req.startTime || 0,
      playing: false,
      speed: 1,
    };

    const unsubscribe = connection.subscribe((event) => {
      try {
        switch (event.name) {
          case "replay_create_session":
            state.sessionId = event.params[0];
            state.playing = false;
            state.position = req.startTime || 0;
            break;
          case "replay_reset":
            state.position = req.startTime || 0;
            state.playing = false;
            break;
          case "replay_step":
            state.position = event.params[1];
            break;
          case "replay_start":
            state.playing = true;
            state.speed = event.params[1] || 1;
            break;
          case "replay_stop":
            state.playing = false;
            break;
        }
      } catch (err) {
        unsubscribe();
        connection.close().catch(() => {});
        reject(err);
      }
    });

    try {
      const tf = validateTimeframe(req.timeframe ?? "60");
      connection.send("replay_create_session", [replaySession]);
      connection.send("replay_add_series", [replaySession, "symbol_0", req.symbol, tf]);
      const start = req.startTime || Math.floor(Date.now() / 1000);
      connection.send("replay_reset", [replaySession, "req_replay_reset", start]);
      resolve(state);
    } catch (err) {
      unsubscribe();
      connection.close().catch(() => {});
      reject(err);
    }
  });
};

// === FUNDAMENTALS (symbol endpoint) ===
const FUNDAMENTAL_FIELDS = [
  "total_revenue",
  "revenue_per_share_ttm",
  "total_revenue_fy",
  "gross_profit",
  "gross_profit_fy",
  "operating_income",
  "operating_income_fy",
  "net_income",
  "net_income_fy",
  "EBITDA",
  "basic_eps_net_income",
  "earnings_per_share_basic_ttm",
  "earnings_per_share_diluted_ttm",
  "total_assets",
  "total_assets_fy",
  "cash_n_short_term_invest",
  "cash_n_short_term_invest_fy",
  "total_debt",
  "total_debt_fy",
  "stockholders_equity",
  "stockholders_equity_fy",
  "book_value_per_share_fq",
  "cash_f_operating_activities",
  "cash_f_operating_activities_fy",
  "cash_f_investing_activities",
  "cash_f_investing_activities_fy",
  "cash_f_financing_activities",
  "cash_f_financing_activities_fy",
  "free_cash_flow",
  "gross_margin",
  "gross_margin_percent_ttm",
  "operating_margin",
  "operating_margin_ttm",
  "pretax_margin_percent_ttm",
  "net_margin",
  "net_margin_percent_ttm",
  "EBITDA_margin",
  "return_on_equity",
  "return_on_equity_fq",
  "return_on_assets",
  "return_on_assets_fq",
  "return_on_investment_ttm",
  "current_ratio",
  "current_ratio_fq",
  "quick_ratio",
  "quick_ratio_fq",
  "debt_to_equity",
  "debt_to_equity_fq",
  "debt_to_assets",
  "market_cap_basic",
  "market_cap_calc",
  "market_cap_diluted_calc",
  "enterprise_value_fq",
  "price_earnings_ttm",
  "price_book_fq",
  "price_sales_ttm",
  "price_free_cash_flow_ttm",
  "dividends_yield",
  "dividends_per_share_fq",
  "dividend_payout_ratio_ttm",
];

export interface FundamentalsRequest {
  symbol: string; // must include exchange prefix, e.g., "NASDAQ:AAPL"
  fields?: string[];
}

export interface FundamentalsResponse {
  status: "success" | "failed";
  data?: any;
  error?: string;
}

export const fetchFundamentals = async (
  req: FundamentalsRequest,
): Promise<FundamentalsResponse> => {
  if (!req.symbol || !req.symbol.includes(":")) {
    return { status: "failed", error: "symbol must include exchange prefix, e.g., NASDAQ:AAPL" };
  }

  const fields = req.fields && req.fields.length ? req.fields : FUNDAMENTAL_FIELDS;
  const url = new URL("https://scanner.tradingview.com/symbol");
  url.searchParams.set("symbol", req.symbol.toUpperCase());
  url.searchParams.set("fields", fields.join(","));

  const resp = await fetch(url.toString(), {
    headers: { "User-Agent": "cloudflare-tw-data" },
  });

  if (!resp.ok) {
    return { status: "failed", error: `HTTP ${resp.status}: ${resp.statusText}` };
  }

  const data: any = await resp.json();
  if (!data) {
    return { status: "failed", error: `No data for symbol: ${req.symbol}` };
  }

  data.symbol = req.symbol.toUpperCase();
  return { status: "success", data };
};

// === GENERIC SCANNER (screener API) ===
export interface ScanRequest {
  market?: string; // e.g., "america", "crypto", "forex", "cfd"
  symbols?: string[]; // optional explicit symbols
  filter?: any[]; // TradingView scanner filter objects
  columns?: string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export const runScan = async (req: ScanRequest): Promise<any> => {
  const market = req.market || "america";
  const body = {
    filter: req.filter || [],
    options: { lang: "en" },
    symbols: {
      tickers: req.symbols && req.symbols.length ? req.symbols : [],
      query: { types: [] },
    },
    columns:
      req.columns && req.columns.length
        ? req.columns
        : ["name", "close", "change", "volume", "market_cap_basic", "Recommend.All"],
    sort: req.sortBy
      ? { sortBy: req.sortBy, sortOrder: req.sortOrder === "asc" ? "asc" : "desc" }
      : undefined,
  };

  const resp = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`scan failed: ${resp.status} ${resp.statusText}`);
  return resp.json();
};

// === MARKET MOVERS (gain/lose/volume) convenience ===
export interface MoversRequest {
  market?: string;
  type?: "gainers" | "losers" | "volume";
  limit?: number;
}

export const getMovers = async (req: MoversRequest): Promise<any> => {
  const type = req.type || "gainers";
  const limit = req.limit ?? 10;
  const sortBy =
    type === "volume" ? "volume" : "change"; // change percent default
  const sortOrder = type === "losers" ? "asc" : "desc";

  const result = await runScan({
    market: req.market || "america",
    sortBy,
    sortOrder,
    columns: ["name", "close", "change", "change_abs", "volume", "market_cap_basic"],
  });

  if (!result?.data) return [];
  return (result.data as any[]).slice(0, limit).map((row) => {
    const cols = result.columns || ["name", "close", "change", "change_abs", "volume", "market_cap_basic"];
    const obj: Record<string, any> = {};
    cols.forEach((col: string, idx: number) => {
      obj[col] = row.d[idx];
    });
    return obj;
  });
};

// === MARKET OVERVIEW (top by sort) ===
export interface MarketOverviewRequest {
  market?: string;
  sort?: "market_cap" | "volume" | "change" | "price" | "volatility";
  limit?: number;
}

const SORT_MAP: Record<string, string> = {
  market_cap: "market_cap_basic",
  volume: "volume",
  change: "change",
  price: "close",
  volatility: "Volatility.D",
};

export const getMarketOverview = async (req: MarketOverviewRequest) => {
  const sortField = SORT_MAP[req.sort || "market_cap"] || "market_cap_basic";
  const limit = req.limit ?? 20;
  const result = await runScan({
    market: req.market || "america",
    sortBy: sortField,
    sortOrder: "desc",
    columns: [
      "name",
      "close",
      "change",
      "change_abs",
      "volume",
      "Recommend.All",
      "market_cap_basic",
      "price_earnings_ttm",
      "earnings_per_share_basic_ttm",
      "sector",
      "industry",
    ],
  });

  if (!result?.data) return [];
  return (result.data as any[]).slice(0, limit).map((row) => {
    const cols =
      result.columns ||
      [
        "name",
        "close",
        "change",
        "change_abs",
        "volume",
        "Recommend.All",
        "market_cap_basic",
        "price_earnings_ttm",
        "earnings_per_share_basic_ttm",
        "sector",
        "industry",
      ];
    const obj: Record<string, any> = {};
    cols.forEach((col: string, idx: number) => {
      obj[col] = row.d[idx];
    });
    return obj;
  });
};

// === SECTOR MOVERS ===
export interface SectorMoversRequest {
  market?: string;
  sector: string;
  type?: "gainers" | "losers" | "volume";
  limit?: number;
}

export const getSectorMovers = async (req: SectorMoversRequest) => {
  if (!req.sector) throw new Error("sector required");
  const type = req.type || "gainers";
  const limit = req.limit ?? 10;
  const sortBy = type === "volume" ? "volume" : "change";
  const sortOrder = type === "losers" ? "asc" : "desc";

  const filter = [
    {
      left: "sector",
      operation: "equal",
      right: req.sector,
    },
  ];

  const result = await runScan({
    market: req.market || "america",
    filter,
    sortBy,
    sortOrder,
    columns: ["name", "close", "change", "change_abs", "volume", "market_cap_basic", "sector", "industry"],
  });

  if (!result?.data) return [];
  const cols =
    result.columns ||
    ["name", "close", "change", "change_abs", "volume", "market_cap_basic", "sector", "industry"];

  return (result.data as any[]).slice(0, limit).map((row) => {
    const obj: Record<string, any> = {};
    cols.forEach((col: string, idx: number) => {
      obj[col] = row.d[idx];
    });
    return obj;
  });
};

// === INDUSTRY MOVERS ===
export interface IndustryMoversRequest {
  market?: string;
  industry: string;
  type?: "gainers" | "losers" | "volume";
  limit?: number;
}

export const getIndustryMovers = async (req: IndustryMoversRequest) => {
  if (!req.industry) throw new Error("industry required");
  const type = req.type || "gainers";
  const limit = req.limit ?? 10;
  const sortBy = type === "volume" ? "volume" : "change";
  const sortOrder = type === "losers" ? "asc" : "desc";

  const filter = [
    {
      left: "industry",
      operation: "equal",
      right: req.industry,
    },
  ];

  const result = await runScan({
    market: req.market || "america",
    filter,
    sortBy,
    sortOrder,
    columns: ["name", "close", "change", "change_abs", "volume", "market_cap_basic", "sector", "industry"],
  });

  if (!result?.data) return [];
  const cols =
    result.columns ||
    ["name", "close", "change", "change_abs", "volume", "market_cap_basic", "sector", "industry"];

  return (result.data as any[]).slice(0, limit).map((row) => {
    const obj: Record<string, any> = {};
    cols.forEach((col: string, idx: number) => {
      obj[col] = row.d[idx];
    });
    return obj;
  });
};

// === STREAM BOOTSTRAP (stateless helper for clients) ===
export interface StreamBootstrapRequest {
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  symbol?: string;
  timeframe?: string | number;
  fields?: string[];
}

export interface StreamBootstrap {
  wsUrl: string;
  token: string;
  chartSession: string;
  quoteSession: string;
  initialMessages: string[];
}

const formatWSMessage = (name: string, params: any[]) => {
  return frameTradingViewMessage(name, params);
};

export const getStreamBootstrap = async (
  req: StreamBootstrapRequest,
): Promise<StreamBootstrap> => {
  const endpoint =
    req.endpoint && TRADINGVIEW_WS_ENDPOINTS[req.endpoint] ? req.endpoint : ("prodata" as TradingviewEndpoint);
  const wsUrl = TRADINGVIEW_WS_ENDPOINTS[endpoint];
  const token = await getAuthToken(req.sessionId, req.sessionSign);
  const chartSession = generateSessionId("cs");
  const quoteSession = generateSessionId("qs");
  const tf = req.timeframe ? validateTimeframe(req.timeframe) : "1D";
  const fields = req.fields && req.fields.length ? req.fields : DEFAULT_QUOTE_FIELDS;

  const messages: string[] = [];
  messages.push(formatWSMessage("set_auth_token", [token]));
  messages.push(formatWSMessage("set_locale", ["en", "US"]));
  messages.push(formatWSMessage("chart_create_session", [chartSession, ""]));
  messages.push(formatWSMessage("quote_create_session", [quoteSession]));
  messages.push(formatWSMessage("quote_set_fields", [quoteSession, ...fields]));

  if (req.symbol) {
    const resolveSym = "=" + JSON.stringify({ symbol: req.symbol, adjustment: "splits" });
    messages.push(formatWSMessage("quote_add_symbols", [quoteSession, resolveSym]));
    messages.push(formatWSMessage("quote_fast_symbols", [quoteSession, req.symbol]));
    messages.push(formatWSMessage("resolve_symbol", [chartSession, "sds_sym_1", resolveSym]));
    messages.push(
      formatWSMessage("create_series", [
        chartSession,
        "sds_1",
        "s1",
        "sds_sym_1",
        tf,
        MAX_BATCH_SIZE,
        "",
      ]),
    );
  }

  return {
    wsUrl,
    token,
    chartSession,
    quoteSession,
    initialMessages: messages,
  };
};

// === CALENDAR: DIVIDENDS & EARNINGS ===
const DIVIDEND_DEFAULT_FIELDS = [
  "dividend_ex_date_recent",
  "dividend_ex_date_upcoming",
  "logoid",
  "name",
  "description",
  "dividends_yield",
  "dividend_payment_date_recent",
  "dividend_payment_date_upcoming",
  "dividend_amount_recent",
  "dividend_amount_upcoming",
  "fundamental_currency_code",
  "market",
];

const EARNINGS_DEFAULT_FIELDS = [
  "earnings_release_next_date",
  "logoid",
  "name",
  "description",
  "earnings_per_share_fq",
  "earnings_per_share_forecast_next_fq",
  "eps_surprise_fq",
  "eps_surprise_percent_fq",
  "revenue_fq",
  "revenue_forecast_next_fq",
  "market_cap_basic",
  "earnings_release_time",
  "earnings_release_next_time",
  "earnings_per_share_forecast_fq",
  "revenue_forecast_fq",
  "fundamental_currency_code",
  "market",
  "earnings_publication_type_fq",
  "earnings_publication_type_next_fq",
  "revenue_surprise_fq",
  "revenue_surprise_percent_fq",
];

export interface CalendarRequest {
  timestampFrom?: number;
  timestampTo?: number;
  markets?: string[];
  fields?: string[];
}

const calendarFetch = async (
  labelProduct: "calendar-dividends" | "calendar-earnings",
  req: CalendarRequest,
  defaults: string[],
) => {
  const url = `https://scanner.tradingview.com/global/scan?label-product=${labelProduct}`;

  const now = Math.floor(Date.now() / 1000);
  const from = req.timestampFrom ?? now - 3 * 86400;
  const to = req.timestampTo ?? now + 3 * 86400 + 86399;
  const fields = req.fields && req.fields.length ? req.fields : defaults;

  const payload: any = {
    columns: fields,
    filter: [
      {
        left:
          labelProduct === "calendar-dividends"
            ? "dividend_ex_date_recent,dividend_ex_date_upcoming"
            : "earnings_release_next_date,earnings_release_time",
        operation: "in_range",
        right: [from, to],
      },
    ],
    ignore_unknown_fields: false,
    options: { lang: "en" },
  };
  if (req.markets && req.markets.length) {
    payload.markets = req.markets;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`calendar fetch failed: ${resp.status} ${resp.statusText}`);
  const data: any = await resp.json();
  return data?.data || [];
};

export const getDividendCalendar = async (req: CalendarRequest) => {
  const rows = await calendarFetch("calendar-dividends", req, DIVIDEND_DEFAULT_FIELDS);
  const out: any[] = [];
  rows.forEach((row: any) => {
    const sym = row?.s;
    const vals = row?.d || [];
    const entry: Record<string, any> = { symbol: sym };
    (req.fields && req.fields.length ? req.fields : DIVIDEND_DEFAULT_FIELDS).forEach(
      (field, idx) => {
        entry[field] = vals[idx];
      },
    );
    out.push(entry);
  });
  return out;
};

export const getEarningsCalendar = async (req: CalendarRequest) => {
  const rows = await calendarFetch("calendar-earnings", req, EARNINGS_DEFAULT_FIELDS);
  const out: any[] = [];
  rows.forEach((row: any) => {
    const sym = row?.s;
    const vals = row?.d || [];
    const entry: Record<string, any> = { symbol: sym };
    (req.fields && req.fields.length ? req.fields : EARNINGS_DEFAULT_FIELDS).forEach(
      (field, idx) => {
        entry[field] = vals[idx];
      },
    );
    out.push(entry);
  });
  return out;
};
// === CREDENTIAL LOGIN (sessionid/sessionid_sign) ===
export interface LoginRequest {
  username: string;
  password: string;
  remember?: boolean;
  userAgent?: string;
}

export interface LoginResponse {
  sessionId: string;
  sessionSign: string;
  authToken?: string;
  username?: string;
  id?: number;
}

export const loginUser = async (req: LoginRequest): Promise<LoginResponse> => {
  if (!req.username || !req.password) {
    throw new Error("username and password required");
  }
  const body = `username=${encodeURIComponent(req.username)}&password=${encodeURIComponent(req.password)}${
    req.remember === false ? "" : "&remember=on"
  }`;

  const resp = await fetch("https://www.tradingview.com/accounts/signin/", {
    method: "POST",
    headers: {
      referer: "https://www.tradingview.com",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": req.userAgent || "cloudflare-tw-data",
    },
    body,
    redirect: "manual",
  });

  const cookies = resp.headers.get("set-cookie") || "";
  const sessionMatch = cookies.match(/sessionid=([^;]+)/);
  const signMatch = cookies.match(/sessionid_sign=([^;]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : "";
  const sessionSign = signMatch ? signMatch[1] : "";

  let json: any = {};
  try {
    json = (await resp.json()) as any;
  } catch {
    // ignore
  }
  if (!sessionId) {
    const raw = typeof json?.error === "string" ? json.error : "";
    // TradingView's signin endpoint can return arbitrary strings (HTML,
    // captcha challenge text, control chars). Strip control characters and
    // cap length so the worker never echoes a hostile payload back to the
    // caller as an error message.
    const sanitized = raw
      .replace(/[\x00-\x1f\x7f-\x9f]+/g, " ")
      .trim()
      .slice(0, 200);
    throw new Error(sanitized || "login failed (sessionid not returned)");
  }

  return {
    sessionId,
    sessionSign,
    authToken: json?.user?.auth_token,
    username: json?.user?.username,
    id: json?.user?.id,
  };
};

// === IDEAS (best-effort scrape of symbol ideas) ===
export interface IdeasRequest {
  symbol: string; // exchange-prefixed, e.g., NASDAQ:AAPL
  limit?: number;
}

export interface IdeaSummary {
  id: string;
  title: string;
  author?: string;
  published?: number;
  url: string;
  symbols?: string[];
  tags?: string[];
}

export const fetchIdeas = async (req: IdeasRequest): Promise<IdeaSummary[]> => {
  if (!req.symbol) throw new Error("symbol required");
  const limit = req.limit ?? 20;
  // TradingView idea pages use : in URL encoded as %3A
  const sym = encodeURIComponent(req.symbol.toUpperCase());
  const resp = await fetch(`https://www.tradingview.com/ideas/symbol/${sym}/`);
  if (!resp.ok) throw new Error(`ideas fetch failed: ${resp.status} ${resp.statusText}`);
  const html = await resp.text();

  // Heuristic parse: look for a JSON block with "ideas":[{...}]
  const ideas: IdeaSummary[] = [];
  const match = html.match(/"ideas":(\[.*?\])[,}]/s);
  if (match) {
    try {
      const arr = JSON.parse(match[1]) as any[];
      arr.slice(0, limit).forEach((it) => {
        ideas.push({
          id: it?.id?.toString() || "",
          title: it?.title || "",
          author: it?.user?.username,
          published: it?.published,
          url: it?.urls?.view || (it?.slug ? `https://www.tradingview.com${it.slug}` : ""),
          symbols: it?.symbols?.map((s: any) => s.symbol),
          tags: it?.tags,
        });
      });
    } catch (e) {
      // fall through
    }
  }
  return ideas;
};

// === MINDS (community discussions) ===
export interface MindsRequest {
  symbol: string; // exchange-prefixed
  sort?: "recent" | "popular" | "trending";
  limit?: number;
  cursor?: string;
}

export interface MindItem {
  uid?: string;
  text?: string;
  url?: string;
  author?: { username?: string; profile_url?: string; is_broker?: boolean };
  created?: string;
  symbols?: string[];
  total_likes?: number;
  total_comments?: number;
  modified?: boolean;
  hidden?: boolean;
}

export const fetchMinds = async (
  req: MindsRequest,
): Promise<{ data: MindItem[]; next?: string }> => {
  if (!req.symbol || !req.symbol.includes(":")) {
    throw new Error("symbol must include exchange prefix, e.g., NASDAQ:AAPL");
  }
  const limit = Math.min(req.limit ?? 50, 200);
  const params = new URLSearchParams({
    symbol: req.symbol.toUpperCase(),
    limit: limit.toString(),
    sort: req.sort || "recent",
  });
  if (req.cursor) params.set("c", req.cursor);

  const resp = await fetch(`https://www.tradingview.com/api/v1/minds/?${params.toString()}`, {
    headers: { "User-Agent": "cloudflare-tw-data" },
  });
  if (!resp.ok) throw new Error(`minds fetch failed: ${resp.status} ${resp.statusText}`);
  const json: any = await resp.json();
  const results = (json.results || []) as any[];

  const data: MindItem[] = results.map((item) => ({
    uid: item.uid,
    text: item.text,
    url: item.url,
    author: item.author
      ? {
          username: item.author.username,
          profile_url: item.author.uri ? `https://www.tradingview.com${item.author.uri}` : undefined,
          is_broker: item.author.is_broker,
        }
      : undefined,
    created: item.created,
    symbols: item.symbols ? Object.values(item.symbols) : [],
    total_likes: item.total_likes,
    total_comments: item.total_comments,
    modified: item.modified,
    hidden: item.hidden,
  }));

  return {
    data,
    next: json.next,
  };
};

// === SYMBOL RESOLUTION (chart-based metadata) ===
export interface ResolveSymbolRequest {
  symbol: string; // exchange-prefixed preferred
  endpoint?: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  timeoutMs?: number;
}

export interface SymbolMeta {
  symbol: string;
  pro_name?: string;
  description?: string;
  exchange?: string;
  type?: string;
  timezone?: string;
  session?: string;
  pricescale?: number;
  minmov?: number;
  minmove2?: number;
  fractional?: boolean;
  has_intraday?: boolean;
  has_no_volume?: boolean;
}

export const resolveSymbol = async (req: ResolveSymbolRequest): Promise<SymbolMeta> => {
  if (!req.symbol) throw new Error("symbol required");

  const chartSession = generateSessionId("cs");
  const connection = await connect({
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    timeoutMs: req.timeoutMs,
  });

  return new Promise<SymbolMeta>((resolve, reject) => {
    let completed = false;

    const unsubscribe = connection.subscribe((event) => {
      try {
        if (event.name === "symbol_resolved") {
          completed = true;
          unsubscribe();
          connection.close().catch(() => {});
          const meta = event.params[2] || {};
          resolve({
            symbol: req.symbol,
            pro_name: meta.pro_name,
            description: meta.description,
            exchange: meta.exchange,
            type: meta.type,
            timezone: meta.timezone,
            session: meta.session,
            pricescale: meta.pricescale,
            minmov: meta.minmov,
            minmove2: meta.minmove2,
            fractional: meta.fractional,
            has_intraday: meta.has_intraday,
            has_no_volume: meta.has_no_volume,
          });
        }
        if (event.name === "symbol_error") {
          completed = true;
          unsubscribe();
          connection.close().catch(() => {});
          reject(new Error("symbol_error"));
        }
      } catch (err) {
        completed = true;
        unsubscribe();
        connection.close().catch(() => {});
        reject(err);
      }
    });

    try {
      connection.send("chart_create_session", [chartSession, ""]);
      connection.send("resolve_symbol", [
        chartSession,
        "symbol_1",
        "=" + JSON.stringify({ symbol: req.symbol, adjustment: "splits" }),
      ]);
    } catch (err) {
      completed = true;
      unsubscribe();
      connection.close().catch(() => {});
      reject(err);
    }

    const ttl = setTimeout(() => {
      if (!completed) {
        unsubscribe();
        connection.close().catch(() => {});
        reject(new Error("Timed out resolving symbol"));
      }
      clearTimeout(ttl);
    }, req.timeoutMs ?? 8000);
  });
};
