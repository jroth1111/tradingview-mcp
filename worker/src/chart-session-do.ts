// Stateful chart-session Durable Object for the TradingView Worker.
//
// One DO instance owns one TradingView WebSocket and one chart session for
// the lifetime of an iteration loop. It exposes JSON sub-routes the Worker
// fetches via stub.fetch(): /create, /study/create, /study/modify,
// /replay/step, /close. This lets the UI debounce study-input edits, build
// study-on-study chains, step through replay, and iterate Pine code without
// re-establishing the upstream WS on every call.
//
// WebSocket plumbing (connect/auth/parse) duplicated from
// worker/src/tradingview.ts because `connect` is not exported there. When
// tradingview.ts exposes `connect` (and `parseMessage`/`getAuthToken`), swap
// to the shared primitive.
//
// State is in-memory only: this v1 does not persist slots or the session
// token across DO hibernation. If hibernation occurs between calls the
// caller must /create again. Persisting via DurableObjectState.storage is a
// follow-up (see report).

import { RawWebSocket } from "./tv-raw-socket";
import {
  TIMEFRAME_MAP,
  TRADINGVIEW_BASICSTUDIES_VERSION,
  TRADINGVIEW_PINE_SCRIPT_WIRE_ID,
  TRADINGVIEW_WS_ENDPOINTS,
  VALID_TIMEFRAMES,
  buildChartSessionWsUrl,
  clampBarCount,
  frameTradingViewMessage,
  normalizeTradingViewPayload,
  type BarLimitMode,
  type BarLimitPlan,
  type TradingviewEndpoint,
} from "../../packages/tradingview-core/src";
import { decodeWSEvent } from "./ws-events";

// === Public types ===

export interface CreateChartSessionRequest {
  symbol: string;
  timeframe?: string | number;
  bars?: number;
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  timeoutMs?: number;
  barLimitMode?: BarLimitMode;
  barLimitPlan?: BarLimitPlan;
}

export interface CreateChartSessionResponse {
  ok: true;
  chartSession: string;
  parentSeriesId: "sds_1";
}

export interface StudyCreateRequest {
  studyId: string;
  inputs?: Record<string, any>;
  params?: Record<string, any>;
  parentSlot?: string; // sds_1 (default) or stN
  slotName?: string; // optional; otherwise auto-assigned st1, st2, ...
  timeoutMs?: number;
}

export interface StudyPlot {
  id: string;
  name: string;
  type: string;
  data: Array<{ ts: number; value: any }>;
}

export interface StudyCreateResponse {
  ok: true;
  slotName: string;
  wireId: string;
  studyVersion: string;
  plots: StudyPlot[];
  nonseries?: Record<string, any>;
}

export interface StudyModifyRequest {
  slotName: string;
  inputs: Record<string, any>;
  params?: Record<string, any>;
  timeoutMs?: number;
}

export interface StudyModifyResponse {
  ok: true;
  slotName: string;
  plots: StudyPlot[];
  nonseries?: Record<string, any>;
}

export interface ReplayStepRequest {
  direction: "forward" | "backward";
  bars?: number;
}

export interface ReplayStepResponse {
  ok: true;
  direction: "forward" | "backward";
  bars: number;
  barsAdvanced: number;
}

export interface SlotEntry {
  slotName: string;
  studyId: string;
  wireId: string;
  studyVersion: string;
  parentSlot: string;
  /** Bumped on each modify_study send so the upstream sees a fresh turnaround cookie. */
  turnaround: number;
  meta: { inputs: any[]; plots: any[] } | null;
  /** Last-known input wire dict for the slot; merged with new inputs on modify. */
  lastInputs: Record<string, any>;
}

export interface ChartSessionState {
  symbol: string;
  timeframe: string;
  bars: number;
  chartSession: string;
  parentSeriesId: "sds_1";
  endpoint: TradingviewEndpoint;
  sessionId?: string;
  sessionSign?: string;
  slots: SlotEntry[];
}

// === Internal types (mirroring tradingview.ts) ===

type TradingviewEvent = { name: string; params: any[] };
type Subscriber = (event: TradingviewEvent) => void;
type Unsubscriber = () => void;

export interface TradingviewConnection {
  subscribe: (handler: Subscriber) => Unsubscriber;
  send: (name: string, params: any[]) => void;
  close: () => Promise<void>;
}

export type ConnectFactory = (opts: {
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  timeoutMs?: number;
}) => Promise<TradingviewConnection>;

interface ResolvedWireId {
  wireId: string;
  version: string;
  pineId?: string;
}

