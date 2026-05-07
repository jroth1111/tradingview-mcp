// Strategy run + backtest + parameter-sweep helpers.
//
// TradingView strategies are Pine scripts dispatched through the same
// `create_study` WebSocket call as indicators. The wire shape differs in one
// material place: strategy properties (`initial_capital`, `commission_value`,
// `default_qty_type`, …) live inside an `in_0` *dict* envelope alongside the
// user-input value at slot 0, while user inputs at slot 1+ stay at the top
// level of the inputs map (per skills/tradingview/reference/strategies.md:91).
// `runStudy` already accumulates `ns` into `StudyResult.nonseries`; this
// module composes runStudy + best-effort parsing of those non-series outputs.

import {
  STRATEGY_COMMISSION_TYPES,
  STRATEGY_DEFAULT_QTY_TYPES,
  STRATEGY_PROPERTY_KEYS,
  type TradingviewEndpoint,
} from "../../packages/tradingview-core/src";
import { compilePine } from "./pine";
import { isAuthToGet } from "./pine-crud";
import {
  getIndicatorMeta,
  runStudy,
  type IndicatorMeta,
  type StudyRequest,
  type StudyResult,
} from "./tradingview";

// ---------- types ----------

export type StrategyDefaultQtyType = "fixed" | "cash_per_order" | "percent_of_equity";
export type StrategyCommissionType = "percent" | "cash_per_contract" | "cash_per_order";

export interface StrategyProperties {
  initial_capital?: number;
  currency?: string;
  default_qty_value?: number;
  default_qty_type?: StrategyDefaultQtyType;
  pyramiding?: number;
  commission_value?: number;
  commission_type?: StrategyCommissionType;
  backtest_fill_limits_assumption?: number;
  slippage?: number;
  calc_on_every_tick?: boolean;
  calc_on_order_fills?: boolean;
  margin_long?: number;
  margin_short?: number;
  use_bar_magnifier?: boolean;
  process_orders_on_close?: boolean;
  fill_orders_on_standard_ohlc?: boolean;
}

// StrategyTrade: pair-aggregated trade record (entry + optional exit).
//
// Field naming follows the skill canonical wire vocabulary in
// skills/tradingview/reference/strategies.md:64-66 (`bar_index`, `time`,
// `signal`, `qty`, `price`, `profit`, `profit_pct`, `cumulative_profit`,
// `type`, `comment`, `drawdown`, `runup`). The wire format is one row per
// fill; this shape pairs entry and exit fills into a single trade record by
// prefixing time/price/signal with `entry_`/`exit_`. This pair-aggregation
// is what the walkforward and cpcv runners consume directly.
export interface StrategyTrade {
  number: number;
  side: "long" | "short";
  entry_time: number; // unix seconds
  entry_price: number;
  entry_signal?: string;
  exit_time?: number;
  exit_price?: number;
  exit_signal?: string;
  size: number;
  profit?: number;
  profit_pct?: number;
  cumulative_profit?: number;
  drawdown?: number;
  runup?: number;
  comment?: string;
}

// StrategyReport: skill-canonical 27-field strategy report.
//
// Field names match skills/tradingview/reference/strategies.md:40-58
// verbatim. These map directly to TradingView's strategy report tab and
// drive ranking/optimization logic via `keyof StrategyReport`.
export interface StrategyReport {
  gross_profit?: number;
  net_profit?: number;
  net_profit_percent?: number;
  profit_factor?: number;
  max_drawdown?: number;
  max_drawdown_percent?: number;
  max_runup?: number;
  max_runup_percent?: number;
  max_intraday_loss?: number;
  max_cons_loss_days?: number;
  currency_rate?: number;
  sharpe_ratio?: number;
  sortino_ratio?: number;
  total_trades?: number;
  winning_trades?: number;
  losing_trades?: number;
  even_trades?: number;
  win_rate?: number; // 0..1
  avg_trade?: number;
  avg_winning_trade?: number;
  avg_losing_trade?: number;
  largest_winning_trade?: number;
  largest_losing_trade?: number;
  buy_hold_return?: number;
  alpha?: number;
  beta?: number;
  ratio_avg_win_avg_loss?: number;
  raw?: any; // original ns payload for debug
}

