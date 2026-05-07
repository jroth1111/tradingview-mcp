// Multi-study chain (study-on-study) and short-lived modify helpers.
//
// SCOPE:
//   - modifyStudy: short-lived re-run of a single study with new inputs. Real
//     in-place modify (without re-establishing the chart session) requires a
//     long-lived chart session held in a Cloudflare Durable Object. That is
//     bead tradingview-2v6 and is intentionally out of scope here. This file
//     is the non-DO complement.
//   - runStudyChain: opens ONE chart session, creates a series + N studies
//     sequentially in the same session so studies can chain (e.g. RSI of EMA
//     where study B's parent_series_id is study A's slot "st1"), accumulates
//     du frames per slot, and returns all results in one call.
//
// DUPLICATION NOTICE:
//   `connect` (the chart-session WebSocket primitive in tradingview.ts) is not
//   exported. The chain implementation below re-implements the connect /
//   subscribe / send loop locally. The duplicated section is small (~40 lines
//   of WS bring-up plus message parsing) and mirrors:
//     - tradingview.ts:136-247  (connect)
//     - tradingview.ts:43-95    (parseMessage / normalizePayload)
//     - tradingview.ts:1049-1221 (runStudy lifecycle: chart_create_session,
//       resolve_symbol, create_series, create_study, du frame accumulator,
//       study_completed handler)
//   When the chart-session DO (bead tradingview-2v6) lands, this module
//   should migrate to the DO primitive and the duplicated WS plumbing here
//   should be deleted. See "Suggested follow-up" in the task report.
//
// What is intentionally re-derived locally rather than imported:
//   - resolveStudyWireId (private): we re-derive wire id from the same rules.
//   - buildInputsDict   (private): we re-derive friendly-input mapping and
//     source-alias rewriting.
//   - buildStudyPlots   (private): we re-derive plot extraction from du frames.
//   - SOURCE_ALIASES: values copied verbatim from tradingview.ts.

import {
  runStudy,
  validateTimeframe,
  getIndicatorMeta,
  getAuthToken,
  type StudyRequest,
  type StudyPlot,
  type StudyResult,
  type IndicatorMeta,
} from "./tradingview";
import { RawWebSocket } from "./tv-raw-socket";
import {
  TRADINGVIEW_WS_ENDPOINTS,
  clampBarCount,
  frameTradingViewMessage,
  normalizeTradingViewPayload,
  type BarLimitMode,
  type BarLimitPlan,
  type TradingviewEndpoint,
} from "../../packages/tradingview-core/src";

// === MODIFY ENTRYPOINT ============================================
// Short-lived modify: literal alias for runStudy with explicit naming.
// In TradingView's wire protocol, "modify_study" without holding the chart
// session open is functionally a re-run, so this delegates straight through.
// Real "modify in place" without re-running requires the chart-session DO
// (bead tradingview-2v6); see top-of-file scope notice.
export const modifyStudy = async (req: StudyRequest): Promise<StudyResult> => {
  return runStudy(req);
};

// === CHAIN ENTRYPOINT =============================================
export interface StudyChainSpec {
  /** Canonical study id ("STD;RSI", "PUB;<hash>", "USER;<id>", or already-qualified "STD;RSI@tv-basicstudies-241!"). */
  studyId: string;
  /** Raw wire-form inputs ({in_0, in_1, ...}). Merged with `params` after meta resolution. */
  inputs?: Record<string, any>;
  /** Friendly {name: value} pairs mapped via metainfo. */
  params?: Record<string, any>;
  /** Parent series id. Default "sds_1" (main symbol). May reference a prior chained study's slot (e.g. "st1") to chain studies. */
  parentSlot?: string;
  /** Optional explicit slot name. Auto-assigned to "st1", "st2", ... when omitted. Must be unique within the chain and must start with "st". */
  slotName?: string;
}

