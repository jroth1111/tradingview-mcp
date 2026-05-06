// Strategy run + backtest + parameter-sweep helpers.
//
// TradingView strategies are Pine scripts dispatched through the same
// `create_study` WebSocket call as indicators. The wire shape is identical;
// what differs is that the strategy script emits non-series outputs through
// `du.params[1][st_slot].ns` — the performance report, the trade list, and the
// equity curve all ride that channel. `runStudy` already accumulates `ns` into
// `StudyResult.nonseries`; this module composes runStudy + best-effort parsing
// of those non-series outputs.
//
// Strategy properties (`initial_capital`, `commission_value`, …) are passed as
// part of the create_study `inputs` dict. The exact upstream key naming for
// strategy property fields is NOT yet confirmed by a runtime probe — different
// TradingView builds have used `__pine_property_<name>`, `_strategy_<name>`,
// or accepted properties as plain top-level entries when the strategy script
// declares them through `strategy(...)` parameters. Until a probe verifies the
// canonical wire form, this helper merges the property names as-is at the top
// level of the inputs dict; callers may pre-shape inputs themselves to override.

import {
  runStudy,
  type StudyRequest,
  type StudyResult,
} from "./tradingview";
import type { TradingviewEndpoint } from "../../packages/tradingview-core/src";

// ---------- types ----------

export interface StrategyProperties {
  initial_capital?: number;
  currency?: string;
  default_qty_value?: number;
  default_qty_type?: "fixed_units" | "percent_of_equity" | "cash";
  pyramiding?: number;
  commission_value?: number;
  commission_type?: "percent" | "cash_per_contract" | "cash_per_order";
  slippage?: number;
  calc_on_every_tick?: boolean;
  calc_on_order_fills?: boolean;
  margin_long?: number;
  margin_short?: number;
  use_bar_magnifier?: boolean;
  process_orders_on_close?: boolean;
  fill_orders_on_standard_ohlc?: boolean;
}

export interface StrategyTrade {
  number: number;
  side: "long" | "short";
  entryTime: number; // unix seconds
  entryPrice: number;
  entrySignal?: string;
  exitTime?: number;
  exitPrice?: number;
  exitSignal?: string;
  size: number;
  profit?: number;
  profitPct?: number;
  cumProfit?: number;
}

export interface StrategyReport {
  netProfit?: number;
  netProfitPct?: number;
  grossProfit?: number;
  grossLoss?: number;
  totalTrades?: number;
  winningTrades?: number;
  losingTrades?: number;
  winRate?: number; // 0..1
  profitFactor?: number;
  maxDrawdown?: number;
  maxDrawdownPct?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  avgTrade?: number;
  largestWin?: number;
  largestLoss?: number;
  raw?: any; // original ns payload for debug
}

export interface StrategyEquityPoint {
  ts: number;
  equity: number;
  drawdown?: number;
}

export interface StrategyRunRequest {
  symbol: string;
  studyId?: string; // PUB;... or USER;... — required if no source
  source?: string; // raw Pine strategy source — needs pre-compile (see below)
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
  metric?: keyof StrategyReport; // default "netProfit"
}

export interface StrategyOptimizeResult {
  combos: number;
  results: Array<{
    params: Record<string, any>;
    report: StrategyReport;
  }>;
  best?: { params: Record<string, any>; report: StrategyReport };
}

// ---------- input/property merging ----------

// buildStrategyInputs merges baseInputs with strategy properties, top-level.
// The exact upstream key names for strategy properties (e.g. `initial_capital`
// vs `__pine_property_initial_capital`) are not yet verified by a runtime
// probe. This helper preserves the property key as-is so that:
//   1. If TradingView accepts top-level keys (via strategy() declaration),
//      the property propagates correctly.
//   2. If a different wire encoding is required, callers can pre-shape and
//      pass the raw form via `inputs` (which takes precedence on conflict).
// Callers' explicit `inputs` always win over property-derived defaults.
export const buildStrategyInputs = (
  baseInputs: Record<string, any> | undefined,
  properties: StrategyProperties | undefined,
): Record<string, any> => {
  const merged: Record<string, any> = {};
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (value === undefined) continue;
      merged[key] = value;
    }
  }
  if (baseInputs) {
    for (const [key, value] of Object.entries(baseInputs)) {
      // Caller-supplied input overrides any property-derived default.
      merged[key] = value;
    }
  }
  return merged;
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