export interface StrategyEquityPoint {
  ts: number;
  equity: number;
  drawdown?: number;
}

export interface WireDiagnostics {
  acceptedProperties: string[];
  rejectedProperties: Record<string, unknown>;
  enumViolations: Array<{ key: string; value: unknown; allowed: string[] }>;
  inputCollisions: Array<{
    key: string;
    propertyValue: unknown;
    inputValue: unknown;
  }>;
  sourceRewrites: Array<{ id: string; before: string; after: string }>;
  symbolRewrites: Array<{
    id: string;
    before: string;
    after: { type: "symbol"; value: string };
  }>;
  paramAliases: Array<{ name: string; resolvedId: string }>;
  wireForm: "conservative-bundle";
}

export interface StrategyRunRequest {
  symbol: string;
  studyId?: string; // PUB;... or USER;... — required if no source
  source?: string; // raw Pine strategy source (auto-compiled to a fresh PUB id)
  pineVersion?: string; // optional; defaults to v5 inside compilePine
  properties?: StrategyProperties;
  inputs?: Record<string, any>;
  params?: Record<string, any>;
  timeframe?: string | number;
  bars?: number;
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
}

export interface StrategyResult {
  studyResult: StudyResult;
  report: StrategyReport;
  trades: StrategyTrade[];
  equity: StrategyEquityPoint[];
  wireDiagnostics: WireDiagnostics;
}

export interface StrategyOptimizeRequest {
  symbol: string;
  studyId: string;
  baseInputs?: Record<string, any>;
  baseParams?: Record<string, any>;
  properties?: StrategyProperties;
  sweep: Record<string, any[]>;
  timeframe?: string | number;
  bars?: number;
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  concurrency?: number; // default 4
  metric?: keyof StrategyReport; // default "net_profit"
}

export interface StrategyOptimizeResult {
  combos: number;
  results: Array<{
    params: Record<string, any>;
    report: StrategyReport;
  }>;
  best?: { params: Record<string, any>; report: StrategyReport };
}

// ---------- wire-input normalization ----------

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

const emptyDiagnostics = (): WireDiagnostics => ({
  acceptedProperties: [],
  rejectedProperties: {},
  enumViolations: [],
  inputCollisions: [],
  sourceRewrites: [],
  symbolRewrites: [],
  paramAliases: [],
  wireForm: "conservative-bundle",
});

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface BuildStrategyWireInputsArgs {
  rawInputs?: Record<string, any>;
  paramsByName?: Record<string, any>;
  properties?: StrategyProperties;
  meta?: { inputs?: any[] } | null;
  parentSeriesId?: string;
}

interface BuildStrategyWireInputsResult {
  inputs: Record<string, any>;
  diagnostics: WireDiagnostics;
}

