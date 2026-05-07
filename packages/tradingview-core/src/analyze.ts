// Pure post-process analytics on (trades, equity).
//
// Everything here runs without TradingView WS access — feed in the result of
// a strategy run (or any other source) and get bootstrap CIs, Monte Carlo
// trade-reorder distribution, deflated metrics, permutation tests, SPA /
// Reality Check, and regime-conditioned breakdowns.
//
// Determinism: every helper accepts a `seed` so the same inputs produce the
// same outputs across re-runs. Production users should always pin a seed so
// reports stay reproducible after a redeploy.

import {
  buildMetricBundle,
  defaultRankingMetric,
  deflatedSortino,
  deflatedSharpe,
  excessKurtosis,
  maxDrawdownPct,
  pickMetric,
  returnsFromEquity,
  sharpeRatio,
  skewness,
  sortinoRatio,
  type MetricBundle,
  type RankingMetric,
} from "./metrics";

// ----- deterministic RNG (Mulberry32) -----

export type Rng = () => number;

export const mulberry32 = (seed: number): Rng => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sampleIndex = (rng: Rng, len: number): number =>
  Math.min(len - 1, Math.floor(rng() * len));

const sampleWithReplacement = <T>(rng: Rng, xs: readonly T[], n: number): T[] => {
  const out: T[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = xs[sampleIndex(rng, xs.length)];
  return out;
};

const shuffleInPlace = <T>(rng: Rng, xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i -= 1) {
    const j = sampleIndex(rng, i + 1);
    const tmp = xs[i];
    xs[i] = xs[j];
    xs[j] = tmp;
  }
  return xs;
};

const sortAsc = (xs: number[]): number[] => xs.slice().sort((a, b) => a - b);

const percentile = (sortedAsc: readonly number[], p: number): number => {
  if (sortedAsc.length === 0) return 0;
  const idx = (sortedAsc.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
};

// ----- bootstrap confidence intervals -----

export interface BootstrapOpts {
  iterations?: number; // default 1000
  alpha?: number; // 0.05 → 95% CI
  seed?: number;
  periodsPerYear?: number;
}

export interface BootstrapCi {
  metric: string;
  point: number;
  lo: number;
  hi: number;
  iterations: number;
  alpha: number;
}

// Bootstrap a metric distribution by resampling the per-period returns with
// replacement. Returns a percentile CI at level `alpha`.
//
// For metrics that depend on the equity curve (calmar / cagr / maxDD), the
// resample is reconstructed by accumulating the resampled returns from the
// curve's starting equity. For trade-level metrics (profitFactor / winRate),
// pass the trade PnL array via `bootstrapTrades`.
export const bootstrapMetric = (
  returns: readonly number[],
  metric: RankingMetric,
  opts: BootstrapOpts = {},
): BootstrapCi => {
  const iterations = Math.max(50, opts.iterations ?? 1000);
  const alpha = Math.min(0.5, Math.max(0.001, opts.alpha ?? 0.05));
  const rng = mulberry32(opts.seed ?? 1);
  const ppy = opts.periodsPerYear ?? 252;
  if (returns.length < 2) {
    return { metric, point: 0, lo: 0, hi: 0, iterations: 0, alpha };
  }
  const point = pickMetric(
    buildMetricBundle({ returns, periodsPerYear: ppy }),
    metric,
  );
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const draw = sampleWithReplacement(rng, returns, returns.length);
    samples.push(
      pickMetric(buildMetricBundle({ returns: draw, periodsPerYear: ppy }), metric),
    );
  }
  const sorted = sortAsc(samples);
  return {
    metric,
    point,
    lo: percentile(sorted, alpha / 2),
    hi: percentile(sorted, 1 - alpha / 2),
    iterations,
    alpha,
  };
};

// Bootstrap a maxDrawdown distribution by resampling returns with replacement and
// reconstructing the equity curve from a fixed starting equity. The resulting CI
// captures path-dependent drawdown risk under the empirical return distribution.
export const bootstrapMaxDrawdown = (
  returns: readonly number[],
  startingEquity: number,
  opts: BootstrapOpts = {},
): BootstrapCi => {
  const iterations = Math.max(50, opts.iterations ?? 1000);
  const alpha = Math.min(0.5, Math.max(0.001, opts.alpha ?? 0.05));
  const rng = mulberry32(opts.seed ?? 1);
  if (returns.length < 2) {
    return { metric: "maxDrawdown", point: 0, lo: 0, hi: 0, iterations: 0, alpha };
  }
  // Reconstruct point estimate from the empirical equity curve.
  const buildEquity = (rs: readonly number[]): number[] => {
    const eq = [startingEquity];
    for (const r of rs) eq.push(eq[eq.length - 1] * (1 + r));
    return eq;
  };
  const point = maxDrawdownPct(buildEquity(returns));
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const draw = sampleWithReplacement(rng, returns, returns.length);
    samples.push(maxDrawdownPct(buildEquity(draw)));
  }
  const sorted = sortAsc(samples);
  return {
    metric: "maxDrawdown",
    point,
    lo: percentile(sorted, alpha / 2),
    hi: percentile(sorted, 1 - alpha / 2),
    iterations,
    alpha,
  };
};