interface IndicatorMetaLike {
  inputs: any[];
  plots: any[];
  script?: string;
  version?: string;
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

const generateSessionId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const validateTimeframe = (tf: string | number): string => {
  const tfStr = typeof tf === "number" ? tf.toString() : tf;
  if (VALID_TIMEFRAMES.has(tfStr)) return tfStr;
  const mapped = TIMEFRAME_MAP.get(tfStr.toLowerCase());
  if (mapped) return mapped;
  throw new Error(`Invalid timeframe: ${tf}`);
};

const isUnixSeconds = (n: any): boolean =>
  typeof n === "number" && n > 1_000_000_000 && n < 4_000_000_000;

// === WebSocket plumbing (duplicated from tradingview.ts) ===

const parseMessage = (message: string) => {
  if (!message) return [];
  const normalized = normalizeTradingViewPayload(message.toString());
  return normalized
    .split(/~m~\d+~m~/)
    .slice(1)
    .map((event) => {
      if (event.startsWith("~h~")) {
        return { type: "ping" as const, data: `~m~${event.length}~m~${event}` };
      }
      const parsed = JSON.parse(event);
      if (parsed["session_id"]) return { type: "session" as const, data: parsed };
      return { type: "event" as const, data: parsed };
    });
};

const getAuthToken = async (sessionId?: string, sessionSign?: string): Promise<string> => {
  if (!sessionId) return "unauthorized_user_token";
  const cookie = sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`;
  try {
    const resp = await fetch("https://www.tradingview.com/disclaimer/", {
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.tradingview.com/",
      },
    });
    if (!resp.ok) return "unauthorized_user_token";
    const text = await resp.text();
    const match = text.match(/"auth_token":"(.+?)"/);
    return match ? match[1] : "unauthorized_user_token";
  } catch {
    return "unauthorized_user_token";
  }
};

const defaultConnect: ConnectFactory = async (opts) => {
  const preferred =
    opts.endpoint && TRADINGVIEW_WS_ENDPOINTS[opts.endpoint] ? opts.endpoint : "prodata";
  const fallback = (Object.keys(TRADINGVIEW_WS_ENDPOINTS) as TradingviewEndpoint[]).filter(
    (k) => k !== preferred,
  );
  const attempts = [preferred, ...fallback];
  const token = await getAuthToken(opts.sessionId, opts.sessionSign);
  let lastError: any;

  for (const ep of attempts) {
    const wsUrl = buildChartSessionWsUrl(ep);
    const socket = new RawWebSocket(wsUrl, {
      sessionId: opts.sessionId,
      sessionSign: opts.sessionSign,
    });
    const subscribers = new Set<Subscriber>();

    const subscribe = (handler: Subscriber): Unsubscriber => {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    };

    const send = (name: string, params: any[]) => {
      const framed = frameTradingViewMessage(name, params);
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
            }
          }
        };

        socket.connect(opts.timeoutMs ?? 10000).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      return connection;
    } catch (err) {
      lastError = err;
      await socket.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }
  }

  throw lastError || new Error("Failed to connect to any TradingView endpoint");
};

// Test seam: lets unit tests inject a fake connection without touching the real
// WS layer. Production callers never set this; defaults to defaultConnect.
let connectFactory: ConnectFactory = defaultConnect;
export const _setConnectFactoryForTests = (factory: ConnectFactory | null) => {
  connectFactory = factory ?? defaultConnect;
};

// === Pine-facade helpers (mirrored from tradingview.ts) ===

const resolveStudyWireId = async (
  rawId: string,
  sessionId?: string,
  sessionSign?: string,
): Promise<ResolvedWireId> => {
  if (rawId.includes("@")) {
    const versionMatch = rawId.match(/@[a-z-]+-([0-9]+)!?$/);
    return { wireId: rawId, version: versionMatch?.[1] ?? "last" };
  }

  if (rawId.startsWith("PUB;") || rawId.startsWith("USER;")) {
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers["cookie"] = sessionSign
        ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
        : `sessionid=${sessionId}`;
    }
    const versionsUrl = `https://pine-facade.tradingview.com/pine-facade/versions/${encodeURIComponent(rawId)}/last`;
    let version = "1.0";
    try {
      const resp = await fetch(versionsUrl, { headers });
      if (resp.ok) {
        const data: any = await resp.json();
        const v = Array.isArray(data) ? data[0]?.version : data?.version;
        if (v != null) version = String(v);
      }
    } catch {
      // version lookup is best-effort; the chart loader accepts "1.0" as a default.
    }
    return { wireId: TRADINGVIEW_PINE_SCRIPT_WIRE_ID, version, pineId: rawId };
  }

  // Built-in studies: drop the legacy STD; prefix and pin to the current basicstudies pack.
  const bareId = rawId.startsWith("STD;") ? rawId.slice(4) : rawId;
  return {
    wireId: `${bareId}@tv-basicstudies-${TRADINGVIEW_BASICSTUDIES_VERSION}`,
    version: TRADINGVIEW_BASICSTUDIES_VERSION,
  };
};