// buildStrategyWireInputs normalises raw caller inputs + properties + paramsByName
// into the canonical create_study `inputs` payload for a strategy:
//   {
//     in_0: { ...validated_properties, [<slot-0 user input keyed by meta-name>]: ... },
//     in_1: <slot-1 user input>,
//     in_2: <slot-2 user input>,
//     ...
//   }
//
// "Conservative-bundle" wire form: properties + only the slot-0 user input go into
// the in_0 envelope; subsequent user inputs stay top-level. This matches the
// literal example in skills/tradingview/reference/strategies.md:91-94. Once the
// A4 deep-mode probe captures actual TV WS frames we may flip to all-bundle —
// the diagnostics field tags the assumption so callers can tell.
//
// Properties outside STRATEGY_PROPERTY_KEYS are rejected (recorded in
// diagnostics.rejectedProperties) rather than silently passed to the wire,
// preventing accidental leakage of indicator-style keys.
//
// `default_qty_type` and `commission_type` enums are validated against the
// canonical sets; bad values land in `enumViolations` and the offending
// property is dropped (loud failure surface so callers can fix without a
// silent wire mismatch).
//
// If a caller pre-shaped `rawInputs.in_0` as a dict, this function MERGES the
// validated properties into it; collisions surface as `inputCollisions` (the
// caller-supplied value wins, but the conflict is recorded).
export const buildStrategyWireInputs = (
  args: BuildStrategyWireInputsArgs,
): BuildStrategyWireInputsResult => {
  const diagnostics = emptyDiagnostics();
  const parentSeriesId = args.parentSeriesId ?? "sds_1";
  const meta = args.meta ?? null;
  const metaInputs: any[] = Array.isArray(meta?.inputs) ? meta!.inputs! : [];

  // ---- 1. property validation ----
  const acceptedProps: Record<string, any> = {};
  if (args.properties) {
    for (const [key, value] of Object.entries(args.properties)) {
      if (value === undefined) continue;
      if (!STRATEGY_PROPERTY_KEYS.has(key)) {
        diagnostics.rejectedProperties[key] = value;
        continue;
      }
      if (
        key === "default_qty_type" &&
        typeof value === "string" &&
        !STRATEGY_DEFAULT_QTY_TYPES.has(value)
      ) {
        diagnostics.enumViolations.push({
          key,
          value,
          allowed: [...STRATEGY_DEFAULT_QTY_TYPES],
        });
        continue;
      }
      if (
        key === "commission_type" &&
        typeof value === "string" &&
        !STRATEGY_COMMISSION_TYPES.has(value)
      ) {
        diagnostics.enumViolations.push({
          key,
          value,
          allowed: [...STRATEGY_COMMISSION_TYPES],
        });
        continue;
      }
      acceptedProps[key] = value;
      diagnostics.acceptedProperties.push(key);
    }
  }

  // ---- 2. resolve paramsByName into slot-id-keyed user inputs ----
  // When meta is available we resolve friendly names → slot ids. Otherwise we
  // fall back to treating paramsByName keys as slot ids directly (callers
  // sweeping with `in_1`/`in_2` keys must still flow through). Keys that look
  // like slot ids (`in_NUMBER`) are always passed through; named keys without
  // meta are dropped into rejectedProperties so the caller sees the failure.
  const userInputs: Record<string, any> = {};
  const SLOT_ID_RE = /^in_\d+$/;
  if (args.paramsByName) {
    for (const [name, val] of Object.entries(args.paramsByName)) {
      if (metaInputs.length > 0) {
        const found = metaInputs.find(
          (mi: any) => mi?.name === name || mi?.id === name,
        );
        if (found?.id) {
          diagnostics.paramAliases.push({ name, resolvedId: found.id });
          userInputs[found.id] = val;
          continue;
        }
      }
      if (SLOT_ID_RE.test(name)) {
        userInputs[name] = val;
      } else {
        diagnostics.rejectedProperties[`params.${name}`] = val;
      }
    }
  }

  // rawInputs (slot-keyed) overlay paramsByName-derived; caller-explicit wins.
  if (args.rawInputs) {
    for (const [key, value] of Object.entries(args.rawInputs)) {
      userInputs[key] = value;
    }
  }

  // ---- 3. apply meta-driven source/symbol rewrites on user inputs ----
  if (metaInputs.length > 0) {
    for (const mi of metaInputs) {
      const id = mi?.id as string | undefined;
      if (!id || !(id in userInputs)) continue;
      const t = (mi?.type as string) || "";
      const v = userInputs[id];
      if (t === "source" && typeof v === "string" && SOURCE_ALIASES.has(v)) {
        const after = `${parentSeriesId}$${v}`;
        diagnostics.sourceRewrites.push({ id, before: v, after });
        userInputs[id] = after;
      } else if (t === "symbol" && typeof v === "string") {
        const after = { type: "symbol" as const, value: v };
        diagnostics.symbolRewrites.push({ id, before: v, after });
        userInputs[id] = after;
      }
    }
  }

  // ---- 4. compose conservative-bundle wire form ----
  // Start the in_0 envelope from validated properties.
  const in0Envelope: Record<string, any> = { ...acceptedProps };

  // If the caller pre-shaped in_0 as a dict, merge that on top with collision
  // tracking. Caller value wins (caller is opting into the lower-level wire).
  const slot0Raw = userInputs["in_0"];
  if (isPlainObject(slot0Raw)) {
    for (const [k, v] of Object.entries(slot0Raw)) {
      if (k in in0Envelope && in0Envelope[k] !== v) {
        diagnostics.inputCollisions.push({
          key: k,
          propertyValue: in0Envelope[k],
          inputValue: v,
        });
      }
      in0Envelope[k] = v;
    }
  } else if (slot0Raw !== undefined) {
    // Primitive slot-0 value: bundle it under the meta-name when known so the
    // upstream sees a labelled key inside the envelope (per skill example
    // showing `length: 14` inside in_0). Without meta we fall back to the
    // literal slot id so the value is never silently dropped.
    let bundleKey = "in_0";
    const slot0Meta = metaInputs.find((mi: any) => mi?.id === "in_0");
    if (slot0Meta?.name && typeof slot0Meta.name === "string") {
      bundleKey = slot0Meta.name;
    }
    if (bundleKey in in0Envelope && in0Envelope[bundleKey] !== slot0Raw) {
      diagnostics.inputCollisions.push({
        key: bundleKey,
        propertyValue: in0Envelope[bundleKey],
        inputValue: slot0Raw,
      });
    }
    in0Envelope[bundleKey] = slot0Raw;
  }

  const finalInputs: Record<string, any> = { in_0: in0Envelope };
  for (const [k, v] of Object.entries(userInputs)) {
    if (k === "in_0") continue;
    finalInputs[k] = v;
  }

  return { inputs: finalInputs, diagnostics };
};

