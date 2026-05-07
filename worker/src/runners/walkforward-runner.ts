// Walkforward runner.
//
// Slice C primary deliverable. Implements anchored / rolling walk-forward over
// a parameter grid against a single TradingView strategy id (or compiled
// source), splitting the full-history equity into per-window IS/OOS slices,
// picking the IS-winner by the chosen ranking metric, then evaluating that
// winner over the OOS slice. The concatenated OOS equity is returned for
// downstream analyze-suite consumption.
//
// Single-run partitioning trick: we run each combo ONCE over the full history
// (not once per window), then slice the resulting equity by bar index per
// window. This preserves correctness — each combo's behavior is deterministic
// in time and TradingView strategies don't peek into the future, so slicing
// by bar index is equivalent to re-running with truncated history.
//
// This cuts TV WS calls from O(combos × windows) to O(combos) — critical for
// the soft rate-limit budget (≤4 concurrent WS per session).

import {
  buildMetricBundle,
  defaultRankingMetric,
  pickMetric,
  type MetricBundle,
  type RankingMetric,
  type TradingviewEndpoint,
} from "../../../packages/tradingview-core/src";
import {
  cartesianProduct,
  type StrategyEquityPoint,
  type StrategyProperties,
  type StrategyRunRequest,
  type StrategyTrade,
} from "../strategy";
import {
  runStrategyCached,
  type RunStrategyCache,
} from "../strategy-cache";

export interface WalkforwardInput {
  symbol: string;
  studyId?: string;
  source?: string;
  pineVersion?: string;
  baseInputs?: Record<string, any>;
  baseParams?: Record<string, any>;
  properties?: StrategyProperties;
  paramGrid: Record<string, any[]>;
  timeframe?: string | number;
  bars?: number;
  isWindowBars: number;
  oosWindowBars: number;
  stepBars: number;
  anchored?: boolean; // default false (rolling)
  metric?: RankingMetric; // default "sortino"
  concurrency?: number; // default 4
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  periodsPerYear?: number;
  // Optional KV cache for per-combo strategy-run reuse across job submissions.
  kv?: RunStrategyCache;
}

export interface WalkforwardWindow {
  index: number;
  isStartIdx: number;
  isEndIdx: number;
  oosStartIdx: number;
  oosEndIdx: number;
  isStartTs: number;
  isEndTs: number;
  oosStartTs: number;
  oosEndTs: number;
  winningParams: Record<string, any>;
  isMetric: number;
  oosMetric: number;
  isMetrics: MetricBundle;
  oosMetrics: MetricBundle;
  isTradeCount: number;
  oosTradeCount: number;
}

export interface WalkforwardResult {
  metric: RankingMetric;
  anchored: boolean;
  comboCount: number;
  windows: WalkforwardWindow[];
  concatenatedOosEquity: StrategyEquityPoint[];
  concatenatedOosTrades: StrategyTrade[];
  summary: MetricBundle;
  perComboCalls: number;
}

interface ComboResult {
  params: Record<string, any>;
  equity: StrategyEquityPoint[];
  trades: StrategyTrade[];
}

const sliceEquity = (
  equity: readonly StrategyEquityPoint[],
  start: number,
  end: number,
): StrategyEquityPoint[] => equity.slice(Math.max(0, start), Math.min(equity.length, end));

const tradesInRange = (
  trades: readonly StrategyTrade[],
  startTs: number,
  endTs: number,
): StrategyTrade[] =>
  trades.filter(
    (t) => t.entry_time >= startTs && (t.exit_time ?? t.entry_time) < endTs,
  );

const tradePnlOf = (trades: readonly StrategyTrade[]): number[] =>
  trades.map((t) => (typeof t.profit === "number" ? t.profit : 0));

const equityValuesOf = (eq: readonly StrategyEquityPoint[]): number[] =>
  eq.map((p) => p.equity);

const runWithConcurrency = async <I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> => {
  const results: O[] = new Array(items.length);
  if (items.length === 0) return results;
  const cap = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: cap }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    }),
  );
  return results;
};

