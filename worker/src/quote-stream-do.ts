// QuoteStream Durable Object (Slice F / tradingview-1nt).
//
// One DO instance per streamId. Owns one TradingView WS connection running
// `quote_create_session` for live quote frames (qsd) and optionally one
// `chart_create_session` per symbol for minute-bar closes (timescale_update
// with tf=1). Fans out coalesced events over SSE to attached consumers.
//
// Lifecycle vs. StreamBridge: StreamBridge is one-DO-per-session for
// alerts/news pushstream (different upstream protocol); this DO is
// per-streamId and supports many concurrent streams per session, with a
// per-stream idle-alarm auto-close. Separation keeps both protocols clean.

import { RawWebSocket } from "./tv-raw-socket";
import {
  TIMEFRAME_MAP,
  TRADINGVIEW_WS_ENDPOINTS,
  VALID_TIMEFRAMES,
  frameTradingViewMessage,
  normalizeTradingViewPayload,
  type TradingviewEndpoint,
} from "../../packages/tradingview-core/src";

// === Public types =======================================================

export interface QuoteStreamInitRequest {
  streamId: string;
  hmacClient: string;
  symbols: string[];
  fields?: string[];
  includeMinuteBars?: boolean;
  timeframe?: string | number;
  sessionId: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  /** Override safety-gate caps for tests. */
  maxSymbolsPerStream?: number;
}

export interface QuoteStreamUpdateRequest {
  add?: string[];
  remove?: string[];
}

export interface QuoteEvent {
  seq: number;
  ts: string;
  kind: "quote" | "bar" | "control" | "error";
  symbol?: string;
  fields?: Record<string, any>;
  bar?: { time: number; open: number; high: number; low: number; close: number; volume: number };
  reason?: string;
  data?: any;
}

export interface QuoteStreamBindings {
  QUOTE_STREAM: {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  };
}

// === Constants ==========================================================

export const MAX_SYMBOLS_PER_STREAM_DEFAULT = 100;
export const IDLE_STREAM_AUTO_CLOSE_MS = 5 * 60 * 1000;
export const QUOTE_THROTTLE_INTERVAL_MS = 250;
const RING_BUFFER_MAX = 1000;
const SSE_HEARTBEAT_MS = 15_000;
const SSE_DEFAULT_MAX_AGE_MS = 4 * 60 * 1000;
const TV_WS_RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

const DEFAULT_QUOTE_FIELDS = [
  "lp",
  "ch",
  "chp",
  "volume",
  "bid",
  "ask",
  "bid_size",
  "ask_size",
  "high_price",
  "low_price",
  "open_price",
  "prev_close_price",
  "trade_loaded",
  "current_session",
];

// === Test seams =========================================================

export interface UpstreamFactoryOptions {
  url: string;
  sessionId: string;
  sessionSign?: string;
  endpoint: TradingviewEndpoint;
  authToken: string;
}

export interface UpstreamSocket {
  send: (frame: string) => void;
  close: (code?: number, reason?: string) => void;
}

export type UpstreamFactory = (
  opts: UpstreamFactoryOptions,
  handlers: {
    onMessage: (text: string) => void;
    onClose?: (code: number, reason: string) => void;
    onError?: (err: any) => void;
    onAuthFailure?: () => void;
  },
) => Promise<UpstreamSocket>;

let upstreamFactory: UpstreamFactory | null = null;
export const _setUpstreamFactoryForTests = (factory: UpstreamFactory | null) => {
  upstreamFactory = factory;
};

let authTokenFetcher: ((sessionId: string, sessionSign?: string) => Promise<string>) | null = null;
export const _setAuthTokenFetcherForTests = (
  fetcher: ((sessionId: string, sessionSign?: string) => Promise<string>) | null,
) => {
  authTokenFetcher = fetcher;
};