// ---------- non-series output parsing ----------

const toNumber = (value: any): number | undefined => {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const tryParseJson = (value: any): any => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

// Wire-form aliases → canonical snake_case StrategyReport keys.
//
// TradingView's `du.params[*].<slot>.ns` payload varies by Pine version,
// broker, and locale; observed wire keys include camelCase, dashed,
// percent-suffixed, and "average"-spelled variants. The alias table maps
// every observed variant to the canonical skill-spec snake_case name.
// Keys here are post-normalisation (lowercase, no spaces/dashes) — see
// `normalizeKey`.
const REPORT_FIELD_ALIASES: Record<string, keyof StrategyReport> = {
  // gross_profit
  grossprofit: "gross_profit",
  gross_profit: "gross_profit",
  // net_profit
  netprofit: "net_profit",
  netprofitvalue: "net_profit",
  net_profit: "net_profit",
  // net_profit_percent
  netprofitpercent: "net_profit_percent",
  netprofitpct: "net_profit_percent",
  net_profit_percent: "net_profit_percent",
  // profit_factor
  profitfactor: "profit_factor",
  profit_factor: "profit_factor",
  // max_drawdown
  maxdrawdown: "max_drawdown",
  max_drawdown: "max_drawdown",
  // max_drawdown_percent
  maxdrawdownpct: "max_drawdown_percent",
  maxdrawdownpercent: "max_drawdown_percent",
  max_drawdown_percent: "max_drawdown_percent",
  // max_runup
  maxrunup: "max_runup",
  max_runup: "max_runup",
  // max_runup_percent
  maxrunuppct: "max_runup_percent",
  maxrunuppercent: "max_runup_percent",
  max_runup_percent: "max_runup_percent",
  // max_intraday_loss
  maxintradayloss: "max_intraday_loss",
  max_intraday_loss: "max_intraday_loss",
  // max_cons_loss_days
  maxconslossdays: "max_cons_loss_days",
  max_cons_loss_days: "max_cons_loss_days",
  maxconsecutivelossdays: "max_cons_loss_days",
  // currency_rate
  currencyrate: "currency_rate",
  currency_rate: "currency_rate",
  // sharpe_ratio
  sharperatio: "sharpe_ratio",
  sharpe_ratio: "sharpe_ratio",
  // sortino_ratio
  sortinoratio: "sortino_ratio",
  sortino_ratio: "sortino_ratio",
  // total_trades
  totaltrades: "total_trades",
  total_trades: "total_trades",
  numberoftrades: "total_trades",
  // winning_trades
  winningtrades: "winning_trades",
  winning_trades: "winning_trades",
  number_of_winning_trades: "winning_trades",
  // losing_trades
  losingtrades: "losing_trades",
  losing_trades: "losing_trades",
  number_of_losing_trades: "losing_trades",
  // even_trades
  eventrades: "even_trades",
  even_trades: "even_trades",
  number_of_even_trades: "even_trades",
  // win_rate
  winrate: "win_rate",
  win_rate: "win_rate",
  percentprofitable: "win_rate",
  percent_profitable: "win_rate",
  // avg_trade
  avgtrade: "avg_trade",
  avg_trade: "avg_trade",
  averagetrade: "avg_trade",
  // avg_winning_trade
  avgwinningtrade: "avg_winning_trade",
  avg_winning_trade: "avg_winning_trade",
  averagewinningtrade: "avg_winning_trade",
  // avg_losing_trade
  avglosingtrade: "avg_losing_trade",
  avg_losing_trade: "avg_losing_trade",
  averagelosingtrade: "avg_losing_trade",
  // largest_winning_trade
  largestwinningtrade: "largest_winning_trade",
  largest_winning_trade: "largest_winning_trade",
  largestwin: "largest_winning_trade",
  largest_win: "largest_winning_trade",
  // largest_losing_trade
  largestlosingtrade: "largest_losing_trade",
  largest_losing_trade: "largest_losing_trade",
  largestloss: "largest_losing_trade",
  largest_loss: "largest_losing_trade",
  // buy_hold_return
  buyholdreturn: "buy_hold_return",
  buy_hold_return: "buy_hold_return",
  // alpha
  alpha: "alpha",
  // beta
  beta: "beta",
  // ratio_avg_win_avg_loss
  ratioavgwinavgloss: "ratio_avg_win_avg_loss",
  ratio_avg_win_avg_loss: "ratio_avg_win_avg_loss",
};

const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[\s\-]/g, "");