export const runWalkforward = async (
  input: WalkforwardInput,
): Promise<WalkforwardResult> => {
  if (!input.symbol) throw new Error("walkforward: symbol required");
  if (!input.studyId && !input.source) {
    throw new Error("walkforward: studyId or source required");
  }
  if (!input.paramGrid || Object.keys(input.paramGrid).length === 0) {
    throw new Error("walkforward: non-empty paramGrid required");
  }
  if (input.isWindowBars <= 0 || input.oosWindowBars <= 0) {
    throw new Error("walkforward: isWindowBars and oosWindowBars must be > 0");
  }
  if (input.stepBars <= 0) {
    throw new Error("walkforward: stepBars must be > 0");
  }

  const combos = cartesianProduct(input.paramGrid);
  if (combos.length === 0) {
    throw new Error("walkforward: paramGrid resolved to zero combinations");
  }

  const metric = input.metric ?? defaultRankingMetric();
  const concurrency = Math.max(1, input.concurrency ?? 4);
  const ppy = input.periodsPerYear ?? 252;
  const anchored = !!input.anchored;

  // 1. Run each combo once over the full history.
  const comboResults = await runWithConcurrency(combos, concurrency, async (combo) => {
    const params = { ...(input.baseParams ?? {}), ...combo };
    const req: StrategyRunRequest = {
      symbol: input.symbol,
      studyId: input.studyId,
      source: input.source,
      pineVersion: input.pineVersion,
      properties: input.properties,
      inputs: input.baseInputs,
      params,
      timeframe: input.timeframe,
      bars: input.bars,
      sessionId: input.sessionId,
      sessionSign: input.sessionSign,
      endpoint: input.endpoint,
    };
    const out = await runStrategyCached(req, input.kv);
    const equity: StrategyEquityPoint[] = out.equity ?? [];
    const trades: StrategyTrade[] = out.trades ?? [];
    return { params: combo, equity, trades } satisfies ComboResult;
  });

  // 2. Determine equity length (use min so we don't run off the end of any
  //    combo's curve — TV occasionally returns slightly different bar counts
  //    when a combo creates orders that extend the last bar).
  const minEqLen = comboResults.reduce(
    (acc, c) => Math.min(acc, c.equity.length),
    comboResults[0]?.equity.length ?? 0,
  );

  // 3. Walk forward generating windows.
  //    Rolling: IS window slides forward by stepBars each iteration.
  //    Anchored: IS start stays at 0; IS window grows by stepBars each iter,
  //    so each successive optimization sees more history.
  const windows: WalkforwardWindow[] = [];
  const concatenatedOosEquity: StrategyEquityPoint[] = [];
  const concatenatedOosTrades: StrategyTrade[] = [];

  let idx = 0;
  let oosStart = input.isWindowBars;
  while (oosStart + input.oosWindowBars <= minEqLen) {
    const isStart = anchored ? 0 : oosStart - input.isWindowBars;
    const isEnd = oosStart;
    const oosEnd = oosStart + input.oosWindowBars;

    // Pick winning combo by IS metric.
    let bestIdx = -1;
    let bestVal = Number.NEGATIVE_INFINITY;
    let bestIsMetrics: MetricBundle | null = null;
    for (let c = 0; c < comboResults.length; c += 1) {
      const cr = comboResults[c];
      const isStartTs = cr.equity[isStart]?.ts ?? 0;
      const isEndTs = cr.equity[isEnd - 1]?.ts ?? isStartTs;
      const isEqSlice = sliceEquity(cr.equity, isStart, isEnd);
      const isTrades = tradesInRange(cr.trades, isStartTs, isEndTs + 1);
      const bundle = buildMetricBundle({
        equity: equityValuesOf(isEqSlice),
        tradePnl: tradePnlOf(isTrades),
        periodsPerYear: ppy,
      });
      const v = pickMetric(bundle, metric);
      if (Number.isFinite(v) && v > bestVal) {
        bestVal = v;
        bestIdx = c;
        bestIsMetrics = bundle;
      }
    }

    // Some windows may have no valid combo (e.g. all NaN ratios). Skip them.
    if (bestIdx === -1 || !bestIsMetrics) {
      oosStart += input.stepBars;
      idx += 1;
      continue;
    }

    const winner = comboResults[bestIdx];
    const isStartTs = winner.equity[isStart]?.ts ?? 0;
    const isEndTs = winner.equity[isEnd - 1]?.ts ?? isStartTs;
    const oosStartTs = winner.equity[oosStart]?.ts ?? isEndTs;
    const oosEndTs = winner.equity[oosEnd - 1]?.ts ?? oosStartTs;

    const oosEqSlice = sliceEquity(winner.equity, oosStart, oosEnd);
    const oosTrades = tradesInRange(winner.trades, oosStartTs, oosEndTs + 1);
    const isTrades = tradesInRange(winner.trades, isStartTs, isEndTs + 1);
    const oosBundle = buildMetricBundle({
      equity: equityValuesOf(oosEqSlice),
      tradePnl: tradePnlOf(oosTrades),
      periodsPerYear: ppy,
    });

    windows.push({
      index: idx,
      isStartIdx: isStart,
      isEndIdx: isEnd,
      oosStartIdx: oosStart,
      oosEndIdx: oosEnd,
      isStartTs,
      isEndTs,
      oosStartTs,
      oosEndTs,
      winningParams: winner.params,
      isMetric: bestVal,
      oosMetric: pickMetric(oosBundle, metric),
      isMetrics: bestIsMetrics,
      oosMetrics: oosBundle,
      isTradeCount: isTrades.length,
      oosTradeCount: oosTrades.length,
    });

    concatenatedOosEquity.push(...oosEqSlice);
    concatenatedOosTrades.push(...oosTrades);

    oosStart += input.stepBars;
    idx += 1;
  }

  // 4. Roll-up summary across the concatenated OOS curve.
  const summary = buildMetricBundle({
    equity: equityValuesOf(concatenatedOosEquity),
    tradePnl: tradePnlOf(concatenatedOosTrades),
    periodsPerYear: ppy,
  });

  return {
    metric,
    anchored,
    comboCount: combos.length,
    windows,
    concatenatedOosEquity,
    concatenatedOosTrades,
    summary,
    perComboCalls: combos.length,
  };
};
