// Pure study/chart-session helpers shared across all worker hot paths.
//
// Consolidates resolveStudyWireId, buildInputsDict, buildStudyPlots,
// SOURCE_ALIASES, isUnixSeconds, generateSessionId, and parseMessage —
// previously duplicated in worker/src/tradingview.ts, worker/src/study-chain.ts,
// and worker/src/chart-session-do.ts. This module has no Cloudflare/Worker
// dependencies (only `fetch` and the constants module) so it lives in the
// shared core package.

import {
  TRADINGVIEW_BASICSTUDIES_VERSION,
  TRADINGVIEW_PINE_SCRIPT_WIRE_ID,
  TRADINGVIEW_PINE_STRATEGY_WIRE_ID,
  normalizeTradingViewPayload,
} from "./constants";

// === Source aliases =======================================================
// Friendly source names accepted by buildInputsDict for `source`-typed inputs.
// The wire form is "<parentSlot>$<alias>" (e.g. "sds_1$close" / "st1$hl2").
export const SOURCE_ALIASES = new Set([
  "open",
  "high",
  "low",
  "close",
  "hl2",
  "hlc3",
  "ohlc4",
  "volume",
]);

// === Primitive helpers ====================================================

export const isUnixSeconds = (n: any): boolean =>
  typeof n === "number" && n > 1_000_000_000 && n < 4_000_000_000;

export const generateSessionId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// === TradingView WS frame parser ==========================================
// Strips Engine.IO/Socket.IO prefixes and splits the resulting netstring
// stream into typed payloads. Each payload is one of:
//   - { type: "ping",    data: string }       // raw ~h~N ping frame to echo
//   - { type: "session", data: { session_id, ... } }  // initial handshake
//   - { type: "event",   data: { m: string, p: any[] } }  // normal frame

export type TVWSPayload =
  | { type: "ping"; data: string }
  | { type: "session"; data: any }
  | { type: "event"; data: any };

export const parseMessage = (message: string): TVWSPayload[] => {
  if (!message) return [];
  const normalized = normalizeTradingViewPayload(message.toString());
  return normalized
    .split(/~m~\d+~m~/)
    .slice(1)
    .map((event): TVWSPayload => {
      if (event.startsWith("~h~")) {
        return { type: "ping", data: `~m~${event.length}~m~${event}` };
      }
      const parsed = JSON.parse(event);
      if (parsed["session_id"]) return { type: "session", data: parsed };
      return { type: "event", data: parsed };
    });
};

// === Study wire-id resolution =============================================

export interface ResolvedWireId {
  wireId: string;
  version: string;
  // For Pine-flow studies (PUB;/USER; user scripts and TV built-ins TV has
  // migrated to Pine like STD;EMA), the underlying Pine identity injected
  // into create_study inputs alongside the encrypted IL.
  pineId?: string;
}

// pine-facade/list?filter=standard returns the canonical scriptIdPart for
// every built-in study/strategy along with its scriptName ("Average
// Directional Index") and extra.shortDescription ("ADX"). Caller-supplied
// friendly names ("ADX", "ATR", "MFI", "Williams %R") don't match the
// canonical pineIdPart suffix on their own (canonical is e.g.
// STD;Average%1Directional%1Index), so we use the list as a friendly →
// canonical map before probing translate.
const normalizeAliasKey = (s: string): string =>
  s.toUpperCase().replace(/[^A-Z0-9]/g, "");

let builtinAliasCache: Promise<Map<string, string>> | null = null;

const fetchBuiltinAliases = async (): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  try {
    const resp = await fetch(
      "https://pine-facade.tradingview.com/pine-facade/list?filter=standard",
    );
    if (!resp.ok) return map;
    const data: any = await resp.json();
    if (!Array.isArray(data)) return map;
    for (const ind of data) {
      const id = ind?.scriptIdPart;
      if (typeof id !== "string" || !id.startsWith("STD;")) continue;
      for (const alias of [ind?.scriptName, ind?.extra?.shortDescription]) {
        if (typeof alias !== "string") continue;
        const key = normalizeAliasKey(alias);
        if (!key || map.has(key)) continue;
        map.set(key, id);
      }
    }
  } catch {
    // Network failure → degrade silently. The caller's literal id is still
    // probed by the existing translate flow below.
  }
  return map;
};