// Map a free-form key from upstream (snake_case, camelCase, "Net Profit", etc.)
// to a canonical StrategyReport field name. Returns undefined when no match.
const REPORT_FIELD_ALIASES: Record<string, keyof StrategyReport> = {
  netprofit: "netProfit",
  netprofitvalue: "netProfit",
  net_profit: "netProfit",
  netprofitpercent: "netProfitPct",
  netprofitpct: "netProfitPct",
  net_profit_percent: "netProfitPct",
  grossprofit: "grossProfit",
  gross_profit: "grossProfit",
  grossloss: "grossLoss",
  gross_loss: "grossLoss",
  totaltrades: "totalTrades",
  total_trades: "totalTrades",
  numberoftrades: "totalTrades",
  winningtrades: "winningTrades",
  number_of_winning_trades: "winningTrades",
  losingtrades: "losingTrades",
  number_of_losing_trades: "losingTrades",
  winrate: "winRate",
  win_rate: "winRate",
  percentprofitable: "winRate",
  percent_profitable: "winRate",
  profitfactor: "profitFactor",
  profit_factor: "profitFactor",
  maxdrawdown: "maxDrawdown",
  max_drawdown: "maxDrawdown",
  maxdrawdownpct: "maxDrawdownPct",
  max_drawdown_percent: "maxDrawdownPct",
  sharperatio: "sharpeRatio",
  sharpe_ratio: "sharpeRatio",
  sortinoratio: "sortinoRatio",
  sortino_ratio: "sortinoRatio",
  avgtrade: "avgTrade",
  avg_trade: "avgTrade",
  averagetrade: "avgTrade",
  largestwin: "largestWin",
  largest_win: "largestWin",
  largestloss: "largestLoss",
  largest_loss: "largestLoss",
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

const parseTradesArray = (raw: any): StrategyTrade[] => {
  if (!Array.isArray(raw)) return [];
  const trades: StrategyTrade[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i];
    if (!t || typeof t !== "object") continue;
    const sideRaw =
      t.side ?? t.direction ?? t.type ?? (t.long === true ? "long" : undefined);
    const side: "long" | "short" =
      typeof sideRaw === "string" && sideRaw.toLowerCase().startsWith("s")
        ? "short"
        : "long";
    const entryTime = toNumber(t.entryTime ?? t.entry_time ?? t.entry?.time);
    const entryPrice = toNumber(t.entryPrice ?? t.entry_price ?? t.entry?.price);
    if (entryTime === undefined || entryPrice === undefined) continue;
    const trade: StrategyTrade = {
      number: toNumber(t.number ?? t.id ?? t.idx) ?? i + 1,
      side,
      entryTime,
      entryPrice,
      size: toNumber(t.size ?? t.qty ?? t.contracts) ?? 0,
    };
    const entrySignal = t.entrySignal ?? t.entry_signal ?? t.entry?.signal;
    if (typeof entrySignal === "string") trade.entrySignal = entrySignal;
    const exitTime = toNumber(t.exitTime ?? t.exit_time ?? t.exit?.time);
    if (exitTime !== undefined) trade.exitTime = exitTime;
    const exitPrice = toNumber(t.exitPrice ?? t.exit_price ?? t.exit?.price);
    if (exitPrice !== undefined) trade.exitPrice = exitPrice;
    const exitSignal = t.exitSignal ?? t.exit_signal ?? t.exit?.signal;
    if (typeof exitSignal === "string") trade.exitSignal = exitSignal;
    const profit = toNumber(t.profit ?? t.netProfit ?? t.net_profit);
    if (profit !== undefined) trade.profit = profit;
    const profitPct = toNumber(t.profitPct ?? t.profit_pct ?? t.profit_percent);
    if (profitPct !== undefined) trade.profitPct = profitPct;
    const cumProfit = toNumber(t.cumProfit ?? t.cum_profit ?? t.cumulativeProfit);
    if (cumProfit !== undefined) trade.cumProfit = cumProfit;
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

  // Search top-level for report fields first.
  extractReportFields(nonseries, report);

  // `ns.d` / `ns.report` may carry the actual structured payload, often as a
  // JSON-encoded string when traversing some upstream paths.
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

  // If equity is still empty but trades have cumProfit, derive a thin curve
  // from trade exits — useful as a debug aid.
  if (
    equity.length === 0 &&
    trades.length > 0 &&
    trades.every((t) => t.exitTime !== undefined && t.cumProfit !== undefined)
  ) {
    equity = trades.map((t) => ({
      ts: t.exitTime as number,
      equity: t.cumProfit as number,
    }));
  }

  return { report, trades, equity };
};

// ---------- runStrategy ----------

export const runStrategy = async (
  req: StrategyRunRequest,
): Promise<StrategyResult> => {
  if (req.source && !req.studyId) {
    // Pine compile -> strategy run integration belongs to the Pine module.
    // Until that wiring lands, callers must pre-compile and pass the resulting
    // PUB/USER studyId here.
    throw new Error(
      "source path requires pre-compile via compilePine; pass studyId instead",
    );
  }
  if (!req.studyId) {
    throw new Error("studyId required");
  }
  if (!req.symbol) {
    throw new Error("symbol required");
  }

  const inputs = buildStrategyInputs(req.inputs, req.properties);

  const studyReq: StudyRequest = {
    symbol: req.symbol,
    studyId: req.studyId,
    inputs,
    params: req.params,
    timeframe: req.timeframe,
    bars: req.bars,
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
  };

  const studyResult = await runStudy(studyReq);
  const { report, trades, equity } = parseStrategyOutputs(studyResult.nonseries);

  return { studyResult, report, trades, equity };
};

// ---------- cartesian product + concurrency limiter ----------

export const cartesianProduct = <T>(
  matrix: Record<string, T[]>,
): Array<Record<string, T>> => {
  const keys = Object.keys(matrix);
  if (keys.length === 0) return [{}];
  // Empty array on any dimension collapses the product to zero combos.
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

// Run a fixed-concurrency worker pool over `items`. Maintains input order in
// the returned array even when individual tasks complete out of order.
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
  const metric: keyof StrategyReport = req.metric ?? "netProfit";

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
