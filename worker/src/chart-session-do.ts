// Stateful chart-session Durable Object for the TradingView Worker.
//
// One DO instance owns one TradingView WebSocket and one chart session for
// the lifetime of an iteration loop. It exposes JSON sub-routes the Worker
// fetches via stub.fetch(): /create, /study/create, /study/modify,
// /study/remove, /replay/{start,stop,set-resolution,get-depth},
// /series/{modify,timeframe}, /quality, /timezone, /quote/hibernate,
// /pointset/{create,modify,remove}, /close. This lets the UI debounce
// study-input edits, build study-on-study chains, and iterate Pine code
// without re-establishing the upstream WS on every call.
//
// State is in-memory only: this v1 does not persist slots or the session
// token across DO hibernation. If hibernation occurs between calls the
// caller must /create again. Persisting via DurableObjectState.storage is a
// follow-up (see report).

import {
  buildInputsDict,
  buildStudyPlots,
  clampBarCount,
  generateSessionId,
  isPineFlowWireId,
  isUnixSeconds,
  resolveStudyWireId,
  type BarLimitMode,
  type BarLimitPlan,
  type IndicatorMetaShape,
  type ResolvedWireId,
  type StudyPlot,
  type TradingviewEndpoint,
} from "../../packages/tradingview-core/src";
import {
  connect,
  getIndicatorMeta,
  validateTimeframe,
  type TradingviewConnection,
  type TradingviewEvent,
} from "./tradingview";
import { decodeWSEvent } from "./ws-events";

export type { StudyPlot } from "../../packages/tradingview-core/src";
export type { TradingviewConnection } from "./tradingview";

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

export interface SlotEntry {
  slotName: string;
  studyId: string;
  wireId: string;
  studyVersion: string;
  parentSlot: string;
  /** Bumped on each modify_study send so the upstream sees a fresh turnaround cookie. */
  turnaround: number;
  meta: IndicatorMetaShape | null;
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

// === Test-seam types ===

export type ConnectFactory = (opts: {
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  timeoutMs?: number;
}) => Promise<TradingviewConnection>;

// Test seam: lets unit tests inject a fake connection without touching the real
// WS layer. Production callers never set this; defaults to the shared `connect`.
let connectFactory: ConnectFactory = connect;
export const _setConnectFactoryForTests = (factory: ConnectFactory | null) => {
  connectFactory = factory ?? connect;
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

  // Replay session token; lazily created by ensureReplaySession() when the
  // first /replay/* sub-route fires. Stays alive across calls so subsequent
  // verbs reuse the same upstream replay context.
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
      getIndicatorMeta({
        id: body.studyId.split("@")[0],
        sessionId: this.chartSessionState.sessionId,
        sessionSign: this.chartSessionState.sessionSign,
      }).catch(() => null),
    ]);

    const inputsDict = buildInputsDict(body.inputs, body.params, meta, parentSlot);

    if (isPineFlowWireId(wireId)) {
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
    const turnaroundToken = slotName;
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
              // study_error params: [csId, slot, key, reason, detail?].
              // Fall back to the older 4-field form [csId, slot, reason, detail].
              const reason = event.params?.[3] ?? event.params?.[2];
              const detail = event.params?.[4] ?? event.params?.[3];
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
            turnaroundToken,
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
              // study_error params: [csId, slot, key, reason, detail?].
              // Fall back to the older 4-field form [csId, slot, reason, detail].
              const reason = event.params?.[3] ?? event.params?.[2];
              const detail = event.params?.[4] ?? event.params?.[3];
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
          // modify_study wire format: [cs, st_slot, turnaround, inputs]
          // Note 4-arg shape vs create_study's 6-arg (no parent_series_id or study id).
          connection.send("modify_study", [
            chartSession,
            slot.slotName,
            `${slot.slotName}_${slot.turnaround}`,
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
  // Send the documented C->S frames against a lazily-created replay session.
  // /replay/get-depth waits for the replay_depth response (decoded via
  // wsEvents); the rest are fire-and-forget and let resulting du/replay_*
  // frames flow through onEvent.

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