const fetchIndicatorMeta = async (
  studyId: string,
  sessionId?: string,
  sessionSign?: string,
): Promise<IndicatorMetaLike | null> => {
  const id = studyId.split("@")[0];
  if (!id) return null;
  const indicId = id.replace(/ |%/g, "%25");
  const headers: Record<string, string> = {};
  if (sessionId) {
    headers["cookie"] = sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`;
  }
  try {
    const resp = await fetch(
      `https://pine-facade.tradingview.com/pine-facade/translate/${indicId}/last`,
      { headers },
    );
    if (!resp.ok) return null;
    const data: any = await resp.json();
    if (!data?.success || !data?.result?.metaInfo) return null;
    const meta = data.result.metaInfo;
    const script = data.result.ilTemplate ?? data.result.IL ?? undefined;
    const version = data.result.metaInfo?.pine?.version ?? data.result.metaInfo?.version;
    return {
      inputs: meta.inputs || [],
      plots: meta.plots || [],
      script,
      version: version != null ? String(version) : undefined,
    };
  } catch {
    return null;
  }
};

const buildInputsDict = (
  rawInputs: Record<string, any> | undefined,
  paramsByName: Record<string, any> | undefined,
  meta: IndicatorMetaLike | null,
  parentSlot: string,
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
      if (t === "source" && typeof v === "string" && SOURCE_ALIASES.has(v)) {
        inputs[id] = `${parentSlot}$${v}`;
      }
      if (t === "symbol" && typeof v === "string") {
        inputs[id] = { type: "symbol", value: v };
      }
    }
  }
  return inputs;
};