const defaultAuthTokenFetcher = async (
  sessionId: string,
  sessionSign?: string,
): Promise<string> => {
  if (!sessionId) return "unauthorized_user_token";
  const cookie = sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`;
  try {
    const resp = await fetch("https://www.tradingview.com/disclaimer/", {
      method: "GET",
      headers: { Cookie: cookie },
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) throw new Error("auth_error");
      return "unauthorized_user_token";
    }
    const text = await resp.text();
    const match = text.match(/"auth_token":"(.+?)"/);
    return match ? match[1] : "unauthorized_user_token";
  } catch (err: any) {
    if (err?.message === "auth_error") throw err;
    return "unauthorized_user_token";
  }
};

const defaultUpstreamFactory: UpstreamFactory = async (opts, handlers) => {
  const socket = new RawWebSocket(opts.url, {
    sessionId: opts.sessionId,
    sessionSign: opts.sessionSign,
  });
  socket.onText = handlers.onMessage;
  socket.onClose = (err) => handlers.onClose?.(1006, err?.message ?? "closed");
  socket.onError = (err) => handlers.onError?.(err);
  await socket.connect(10000);
  return {
    send: (frame: string) => {
      socket.sendText(frame).catch(() => {});
    },
    close: (_code, _reason) => {
      socket.close().catch(() => {});
    },
  };
};

// === Helpers ============================================================

const validateTimeframe = (tf: string | number): string => {
  const tfStr = typeof tf === "number" ? tf.toString() : tf;
  if (VALID_TIMEFRAMES.has(tfStr)) return tfStr;
  const mapped = TIMEFRAME_MAP.get(tfStr.toLowerCase());
  if (mapped) return mapped;
  throw new Error(`invalid timeframe: ${tf}`);
};

const generateSessionId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const parseFrames = (text: string) => {
  if (!text) return [] as Array<{ type: "ping" | "session" | "event"; data: any }>;
  const normalized = normalizeTradingViewPayload(text);
  return normalized
    .split(/~m~\d+~m~/)
    .slice(1)
    .map((event) => {
      if (event.startsWith("~h~")) {
        return { type: "ping" as const, data: `~m~${event.length}~m~${event}` };
      }
      try {
        const parsed = JSON.parse(event);
        if (parsed["session_id"]) return { type: "session" as const, data: parsed };
        return { type: "event" as const, data: parsed };
      } catch {
        return { type: "event" as const, data: null };
      }
    });
};

// === DO state ===========================================================

interface PendingQuote {
  fields: Record<string, any>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface SubscriptionState {
  /** Settled stream config — populated on /init success. */
  ready: boolean;
  hmacClient: string;
  symbols: Set<string>;
  fields: string[];
  includeMinuteBars: boolean;
  timeframe: string;
  endpoint: TradingviewEndpoint;
  sessionId: string;
  sessionSign?: string;
  quoteSession: string;
  chartSession: string | null;
  /** chartSession-side resolved-symbol id per symbol → "qss_<n>". */
  chartSeriesBySymbol: Map<string, string>;
  upstream: UpstreamSocket | null;
  upstreamRetries: number;
  authBlocked: boolean;
  /** In-memory ring buffer; oldest first. */
  ring: QuoteEvent[];
  nextSeq: number;
  truncated: boolean;
  /** Per-symbol coalescing throttle state. */
  pending: Map<string, PendingQuote>;
}

const newSubscriptionState = (): SubscriptionState => ({
  ready: false,
  hmacClient: "",
  symbols: new Set(),
  fields: DEFAULT_QUOTE_FIELDS.slice(),
  includeMinuteBars: false,
  timeframe: "1",
  endpoint: "prodata",
  sessionId: "",
  sessionSign: undefined,
  quoteSession: "",
  chartSession: null,
  chartSeriesBySymbol: new Map(),
  upstream: null,
  upstreamRetries: 0,
  authBlocked: false,
  ring: [],
  nextSeq: 1,
  truncated: false,
  pending: new Map(),
});

// === DO class ===========================================================

interface AlarmStorage {
  setAlarm: (when: number) => Promise<void>;
  deleteAlarm?: () => Promise<void>;
  getAlarm?: () => Promise<number | null>;
  put?: (key: string, value: unknown) => Promise<void>;
  get?: <T>(key: string) => Promise<T | undefined>;
  delete?: (key: string) => Promise<void>;
}

export class QuoteStream {
  private state: DurableObjectState;
  private env: CloudflareBindings;
  private sub: SubscriptionState;
  private sseClients = new Map<
    string,
    { writer: WritableStreamDefaultWriter<Uint8Array>; closed: boolean }
  >();
  private lastConsumerSeenAt: number = Date.now();
  private idleCloseFn: (() => Promise<void>) | null = null;

  constructor(state: DurableObjectState, env: CloudflareBindings) {
    this.state = state;
    this.env = env;
    this.sub = newSubscriptionState();
  }

  // ----- HTTP routing -----

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/sse" && request.method === "GET") {
        return this.handleSse(request);
      }
      if (request.method !== "POST") {
        return Response.json({ error: "method not allowed" }, { status: 405 });
      }
      switch (path) {
        case "/init":
          return await this.handleInit(request);
        case "/update":
          return await this.handleUpdate(request);
        case "/close":
          return await this.handleClose();
        case "/state":
          return Response.json(this._snapshot());
        default:
          return Response.json({ error: `unknown sub-path: ${path}` }, { status: 404 });
      }
    } catch (err: any) {
      return Response.json({ error: err?.message || "quote-stream error" }, { status: 500 });
    }
  }

  // ----- handlers -----

  private async handleInit(request: Request): Promise<Response> {
    if (this.sub.ready) {
      return Response.json({ error: "stream already initialized" }, { status: 409 });
    }
    let body: QuoteStreamInitRequest;
    try {
      body = (await request.json()) as QuoteStreamInitRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body.streamId !== "string" || !body.streamId) {
      return Response.json({ error: "streamId (string) required" }, { status: 400 });
    }
    if (typeof body.hmacClient !== "string" || !body.hmacClient) {
      return Response.json({ error: "hmacClient (string) required" }, { status: 400 });
    }
    if (!Array.isArray(body.symbols) || body.symbols.length === 0) {
      return Response.json({ error: "symbols (non-empty array) required" }, { status: 400 });
    }
    const cap = body.maxSymbolsPerStream ?? MAX_SYMBOLS_PER_STREAM_DEFAULT;
    if (body.symbols.length > cap) {
      return Response.json(
        {
          error: "max_symbols_exceeded",
          limit: cap,
          requested: body.symbols.length,
        },
        { status: 400 },
      );
    }
    if (typeof body.sessionId !== "string" || !body.sessionId) {
      return Response.json({ error: "sessionId (string) required" }, { status: 400 });
    }

    const endpoint =
      body.endpoint && TRADINGVIEW_WS_ENDPOINTS[body.endpoint] ? body.endpoint : "prodata";
    const fields = Array.isArray(body.fields) && body.fields.length > 0
      ? body.fields.slice()
      : DEFAULT_QUOTE_FIELDS.slice();
    const timeframe = body.includeMinuteBars
      ? validateTimeframe(body.timeframe ?? "1")
      : "1";

    this.sub.hmacClient = body.hmacClient;
    this.sub.symbols = new Set(body.symbols);
    this.sub.fields = fields;
    this.sub.includeMinuteBars = !!body.includeMinuteBars;
    this.sub.timeframe = timeframe;
    this.sub.endpoint = endpoint;
    this.sub.sessionId = body.sessionId;
    this.sub.sessionSign = body.sessionSign;
    this.sub.quoteSession = generateSessionId("qs");
    this.sub.chartSession = this.sub.includeMinuteBars ? generateSessionId("cs") : null;

    try {
      await this.openUpstream();
    } catch (err: any) {
      const isAuth = err?.message === "auth_error";
      this.sub = newSubscriptionState();
      return Response.json(
        {
          error: isAuth ? "auth_error" : "upstream_error",
          message: err?.message ?? String(err),
        },
        { status: isAuth ? 401 : 502 },
      );
    }

    this.sub.ready = true;
    await this.persistSnapshot();
    return Response.json({
      ok: true,
      streamId: body.streamId,
      symbols: [...this.sub.symbols],
      fields: this.sub.fields,
      includeMinuteBars: this.sub.includeMinuteBars,
      timeframe: this.sub.timeframe,
    });
  }

  private async handleUpdate(request: Request): Promise<Response> {
    if (!this.sub.ready) {
      return Response.json({ error: "stream not initialized" }, { status: 409 });
    }
    let body: QuoteStreamUpdateRequest;
    try {
      body = (await request.json()) as QuoteStreamUpdateRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const add = Array.isArray(body?.add) ? body.add.filter((s) => typeof s === "string") : [];
    const remove = Array.isArray(body?.remove) ? body.remove.filter((s) => typeof s === "string") : [];

    const next = new Set(this.sub.symbols);
    for (const r of remove) next.delete(r);
    for (const a of add) next.add(a);
    if (next.size > MAX_SYMBOLS_PER_STREAM_DEFAULT) {
      return Response.json(
        {
          error: "max_symbols_exceeded",
          limit: MAX_SYMBOLS_PER_STREAM_DEFAULT,
          requested: next.size,
        },
        { status: 400 },
      );
    }
    if (!this.sub.upstream) {
      return Response.json({ error: "upstream_not_open" }, { status: 503 });
    }

    const toRemove = remove.filter((s) => this.sub.symbols.has(s));
    const toAdd = add.filter((s) => !this.sub.symbols.has(s));

    if (toRemove.length > 0) {
      this.sendUpstream("quote_remove_symbols", [this.sub.quoteSession, ...toRemove]);
      for (const s of toRemove) {
        this.sub.symbols.delete(s);
        this.sub.pending.delete(s);
        if (this.sub.includeMinuteBars && this.sub.chartSession) {
          const seriesId = this.sub.chartSeriesBySymbol.get(s);
          if (seriesId) {
            this.sendUpstream("remove_series", [this.sub.chartSession, seriesId]);
            this.sub.chartSeriesBySymbol.delete(s);
          }
        }
      }
    }
    if (toAdd.length > 0) {
      const resolved = toAdd.map((s) => this.formatResolveSymbol(s));
      this.sendUpstream("quote_add_symbols", [this.sub.quoteSession, ...resolved]);
      for (const s of toAdd) this.sub.symbols.add(s);
      if (this.sub.includeMinuteBars && this.sub.chartSession) {
        for (const s of toAdd) this.attachChartSeriesForSymbol(s);
      }
    }
    await this.persistSnapshot();
    return Response.json({
      ok: true,
      added: toAdd,
      removed: toRemove,
      symbols: [...this.sub.symbols],
    });
  }

  private async handleClose(): Promise<Response> {
    if (this.sub.upstream) {
      this.sub.upstream.close(1000, "client_close");
      this.sub.upstream = null;
    }
    for (const [, pq] of this.sub.pending) {
      if (pq.timer) clearTimeout(pq.timer);
    }
    this.sub.pending.clear();
    for (const [, c] of this.sseClients) {
      try {
        await c.writer.close();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();
    this.sub = newSubscriptionState();
    await this.clearPersistedSnapshot();
    return Response.json({ ok: true });
  }

  private handleSse(request: Request): Response {
    if (!this.sub.ready) {
      return Response.json({ error: "stream not initialized" }, { status: 409 });
    }
    const url = new URL(request.url);
    const lastEventId = request.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
    const sinceSeq = lastEventId ? Number(lastEventId) : NaN;
    const id = `sse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    const sendChunk = async (chunk: string) => {
      try {
        await writer.write(encoder.encode(chunk));
      } catch {
        const entry = this.sseClients.get(id);
        if (entry) entry.closed = true;
      }
    };

    this.sseClients.set(id, { writer, closed: false });
    // Cancel any pending idle alarm — consumer attached.
    this.cancelIdleAlarm();

    const replay = Number.isFinite(sinceSeq)
      ? this.sub.ring.filter((e) => e.seq > sinceSeq)
      : this.sub.ring.slice();

    void (async () => {
      await sendChunk(`retry: 3000\n\n`);
      for (const ev of replay) {
        await sendChunk(formatSseEvent(ev));
      }
      const start = Date.now();
      const tick = async () => {
        const entry = this.sseClients.get(id);
        if (!entry || entry.closed) {
          this.sseClients.delete(id);
          this.armIdleAlarmIfNoConsumers();
          return;
        }
        if (Date.now() - start >= SSE_DEFAULT_MAX_AGE_MS) {
          await sendChunk(`event: close\ndata: {"reason":"max_age"}\n\n`);
          await writer.close().catch(() => {});
          this.sseClients.delete(id);
          this.armIdleAlarmIfNoConsumers();
          return;
        }
        await sendChunk(`: heartbeat\n\n`);
        setTimeout(tick, SSE_HEARTBEAT_MS);
      };
      setTimeout(tick, SSE_HEARTBEAT_MS);
    })();

    return new Response(stream.readable, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-stream-id": id,
      },
    });
  }

  // ----- alarm + idle close -----

  /**
   * DO storage alarm fires when the stream has been without an SSE consumer
   * for IDLE_STREAM_AUTO_CLOSE_MS. Closes the upstream WS and clears state.
   * The KV registry is GC'd lazily on the next /subscribe; we don't need to
   * call back to the Worker here, which keeps the DO independently terminating.
   */
  async alarm(): Promise<void> {
    const idleSinceMs = Date.now() - this.lastConsumerSeenAt;
    if (this.sseClients.size === 0 && idleSinceMs >= IDLE_STREAM_AUTO_CLOSE_MS) {
      if (this.sub.upstream) {
        this.sub.upstream.close(1000, "idle_close");
        this.sub.upstream = null;
      }
      for (const [, pq] of this.sub.pending) if (pq.timer) clearTimeout(pq.timer);
      this.sub.pending.clear();
      this.sub = newSubscriptionState();
      await this.clearPersistedSnapshot();
      if (this.idleCloseFn) await this.idleCloseFn().catch(() => {});
    }
  }

  private armIdleAlarmIfNoConsumers(): void {
    if (this.sseClients.size > 0) return;
    this.lastConsumerSeenAt = Date.now();
    const storage = this.state.storage as unknown as AlarmStorage;
    if (typeof storage?.setAlarm === "function") {
      void storage.setAlarm(Date.now() + IDLE_STREAM_AUTO_CLOSE_MS).catch(() => {});
    }
  }

  private cancelIdleAlarm(): void {
    const storage = this.state.storage as unknown as AlarmStorage;
    if (typeof storage?.deleteAlarm === "function") {
      void storage.deleteAlarm().catch(() => {});
    }
  }

  // ----- upstream lifecycle -----

  private async openUpstream(): Promise<void> {
    const wsUrl = TRADINGVIEW_WS_ENDPOINTS[this.sub.endpoint];
    const fetcher = authTokenFetcher ?? defaultAuthTokenFetcher;
    const token = await fetcher(this.sub.sessionId, this.sub.sessionSign);
    if (token === "unauthorized_user_token") {
      throw new Error("auth_error");
    }
    const factory = upstreamFactory ?? defaultUpstreamFactory;
    const socket = await factory(
      {
        url: wsUrl,
        sessionId: this.sub.sessionId,
        sessionSign: this.sub.sessionSign,
        endpoint: this.sub.endpoint,
        authToken: token,
      },
      {
        onMessage: (text) => this.onUpstreamMessage(text),
        onClose: (code, reason) => this.onUpstreamClose(code, reason),
        onError: (err) => this.onUpstreamError(err),
        onAuthFailure: () => this.onAuthFailure(),
      },
    );
    this.sub.upstream = socket;
    this.sub.upstreamRetries = 0;

    const send = (m: string, p: any[]) => socket.send(frameTradingViewMessage(m, p));
    send("set_auth_token", [token]);
    send("set_locale", ["en", "US"]);
    send("quote_create_session", [this.sub.quoteSession]);
    send("quote_set_fields", [this.sub.quoteSession, ...this.sub.fields]);
    const resolvedSyms = [...this.sub.symbols].map((s) => this.formatResolveSymbol(s));
    send("quote_add_symbols", [this.sub.quoteSession, ...resolvedSyms]);
    send("quote_fast_symbols", [this.sub.quoteSession, ...this.sub.symbols]);
    if (this.sub.includeMinuteBars && this.sub.chartSession) {
      send("chart_create_session", [this.sub.chartSession, ""]);
      for (const s of this.sub.symbols) this.attachChartSeriesForSymbol(s);
    }
  }

  private formatResolveSymbol(s: string): string {
    return "=" + JSON.stringify({ symbol: s, adjustment: "splits" });
  }

  private attachChartSeriesForSymbol(symbol: string) {
    if (!this.sub.chartSession) return;
    const seriesId = `qss_${this.sub.chartSeriesBySymbol.size + 1}`;
    const symId = `qsy_${this.sub.chartSeriesBySymbol.size + 1}`;
    this.sub.chartSeriesBySymbol.set(symbol, seriesId);
    const send = (m: string, p: any[]) => this.sendUpstream(m, p);
    send("resolve_symbol", [this.sub.chartSession, symId, this.formatResolveSymbol(symbol)]);
    send("create_series", [this.sub.chartSession, seriesId, "s1", symId, this.sub.timeframe, 1, ""]);
  }

  private sendUpstream(name: string, params: any[]) {
    if (!this.sub.upstream) return;
    this.sub.upstream.send(frameTradingViewMessage(name, params));
  }

  private onUpstreamMessage(text: string) {
    if (text === "2") {
      // Engine.IO ping → pong
      this.sub.upstream?.send("3");
      return;
    }
    const frames = parseFrames(text);
    for (const frame of frames) {
      if (frame.type === "ping") {
        this.sub.upstream?.send(frame.data);
        continue;
      }
      if (frame.type !== "event" || !frame.data) continue;
      this.dispatchTradingviewEvent(frame.data);
    }
  }

  private dispatchTradingviewEvent(payload: { m?: string; p?: any[] }) {
    const m = payload?.m;
    const p = payload?.p ?? [];
    if (m === "qsd") {
      const q = p[1];
      if (q?.n && q?.s) this.queueQuoteUpdate(q.n, q.s);
      return;
    }
    if (m === "quote_completed" || m === "symbol_resolved") {
      // Loaded — no-op for streaming.
      return;
    }
    if (m === "symbol_error" || m === "series_error") {
      this.enqueueEvent({
        kind: "error",
        reason: typeof p[1] === "string" ? p[1] : (m === "symbol_error" ? "symbol_error" : "series_error"),
        data: p,
      });
      return;
    }
    if (m === "du" && this.sub.includeMinuteBars) {
      this.handleChartUpdate(p[1]);
      return;
    }
    if (m === "timescale_update" && this.sub.includeMinuteBars) {
      this.handleChartUpdate(p[1]);
      return;
    }
    if (m === "critical_error" || m === "protocol_error") {
      this.enqueueEvent({ kind: "error", reason: m, data: p });
      return;
    }
  }

  private queueQuoteUpdate(symbol: string, fields: Record<string, any>) {
    let pq = this.sub.pending.get(symbol);
    if (!pq) {
      pq = { fields: {}, timer: null };
      this.sub.pending.set(symbol, pq);
    }
    Object.assign(pq.fields, fields);
    if (pq.timer == null) {
      pq.timer = setTimeout(() => this.flushQuote(symbol), QUOTE_THROTTLE_INTERVAL_MS);
    }
  }

  private flushQuote(symbol: string) {
    const pq = this.sub.pending.get(symbol);
    if (!pq) return;
    pq.timer = null;
    if (Object.keys(pq.fields).length === 0) {
      this.sub.pending.delete(symbol);
      return;
    }
    const fields = pq.fields;
    pq.fields = {};
    this.enqueueEvent({ kind: "quote", symbol, fields });
  }

  private handleChartUpdate(slot: any) {
    if (!slot || typeof slot !== "object") return;
    for (const [seriesId, payload] of Object.entries(slot)) {
      const symbol = this.findSymbolBySeries(seriesId);
      if (!symbol) continue;
      const bars: any[] = (payload as any)?.s ?? [];
      for (const bar of bars) {
        const v = bar?.v;
        if (!Array.isArray(v) || v.length < 5) continue;
        this.enqueueEvent({
          kind: "bar",
          symbol,
          bar: {
            time: v[0],
            open: v[1],
            high: v[2],
            low: v[3],
            close: v[4],
            volume: v[5] ?? 0,
          },
        });
      }
    }
  }

  private findSymbolBySeries(seriesId: string): string | null {
    for (const [sym, sid] of this.sub.chartSeriesBySymbol) {
      if (sid === seriesId) return sym;
    }
    return null;
  }

  private onAuthFailure() {
    this.sub.authBlocked = true;
    this.enqueueEvent({ kind: "error", reason: "auth_error" });
    if (this.sub.upstream) {
      this.sub.upstream.close(1008, "auth_error");
      this.sub.upstream = null;
    }
  }

  private onUpstreamError(err: any) {
    this.enqueueEvent({
      kind: "error",
      reason: "upstream_error",
      data: { message: err?.message || String(err) },
    });
  }

  private onUpstreamClose(code: number, reason: string) {
    this.enqueueEvent({
      kind: "control",
      reason: "upstream_closed",
      data: { code, reason },
    });
    this.sub.upstream = null;
    if (this.sub.authBlocked) return;
    // Attempt reconnect with bounded backoff.
    if (this.sub.upstreamRetries >= TV_WS_RETRY_BACKOFF_MS.length) {
      this.enqueueEvent({ kind: "error", reason: "upstream_retry_exhausted" });
      return;
    }
    const delay = TV_WS_RETRY_BACKOFF_MS[this.sub.upstreamRetries];
    this.sub.upstreamRetries += 1;
    setTimeout(() => {
      void this.openUpstream().catch((err) => {
        if (err?.message === "auth_error") this.onAuthFailure();
      });
    }, delay);
  }

  // ----- ring buffer / fanout -----

  private enqueueEvent(partial: Omit<QuoteEvent, "seq" | "ts">) {
    const ev: QuoteEvent = {
      seq: this.sub.nextSeq++,
      ts: new Date().toISOString(),
      ...partial,
    };
    this.sub.ring.push(ev);
    if (this.sub.ring.length > RING_BUFFER_MAX) {
      this.sub.ring.splice(0, this.sub.ring.length - RING_BUFFER_MAX);
      this.sub.truncated = true;
    }
    const chunk = formatSseEvent(ev);
    for (const [id, client] of this.sseClients) {
      if (client.closed) {
        this.sseClients.delete(id);
        continue;
      }
      void client.writer.write(new TextEncoder().encode(chunk)).catch(() => {
        client.closed = true;
        this.sseClients.delete(id);
      });
    }
  }

  // ----- persistence (alarm survival only — ring buffer stays in-memory) -----

  private async persistSnapshot(): Promise<void> {
    const storage = this.state.storage as unknown as AlarmStorage;
    if (typeof storage?.put !== "function") return;
    await storage
      .put("snapshot", {
        symbols: [...this.sub.symbols],
        fields: this.sub.fields,
        includeMinuteBars: this.sub.includeMinuteBars,
        timeframe: this.sub.timeframe,
        endpoint: this.sub.endpoint,
        hmacClient: this.sub.hmacClient,
      })
      .catch(() => {});
  }

  private async clearPersistedSnapshot(): Promise<void> {
    const storage = this.state.storage as unknown as AlarmStorage;
    if (typeof storage?.delete !== "function") return;
    await storage.delete("snapshot").catch(() => {});
  }

  // ----- test hooks -----

  _snapshot() {
    return {
      ready: this.sub.ready,
      hmacClient: this.sub.hmacClient,
      symbols: [...this.sub.symbols],
      fields: this.sub.fields,
      includeMinuteBars: this.sub.includeMinuteBars,
      timeframe: this.sub.timeframe,
      ringLength: this.sub.ring.length,
      truncated: this.sub.truncated,
      nextSeq: this.sub.nextSeq,
      sseClients: this.sseClients.size,
      pendingSymbols: [...this.sub.pending.keys()],
      authBlocked: this.sub.authBlocked,
      upstreamRetries: this.sub.upstreamRetries,
    };
  }

  /** Test seam: directly inject a TV WS frame into the consumer. */
  _injectFrame(text: string) {
    this.onUpstreamMessage(text);
  }

  /** Test seam: trigger upstream-close handler. */
  _injectUpstreamClose(code: number, reason: string) {
    this.onUpstreamClose(code, reason);
  }

  /** Test seam: trigger auth failure path. */
  _injectAuthFailure() {
    this.onAuthFailure();
  }

  /** Test seam: register an idle-close callback for verification. */
  _setIdleCloseCallback(fn: (() => Promise<void>) | null) {
    this.idleCloseFn = fn;
  }
}

// === SSE formatting =====================================================

const formatSseEvent = (ev: QuoteEvent): string => {
  const eventName = `quote.${ev.kind}`;
  return [
    `id: ${ev.seq}`,
    `event: ${eventName}`,
    `data: ${JSON.stringify(ev)}`,
  ].join("\n") + "\n\n";
};

export { RING_BUFFER_MAX, DEFAULT_QUOTE_FIELDS };