export interface StudyChainRequest {
  symbol: string;
  timeframe?: string | number;
  bars?: number;
  studies: StudyChainSpec[];
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  timeoutMs?: number;
  barLimitMode?: BarLimitMode;
  barLimitPlan?: BarLimitPlan;
  to?: number; // optional Unix-seconds end-of-history pin
}

export interface StudyChainResultEntry {
  slotName: string;
  studyId: string;
  wireId: string;
  studyVersion: string;
  parentSlot: string;
  plots: StudyPlot[];
  nonseries?: Record<string, any>;
}

export interface StudyChainResult {
  symbol: string;
  timeframe: string;
  bars: number;
  studies: StudyChainResultEntry[];
}

// === Internal: types & framing copied / re-derived from tradingview.ts ====

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

interface PreparedSpec {
  spec: StudyChainSpec;
  slotName: string;
  parentSlot: string;
  wireId: string;
  version: string;
  meta: IndicatorMeta | null;
  inputsDict: Record<string, any>;
}

type TVEvent = { name: string; params: any[] };

const generateSessionId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const isUnixSeconds = (n: any): boolean =>
  typeof n === "number" && n > 1_000_000_000 && n < 4_000_000_000;

// === Internal: validation ================================================

// Validates the chain spec, assigns slot names where missing, and ensures
// every parentSlot reference points to either the main series or an EARLIER
// study slot. Returns prepared (slotName-resolved) specs in the original
// order.
//
// Exported for unit tests; the chain runner calls this internally.
export const planChainSlots = (specs: StudyChainSpec[]): Array<{ spec: StudyChainSpec; slotName: string; parentSlot: string }> => {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error("studies array required and must contain at least one entry");
  }

  const seen = new Set<string>();
  // sds_1 is the main series and is always available as a parent.
  seen.add("sds_1");

  const out: Array<{ spec: StudyChainSpec; slotName: string; parentSlot: string }> = [];

  specs.forEach((spec, idx) => {
    if (!spec || typeof spec !== "object") {
      throw new Error(`studies[${idx}] must be an object`);
    }
    if (!spec.studyId || typeof spec.studyId !== "string") {
      throw new Error(`studies[${idx}].studyId required`);
    }

    const slotName = spec.slotName || `st${idx + 1}`;
    if (!/^st[a-zA-Z0-9_]+$/.test(slotName)) {
      throw new Error(`studies[${idx}].slotName must match /^st[a-zA-Z0-9_]+$/, got "${slotName}"`);
    }
    if (seen.has(slotName)) {
      throw new Error(`studies[${idx}].slotName "${slotName}" duplicates an earlier slot or the reserved main series id`);
    }

    const parentSlot = spec.parentSlot || "sds_1";
    if (!seen.has(parentSlot)) {
      throw new Error(
        `studies[${idx}].parentSlot "${parentSlot}" must be "sds_1" or an earlier chained study slot; ` +
          `seen so far: ${Array.from(seen).join(", ")}`,
      );
    }

    out.push({ spec, slotName, parentSlot });
    seen.add(slotName);
  });

  return out;
};

// === Internal: wire-id resolution (mirrors tradingview.ts:926) ============

const resolveStudyWireId = async (
  rawId: string,
  sessionId?: string,
  sessionSign?: string,
): Promise<ResolvedWireId> => {
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
  const ns = version === "last" ? "tv-basicstudies" : `tv-basicstudies-${version}`;
  return { wireId: `${rawId}@${ns}!`, version };
};

// === Internal: inputs dict (mirrors tradingview.ts:968) ===================

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
      if (t === "source" && typeof v === "string") {
        if (SOURCE_ALIASES.has(v)) {
          inputs[id] = `${parentSeriesId}$${v}`;
        }
      }
      if (t === "symbol" && typeof v === "string") {
        inputs[id] = { type: "symbol", value: v };
      }
    }
  }

  return inputs;
};

// === Internal: plot extraction (mirrors tradingview.ts:1009) ==============