const getBuiltinAliases = async (): Promise<Map<string, string>> => {
  if (!builtinAliasCache) builtinAliasCache = fetchBuiltinAliases();
  return builtinAliasCache;
};

// Test-only: drop the module-level cache so tests can re-mock fetch.
export const __resetBuiltinAliasCache = (): void => {
  builtinAliasCache = null;
};

// Resolve a caller-supplied study identifier to the wire-form id TV's chart
// gateway accepts. Three families exist:
//   1. Pre-qualified ids ("RSI@tv-basicstudies-265") — passed through verbatim.
//   2. Pine scripts (PUB;<hash>, USER;<hash>) — dispatched via the framework
//      slot Script@tv-scripting-101!. Identity carried in inputs.pineId/text.
//   3. Built-ins ("EMA", "STD;Average%1Directional%1Index", …) — bifurcate at
//      the TV gateway as of 2026-05-07:
//        - Pine-backed: probe pine-facade/translate; on hit, dispatch via
//          Script@/StrategyScript@ with text+pineId+pineVersion.
//        - Definition-bundle-only: 404s on translate; fall back to the
//          legacy <bareId>@tv-basicstudies-265 form.
export const resolveStudyWireId = async (
  rawId: string,
  sessionId?: string,
  sessionSign?: string,
): Promise<ResolvedWireId> => {
  if (rawId.includes("@")) {
    const versionMatch = rawId.match(/@[a-z-]+-([0-9.]+)!?$/);
    return { wireId: rawId, version: versionMatch?.[1] ?? "last" };
  }

  const headers: Record<string, string> = {};
  if (sessionId) {
    headers["cookie"] = sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`;
  }

  if (rawId.startsWith("PUB;") || rawId.startsWith("USER;")) {
    let version = "1.0";
    try {
      const resp = await fetch(
        `https://pine-facade.tradingview.com/pine-facade/versions/${encodeURIComponent(rawId)}/last`,
        { headers },
      );
      if (resp.ok) {
        const data: any = await resp.json();
        const v = Array.isArray(data) ? data[0]?.version : data?.version;
        if (v != null) version = String(v);
      }
    } catch {
      // tolerate network blips; "1.0" is the most common Pine version
    }
    return { wireId: TRADINGVIEW_PINE_SCRIPT_WIRE_ID, version, pineId: rawId };
  }

  const bareId = rawId.startsWith("STD;") ? rawId.slice(4) : rawId;
  // Resolve friendly forms ("ADX", "Williams %R", "STD;ADX") to the
  // canonical pineIdPart before probing translate. STD;ADX 404s but
  // STD;Average%1Directional%1Index resolves; without this lookup the
  // resolver would fall back to <bareId>@tv-basicstudies-265 which lacks
  // many of these studies entirely (MFI, Williams %R, ADX).
  let pineIdForm = rawId.startsWith("STD;") ? rawId : `STD;${rawId}`;
  const aliases = await getBuiltinAliases();
  const canonical = aliases.get(normalizeAliasKey(bareId));
  if (canonical) pineIdForm = canonical;
  try {
    const resp = await fetch(
      `https://pine-facade.tradingview.com/pine-facade/translate/${encodeURIComponent(pineIdForm)}/last`,
      { headers },
    );
    if (resp.ok) {
      const data: any = await resp.json();
      const ilTemplate = data?.result?.ilTemplate ?? data?.result?.IL;
      if (data?.success && ilTemplate) {
        // User-authored Pine strategies set `is_strategy: true`; TV's built-in
        // strategies (STD;Supertrend%Strategy, STD;Bollinger%1Bands%1Strategy,
        // …) instead set `isTVScriptStrategy: true` and leave `is_strategy`
        // undefined. Treat either signal as strategy.
        const meta = data?.result?.metaInfo;
        const isStrategy = meta?.is_strategy === true || meta?.isTVScriptStrategy === true;
        const wireId = isStrategy
          ? TRADINGVIEW_PINE_STRATEGY_WIRE_ID
          : TRADINGVIEW_PINE_SCRIPT_WIRE_ID;
        const version = String(
          data?.result?.metaInfo?.pine?.version ??
            data?.result?.metaInfo?.version ??
            "1.0",
        );
        return { wireId, version, pineId: pineIdForm };
      }
    }
  } catch {
    // Network blip → fall through to basicstudies form.
  }
  return {
    wireId: `${bareId}@tv-basicstudies-${TRADINGVIEW_BASICSTUDIES_VERSION}`,
    version: TRADINGVIEW_BASICSTUDIES_VERSION,
  };
};