const extractReportFields = (
  source: Record<string, any>,
  target: StrategyReport,
): void => {
  for (const [rawKey, value] of Object.entries(source)) {
    if (value == null) continue;
    const normalized = normalizeKey(rawKey);
    const canonical =
      REPORT_FIELD_ALIASES[normalized] ?? REPORT_FIELD_ALIASES[rawKey.toLowerCase()];
    if (!canonical) continue;
    if (target[canonical] != null) continue;
    const num = toNumber(value);
    if (num !== undefined) {
      (target[canonical] as any) = num;
    }
  }
};

// Side classification: skill spec defines `type ∈ {"buy", "sell", "long",
// "short"}` (line 65). For pair-aggregated StrategyTrade, side semantics
// collapse to long/short. "buy"/"long" → long; "sell"/"short" → short.
const inferSide = (raw: any): "long" | "short" => {
  const sideRaw =
    raw.side ?? raw.direction ?? raw.type ?? (raw.long === true ? "long" : undefined);
  if (typeof sideRaw === "string") {
    const s = sideRaw.toLowerCase();
    if (s.startsWith("s")) return "short"; // "short" or "sell"
    if (s === "b" || s === "buy" || s === "long" || s === "l") return "long";
  }
  return "long";
};

const parseTradesArray = (raw: any): StrategyTrade[] => {
  if (!Array.isArray(raw)) return [];
  const trades: StrategyTrade[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i];
    if (!t || typeof t !== "object") continue;
    const side = inferSide(t);
    const entry_time = toNumber(t.entry_time ?? t.entryTime ?? t.entry?.time ?? t.time);
    const entry_price = toNumber(t.entry_price ?? t.entryPrice ?? t.entry?.price ?? t.price);
    if (entry_time === undefined || entry_price === undefined) continue;
    const trade: StrategyTrade = {
      number: toNumber(t.number ?? t.id ?? t.idx) ?? i + 1,
      side,
      entry_time,
      entry_price,
      size: toNumber(t.size ?? t.qty ?? t.contracts) ?? 0,
    };
    const entry_signal = t.entry_signal ?? t.entrySignal ?? t.entry?.signal ?? t.signal;
    if (typeof entry_signal === "string") trade.entry_signal = entry_signal;
    const exit_time = toNumber(t.exit_time ?? t.exitTime ?? t.exit?.time);
    if (exit_time !== undefined) trade.exit_time = exit_time;
    const exit_price = toNumber(t.exit_price ?? t.exitPrice ?? t.exit?.price);
    if (exit_price !== undefined) trade.exit_price = exit_price;
    const exit_signal = t.exit_signal ?? t.exitSignal ?? t.exit?.signal;
    if (typeof exit_signal === "string") trade.exit_signal = exit_signal;
    const profit = toNumber(t.profit ?? t.netProfit ?? t.net_profit);
    if (profit !== undefined) trade.profit = profit;
    const profit_pct = toNumber(
      t.profit_pct ?? t.profitPct ?? t.profit_percent,
    );
    if (profit_pct !== undefined) trade.profit_pct = profit_pct;
    const cumulative_profit = toNumber(
      t.cumulative_profit ?? t.cumulativeProfit ?? t.cumProfit ?? t.cum_profit,
    );
    if (cumulative_profit !== undefined) trade.cumulative_profit = cumulative_profit;
    const drawdown = toNumber(t.drawdown ?? t.dd);
    if (drawdown !== undefined) trade.drawdown = drawdown;
    const runup = toNumber(t.runup ?? t.run_up);
    if (runup !== undefined) trade.runup = runup;
    if (typeof t.comment === "string") trade.comment = t.comment;
    trades.push(trade);
  }
  return trades;
};

