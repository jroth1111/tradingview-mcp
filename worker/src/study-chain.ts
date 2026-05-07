// Multi-study chain (study-on-study) and short-lived modify helpers.
//
// SCOPE:
//   - modifyStudy: short-lived re-run of a single study with new inputs. Real
//     in-place modify (without re-establishing the chart session) requires a
//     long-lived chart session held in a Cloudflare Durable Object — see
//     ChartSession in chart-session-do.ts. This file is the non-DO complement.
//   - runStudyChain: opens ONE chart session via the shared `connect`
//     primitive, creates a series + N studies sequentially in the same session
//     so studies can chain (e.g. RSI of EMA where study B's parent_series_id
//     is study A's slot "st1"), accumulates du frames per slot, and returns
//     all results in one call.
//
// All low-level helpers (parseMessage, generateSessionId, isUnixSeconds,
// SOURCE_ALIASES, resolveStudyWireId, buildInputsDict, buildStudyPlots) live
// in packages/tradingview-core/src/study-helpers.ts. The WebSocket bring-up
// uses the shared `connect` from tradingview.ts so chain Pine studies inherit
// the `?type=chart&auth=sessionid` URL suffix and multi-endpoint fallback.

import {
  connect,
  runStudy,
  validateTimeframe,
  getIndicatorMeta,
  type IndicatorMeta,
  type StudyPlot,
  type StudyRequest,
  type StudyResult,
  type TradingviewConnection,
} from "./tradingview";
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
  type ResolvedWireId,
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
  /** Canonical study id ("STD;RSI", "PUB;<hash>", "USER;<id>", or already-qualified "RSI@tv-basicstudies-265"). */
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

// === Internal: prepared-spec shape used during chain bring-up =============

interface PreparedSpec {
  spec: StudyChainSpec;
  slotName: string;
  parentSlot: string;
  wireId: string;
  version: string;
  meta: IndicatorMeta | null;
  inputsDict: Record<string, any>;
}

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

      // Pine flow (Script@ / StrategyScript@ wireIds) requires the script
      // identity envelope inside the inputs dict: text=ilTemplate, pineId,
      // pineVersion. Without this the upstream returns "study_error: check
      // study unexpected error". Mirrors runStudy in tradingview.ts.
      if (isPineFlowWireId(wire.wireId)) {
        const scriptId = wire.pineId ?? spec.studyId.split("@")[0];
        if (!meta?.script) {
          throw new Error(
            `pine script ${scriptId} missing IL: pine-facade/translate did not return ilTemplate`,
          );
        }
        inputsDict.text = meta.script;
        inputsDict.pineId = scriptId;
        inputsDict.pineVersion = meta.version || wire.version || "1.0";
      }

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
  const connection: TradingviewConnection = await connect({
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
        plots: buildStudyPlots(p.meta, rowsBySlot[p.slotName] || [], seriesIndexToTs),
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
            p.slotName,
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