const buildStudyPlots = (
  meta: IndicatorMetaLike | null,
  rows: Array<{ i: number; v: any[] }>,
  seriesIndexToTs: Map<number, number>,
): StudyPlot[] => {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.i - b.i);
  const sample = sorted[0]?.v ?? [];
  const tsIsFirst = sample.length > 0 && isUnixSeconds(sample[0]);

  const plotDefs = (meta?.plots || []).filter((p: any) => p?.type !== "no_series");
  const numPlotChannels = tsIsFirst ? sample.length - 1 : sample.length;
  const plotCount = plotDefs.length || numPlotChannels;

  const plots: StudyPlot[] = [];
  for (let pi = 0; pi < plotCount; pi += 1) {
    const def = plotDefs[pi] || {};
    const data: Array<{ ts: number; value: any }> = [];
    for (const row of sorted) {
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

// === Durable Object class ===

const DEFAULT_CREATE_TIMEOUT_MS = 15000;
const DEFAULT_STUDY_TIMEOUT_MS = 15000;
const DEFAULT_MODIFY_TIMEOUT_MS = 15000;
const MODIFY_DEBOUNCE_MS = 500;

export class ChartSession {
  private state: DurableObjectState;
  private env: CloudflareBindings;

  private connection: TradingviewConnection | null = null;
  private chartSessionState: ChartSessionState | null = null;
  private nextSlotIndex = 1;

  // Latest accumulated du payload per slot. Cleared per slot on modify so the
  // debounce window observes only fresh data.
  private lastDuRowsBySlot: Record<string, Array<{ i: number; v: any[] }>> = {};
  private lastNsBySlot: Record<string, Record<string, any>> = {};
  private seriesIndexToTs = new Map<number, number>();

  // Replay session token; lazily created on first /replay/step. Wire format
  // for the client-sent replay verbs is partially documented (see report);
  // implementation is best-effort and may need a recon probe to confirm.
  private replaySession: string | null = null;

  constructor(state: DurableObjectState, env: CloudflareBindings) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      switch (path) {
        case "/create":
          return await this.handleCreate(request);
        case "/study/create":
          return await this.handleStudyCreate(request);
        case "/study/modify":
          return await this.handleStudyModify(request);
        case "/study/remove":
          return await this.handleStudyRemove(request);
        case "/replay/step":
          return await this.handleReplayStep(request);
        case "/replay/start":
          return await this.handleReplayStart(request);
        case "/replay/stop":
          return await this.handleReplayStop(request);
        case "/replay/set-resolution":
          return await this.handleReplaySetResolution(request);
        case "/replay/get-depth":
          return await this.handleReplayGetDepth(request);
        case "/series/modify":
          return await this.handleSeriesModify(request);
        case "/series/timeframe":
          return await this.handleSeriesTimeframe(request);
        case "/quality":
          return await this.handleSetDataQuality(request);
        case "/timezone":
          return await this.handleSwitchTimezone(request);
        case "/quote/hibernate":
          return await this.handleQuoteHibernate(request);
        case "/pointset/create":
          return await this.handlePointsetCreate(request);
        case "/pointset/modify":
          return await this.handlePointsetModify(request);
        case "/pointset/remove":
          return await this.handlePointsetRemove(request);
        case "/close":
          return await this.handleClose();
        default:
          return Response.json({ error: `unknown sub-path: ${path}` }, { status: 404 });
      }
    } catch (err: any) {
      return Response.json({ error: err?.message || "DO error" }, { status: 500 });
    }
  }

  // --- handlers ---

  private async handleCreate(request: Request): Promise<Response> {
    let body: CreateChartSessionRequest;
    try {
      body = (await request.json()) as CreateChartSessionRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || !body.symbol || typeof body.symbol !== "string") {
      return Response.json(
        { error: "symbol (string) is required" },
        { status: 400 },
      );
    }

    const timeframe = validateTimeframe(body.timeframe ?? "60");
    const { bars } = clampBarCount(
      body.bars ?? 300,
      body.barLimitMode,
      body.barLimitPlan,
    );
    const endpoint: TradingviewEndpoint = body.endpoint ?? "prodata";

    // Tear down any prior session — /create is the explicit reset point.
    if (this.connection) {
      await this.connection.close().catch(() => {});
      this.connection = null;
    }
    this.chartSessionState = null;
    this.lastDuRowsBySlot = {};
    this.lastNsBySlot = {};
    this.seriesIndexToTs = new Map();
    this.replaySession = null;
    this.nextSlotIndex = 1;

    const chartSession = generateSessionId("cs");
    const parentSeriesId = "sds_1";

    const connection = await connectFactory({
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
      endpoint,
      timeoutMs: body.timeoutMs,
    });

    // Wire up the long-lived event handler before sending anything.
    connection.subscribe((event) => this.onEvent(event));

    await this.state.blockConcurrencyWhile(async () => {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let ttl: ReturnType<typeof setTimeout> | null = null;
        // unsub is hoisted so finish() can call it even when the send block
        // throws before the subscriber is fully wired into the closure.
        let unsub: (() => void) = () => {};
        const finish = (err: any | null) => {
          if (settled) return;
          settled = true;
          if (ttl) clearTimeout(ttl);
          unsub();
          if (err) reject(err);
          else resolve();
        };

        // We can't rely on the long-lived subscriber alone here because we
        // need to detect series_completed and any errors *during* the
        // create handshake. Layer a one-shot subscriber on top.
        unsub = connection.subscribe((event) => {
          if (event.name === "series_completed") {
            finish(null);
            return;
          }
          if (event.name === "symbol_error") {
            finish(new Error(`symbol_error: ${JSON.stringify(event.params)}`));
            return;
          }
          if (event.name === "series_error") {
            finish(new Error(`series_error: ${JSON.stringify(event.params)}`));
          }
        });

        try {
          connection.send("chart_create_session", [chartSession, ""]);
          connection.send("resolve_symbol", [
            chartSession,
            "sds_sym_1",
            "=" + JSON.stringify({ symbol: body.symbol, adjustment: "splits" }),
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
        } catch (err) {
          finish(err);
        }

        ttl = setTimeout(() => {
          finish(new Error("timed out creating chart session"));
        }, body.timeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS);
      });
    });

    this.connection = connection;
    this.chartSessionState = {
      symbol: body.symbol,
      timeframe,
      bars,
      chartSession,
      parentSeriesId,
      endpoint,
      sessionId: body.sessionId,
      sessionSign: body.sessionSign,
      slots: [],
    };

    const resp: CreateChartSessionResponse = {
      ok: true,
      chartSession,
      parentSeriesId,
    };
    return Response.json(resp);
  }

  private async handleStudyCreate(request: Request): Promise<Response> {
    if (!this.connection || !this.chartSessionState) {
      return Response.json(
        { error: "no active chart session; call /create first" },
        { status: 400 },
      );
    }
    let body: StudyCreateRequest;
    try {
      body = (await request.json()) as StudyCreateRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || !body.studyId || typeof body.studyId !== "string") {
      return Response.json({ error: "studyId (string) is required" }, { status: 400 });
    }

    const slotName = body.slotName ?? this.allocateSlotName();
    if (this.chartSessionState.slots.find((s) => s.slotName === slotName)) {
      return Response.json({ error: `slot ${slotName} already exists` }, { status: 400 });
    }
    const parentSlot = body.parentSlot ?? this.chartSessionState.parentSeriesId;

    const [{ wireId, version, pineId }, meta] = await Promise.all([
      resolveStudyWireId(
        body.studyId,
        this.chartSessionState.sessionId,
        this.chartSessionState.sessionSign,
      ).catch(
        () => ({ wireId: body.studyId, version: "last" }) as ResolvedWireId,
      ),
      fetchIndicatorMeta(
        body.studyId,
        this.chartSessionState.sessionId,
        this.chartSessionState.sessionSign,
      ),
    ]);

    const inputsDict = buildInputsDict(body.inputs, body.params, meta, parentSlot);

    if (wireId === TRADINGVIEW_PINE_SCRIPT_WIRE_ID) {
      const scriptId = pineId ?? body.studyId.split("@")[0];
      if (!meta?.script) {
        return Response.json(
          {
            error: `pine script ${scriptId} missing IL: pine-facade/translate did not return ilTemplate`,
          },
          { status: 502 },
        );
      }
      inputsDict.text = meta.script;
      inputsDict.pineId = scriptId;
      inputsDict.pineVersion = meta.version ?? version ?? "1.0";
    }

    const turnaround = 1;
    const slotEntry: SlotEntry = {
      slotName,
      studyId: body.studyId,
      wireId,
      studyVersion: version,
      parentSlot,
      turnaround,
      meta,
      lastInputs: inputsDict,
    };

    // Reset per-slot accumulators before sending so we capture only this study's du frames.
    this.lastDuRowsBySlot[slotName] = [];
    this.lastNsBySlot[slotName] = {};

    const connection = this.connection;
    const chartSession = this.chartSessionState.chartSession;

    const result = await new Promise<{ plots: StudyPlot[]; nonseries?: Record<string, any> }>(
      (resolve, reject) => {
        let settled = false;
        const finish = (err: any | null, plots?: StudyPlot[], nonseries?: Record<string, any>) => {
          if (settled) return;
          settled = true;
          unsub();
          clearTimeout(ttl);
          if (err) reject(err);
          else resolve({ plots: plots!, nonseries });
        };

        const unsub = connection.subscribe((event) => {
          try {
            if (event.name === "study_completed") {
              const completedSlot = event.params?.[1];
              if (completedSlot !== slotName) return;
              const rows = this.lastDuRowsBySlot[slotName] || [];
              const plots = buildStudyPlots(meta, rows, this.seriesIndexToTs);
              const ns = this.lastNsBySlot[slotName];
              finish(null, plots, ns && Object.keys(ns).length ? ns : undefined);
              return;
            }
            if (event.name === "study_error") {
              const errSlot = event.params?.[1];
              if (errSlot && errSlot !== slotName) return;
              const reason = event.params?.[2];
              const detail = event.params?.[3];
              finish(
                new Error(
                  `study_error: ${reason ?? "unknown"}${
                    detail ? `: ${JSON.stringify(detail)}` : ""
                  }`,
                ),
              );
            }
          } catch (err) {
            finish(err);
          }
        });

        const ttl = setTimeout(() => {
          // Surface partial du if we got any.
          const rows = this.lastDuRowsBySlot[slotName] || [];
          if (rows.length > 0) {
            const plots = buildStudyPlots(meta, rows, this.seriesIndexToTs);
            const ns = this.lastNsBySlot[slotName];
            finish(null, plots, ns && Object.keys(ns).length ? ns : undefined);
          } else {
            finish(new Error("timed out creating study"));
          }
        }, body.timeoutMs ?? DEFAULT_STUDY_TIMEOUT_MS);

        try {
          connection.send("create_study", [
            chartSession,
            slotName,
            String(turnaround),
            parentSlot,
            wireId,
            inputsDict,
          ]);
        } catch (err) {
          finish(err);
        }
      },
    );

    this.chartSessionState.slots.push(slotEntry);

    const resp: StudyCreateResponse = {
      ok: true,
      slotName,
      wireId,
      studyVersion: version,
      plots: result.plots,
      nonseries: result.nonseries,
    };
    return Response.json(resp);
  }

  private async handleStudyModify(request: Request): Promise<Response> {
    if (!this.connection || !this.chartSessionState) {
      return Response.json(
        { error: "no active chart session; call /create first" },
        { status: 400 },
      );
    }
    let body: StudyModifyRequest;
    try {
      body = (await request.json()) as StudyModifyRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || !body.slotName || typeof body.slotName !== "string") {
      return Response.json({ error: "slotName (string) is required" }, { status: 400 });
    }
    if (!body.inputs || typeof body.inputs !== "object") {
      return Response.json({ error: "inputs (object) is required" }, { status: 400 });
    }

    const slot = this.chartSessionState.slots.find((s) => s.slotName === body.slotName);
    if (!slot) {
      return Response.json(
        { error: `slot ${body.slotName} not found` },
        { status: 404 },
      );
    }

    // Map friendly params into the wire dict and merge with existing inputs so
    // partial modifies don't reset un-touched inputs.
    const overrideDict = buildInputsDict(body.inputs, body.params, slot.meta, slot.parentSlot);
    const nextInputs: Record<string, any> = { ...slot.lastInputs, ...overrideDict };
    slot.lastInputs = nextInputs;
    slot.turnaround += 1;

    // Reset accumulator for this slot so the debounce window only collects fresh frames.
    this.lastDuRowsBySlot[slot.slotName] = [];
    this.lastNsBySlot[slot.slotName] = {};

    const connection = this.connection;
    const chartSession = this.chartSessionState.chartSession;

    const result = await new Promise<{ plots: StudyPlot[]; nonseries?: Record<string, any> }>(
      (resolve, reject) => {
        let settled = false;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const finish = (
          err: any | null,
          plots?: StudyPlot[],
          nonseries?: Record<string, any>,
        ) => {
          if (settled) return;
          settled = true;
          unsub();
          if (debounceTimer) clearTimeout(debounceTimer);
          clearTimeout(ttl);
          if (err) reject(err);
          else resolve({ plots: plots!, nonseries });
        };

        const flush = () => {
          const rows = this.lastDuRowsBySlot[slot.slotName] || [];
          const plots = buildStudyPlots(slot.meta, rows, this.seriesIndexToTs);
          const ns = this.lastNsBySlot[slot.slotName];
          finish(null, plots, ns && Object.keys(ns).length ? ns : undefined);
        };

        const unsub = connection.subscribe((event) => {
          try {
            if (event.name === "du") {
              const slotMap = event.params?.[1] || {};
              if (slotMap[slot.slotName]) {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(flush, MODIFY_DEBOUNCE_MS);
              }
              return;
            }
            if (event.name === "study_completed") {
              const completedSlot = event.params?.[1];
              if (completedSlot !== slot.slotName) return;
              if (debounceTimer) clearTimeout(debounceTimer);
              flush();
              return;
            }
            if (event.name === "study_error") {
              const errSlot = event.params?.[1];
              if (errSlot && errSlot !== slot.slotName) return;
              const reason = event.params?.[2];
              const detail = event.params?.[3];
              finish(
                new Error(
                  `study_error: ${reason ?? "unknown"}${
                    detail ? `: ${JSON.stringify(detail)}` : ""
                  }`,
                ),
              );
            }
          } catch (err) {
            finish(err);
          }
        });

        const ttl = setTimeout(() => {
          const rows = this.lastDuRowsBySlot[slot.slotName] || [];
          if (rows.length > 0) {
            flush();
          } else {
            finish(new Error("timed out modifying study"));
          }
        }, body.timeoutMs ?? DEFAULT_MODIFY_TIMEOUT_MS);

        try {
          // modify_study wire format: [cs, st_slot, turnaround, indicator_id_with_version, inputs]
          // Note 5-arg shape vs create_study's 6-arg (no parent_series_id).
          connection.send("modify_study", [
            chartSession,
            slot.slotName,
            String(slot.turnaround),
            slot.wireId,
            nextInputs,
          ]);
        } catch (err) {
          finish(err);
        }
      },
    );

    const resp: StudyModifyResponse = {
      ok: true,
      slotName: slot.slotName,
      plots: result.plots,
      nonseries: result.nonseries,
    };
    return Response.json(resp);
  }

  private async handleReplayStep(request: Request): Promise<Response> {
    if (!this.connection || !this.chartSessionState) {
      return Response.json(
        { error: "no active chart session; call /create first" },
        { status: 400 },
      );
    }
    let body: ReplayStepRequest;
    try {
      body = (await request.json()) as ReplayStepRequest;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!body || (body.direction !== "forward" && body.direction !== "backward")) {
      return Response.json(
        { error: "direction must be 'forward' or 'backward'" },
        { status: 400 },
      );
    }
    const bars = Math.max(1, body.bars ?? 1);
    // KNOWN GAP — see chart-session-do.ts header & report.
    // The TradingView client-side wire shape for `replay_step` is documented
    // by name only; we observed `replay_step` as a server-emitted frame with
    // params `[replaySession, position]`. The client-sent verb has not been
    // probed end-to-end. The shape below mirrors `replay_reset`'s 3-arg form
    // and is the best-effort guess. When recon confirms the real shape,
    // update this method (and remove the throw if it diverges).
    throw new Error(
      `replay step not implemented; awaiting wire format probe (requested direction=${body.direction}, bars=${bars})`,
    );
    // Once the wire is confirmed, the body roughly looks like:
    //   if (!this.replaySession) {
    //     this.replaySession = generateSessionId("rs_");
    //     this.connection.send("replay_create_session", [this.replaySession]);
    //     this.connection.send("replay_add_series", [
    //       this.replaySession, "symbol_0", this.chartSessionState.symbol, this.chartSessionState.timeframe,
    //     ]);
    //   }
    //   const stepCount = body.direction === "forward" ? bars : -bars;
    //   await new Promise<void>((resolve, reject) => { ... wait for next timescale_update ... });
    //   const resp: ReplayStepResponse = { ok: true, direction: body.direction, bars, barsAdvanced };
    //   return Response.json(resp);
  }

  // === P17 fire-and-forget verbs ===
  // These send a single C->S frame on the live connection and return ok
  // immediately. Any resulting frames flow through the normal `onEvent`
  // pipeline (du, timescale_update, plus the new typed events emitted by
  // ws-events.decodeWSEvent for downstream consumers).

  private requireSession(): { connection: TradingviewConnection; chartSession: string } | Response {
    if (!this.connection || !this.chartSessionState) {
      return Response.json(
        { error: "no active chart session; call /create first" },
        { status: 400 },
      );
    }
    return {
      connection: this.connection,
      chartSession: this.chartSessionState.chartSession,
    };
  }

  private async handleStudyRemove(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as { slotName?: string };
    if (!body.slotName) return Response.json({ error: "slotName required" }, { status: 400 });
    const slotIndex = this.chartSessionState!.slots.findIndex(
      (s) => s.slotName === body.slotName,
    );
    if (slotIndex < 0) {
      return Response.json({ error: `slot ${body.slotName} not found` }, { status: 404 });
    }
    ctx.connection.send("remove_study", [ctx.chartSession, body.slotName]);
    this.chartSessionState!.slots.splice(slotIndex, 1);
    delete this.lastDuRowsBySlot[body.slotName];
    delete this.lastNsBySlot[body.slotName];
    return Response.json({ ok: true, slotName: body.slotName });
  }

  private async handleSeriesModify(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      seriesId?: string;
      sourceId?: string;
      symbolId?: string;
      timeframe?: string | number;
      count?: number;
    };
    const seriesId = body.seriesId || "sds_1";
    const sourceId = body.sourceId || "s1";
    const symbolId = body.symbolId || "sds_sym_1";
    if (!body.timeframe) return Response.json({ error: "timeframe required" }, { status: 400 });
    if (!body.count || body.count < 1) {
      return Response.json({ error: "count (positive integer) required" }, { status: 400 });
    }
    const tf = validateTimeframe(body.timeframe);
    ctx.connection.send("modify_series", [
      ctx.chartSession,
      seriesId,
      sourceId,
      symbolId,
      tf,
      body.count,
    ]);
    if (this.chartSessionState) {
      this.chartSessionState.timeframe = tf;
      this.chartSessionState.bars = body.count;
    }
    return Response.json({ ok: true, seriesId, timeframe: tf, count: body.count });
  }

  private async handleSeriesTimeframe(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      seriesId?: string;
      sourceId?: string;
      timeframe?: string | number;
      range?: { from: number; to: number };
    };
    const seriesId = body.seriesId || "sds_1";
    const sourceId = body.sourceId || "s1";
    if (!body.timeframe) return Response.json({ error: "timeframe required" }, { status: 400 });
    const tf = validateTimeframe(body.timeframe);
    const params: any[] = [ctx.chartSession, seriesId, sourceId, tf];
    if (body.range) {
      const { from, to } = body.range;
      if (typeof from !== "number" || typeof to !== "number" || to < from) {
        return Response.json(
          { error: "range must be { from:number, to:number } with to >= from" },
          { status: 400 },
        );
      }
      params.push({ from, to });
    }
    ctx.connection.send("series_timeframe", params);
    if (this.chartSessionState) this.chartSessionState.timeframe = tf;
    return Response.json({ ok: true, seriesId, timeframe: tf });
  }

  private async handleSetDataQuality(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as { quality?: string };
    if (body.quality !== "low" && body.quality !== "high") {
      return Response.json({ error: "quality must be 'low' or 'high'" }, { status: 400 });
    }
    ctx.connection.send("set_data_quality", [ctx.chartSession, body.quality]);
    return Response.json({ ok: true, quality: body.quality });
  }

  private async handleSwitchTimezone(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as { tz?: string };
    if (!body.tz || typeof body.tz !== "string") {
      return Response.json({ error: "tz (IANA timezone string) required" }, { status: 400 });
    }
    ctx.connection.send("switch_timezone", [ctx.chartSession, body.tz]);
    return Response.json({ ok: true, tz: body.tz });
  }

  private async handleQuoteHibernate(_request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    // Reuse the chart session id as the quote session id only when the DO
    // hasn't tracked a separate quote session. Today the DO doesn't open a
    // dedicated quote session, so we hibernate the chart session's quote
    // pipe by sending the verb against the chart session id; if a future
    // change separates the two, this must be updated to track the qs id.
    ctx.connection.send("quote_hibernate_all", [ctx.chartSession]);
    return Response.json({ ok: true });
  }

  private async handlePointsetCreate(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      pointsetId?: string;
      args?: any[];
    };
    if (!body.pointsetId) return Response.json({ error: "pointsetId required" }, { status: 400 });
    const trailing = Array.isArray(body.args) ? body.args : [];
    ctx.connection.send("create_pointset", [ctx.chartSession, body.pointsetId, ...trailing]);
    return Response.json({ ok: true, pointsetId: body.pointsetId });
  }

  private async handlePointsetModify(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      pointsetId?: string;
      args?: any[];
    };
    if (!body.pointsetId) return Response.json({ error: "pointsetId required" }, { status: 400 });
    const trailing = Array.isArray(body.args) ? body.args : [];
    ctx.connection.send("modify_pointset", [ctx.chartSession, body.pointsetId, ...trailing]);
    return Response.json({ ok: true, pointsetId: body.pointsetId });
  }

  private async handlePointsetRemove(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as { pointsetId?: string };
    if (!body.pointsetId) return Response.json({ error: "pointsetId required" }, { status: 400 });
    ctx.connection.send("remove_pointset", [ctx.chartSession, body.pointsetId]);
    return Response.json({ ok: true, pointsetId: body.pointsetId });
  }

  // === P17 replay verbs ===
  // The DO did not previously send any client-driven replay verbs (only the
  // partial replay_step stub). These send the documented C->S frames against
  // a lazily-created replay session. /replay/get-depth waits for the
  // replay_depth response (decoded via wsEvents); the rest are fire-and-
  // forget and let resulting du/replay_* frames flow through onEvent.

  private ensureReplaySession(connection: TradingviewConnection): string {
    if (this.replaySession) return this.replaySession;
    const rs = generateSessionId("rs");
    connection.send("replay_create_session", [rs]);
    if (this.chartSessionState) {
      connection.send("replay_add_series", [
        rs,
        "rs_1",
        this.chartSessionState.symbol,
        this.chartSessionState.timeframe,
      ]);
    }
    this.replaySession = rs;
    return rs;
  }

  private async handleReplayStart(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      slot?: string;
      args?: any[];
    };
    const slot = body.slot || "rs_1";
    const trailing = Array.isArray(body.args) ? body.args : [];
    const rs = this.ensureReplaySession(ctx.connection);
    ctx.connection.send("replay_start", [rs, slot, ...trailing]);
    return Response.json({ ok: true, replaySession: rs, slot });
  }

  private async handleReplayStop(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as { slot?: string };
    if (!this.replaySession) {
      return Response.json({ error: "no active replay session" }, { status: 400 });
    }
    const slot = body.slot || "rs_1";
    ctx.connection.send("replay_stop", [this.replaySession, slot]);
    return Response.json({ ok: true, replaySession: this.replaySession, slot });
  }

  private async handleReplaySetResolution(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      slot?: string;
      timeframe?: string | number;
    };
    if (!body.timeframe) return Response.json({ error: "timeframe required" }, { status: 400 });
    const tf = validateTimeframe(body.timeframe);
    const slot = body.slot || "rs_1";
    const rs = this.ensureReplaySession(ctx.connection);
    ctx.connection.send("replay_set_resolution", [rs, slot, tf]);
    return Response.json({ ok: true, replaySession: rs, slot, timeframe: tf });
  }

  private async handleReplayGetDepth(request: Request): Promise<Response> {
    const ctx = this.requireSession();
    if (ctx instanceof Response) return ctx;
    const body = (await request.json().catch(() => ({}))) as {
      slot?: string;
      timeoutMs?: number;
    };
    const slot = body.slot || "rs_1";
    const rs = this.ensureReplaySession(ctx.connection);
    const timeoutMs = body.timeoutMs ?? 8000;

    return new Promise<Response>((resolve) => {
      let settled = false;
      const finish = (resp: Response) => {
        if (settled) return;
        settled = true;
        clearTimeout(ttl);
        unsub();
        resolve(resp);
      };
      const unsub = ctx.connection.subscribe((event) => {
        const decoded = decodeWSEvent({ m: event.name, p: event.params });
        if (!decoded) return;
        if (decoded.kind === "replay_depth" && decoded.slot === slot) {
          finish(
            Response.json({ ok: true, replaySession: rs, slot, depth: decoded.depth }),
          );
        }
      });
      const ttl = setTimeout(
        () =>
          finish(
            Response.json(
              { error: "timed out awaiting replay_depth" },
              { status: 504 },
            ),
          ),
        timeoutMs,
      );
      try {
        ctx.connection.send("replay_get_depth", [rs, slot]);
      } catch (err: any) {
        finish(Response.json({ error: err?.message ?? "send failed" }, { status: 500 }));
      }
    });
  }

  private async handleClose(): Promise<Response> {
    if (this.connection) {
      await this.connection.close().catch(() => {});
    }
    this.connection = null;
    this.chartSessionState = null;
    this.lastDuRowsBySlot = {};
    this.lastNsBySlot = {};
    this.seriesIndexToTs = new Map();
    this.replaySession = null;
    this.nextSlotIndex = 1;
    return Response.json({ ok: true });
  }

  // --- internal helpers ---

  private allocateSlotName(): string {
    const name = `st${this.nextSlotIndex}`;
    this.nextSlotIndex += 1;
    return name;
  }

  private onEvent(event: TradingviewEvent) {
    if (event.name === "timescale_update") {
      const sessionData = event.params?.[1] || {};
      for (const [, payload] of Object.entries<any>(sessionData)) {
        const seriesBars: any[] | undefined = payload?.s;
        if (!Array.isArray(seriesBars)) continue;
        for (const bar of seriesBars) {
          if (bar?.i != null && Array.isArray(bar.v) && isUnixSeconds(bar.v[0])) {
            this.seriesIndexToTs.set(bar.i, bar.v[0]);
          }
        }
      }
      return;
    }
    if (event.name === "du") {
      const slotMap = event.params?.[1] || {};
      for (const [slot, payload] of Object.entries<any>(slotMap)) {
        const rows = (payload?.st || []) as Array<{ i: number; v: any[] }>;
        if (rows.length > 0) {
          if (!this.lastDuRowsBySlot[slot]) this.lastDuRowsBySlot[slot] = [];
          this.lastDuRowsBySlot[slot].push(...rows);
        }
        if (payload?.ns) {
          this.lastNsBySlot[slot] = {
            ...(this.lastNsBySlot[slot] || {}),
            ...payload.ns,
          };
        }
      }
    }
  }

  // Test hook: read-only snapshot of in-memory state. Production callers do
  // not use this; tests inspect to verify slot allocation and lifecycle.
  _state(): {
    hasConnection: boolean;
    chartSession: ChartSessionState | null;
    nextSlotIndex: number;
  } {
    return {
      hasConnection: this.connection !== null,
      chartSession: this.chartSessionState
        ? { ...this.chartSessionState, slots: [...this.chartSessionState.slots] }
        : null,
      nextSlotIndex: this.nextSlotIndex,
    };
  }
}
