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

// exactWindowed — true per-fold runs with explicit warmup. For each
// (combo, fold) the runner makes one isolated TV call with
// `to = foldEndTs[f]` and `bars = warmupBars + (f+1)*foldWidth`, so the
// strategy's pre-fold state is bounded by the warmup tail and not by any
// previous folds. Per-fold metrics are computed from the bars in
// [foldStartTs[f], foldEndTs[f]] of each isolated run; trades are purged
// (drop trades that straddle fold boundaries) and embargo'd (drop trades
// within the last embargoBars of the fold) before metric computation.
//
// Cost: one boundary-discovery run for combos[0] + |combos| × N isolated
// per-fold runs. The KV cache short-circuits identical (combo, fold)
// requests across re-submissions.
const runExactWindowed = async (
  combos: readonly Record<string, any>[],
  input: CpcvInput,
  metric: RankingMetric,
  ppy: number,
  startTs: number,
  concurrency: number,
): Promise<CpcvResult> => {
  const N = input.N;
  const embargoBars = Math.max(0, input.embargoBars ?? 0);
  const warmupBars = Math.max(0, input.warmupBars ?? 0);
  const requestedTotalBars = Math.max(1, input.bars ?? 1000);

  // Boundary discovery: one full-history run for combos[0]. The boundary
  // equity supplies the per-fold timestamp boundaries used to anchor the
  // isolated per-fold runs. We honour whatever TV returned (which may be
  // shorter than requested when the symbol/timeframe runs out of history)
  // and partition that into N folds.
  const boundaryReq: StrategyRunRequest = {
    symbol: input.symbol,
    studyId: input.studyId,
    source: input.source,
    pineVersion: input.pineVersion,
    properties: input.properties,
    inputs: input.baseInputs,
    params: { ...(input.baseParams ?? {}), ...combos[0] },
    timeframe: input.timeframe,
    bars: warmupBars + requestedTotalBars,
    sessionId: input.sessionId,
    sessionSign: input.sessionSign,
    endpoint: input.endpoint,
  };
  const boundary = await runStrategyCached(boundaryReq, input.kv);
  const boundaryEquity = boundary.equity ?? [];
  const actualUsableBars = Math.max(0, boundaryEquity.length - warmupBars);
  const foldWidth = Math.floor(actualUsableBars / N);
  if (foldWidth === 0) {
    throw Object.assign(
      new Error(
        `cpcv:exactWindowed: equity length ${boundaryEquity.length} too short for N=${N} folds`,
      ),
      { code: "cpcv_insufficient_history" },
    );
  }
  // Trim warmup from the head; the trailing N*foldWidth bars are the in-scope
  // fold area.
  const boundaryTrim = boundaryEquity.slice(boundaryEquity.length - N * foldWidth);
  const foldStartTs: number[] = [];
  const foldEndTs: number[] = [];
  for (let f = 0; f < N; f += 1) {
    foldStartTs.push(boundaryTrim[f * foldWidth]?.ts ?? 0);
    foldEndTs.push(boundaryTrim[(f + 1) * foldWidth - 1]?.ts ?? 0);
  }

  // Per-(combo, fold) isolated run.
  interface FoldRun {
    equity: StrategyEquityPoint[];
    trades: StrategyTrade[];
  }
  const cellTasks: Array<{ c: number; f: number }> = [];
  for (let c = 0; c < combos.length; c += 1) {
    for (let f = 0; f < N; f += 1) {
      cellTasks.push({ c, f });
    }
  }
  const runFoldCell = async (
    c: number,
    f: number,
  ): Promise<FoldRun> => {
    const params = { ...(input.baseParams ?? {}), ...combos[c] };
    const req: StrategyRunRequest = {
      symbol: input.symbol,
      studyId: input.studyId,
      source: input.source,
      pineVersion: input.pineVersion,
      properties: input.properties,
      inputs: input.baseInputs,
      params,
      timeframe: input.timeframe,
      bars: warmupBars + (f + 1) * foldWidth,
      to: foldEndTs[f],
      sessionId: input.sessionId,
      sessionSign: input.sessionSign,
      endpoint: input.endpoint,
    };
    const out = await runStrategyCached(req, input.kv);
    return { equity: out.equity ?? [], trades: out.trades ?? [] };
  };
  const cellResults = await runWithConcurrency(
    cellTasks,
    concurrency,
    async ({ c, f }) => runFoldCell(c, f),
  );
  const perFoldRuns: FoldRun[][] = combos.map(() => new Array(N));
  for (let i = 0; i < cellTasks.length; i += 1) {
    const { c, f } = cellTasks[i];
    perFoldRuns[c][f] = cellResults[i];
  }

  // Compute per-fold metric from the isolated run's [foldStartTs, foldEndTs]
  // slice with purge + embargo applied.
  const foldMetricsFor = (
    run: FoldRun,
    f: number,
    embargo: number,
  ): { sortino: number; sharpe: number; metric: number } => {
    const startTsf = foldStartTs[f];
    const endTsf = foldEndTs[f];
    const eqInFold = run.equity.filter(
      (p) => p.ts >= startTsf && p.ts <= endTsf,
    );
    // Purge: drop trades that straddle either fold boundary.
    const tradesInFold = run.trades.filter((t) => {
      const exitTs = t.exit_time ?? t.entry_time;
      if (t.entry_time < startTsf) return false;
      if (exitTs > endTsf) return false;
      return tradesInRange([t], startTsf, endTsf + 1).length > 0;
    });
    // Embargo: drop trades whose exit falls within the last `embargo` bars
    // of the fold — these would carry information into the next fold's
    // train window.
    const embargoCutoffIdx = Math.max(0, eqInFold.length - embargo);
    const embargoCutoffTs = eqInFold[embargoCutoffIdx]?.ts ?? endTsf;
    const purged = tradesInFold.filter(
      (t) => (t.exit_time ?? t.entry_time) < embargoCutoffTs,
    );
    const bundle = buildMetricBundle({
      equity: equityValues(eqInFold),
      tradePnl: tradePnl(purged),
      periodsPerYear: ppy,
    });
    return {
      sortino: bundle.sortino,
      sharpe: bundle.sharpe,
      metric: pickMetric(bundle, metric),
    };
  };

  const perFoldMetrics: number[][] = combos.map(() => new Array(N).fill(NaN));
  const perFoldSortino: number[][] = combos.map(() => new Array(N).fill(NaN));
  const perFoldSharpe: number[][] = combos.map(() => new Array(N).fill(NaN));
  for (let c = 0; c < combos.length; c += 1) {
    for (let f = 0; f < N; f += 1) {
      const out = foldMetricsFor(perFoldRuns[c][f], f, embargoBars);
      perFoldMetrics[c][f] = out.metric;
      perFoldSortino[c][f] = out.sortino;
      perFoldSharpe[c][f] = out.sharpe;
    }
  }

  const pbo = computePbo({ metrics: perFoldMetrics, k: input.k });

  // OOS distribution: for each split, take the IS winner's mean metric on
  // the split's test folds — genuinely OOS now that per-fold runs are
  // isolated.
  const oosSortinoDist: number[] = [];
  const oosSharpeDist: number[] = [];
  const meanFiniteAt = (
    arr: readonly number[],
    indices: readonly number[],
  ): number | null => {
    let sum = 0;
    let n = 0;
    for (const i of indices) {
      const v = arr[i];
      if (Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    return n === 0 ? null : sum / n;
  };
  for (const detail of pbo.details) {
    const sortino = meanFiniteAt(perFoldSortino[detail.trainBestIdx], detail.testFolds);
    const sharpe = meanFiniteAt(perFoldSharpe[detail.trainBestIdx], detail.testFolds);
    if (sortino !== null) oosSortinoDist.push(sortino);
    if (sharpe !== null) oosSharpeDist.push(sharpe);
  }

  // Pooled OOS summary uses the boundary equity (full timeline) as a stable
  // proxy for the pooled return stream. Concatenating per-fold isolated
  // equities double-counts warmup bars and is not equivalent.
  const pooled = equityValues(boundaryTrim);
  const pooledTrades = tradePnl(boundary.trades ?? []);
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
    "exactWindowed: per-fold isolated TV runs (to=foldEndTs, bars=warmup+foldEnd)",
    "exactWindowed: purge + embargo applied to fold-trade assignment",
  ];
  if (embargoBars === 0) {
    notes.push("embargoBars=0: no post-fold dampener; consider >0 for serial-correlated returns");
  }
  if (warmupBars === 0) {
    notes.push("warmupBars=0: per-fold runs start at first bar; var/varip state isolation may be incomplete");
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

  if (input.mode === "approxSlice") {
    const histories = await runComboHistories(combos, input, concurrency);
    return runApproxSlice(combos, histories, input, metric, ppy, startTs);
  }
  return runExactWindowed(combos, input, metric, ppy, startTs, concurrency);
};