const parseEquityArray = (raw: any): StrategyEquityPoint[] => {
  if (!Array.isArray(raw)) return [];
  const points: StrategyEquityPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const ts = toNumber(p.ts ?? p.time ?? p.t);
    const equity = toNumber(p.equity ?? p.value ?? p.e);
    if (ts === undefined || equity === undefined) continue;
    const pt: StrategyEquityPoint = { ts, equity };
    const drawdown = toNumber(p.drawdown ?? p.dd);
    if (drawdown !== undefined) pt.drawdown = drawdown;
    points.push(pt);
  }
  return points;
};

// parseStrategyOutputs is best-effort. The non-series payload structure is
// known to vary by Pine version and broker:
//   - report fields may be top-level on `ns`, nested under `ns.d`, or shipped
//     as a JSON-encoded string under `ns.d` / `ns.report`.
//   - the trade list may live under `ns.trades`, `ns.tradesList`, or inside
//     `ns.d.trades` after JSON parsing.
//   - the equity curve may live under `ns.equity` or `ns.d.equity`.
// When in doubt the function falls through and stashes the raw payload in
// `report.raw` so callers can still inspect it.
export const parseStrategyOutputs = (
  nonseries: Record<string, any> | undefined,
): {
  report: StrategyReport;
  trades: StrategyTrade[];
  equity: StrategyEquityPoint[];
} => {
  const report: StrategyReport = {};
  let trades: StrategyTrade[] = [];
  let equity: StrategyEquityPoint[] = [];

  if (nonseries == null) {
    return { report, trades, equity };
  }

  report.raw = nonseries;

  extractReportFields(nonseries, report);

  const dPayload = tryParseJson(
    nonseries.d ?? nonseries.report ?? nonseries.data ?? null,
  );
  if (dPayload && typeof dPayload === "object" && !Array.isArray(dPayload)) {
    extractReportFields(dPayload, report);
    const dTrades = parseTradesArray(
      dPayload.trades ?? dPayload.tradesList ?? dPayload.trade_list,
    );
    if (dTrades.length > 0) trades = dTrades;
    const dEquity = parseEquityArray(
      dPayload.equity ?? dPayload.equityCurve ?? dPayload.equity_curve,
    );
    if (dEquity.length > 0) equity = dEquity;
  }

  if (trades.length === 0) {
    trades = parseTradesArray(
      nonseries.trades ?? nonseries.tradesList ?? nonseries.trade_list,
    );
  }
  if (equity.length === 0) {
    equity = parseEquityArray(
      nonseries.equity ?? nonseries.equityCurve ?? nonseries.equity_curve,
    );
  }

  if (
    equity.length === 0 &&
    trades.length > 0 &&
    trades.every(
      (t) => t.exit_time !== undefined && t.cumulative_profit !== undefined,
    )
  ) {
    equity = trades.map((t) => ({
      ts: t.exit_time as number,
      equity: t.cumulative_profit as number,
    }));
  }

  return { report, trades, equity };
};

// ---------- closed-source pre-flight ----------

// Closed-source strategies (`PUB;<id>`) require `is_auth_to_get` to be true on
// the calling session before TradingView's WebSocket will return du frames for
// the run. Calling `runStudy` without the precheck surfaces a generic upstream
// failure — pre-flighting via pine-facade/is_auth_to_get gives a precise
// `plan_required` signal before opening the WS.
const looksLikeClosedSourcePineId = (studyId: string): boolean =>
  /^PUB;/i.test(studyId) || /USER;PUB;/i.test(studyId);