export const bootstrapTrades = (
  tradePnl: readonly number[],
  metric: "profitFactor" | "winRate" | "netProfit",
  opts: BootstrapOpts = {},
): BootstrapCi => {
  const iterations = Math.max(50, opts.iterations ?? 1000);
  const alpha = Math.min(0.5, Math.max(0.001, opts.alpha ?? 0.05));
  const rng = mulberry32(opts.seed ?? 1);
  if (tradePnl.length === 0) {
    return { metric, point: 0, lo: 0, hi: 0, iterations: 0, alpha };
  }
  const point = pickMetric(
    buildMetricBundle({ tradePnl, periodsPerYear: 252 }),
    metric,
  );
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const draw = sampleWithReplacement(rng, tradePnl, tradePnl.length);
    samples.push(
      pickMetric(buildMetricBundle({ tradePnl: draw, periodsPerYear: 252 }), metric),
    );
  }
  const sorted = sortAsc(samples);
  return {
    metric,
    point,
    lo: percentile(sorted, alpha / 2),
    hi: percentile(sorted, 1 - alpha / 2),
    iterations,
    alpha,
  };
};

// ----- Monte Carlo trade-reorder -----

export interface MonteCarloOpts {
  iterations?: number; // default 1000
  seed?: number;
  startingEquity?: number;
}

export interface MonteCarloResult {
  iterations: number;
  finalEquity: { p05: number; p50: number; p95: number; mean: number };
  maxDrawdown: { p05: number; p50: number; p95: number; mean: number };
  profitableProb: number; // P(final equity > start equity)
}