const buildStudyPlots = (
  meta: { plots?: any[] } | null,
  rowsBySlot: Record<string, Array<{ i: number; v: any[] }>>,
  studySlot: string,
  seriesIndexToTs: Map<number, number>,
): StudyPlot[] => {
  const rows = rowsBySlot[studySlot] || [];
  if (rows.length === 0) return [];

  const sortedRows = [...rows].sort((a, b) => a.i - b.i);
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

// === Internal: payload parsing (mirrors tradingview.ts:43-95) =============

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

// === Internal: chart-session connection (mirrors tradingview.ts:136-247) ==
// Trimmed: only the preferred endpoint is tried. The full multi-endpoint
// fallback is unnecessary for the chain helper since runStudy already
// stresses the public endpoint surface; if this fails, the caller can
// retry with a different endpoint.

interface ChainConnection {
  subscribe: (handler: (e: TVEvent) => void) => () => void;
  send: (name: string, params: any[]) => void;
  close: () => Promise<void>;
}

const openChainConnection = async (opts: {
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  timeoutMs?: number;
}): Promise<ChainConnection> => {
  const ep: TradingviewEndpoint =
    opts.endpoint && TRADINGVIEW_WS_ENDPOINTS[opts.endpoint] ? opts.endpoint : "prodata";
  const wsUrl = TRADINGVIEW_WS_ENDPOINTS[ep];
  const token = await getAuthToken(opts.sessionId, opts.sessionSign);
  const socket = new RawWebSocket(wsUrl, {
    sessionId: opts.sessionId,
    sessionSign: opts.sessionSign,
  });
  const subscribers = new Set<(e: TVEvent) => void>();

  const subscribe = (handler: (e: TVEvent) => void) => {
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
    };
  };

  const send = (name: string, params: any[]) => {
    const framed = frameTradingViewMessage(name, params);
    socket.sendText(framed).catch(() => {});
  };

  const close = async () => {
    subscribers.clear();
    await socket.close();
  };

  await new Promise<void>((resolve, reject) => {
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
            resolve();
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

    socket.connect(opts.timeoutMs ?? 10000).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return { subscribe, send, close };
};

// === Public: runStudyChain ================================================

export const runStudyChain = async (req: StudyChainRequest): Promise<StudyChainResult> => {
  if (!req.symbol) throw new Error("symbol required");

  const timeframe = validateTimeframe(req.timeframe ?? "60");
  const { bars } = clampBarCount(
    req.bars ?? 300,
    req.barLimitMode,
    req.barLimitPlan,
  );

  // Validate spec & assign slots up front. Throws on bad references; this is
  // the only way the chain helper detects spec errors before the WS opens.
  const planned = planChainSlots(req.studies);

  // Resolve wire ids and meta in parallel (best effort each).
  const prepared: PreparedSpec[] = await Promise.all(
    planned.map(async ({ spec, slotName, parentSlot }) => {
      const [wireRes, metaRes] = await Promise.allSettled([
        resolveStudyWireId(spec.studyId, req.sessionId, req.sessionSign),
        getIndicatorMeta({
          id: spec.studyId.split("@")[0],
          sessionId: req.sessionId,
          sessionSign: req.sessionSign,
        }).catch(() => null as any),
      ]);
      const wire: ResolvedWireId =
        wireRes.status === "fulfilled" ? wireRes.value : { wireId: spec.studyId, version: "last" };
      const meta: IndicatorMeta | null =
        metaRes.status === "fulfilled" ? (metaRes.value as IndicatorMeta | null) : null;
      const inputsDict = buildInputsDict(spec.inputs, spec.params, meta, parentSlot);
      return {
        spec,
        slotName,
        parentSlot,
        wireId: wire.wireId,
        version: wire.version,
        meta,
        inputsDict,
      };
    }),
  );

  const chartSession = generateSessionId("cs");
  const connection = await openChainConnection({
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    timeoutMs: req.timeoutMs,
  });

  return new Promise<StudyChainResult>((resolve, reject) => {
    let settled = false;
    const rowsBySlot: Record<string, Array<{ i: number; v: any[] }>> = {};
    const nonseriesBySlot: Record<string, Record<string, any>> = {};
    const seriesIndexToTs = new Map<number, number>();
    let seriesReady = false;

    // Track which slots have completed (study_completed event seen).
    const expectedSlots = new Set(prepared.map((p) => p.slotName));
    const completedSlots = new Set<string>();

    const finish = (err: any | null, result?: StudyChainResult) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      connection.close().catch(() => {});
      if (err) reject(err);
      else if (result) resolve(result);
      else reject(new Error("internal: finish called without err or result"));
    };

    const buildResult = (): StudyChainResult => ({
      symbol: req.symbol,
      timeframe,
      bars,
      studies: prepared.map((p) => ({
        slotName: p.slotName,
        studyId: p.spec.studyId,
        wireId: p.wireId,
        studyVersion: p.version,
        parentSlot: p.parentSlot,
        plots: buildStudyPlots(p.meta, rowsBySlot, p.slotName, seriesIndexToTs),
        nonseries: nonseriesBySlot[p.slotName],
      })),
    });

    const sendAllStudies = () => {
      // Issue all create_study calls back to back. Studies referencing a
      // prior slot are valid because TradingView resolves the parent ref
      // server-side once the prior study posts plot data.
      try {
        for (const p of prepared) {
          connection.send("create_study", [
            chartSession,
            p.slotName,
            "",
            p.parentSlot,
            p.wireId,
            p.inputsDict,
          ]);
        }
      } catch (err) {
        finish(err);
      }
    };

    const unsubscribe = connection.subscribe((event) => {
      try {
        if (event.name === "timescale_update") {
          const sessionData = event.params[1] || {};
          // Map series index -> ts from the main series so non-ts-prefixed
          // study du frames can be aligned by index.
          for (const [k, v] of Object.entries<any>(sessionData)) {
            if (k.startsWith("sds_") && Array.isArray(v?.s)) {
              for (const bar of v.s) {
                if (bar?.i != null && Array.isArray(bar.v) && isUnixSeconds(bar.v[0])) {
                  seriesIndexToTs.set(bar.i, bar.v[0]);
                }
              }
            }
          }
          return;
        }

        if (event.name === "series_completed") {
          if (!seriesReady) {
            seriesReady = true;
            sendAllStudies();
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
          // study_completed.params = [chartSession, slotName, ...]
          const slot = event.params?.[1];
          if (typeof slot === "string" && expectedSlots.has(slot)) {
            completedSlots.add(slot);
          }
          if (completedSlots.size >= expectedSlots.size) {
            finish(null, buildResult());
          }
          return;
        }

        if (event.name === "study_error") {
          const slot = event.params?.[1];
          const reason = event.params?.[2];
          const detail = event.params?.[3];
          const err = new Error(
            `study_error in slot ${slot ?? "?"}: ${reason ?? "unknown"}` +
              (detail ? `: ${JSON.stringify(detail)}` : ""),
          );
          (err as any).slot = slot;
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
        "sds_1",
        "s1",
        "sds_sym_1",
        timeframe,
        bars,
        typeof req.to === "number" && Number.isFinite(req.to) ? req.to : "",
      ]);
      // create_study calls fire after series_completed in the subscriber.
    } catch (err) {
      finish(err);
    }

    const ttl = setTimeout(() => {
      if (settled) {
        clearTimeout(ttl);
        return;
      }
      // Surface a partial result if any slot has data; otherwise time out.
      const haveAny = prepared.some((p) => (rowsBySlot[p.slotName] || []).length > 0);
      if (haveAny) {
        finish(null, buildResult());
      } else {
        finish(new Error("Timed out running study chain"));
      }
      clearTimeout(ttl);
    }, req.timeoutMs ?? 20000);
  });
};