const splitVersionFromStudyId = (studyId: string): { id: string; version: string } => {
  // PUB;<id>@<version> or PUB;<id>;<version> — TradingView accepts both.
  const atIdx = studyId.lastIndexOf("@");
  if (atIdx > 0) {
    return { id: studyId.slice(0, atIdx), version: studyId.slice(atIdx + 1) };
  }
  return { id: studyId, version: "1.0" };
};

// ---------- plot-echo helper (closed-source bridge) ----------

interface PlotEchoMeta {
  plots?: Array<{ id?: string; title?: string; type?: string }>;
}

export interface BuildPlotEchoSourceOptions {
  strategyName?: string;
  overlay?: boolean;
  echoEntryThreshold?: number; // simple buy-when-source-crosses default = 0
}

// buildPlotEchoSource emits a tiny Pine v5 strategy that subscribes to each
// non-`no_series` plot of a closed-source script via `input.source`, then
// trades on a configurable threshold cross of the first source. Plots whose
// titles contain shell metacharacters are scrubbed; the helper returns a
// structurally-valid Pine source that compiles cleanly through pine-facade.
//
// The chained source-input wire form is `<parentSeriesId>$<plotTitle>`; that
// rewrite happens automatically in buildStrategyWireInputs based on the
// strategy script's metaInfo (the receiver's input ids are typed `source`).
export const buildPlotEchoSource = (
  meta: PlotEchoMeta,
  options: BuildPlotEchoSourceOptions = {},
): string => {
  const plots = (meta.plots ?? []).filter(
    (p) => p?.type !== "no_series" && (p?.id || p?.title),
  );
  const strategyName = JSON.stringify(options.strategyName ?? "Plot Echo");
  const overlay = options.overlay === false ? "false" : "true";
  const threshold = options.echoEntryThreshold ?? 0;

  const lines: string[] = [];
  lines.push("//@version=5");
  lines.push(`strategy(${strategyName}, overlay=${overlay})`);

  if (plots.length === 0) {
    lines.push("// No public plots on the upstream script — nothing to echo.");
    lines.push("// Strategy emits no trades; useful only as a probe stub.");
    return lines.join("\n") + "\n";
  }

  plots.forEach((p, i) => {
    const title = (p.title ?? p.id ?? `plot_${i}`).replace(/[\\"]/g, "");
    const safeTitle = JSON.stringify(title.length > 0 ? title : `plot_${i}`);
    lines.push(`src${i + 1} = input.source(close, ${safeTitle})`);
  });

  lines.push("");
  lines.push(`longCondition = ta.crossover(src1, ${threshold})`);
  lines.push(`shortCondition = ta.crossunder(src1, ${threshold})`);
  lines.push('if longCondition');
  lines.push('    strategy.entry("Long", strategy.long)');
  lines.push('if shortCondition');
  lines.push('    strategy.entry("Short", strategy.short)');

  return lines.join("\n") + "\n";
};

// ---------- runStrategy ----------

export const runStrategy = async (
  req: StrategyRunRequest,
): Promise<StrategyResult> => {
  if (!req.symbol) {
    throw new Error("symbol required");
  }
  if (!req.studyId && !req.source) {
    throw new Error("studyId or source required");
  }

  // ---- compile path: source -> studyId via pine-facade ----
  let resolvedStudyId = req.studyId;
  if (!resolvedStudyId && req.source) {
    const compile = await compilePine({
      source: req.source,
      version: req.pineVersion,
      sessionId: req.sessionId,
      sessionSign: req.sessionSign,
    });
    if (!compile.success) {
      const msg = compile.errors[0]?.message ?? "pine compile failed";
      const err: any = new Error(`pine compile failed: ${msg}`);
      err.compile = compile;
      err.category = "validation";
      throw err;
    }
    if (!compile.pineId) {
      const err: any = new Error("pine compile did not return a pineId");
      err.compile = compile;
      throw err;
    }
    resolvedStudyId = compile.pineId;
  }
  if (!resolvedStudyId) {
    throw new Error("studyId required");
  }

  // ---- closed-source pre-flight ----
  if (
    req.studyId &&
    req.sessionId &&
    looksLikeClosedSourcePineId(resolvedStudyId)
  ) {
    const { id, version } = splitVersionFromStudyId(resolvedStudyId);
    const auth = await isAuthToGet(
      { sessionId: req.sessionId, sessionSign: req.sessionSign },
      id,
      version,
    );
    if (!auth.authorized) {
      const err: any = new Error(
        `closed-source script ${id} not accessible to this session (is_auth_to_get=${auth.raw})`,
      );
      err.status = 403;
      err.category = "plan_required";
      err.code = "is_auth_to_get_false";
      throw err;
    }
  }

  // ---- fetch metaInfo so the wire normaliser can apply source/symbol rewrites ----
  let meta: IndicatorMeta | null = null;
  try {
    meta = await getIndicatorMeta({
      id: resolvedStudyId.split("@")[0],
      sessionId: req.sessionId,
      sessionSign: req.sessionSign,
    });
  } catch {
    // Tolerate metaInfo lookup failures: paramsByName resolution and meta-driven
    // source/symbol rewrites are skipped, but the run can still proceed when
    // callers pass slot-keyed rawInputs directly.
    meta = null;
  }

  const { inputs, diagnostics } = buildStrategyWireInputs({
    rawInputs: req.inputs,
    paramsByName: req.params,
    properties: req.properties,
    meta,
    parentSeriesId: "sds_1",
  });

  const studyReq: StudyRequest = {
    symbol: req.symbol,
    studyId: resolvedStudyId,
    inputs,
    inputsPreShaped: true,
    timeframe: req.timeframe,
    bars: req.bars,
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
  };

  const studyResult = await runStudy(studyReq);
  const { report, trades, equity } = parseStrategyOutputs(studyResult.nonseries);

  return { studyResult, report, trades, equity, wireDiagnostics: diagnostics };
};

// ---------- cartesian product + concurrency limiter ----------

export const cartesianProduct = <T>(
  matrix: Record<string, T[]>,
): Array<Record<string, T>> => {
  const keys = Object.keys(matrix);
  if (keys.length === 0) return [{}];
  if (keys.some((k) => !Array.isArray(matrix[k]) || matrix[k].length === 0)) {
    return [];
  }
  let combos: Array<Record<string, T>> = [{}];
  for (const key of keys) {
    const next: Array<Record<string, T>> = [];
    for (const partial of combos) {
      for (const value of matrix[key]) {
        next.push({ ...partial, [key]: value });
      }
    }
    combos = next;
  }
  return combos;
};

const runWithConcurrency = async <I, O>(
  items: I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> => {
  const results: O[] = new Array(items.length);
  if (items.length === 0) return results;
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const runners: Promise<void>[] = [];
  for (let r = 0; r < effectiveLimit; r += 1) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx], idx);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
};

// ---------- optimizeStrategy ----------

export const optimizeStrategy = async (
  req: StrategyOptimizeRequest,
): Promise<StrategyOptimizeResult> => {
  if (!req.symbol) throw new Error("symbol required");
  if (!req.studyId) throw new Error("studyId required");
  if (!req.sweep || typeof req.sweep !== "object") {
    throw new Error("sweep matrix required");
  }

  const combos = cartesianProduct(req.sweep);
  const concurrency = Math.max(1, req.concurrency ?? 4);
  const metric: keyof StrategyReport = req.metric ?? "net_profit";

  const results = await runWithConcurrency(combos, concurrency, async (combo) => {
    const mergedParams = { ...(req.baseParams ?? {}), ...combo };
    const runReq: StrategyRunRequest = {
      symbol: req.symbol,
      studyId: req.studyId,
      properties: req.properties,
      inputs: req.baseInputs,
      params: mergedParams,
      timeframe: req.timeframe,
      bars: req.bars,
      sessionId: req.sessionId,
      sessionSign: req.sessionSign,
      endpoint: req.endpoint,
    };
    const out = await runStrategy(runReq);
    return { params: combo, report: out.report };
  });

  let best: { params: Record<string, any>; report: StrategyReport } | undefined;
  for (const entry of results) {
    const value = entry.report[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (
      best === undefined ||
      ((best.report[metric] as number | undefined) ?? -Infinity) < value
    ) {
      best = entry;
    }
  }

  return { combos: combos.length, results, best };
};
