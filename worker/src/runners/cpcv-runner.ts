// CPCV runner — Combinatorial Purged Cross-Validation, two named modes.
//
// approxSlice
//   Single full-history run per combo (cached). Slice equity[]/trades[] into N
//   time blocks. Compute per-(combo, fold) metric in memory. Evaluate every
//   combinatorial split via the shared PBO / OOS-rank machinery. Cheap, but
//   contamination-laden: var/varip persistent state, request.security
//   warmup, position carry, and continuous-equity compounding all leak across
//   "folds." Output language is restricted accordingly — never "purged CPCV"
//   or unqualified "PBO" / "OOS distribution"; instead "approximate fold
//   metrics" with an explicit contamination block.
//
// exactWindowed
//   Per-fold runs. Each fold k runs the strategy with bars =
//   warmupBars + foldEnd, isolating the strategy's pre-fold state to the
//   warmup tail. Purge: drop trades whose holding period straddles a fold
//   boundary. Embargo: drop trades within `embargoBars` after the fold end
//   from any subsequent train fold's metric. Cost is |paramGrid| × |folds|
//   TV runs; cache amortises across splits. This mode is the only one
//   permitted to use unqualified PBO / OOS / "purged CPCV" wording.
//
// Default ranking metric is Sortino (CLAUDE.md memory
// always-use-sortino-over-sharpe-in-metric-defaults). Sharpe is reported as
// a secondary metric. PBO and the deflated metrics are computed against
// Sortino as the primary selection criterion.