// === inputs dict & plot extraction ========================================

// Minimum metaInfo shape consumed by the helpers. Matches the IndicatorMeta
// returned by getIndicatorMeta in worker/src/tradingview.ts but is intentionally
// minimal so any caller-facing meta type can satisfy it.
export interface IndicatorMetaShape {
  inputs?: any[];
  plots?: any[];
  metaInfo?: any;
  script?: string;
  version?: string;
}

export interface StudyDataRow {
  i: number;
  v: any[];
}

export interface StudyPlot {
  id: string;
  name: string;
  title: string;
  type: string;
  data: Array<{ ts: number; value: any }>;
}

// Map raw inputs + friendly param names into the wire dict shape TradingView's
// create_study verb expects. Friendly names are translated through metaInfo,
// `source` aliases are rewritten as <parent>$<alias>, and `symbol` strings are
// boxed into { type: "symbol", value }.
export const buildInputsDict = (
  rawInputs: Record<string, any> | undefined,
  paramsByName: Record<string, any> | undefined,
  meta: IndicatorMetaShape | null,
  parentSeriesId: string,
): Record<string, any> => {
  const inputs: Record<string, any> = { ...(rawInputs ?? {}) };

  if (paramsByName && meta) {
    for (const [name, value] of Object.entries(paramsByName)) {
      const found = (meta.inputs || []).find(
        (mi: any) => mi.name === name || mi.id === name,
      );
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
        inputs[id] = `${parentSeriesId}$${v}`;
      }
      if (t === "symbol" && typeof v === "string") {
        inputs[id] = { type: "symbol", value: v };
      }
    }
  }
  return inputs;
};

// Convert accumulated du-frame rows into the public StudyPlot shape. Detects
// whether each row's v[0] is a unix-seconds timestamp (newer du payloads) or a
// raw series index (older payloads); when no timestamp is present, falls back
// to the timescale_update-derived seriesIndexToTs map.
export const buildStudyPlots = (
  meta: IndicatorMetaShape | null,
  rows: StudyDataRow[],
  seriesIndexToTs: Map<number, number>,
): StudyPlot[] => {
  if (rows.length === 0) return [];

  const sortedRows = [...rows].sort((a, b) => a.i - b.i);
  const sample = sortedRows[0]?.v ?? [];
  const tsIsFirst = sample.length > 0 && isUnixSeconds(sample[0]);

  const plotDefs = (meta?.plots || []).filter((p: any) => p?.type !== "no_series");
  const styles: Record<string, any> = meta?.metaInfo?.styles || {};
  const numPlotChannels = tsIsFirst ? sample.length - 1 : sample.length;
  const plotCount = plotDefs.length || numPlotChannels;

  const plots: StudyPlot[] = [];
  for (let pi = 0; pi < plotCount; pi += 1) {
    const def = plotDefs[pi] || {};
    const plotId = def.id || `plot_${pi}`;
    const title = styles[plotId]?.title || def.title || plotId;
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
      id: plotId,
      name: plotId,
      title,
      type: def.type || "line",
      data,
    });
  }
  return plots;
};