// Trade reordering simulates path-dependent risk: keep the same trade PnLs but
// shuffle the order, then look at the resulting equity-curve distribution.
export const monteCarloTradeReorder = (
  tradePnl: readonly number[],
  opts: MonteCarloOpts = {},
): MonteCarloResult => {
  const iterations = Math.max(100, opts.iterations ?? 1000);
  const rng = mulberry32(opts.seed ?? 1);
  const start = opts.startingEquity ?? 100_000;
  const finals: number[] = [];
  const drawdowns: number[] = [];
  let profitable = 0;
  for (let i = 0; i < iterations; i += 1) {
    const order = shuffleInPlace(rng, tradePnl.slice());
    let eq = start;
    let peak = start;
    let mdd = 0;
    for (const pnl of order) {
      eq += pnl;
      if (eq > peak) peak = eq;
      if (peak > 0) {
        const dd = (peak - eq) / peak;
        if (dd > mdd) mdd = dd;
      }
    }
    finals.push(eq);
    drawdowns.push(mdd);
    if (eq > start) profitable += 1;
  }
  const fSorted = sortAsc(finals);
  const dSorted = sortAsc(drawdowns);
  const meanOf = (xs: readonly number[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    iterations,
    finalEquity: {
      p05: percentile(fSorted, 0.05),
      p50: percentile(fSorted, 0.5),
      p95: percentile(fSorted, 0.95),
      mean: meanOf(fSorted),
    },
    maxDrawdown: {
      p05: percentile(dSorted, 0.05),
      p50: percentile(dSorted, 0.5),
      p95: percentile(dSorted, 0.95),
      mean: meanOf(dSorted),
    },
    profitableProb: iterations === 0 ? 0 : profitable / iterations,
  };
};

// ----- permutation test on metric significance -----

export interface PermutationOpts {
  iterations?: number; // default 1000
  seed?: number;
  metric?: RankingMetric;
  periodsPerYear?: number;
}

export interface PermutationResult {
  metric: RankingMetric;
  observed: number;
  pValue: number; // probability of seeing |observed| under random sign-flips
  iterations: number;
}

// Sign-flip permutation: under H0 ("no edge"), the sign of each return is
// random. We flip each return's sign with probability 0.5 and recompute the
// metric. The p-value is the fraction of permutations whose absolute metric
// meets or exceeds the observed.
export const permutationTest = (
  returns: readonly number[],
  opts: PermutationOpts = {},
): PermutationResult => {
  const iterations = Math.max(100, opts.iterations ?? 1000);
  const metric = opts.metric ?? defaultRankingMetric();
  const ppy = opts.periodsPerYear ?? 252;
  const rng = mulberry32(opts.seed ?? 1);
  if (returns.length < 2) {
    return { metric, observed: 0, pValue: 1, iterations: 0 };
  }
  const observed = pickMetric(
    buildMetricBundle({ returns, periodsPerYear: ppy }),
    metric,
  );
  const absObs = Math.abs(observed);
  let extreme = 0;
  for (let i = 0; i < iterations; i += 1) {
    const flipped = returns.map((r) => (rng() < 0.5 ? -r : r));
    const m = pickMetric(buildMetricBundle({ returns: flipped, periodsPerYear: ppy }), metric);
    if (Math.abs(m) >= absObs) extreme += 1;
  }
  return {
    metric,
    observed,
    pValue: extreme / iterations,
    iterations,
  };
};

// ----- SPA / Reality Check (Hansen 2005, simplified bootstrap form) -----

export interface SpaInput {
  candidateReturns: readonly (readonly number[])[]; // M strategies × T periods
  benchmarkReturns: readonly number[]; // T periods
  iterations?: number;
  seed?: number;
  periodsPerYear?: number;
}

export interface SpaResult {
  bestIndex: number;
  bestSharpe: number;
  spaPValue: number; // Hansen consistent p-value (lower-tail)
  iterations: number;
}

// Hansen's SPA / Reality Check, simplified to the studentised-mean variant.
// Computes the p-value for "the best of M strategies beats the benchmark"
// after correcting for trial multiplicity.
export const spaTest = (input: SpaInput): SpaResult => {
  const iterations = Math.max(100, input.iterations ?? 1000);
  const ppy = input.periodsPerYear ?? 252;
  const rng = mulberry32(input.seed ?? 1);
  const M = input.candidateReturns.length;
  if (M === 0 || input.benchmarkReturns.length === 0) {
    return { bestIndex: -1, bestSharpe: 0, spaPValue: 1, iterations: 0 };
  }
  const T = Math.min(
    input.benchmarkReturns.length,
    ...input.candidateReturns.map((c) => c.length),
  );
  if (T < 5) {
    return { bestIndex: -1, bestSharpe: 0, spaPValue: 1, iterations: 0 };
  }
  // Excess returns over benchmark.
  const excess: number[][] = input.candidateReturns.map((cands) =>
    Array.from({ length: T }, (_, t) => cands[t] - input.benchmarkReturns[t]),
  );
  const sharpePer = excess.map((arr) => sharpeRatio(arr, { periodsPerYear: ppy }));
  let bestIdx = 0;
  for (let m = 1; m < M; m += 1) if (sharpePer[m] > sharpePer[bestIdx]) bestIdx = m;
  const bestSharpe = sharpePer[bestIdx];
  // Bootstrap by resampling time indices uniformly.
  let beat = 0;
  for (let i = 0; i < iterations; i += 1) {
    const indices = Array.from({ length: T }, () => sampleIndex(rng, T));
    let bsBest = -Infinity;
    for (let m = 0; m < M; m += 1) {
      const draw = indices.map((idx) => excess[m][idx]);
      const s = sharpeRatio(draw, { periodsPerYear: ppy });
      if (s > bsBest) bsBest = s;
    }
    if (bsBest >= bestSharpe) beat += 1;
  }
  return {
    bestIndex: bestIdx,
    bestSharpe,
    spaPValue: beat / iterations,
    iterations,
  };
};

// ----- regime conditioning -----

export interface RegimeBucket {
  label: string;
  predicate: (idx: number) => boolean;
}

export interface RegimeBreakdownEntry {
  label: string;
  observations: number;
  metrics: MetricBundle;
}

// Slice a return / equity series by user-defined predicate buckets (e.g. by
// VIX level, by ATR percentile, by trend / chop classification). Each bucket
// gets its own metric bundle.
export const regimeBreakdown = (
  returns: readonly number[],
  buckets: readonly RegimeBucket[],
  opts: { periodsPerYear?: number } = {},
): RegimeBreakdownEntry[] => {
  const ppy = opts.periodsPerYear ?? 252;
  const result: RegimeBreakdownEntry[] = [];
  for (const b of buckets) {
    const slice: number[] = [];
    for (let i = 0; i < returns.length; i += 1) {
      if (b.predicate(i)) slice.push(returns[i]);
    }
    result.push({
      label: b.label,
      observations: slice.length,
      metrics: buildMetricBundle({ returns: slice, periodsPerYear: ppy }),
    });
  }
  return result;
};

// ----- top-level analyze suite (the shape returned to clients) -----

export interface AnalyzeSuiteInput {
  trades: readonly number[]; // per-trade signed PnL
  equity: readonly number[]; // equity curve
  trialCount?: number; // for deflated metrics; default 1
  iterations?: number; // bootstrap / monte carlo / permutation iterations
  seed?: number;
  alpha?: number;
  periodsPerYear?: number;
  benchmarkReturns?: readonly number[]; // optional, drives SPA
  candidateReturns?: readonly (readonly number[])[]; // optional, drives SPA
  buckets?: readonly RegimeBucket[]; // optional, drives regime breakdown
}

export interface AnalyzeSuiteResult {
  metrics: MetricBundle;
  defaultRanking: { metric: RankingMetric; value: number };
  bootstrap: {
    sortino: BootstrapCi;
    sharpe: BootstrapCi;
    calmar: BootstrapCi;
    profitFactor: BootstrapCi;
    maxDrawdown: BootstrapCi;
  };
  monteCarlo: MonteCarloResult;
  deflated: {
    sortino: number;
    sharpe: number;
    trialCount: number;
  };
  permutation: PermutationResult;
  spa?: SpaResult;
  regimes?: RegimeBreakdownEntry[];
  notes: string[];
}

export const analyzeSuite = (input: AnalyzeSuiteInput): AnalyzeSuiteResult => {
  const trades = input.trades.slice();
  const equity = input.equity.slice();
  const ppy = input.periodsPerYear ?? 252;
  const iterations = input.iterations ?? 1000;
  const alpha = input.alpha ?? 0.05;
  const seed = input.seed ?? 1;
  const trialCount = Math.max(1, input.trialCount ?? 1);
  const returns = returnsFromEquity(equity);

  const metrics = buildMetricBundle({ returns, equity, tradePnl: trades, periodsPerYear: ppy });
  const ranking = defaultRankingMetric();
  const notes: string[] = [];
  if (returns.length < 30) notes.push("low_sample_size_warning");
  if (trades.length < 30) notes.push("low_trade_count_warning");

  return {
    metrics,
    defaultRanking: { metric: ranking, value: pickMetric(metrics, ranking) },
    bootstrap: {
      sortino: bootstrapMetric(returns, "sortino", { iterations, alpha, seed, periodsPerYear: ppy }),
      sharpe: bootstrapMetric(returns, "sharpe", { iterations, alpha, seed: seed + 1, periodsPerYear: ppy }),
      calmar: bootstrapMetric(returns, "calmar", { iterations, alpha, seed: seed + 2, periodsPerYear: ppy }),
      profitFactor: bootstrapTrades(trades, "profitFactor", { iterations, alpha, seed: seed + 3 }),
      maxDrawdown: bootstrapMaxDrawdown(returns, equity[0] ?? 100_000, {
        iterations,
        alpha,
        seed: seed + 10,
      }),
    },
    monteCarlo: monteCarloTradeReorder(trades, {
      iterations,
      seed: seed + 4,
      startingEquity: equity[0] ?? 100_000,
    }),
    deflated: {
      sortino: deflatedSortino(returns, trialCount, { periodsPerYear: ppy }),
      sharpe: deflatedSharpe(returns, trialCount, { periodsPerYear: ppy }),
      trialCount,
    },
    permutation: permutationTest(returns, {
      iterations,
      seed: seed + 5,
      metric: ranking,
      periodsPerYear: ppy,
    }),
    spa:
      input.benchmarkReturns && input.candidateReturns && input.candidateReturns.length > 0
        ? spaTest({
            benchmarkReturns: input.benchmarkReturns,
            candidateReturns: input.candidateReturns,
            iterations,
            seed: seed + 6,
            periodsPerYear: ppy,
          })
        : undefined,
    regimes: input.buckets ? regimeBreakdown(returns, input.buckets, { periodsPerYear: ppy }) : undefined,
    notes,
  };
};

// ----- Bailey/Borwein Probability of Backtest Overfitting (PBO) -----

export interface PboSplit {
  train: readonly number[]; // fold indices used for IS optimization
  test: readonly number[];  // fold indices used for OOS evaluation
}

export interface PboInput {
  // metrics[combo][fold] — per-combo per-fold metric. NaN entries treated as
  // missing (combo skips that fold).
  metrics: readonly (readonly number[])[];
  splits?: readonly PboSplit[]; // optional; when omitted, all C(N, k) splits with k=floor(N/2)
  k?: number; // size of test set when generating splits; default floor(N/2)
}

export interface PboDetail {
  trainBestIdx: number;       // IS-winning combo index
  oosRankFraction: number;     // (rank of winner OOS among all combos) / (C+1)
  logit: number;               // log(omega / (1-omega))
  trainFolds: readonly number[]; // fold indices used as IS for this split
  testFolds: readonly number[];  // fold indices used as OOS for this split
}

export interface PboResult {
  pbo: number;            // P(logit < 0): IS-best below OOS median
  splitsEvaluated: number;
  combos: number;
  folds: number;
  k: number;
  details: PboDetail[];
}

const enumerateCombinations = (
  n: number,
  k: number,
): number[][] => {
  // Standard k-combinations of [0..n-1] enumerated in lexicographic order.
  const out: number[][] = [];
  if (k <= 0 || k > n) return out;
  const combo: number[] = new Array(k);
  const rec = (start: number, depth: number): void => {
    if (depth === k) {
      out.push(combo.slice());
      return;
    }
    const limit = n - (k - depth);
    for (let i = start; i <= limit; i += 1) {
      combo[depth] = i;
      rec(i + 1, depth + 1);
    }
  };
  rec(0, 0);
  return out;
};

const meanFinite = (arr: readonly number[], indices: readonly number[]): number => {
  let sum = 0;
  let count = 0;
  for (const i of indices) {
    const v = arr[i];
    if (Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return count === 0 ? Number.NEGATIVE_INFINITY : sum / count;
};

// Bailey/Borwein PBO: for each combinatorial fold split, find the IS-best
// strategy on `train` folds, then compute its rank within OOS metrics on
// `test` folds. PBO = P(rank below median) across splits.
//
// Returns 0.5 (no information) when no splits can be evaluated.
export const computePbo = (input: PboInput): PboResult => {
  const metrics = input.metrics;
  const combos = metrics.length;
  if (combos === 0) {
    return { pbo: 0.5, splitsEvaluated: 0, combos: 0, folds: 0, k: 0, details: [] };
  }
  const folds = metrics[0]?.length ?? 0;
  const k = Math.max(1, Math.min(input.k ?? Math.floor(folds / 2), folds - 1));
  const splits: readonly PboSplit[] =
    input.splits ??
    enumerateCombinations(folds, k).map((testIdx) => {
      const testSet = new Set(testIdx);
      const train: number[] = [];
      for (let i = 0; i < folds; i += 1) if (!testSet.has(i)) train.push(i);
      return { train, test: testIdx };
    });

  let belowMedian = 0;
  let evaluated = 0;
  const details: PboDetail[] = [];
  for (const split of splits) {
    if (split.train.length === 0 || split.test.length === 0) continue;
    let bestIdx = -1;
    let bestVal = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < combos; c += 1) {
      const v = meanFinite(metrics[c], split.train);
      if (Number.isFinite(v) && v > bestVal) {
        bestVal = v;
        bestIdx = c;
      }
    }
    if (bestIdx < 0) continue;
    const oosScores: number[] = new Array(combos);
    for (let c = 0; c < combos; c += 1) oosScores[c] = meanFinite(metrics[c], split.test);
    const winnerOos = oosScores[bestIdx];
    if (!Number.isFinite(winnerOos)) continue;
    // Rank of winner OOS among all combos (1-indexed; ties counted as half).
    let lower = 0;
    let equal = 0;
    for (let c = 0; c < combos; c += 1) {
      const v = oosScores[c];
      if (!Number.isFinite(v)) continue;
      if (v < winnerOos) lower += 1;
      else if (v === winnerOos) equal += 1;
    }
    const denom = lower + equal + (combos - lower - equal);
    const rank = lower + (equal + 1) / 2;
    const omega = rank / (denom + 1); // (rank)/(C+1) keeps omega ∈ (0,1)
    const logit = Math.log(omega / (1 - omega));
    if (logit < 0) belowMedian += 1;
    evaluated += 1;
    details.push({
      trainBestIdx: bestIdx,
      oosRankFraction: omega,
      logit,
      trainFolds: split.train,
      testFolds: split.test,
    });
  }
  return {
    pbo: evaluated === 0 ? 0.5 : belowMedian / evaluated,
    splitsEvaluated: evaluated,
    combos,
    folds,
    k,
    details,
  };
};

// Re-exports so consumers can pull the analyze surface without juggling
// metric helpers separately.
export {
  buildMetricBundle,
  defaultRankingMetric,
  pickMetric,
  returnsFromEquity,
  sharpeRatio,
  sortinoRatio,
  skewness,
  excessKurtosis,
  type MetricBundle,
  type RankingMetric,
};