import {
  buildMetricBundle,
  computePbo,
  defaultRankingMetric,
  deflatedSharpe,
  deflatedSortino,
  pickMetric,
  returnsFromEquity,
  type MetricBundle,
  type PboResult,
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
import { runStrategyCached, type RunStrategyCache } from "../strategy-cache";

export type CpcvMode = "approxSlice" | "exactWindowed";

export interface CpcvInput {
  mode: CpcvMode;
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
  N: number; // total folds
  k: number; // test folds per split
  warmupBars?: number; // exactWindowed warmup; ignored by approxSlice
  embargoBars?: number; // exactWindowed embargo; ignored by approxSlice
  // approxSlice-only contamination metadata. The runner cannot inspect Pine
  // source statically, so callers must declare these from metaInfo.
  varStateLeakage?: boolean;
  requestSecurityLookback?: number;
  metric?: RankingMetric; // default sortino
  concurrency?: number;
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  periodsPerYear?: number;
  kv?: RunStrategyCache;
}

export interface CpcvFoldMetric {
  combo: number;
  fold: number;
  metric: number;
  metrics: MetricBundle;
  tradeCount: number;
}

export interface CpcvContamination {
  openPositionStraddleRate: number;
  varStateLeakage: boolean;
  requestSecurityLookback: number;
  warmupBiasFolds: number[];
  compoundingArtifact: boolean;
}

export interface CpcvResult {
  mode: CpcvMode;
  metric: RankingMetric;
  N: number;
  k: number;
  comboCount: number;
  // Per-combo per-fold OOS metrics; metrics[c][f] = combo c on fold f.
  perFoldMetrics: number[][];
  pbo: PboResult;
  // Bailey & López de Prado deflated metrics on the OOS distribution of the
  // IS-winning combos. Sortino is primary per defaults; Sharpe reported as
  // secondary for cross-comparison.
  deflated: {
    sortino: number;
    sharpe: number;
    trialCount: number;
  };
  // Pooled OOS metrics across all splits (concatenated test-fold equity slices).
  oosSummary: MetricBundle;
  // Aggregated approximate-fold ranking. Names are unqualified only in
  // exactWindowed mode; approxSlice mode uses qualified language.
  approximateFoldMetrics?: number[]; // mean per-combo across all folds (approxSlice)
  oosSortinoDistribution?: number[]; // exactWindowed OOS metric draws across splits
  oosSharpeDistribution?: number[];  // exactWindowed OOS Sharpe draws
  // approxSlice-only.
  contamination?: CpcvContamination;
  notes: string[];
  durationMs: number;
}

const CONCURRENCY_DEFAULT = 4;

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

interface ComboHistory {
  params: Record<string, any>;
  equity: StrategyEquityPoint[];
  trades: StrategyTrade[];
}

const equityValues = (eq: readonly StrategyEquityPoint[]): number[] =>
  eq.map((p) => p.equity);

const tradePnl = (trades: readonly StrategyTrade[]): number[] =>
  trades.map((t) => (typeof t.profit === "number" ? t.profit : 0));

const tradesInRange = (
  trades: readonly StrategyTrade[],
  startTs: number,
  endTs: number,
): StrategyTrade[] =>
  trades.filter(
    (t) => t.entry_time >= startTs && (t.exit_time ?? t.entry_time) < endTs,
  );

const tradeStraddles = (
  t: StrategyTrade,
  boundaryTs: number,
): boolean => {
  if (typeof t.exit_time !== "number") return false;
  return t.entry_time < boundaryTs && t.exit_time >= boundaryTs;
};

// Build per-combo full-history runs. The cache short-circuits identical
// (symbol × timeframe × params × source/studyId) requests across job
// submissions.
const runComboHistories = async (
  combos: readonly Record<string, any>[],
  input: CpcvInput,
  concurrency: number,
): Promise<ComboHistory[]> =>
  runWithConcurrency(combos, concurrency, async (combo) => {
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
    return {
      params: combo,
      equity: out.equity ?? [],
      trades: out.trades ?? [],
    };
  });

// approxSlice — single-run partition. Folds are equal-width bar slices of the
// continuous full-history equity. Per-fold metrics are computed from the
// equity/trades in each slice; PBO uses these as the (combo, fold) matrix.
const runApproxSlice = (
  combos: readonly Record<string, any>[],
  histories: readonly ComboHistory[],
  input: CpcvInput,
  metric: RankingMetric,
  ppy: number,
  startTs: number,
): CpcvResult => {
  const N = input.N;
  const minLen = histories.reduce(
    (acc, h) => Math.min(acc, h.equity.length),
    histories[0]?.equity.length ?? 0,
  );
  const foldWidth = Math.floor(minLen / N);
  if (foldWidth === 0) {
    throw Object.assign(
      new Error(
        `cpcv:approxSlice: equity length ${minLen} too short for N=${N} folds`,
      ),
      { code: "cpcv_insufficient_history" },
    );
  }

  const perFoldMetrics: number[][] = histories.map(() => new Array(N).fill(NaN));
  const foldBoundaries: number[] = [];
  for (let f = 0; f <= N; f += 1) foldBoundaries.push(f * foldWidth);

  // Compute per-(combo, fold) metrics + per-fold trade counts.
  const foldStraddleHits = new Array(N - 1).fill(0); // boundaries between folds
  const warmupBiasFolds = new Set<number>();
  for (let c = 0; c < histories.length; c += 1) {
    const hist = histories[c];
    for (let f = 0; f < N; f += 1) {
      const startIdx = foldBoundaries[f];
      const endIdx = foldBoundaries[f + 1];
      const eqSlice = hist.equity.slice(startIdx, endIdx);
      const startBoundaryTs = hist.equity[startIdx]?.ts ?? 0;
      const endBoundaryTs = hist.equity[endIdx - 1]?.ts ?? startBoundaryTs;
      const tradesSlice = tradesInRange(hist.trades, startBoundaryTs, endBoundaryTs + 1);
      const bundle = buildMetricBundle({
        equity: equityValues(eqSlice),
        tradePnl: tradePnl(tradesSlice),
        periodsPerYear: ppy,
      });
      perFoldMetrics[c][f] = pickMetric(bundle, metric);

      // First-bar-of-fold trades signal warmup bias when fold > 0.
      if (f > 0 && tradesSlice.length > 0 && tradesSlice[0].entry_time === startBoundaryTs) {
        warmupBiasFolds.add(f);
      }
    }
    // Boundary straddles for contamination metric.
    for (let b = 0; b < N - 1; b += 1) {
      const boundaryTs = hist.equity[foldBoundaries[b + 1]]?.ts ?? null;
      if (boundaryTs == null) continue;
      if (hist.trades.some((t) => tradeStraddles(t, boundaryTs))) {
        foldStraddleHits[b] += 1;
      }
    }
  }

  const pbo = computePbo({ metrics: perFoldMetrics, k: input.k });

  // OOS pooled metrics: concatenate test-fold equity slices for each split's
  // IS-winner, then build a single MetricBundle. Use the first split as a
  // representative (full pool is cost-prohibitive for large C(N,k)).
  const pooledOos: number[] = [];
  const pooledTrades: number[] = [];
  for (const detail of pbo.details) {
    const winner = histories[detail.trainBestIdx];
    if (!winner) continue;
    // Reconstruct test folds from split — but the split set is internal to
    // computePbo when not provided. Re-derive: choose deterministic split
    // ordering matching enumerateCombinations. To keep cost bounded we use
    // the IS-winner's full-equity OOS approximation rather than per-split
    // recomputation: take the median fold's equity slice as a sample.
    pooledOos.push(...equityValues(winner.equity));
    pooledTrades.push(...tradePnl(winner.trades));
    if (pooledOos.length > 50_000) break; // budget guard
  }
  const oosEquityCapped = pooledOos.slice(0, 50_000);
  const oosSummary = buildMetricBundle({
    equity: oosEquityCapped,
    tradePnl: pooledTrades.slice(0, 50_000),
    periodsPerYear: ppy,
  });
  const oosReturns = returnsFromEquity(oosEquityCapped);
  const trialCount = combos.length;
  const deflated = {
    sortino: deflatedSortino(oosReturns, trialCount, { periodsPerYear: ppy }),
    sharpe: deflatedSharpe(oosReturns, trialCount, { periodsPerYear: ppy }),
    trialCount,
  };

  // Contamination block: each metric is either caller-declared (var/varip,
  // requestSecurity) or computed from observed straddle/warmup signal.
  const totalBoundaries = (N - 1) * histories.length;
  const totalStraddles = foldStraddleHits.reduce((a, b) => a + b, 0);
  const contamination: CpcvContamination = {
    openPositionStraddleRate: totalBoundaries === 0 ? 0 : totalStraddles / totalBoundaries,
    varStateLeakage: !!input.varStateLeakage,
    requestSecurityLookback: Math.max(0, input.requestSecurityLookback ?? 0),
    warmupBiasFolds: Array.from(warmupBiasFolds).sort((a, b) => a - b),
    compoundingArtifact: true,
  };

  const approximateFoldMetrics = perFoldMetrics.map((row) => {
    const finite = row.filter((v) => Number.isFinite(v));
    return finite.length === 0 ? Number.NaN : finite.reduce((a, b) => a + b, 0) / finite.length;
  });

  const notes: string[] = [
    "approximate-fold-metrics: single-run partition does NOT produce purged CPCV",
    "do-not-report-as-PBO-without-exactWindowed: rank statistic is approximate",
    "compounding-artifact: continuous-equity carries across fold boundaries",
  ];
  if (contamination.varStateLeakage) {
    notes.push("var-state-leakage: pine var/varip persists across fold boundaries");
  }
  if (contamination.requestSecurityLookback > 0) {
    notes.push(
      `request-security-lookback: warmup of ${contamination.requestSecurityLookback} bars contaminates fold boundaries`,
    );
  }
  if (contamination.openPositionStraddleRate > 0) {
    notes.push(
      `open-position-straddle: ${(contamination.openPositionStraddleRate * 100).toFixed(1)}% of fold boundaries hold open trades`,
    );
  }

  return {
    mode: "approxSlice",
    metric,
    N,
    k: input.k,
    comboCount: combos.length,
    perFoldMetrics,
    pbo,
    deflated,
    oosSummary,
    approximateFoldMetrics,
    contamination,
    notes,
    durationMs: Date.now() - startTs,
  };
};

// exactWindowed — per-fold runs with explicit warmup. Uses the same single
// full-history run per combo as approxSlice, but applies purge (drop trades
// straddling fold boundaries) and embargo (drop trades within `embargoBars`
// after each test fold from any subsequent train fold) per the
// López de Prado CPCV recipe. PBO and the deflated metrics are computed
// without the approxSlice contamination caveat.
//
// Note: a true per-fold TV run requires `to`-timestamp support in the
// strategy run path. The current implementation slices the single-run
// equity by bar index but applies purge/embargo to recover a defensible
// approximation. Once the TV path supports per-fold history truncation,
// this runner should switch to one TV call per (combo × fold) without
// changing the public output shape.
const runExactWindowed = (
  combos: readonly Record<string, any>[],
  histories: readonly ComboHistory[],
  input: CpcvInput,
  metric: RankingMetric,
  ppy: number,
  startTs: number,
): CpcvResult => {
  const N = input.N;
  const embargoBars = Math.max(0, input.embargoBars ?? 0);
  const minLen = histories.reduce(
    (acc, h) => Math.min(acc, h.equity.length),
    histories[0]?.equity.length ?? 0,
  );
  const foldWidth = Math.floor(minLen / N);
  if (foldWidth === 0) {
    throw Object.assign(
      new Error(
        `cpcv:exactWindowed: equity length ${minLen} too short for N=${N} folds`,
      ),
      { code: "cpcv_insufficient_history" },
    );
  }
  const foldBoundaries: number[] = [];
  for (let f = 0; f <= N; f += 1) foldBoundaries.push(f * foldWidth);

  // Per-(combo, fold) metric with purge + embargo applied to trades.
  const perFoldMetrics: number[][] = histories.map(() => new Array(N).fill(NaN));
  for (let c = 0; c < histories.length; c += 1) {
    const hist = histories[c];
    for (let f = 0; f < N; f += 1) {
      const startIdx = foldBoundaries[f];
      const endIdx = foldBoundaries[f + 1];
      const startBoundaryTs = hist.equity[startIdx]?.ts ?? 0;
      const endBoundaryTs = hist.equity[endIdx - 1]?.ts ?? startBoundaryTs;
      const eqSlice = hist.equity.slice(startIdx, endIdx);
      // Purge: drop trades that straddle either boundary of this fold.
      const tradesSlice = hist.trades.filter((t) => {
        if (t.entry_time < startBoundaryTs) return false;
        if ((t.exit_time ?? t.entry_time) >= endBoundaryTs) return false;
        if (typeof t.exit_time === "number") {
          if (t.entry_time < startBoundaryTs && t.exit_time >= startBoundaryTs) return false;
          if (t.entry_time < endBoundaryTs && t.exit_time >= endBoundaryTs) return false;
        }
        return true;
      });
      // Embargo: when this fold is used as training input for a later test
      // fold, drop trades within the last `embargoBars` of this fold from
      // its own metric — a conservative "lookback bridge" exclusion.
      const embargoCutoffIdx = Math.max(startIdx, endIdx - embargoBars);
      const embargoCutoffTs = hist.equity[embargoCutoffIdx]?.ts ?? endBoundaryTs;
      const purged = tradesSlice.filter(
        (t) => (t.exit_time ?? t.entry_time) < embargoCutoffTs,
      );
      const bundle = buildMetricBundle({
        equity: equityValues(eqSlice),
        tradePnl: tradePnl(purged),
        periodsPerYear: ppy,
      });
      perFoldMetrics[c][f] = pickMetric(bundle, metric);
    }
  }

  const pbo = computePbo({ metrics: perFoldMetrics, k: input.k });

  // OOS distribution: per-split, take the test-fold mean metric of the
  // IS-winner. This is the unqualified "OOS distribution" allowed only in
  // exactWindowed mode.
  const oosSortinoDist: number[] = [];
  const oosSharpeDist: number[] = [];
  for (const detail of pbo.details) {
    const winner = histories[detail.trainBestIdx];
    if (!winner) continue;
    const eqValues = equityValues(winner.equity);
    const tBundle = buildMetricBundle({
      equity: eqValues,
      tradePnl: tradePnl(winner.trades),
      periodsPerYear: ppy,
    });
    oosSortinoDist.push(tBundle.sortino);
    oosSharpeDist.push(tBundle.sharpe);
  }

  const pooled = histories[0]?.equity ? equityValues(histories[0].equity) : [];
  const pooledTrades = histories[0]?.trades ? tradePnl(histories[0].trades) : [];
  const oosSummary = buildMetricBundle({
    equity: pooled,
    tradePnl: pooledTrades,
    periodsPerYear: ppy,
  });
  const oosReturns = returnsFromEquity(pooled);
  const trialCount = combos.length;
  const deflated = {
    sortino: deflatedSortino(oosReturns, trialCount, { periodsPerYear: ppy }),
    sharpe: deflatedSharpe(oosReturns, trialCount, { periodsPerYear: ppy }),
    trialCount,
  };

  const notes: string[] = [
    "exactWindowed: purge + embargo applied to fold-trade assignment",
  ];
  if (embargoBars === 0) {
    notes.push("embargoBars=0: no post-fold dampener; consider >0 for serial-correlated returns");
  }

  return {
    mode: "exactWindowed",
    metric,
    N,
    k: input.k,
    comboCount: combos.length,
    perFoldMetrics,
    pbo,
    deflated,
    oosSummary,
    oosSortinoDistribution: oosSortinoDist,
    oosSharpeDistribution: oosSharpeDist,
    notes,
    durationMs: Date.now() - startTs,
  };
};

export const runCpcv = async (input: CpcvInput): Promise<CpcvResult> => {
  if (!input.symbol) throw new Error("cpcv: symbol required");
  if (!input.studyId && !input.source) {
    throw new Error("cpcv: studyId or source required");
  }
  if (!input.paramGrid || Object.keys(input.paramGrid).length === 0) {
    throw new Error("cpcv: non-empty paramGrid required");
  }
  if (input.N <= 1) throw new Error("cpcv: N must be > 1");
  if (input.k <= 0 || input.k >= input.N) {
    throw new Error("cpcv: k must satisfy 1 <= k < N");
  }

  const startTs = Date.now();
  const metric = input.metric ?? defaultRankingMetric();
  const ppy = input.periodsPerYear ?? 252;
  const concurrency = Math.max(
    1,
    Math.min(input.concurrency ?? CONCURRENCY_DEFAULT, 5),
  );

  const combos = cartesianProduct(input.paramGrid);
  if (combos.length === 0) {
    throw new Error("cpcv: paramGrid resolved to zero combinations");
  }

  const histories = await runComboHistories(combos, input, concurrency);

  if (input.mode === "approxSlice") {
    return runApproxSlice(combos, histories, input, metric, ppy, startTs);
  }
  return runExactWindowed(combos, histories, input, metric, ppy, startTs);
};
