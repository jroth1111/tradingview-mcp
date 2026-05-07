import { describe, expect, it } from "vitest";
import {
  analyzeSuite,
  bootstrapMaxDrawdown,
  bootstrapMetric,
  bootstrapTrades,
  computePbo,
  monteCarloTradeReorder,
  mulberry32,
  permutationTest,
  regimeBreakdown,
  spaTest,
} from "./analyze";

const seedNormal = (seed: number, n: number, mu: number, sigma: number): number[] => {
  const rng = mulberry32(seed);
  const out: number[] = [];
  while (out.length < n) {
    const u = Math.max(rng(), Number.EPSILON);
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    out.push(mu + sigma * r * Math.cos(2 * Math.PI * v));
    if (out.length < n) out.push(mu + sigma * r * Math.sin(2 * Math.PI * v));
  }
  return out;
};

const buildEquity = (returns: readonly number[], start = 100_000): number[] => {
  const eq = [start];
  for (const r of returns) eq.push(eq[eq.length - 1] * (1 + r));
  return eq;
};

describe("analyze: bootstrap CI", () => {
  it("bootstrapMetric covers the point estimate within the CI for the source data", () => {
    const r = seedNormal(101, 1000, 0.001, 0.01);
    const ci = bootstrapMetric(r, "sortino", { iterations: 500, seed: 7, alpha: 0.05 });
    expect(ci.iterations).toBe(500);
    expect(ci.lo).toBeLessThanOrEqual(ci.point);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.point);
    expect(ci.alpha).toBe(0.05);
  });

  it("bootstrapTrades on profitFactor produces a sensible CI for symmetric trades", () => {
    const trades: number[] = [];
    for (let i = 0; i < 100; i += 1) trades.push(i % 2 === 0 ? 10 : -5);
    const ci = bootstrapTrades(trades, "profitFactor", { iterations: 300, seed: 8 });
    expect(ci.point).toBeCloseTo(2, 6); // 50 wins of 10 / 50 losses of 5 = 500/250 = 2
    expect(ci.lo).toBeGreaterThan(1);
  });

  it("bootstrapMaxDrawdown returns a maxDrawdown band starting at the empirical point", () => {
    const r = seedNormal(102, 500, 0.0005, 0.01);
    const ci = bootstrapMaxDrawdown(r, 100_000, { iterations: 200, seed: 9 });
    expect(ci.metric).toBe("maxDrawdown");
    expect(ci.point).toBeGreaterThanOrEqual(0);
    expect(ci.lo).toBeGreaterThanOrEqual(0);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.lo);
    // Drawdown is bounded by 1 (full liquidation).
    expect(ci.hi).toBeLessThanOrEqual(1);
  });

  it("returns zeros for sub-2 samples without throwing", () => {
    expect(bootstrapMetric([], "sortino").iterations).toBe(0);
    expect(bootstrapTrades([], "profitFactor").iterations).toBe(0);
    expect(bootstrapMaxDrawdown([], 100_000).iterations).toBe(0);
  });
});

describe("analyze: Monte Carlo trade reorder", () => {
  it("preserves the sum of trade PnL across reorderings", () => {
    const trades = [10, -5, 8, -3, 12, -2, 7, -6, 4, -1];
    const sum = trades.reduce((a, b) => a + b, 0);
    const start = 100_000;
    const r = monteCarloTradeReorder(trades, { iterations: 200, seed: 11, startingEquity: start });
    // The mean final equity equals start + sum(pnl) regardless of ordering.
    expect(r.finalEquity.mean).toBeCloseTo(start + sum, 6);
    expect(r.profitableProb).toBe(1);
  });

  it("max drawdown distribution is non-negative and sorted by percentile", () => {
    const trades = seedNormal(103, 500, 0, 100);
    const r = monteCarloTradeReorder(trades, { iterations: 300, seed: 12, startingEquity: 100_000 });
    expect(r.maxDrawdown.p05).toBeGreaterThanOrEqual(0);
    expect(r.maxDrawdown.p50).toBeGreaterThanOrEqual(r.maxDrawdown.p05);
    expect(r.maxDrawdown.p95).toBeGreaterThanOrEqual(r.maxDrawdown.p50);
  });
});

describe("analyze: permutation test", () => {
  it("pure noise yields a high p-value", () => {
    const noise = seedNormal(104, 500, 0, 0.01);
    const perm = permutationTest(noise, { iterations: 300, seed: 13, metric: "sortino" });
    expect(perm.pValue).toBeGreaterThan(0.2);
  });

  it("strong drift yields a low p-value", () => {
    const drift = seedNormal(105, 500, 0.005, 0.005);
    const perm = permutationTest(drift, { iterations: 300, seed: 14, metric: "sortino" });
    expect(perm.pValue).toBeLessThan(0.1);
  });
});

describe("analyze: SPA / Reality Check", () => {
  it("identifies the strongest excess-Sharpe candidate and returns a valid p-value", () => {
    const benchmark = seedNormal(201, 300, 0.0001, 0.005);
    const cands = [
      seedNormal(202, 300, -0.0005, 0.01),
      seedNormal(203, 300, 0.002, 0.005),
      seedNormal(204, 300, 0.0001, 0.02),
    ];
    const r = spaTest({
      benchmarkReturns: benchmark,
      candidateReturns: cands,
      iterations: 200,
      seed: 16,
    });
    expect(r.bestIndex).toBe(1);
    expect(r.spaPValue).toBeGreaterThanOrEqual(0);
    expect(r.spaPValue).toBeLessThanOrEqual(1);
  });
});

describe("analyze: regime breakdown", () => {
  it("partitions returns by predicate and reports per-bucket metrics", () => {
    const r = seedNormal(106, 200, 0.001, 0.01);
    const buckets = [
      { label: "first_half", predicate: (i: number) => i < 100 },
      { label: "second_half", predicate: (i: number) => i >= 100 },
    ];
    const out = regimeBreakdown(r, buckets);
    expect(out).toHaveLength(2);
    expect(out[0].observations).toBe(100);
    expect(out[1].observations).toBe(100);
    expect(out[0].metrics.observations).toBe(100); // buildMetricBundle on returns slice directly
  });
});

describe("analyze: top-level suite", () => {
  it("Sortino is the headline default-ranking metric — Sharpe stays secondary", () => {
    const r = seedNormal(107, 1000, 0.001, 0.01);
    const equity = buildEquity(r, 100_000);
    const trades = seedNormal(108, 200, 5, 20); // simulated per-trade PnL
    const out = analyzeSuite({
      trades,
      equity,
      iterations: 200,
      seed: 21,
      trialCount: 1,
    });
    expect(out.defaultRanking.metric).toBe("sortino");
    // Sortino must always be reported alongside Sharpe in the bootstrap block.
    expect(out.bootstrap.sortino).toBeDefined();
    expect(out.bootstrap.sharpe).toBeDefined();
    // Deflated metrics must include Sortino as primary.
    expect(out.deflated.sortino).toBeGreaterThanOrEqual(0);
    expect(out.deflated.sharpe).toBeGreaterThanOrEqual(0);
  });

  it("trial count > 1 shrinks the deflated Sortino versus trial count = 1 for noisy returns", () => {
    const noise = seedNormal(109, 500, 0, 0.01);
    const equity = buildEquity(noise, 100_000);
    const out1 = analyzeSuite({
      trades: [],
      equity,
      iterations: 200,
      seed: 22,
      trialCount: 1,
    });
    const outN = analyzeSuite({
      trades: [],
      equity,
      iterations: 200,
      seed: 22,
      trialCount: 1000,
    });
    expect(out1.deflated.sortino).toBeGreaterThanOrEqual(outN.deflated.sortino);
  });

  it("synthetic edge — Sortino of N(0.001, 0.01) over 1000 obs is in expected band", () => {
    const r = seedNormal(110, 1000, 0.001, 0.01);
    const equity = buildEquity(r, 100_000);
    const out = analyzeSuite({
      trades: [],
      equity,
      iterations: 200,
      seed: 23,
      trialCount: 1,
    });
    // Theoretical Sortino > Sharpe; both > 0.5 for this drift.
    expect(out.metrics.sortino).toBeGreaterThan(0.5);
    expect(out.metrics.sharpe).toBeGreaterThan(0.5);
    // Bootstrap CI for Sortino brackets the point estimate.
    expect(out.bootstrap.sortino.lo).toBeLessThanOrEqual(out.metrics.sortino);
    expect(out.bootstrap.sortino.hi).toBeGreaterThanOrEqual(out.metrics.sortino);
  });
});

describe("analyze: Bailey/Borwein PBO", () => {
  // Bailey/Borwein PBO converges to 0.5 in expectation under no-edge null,
  // but the per-sample variance is high. Average across multiple seeds to
  // smooth, and assert the mean lands in [0.4, 0.6].
  it("PBO on no-edge synthetic random combos averages near 0.5 across seeds", () => {
    const folds = 6;
    const combos = 24;
    const seeds = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031];
    const pbos: number[] = [];
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const metrics: number[][] = [];
      for (let c = 0; c < combos; c += 1) {
        const row: number[] = [];
        for (let f = 0; f < folds; f += 1) {
          const u = Math.max(rng(), Number.EPSILON);
          const v = rng();
          row.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
        }
        metrics.push(row);
      }
      pbos.push(computePbo({ metrics, k: 3 }).pbo);
    }
    const mean = pbos.reduce((a, b) => a + b, 0) / pbos.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    // Cross-check counts on a single sample.
    const single = computePbo({
      metrics: Array.from({ length: combos }, () => Array.from({ length: folds }, () => 0)),
      k: 3,
    });
    expect(single.combos).toBe(combos);
    expect(single.folds).toBe(folds);
    expect(single.k).toBe(3);
    expect(single.splitsEvaluated).toBe(20); // C(6, 3)
  });

  it("PBO drops toward 0 when one combo dominates IS and OOS jointly", () => {
    // Combo 0 is the deterministic winner on every fold; others are noise.
    const folds = 6;
    const combos = 12;
    const rng = mulberry32(99);
    const metrics: number[][] = [];
    for (let c = 0; c < combos; c += 1) {
      const row: number[] = [];
      for (let f = 0; f < folds; f += 1) {
        if (c === 0) row.push(5 + 0.01 * f); // strong dominance
        else {
          const u = Math.max(rng(), Number.EPSILON);
          const v = rng();
          row.push(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
        }
      }
      metrics.push(row);
    }
    const pbo = computePbo({ metrics, k: 3 });
    // Winner is always combo 0 IS; combo 0 also dominates OOS → low PBO.
    expect(pbo.pbo).toBeLessThan(0.05);
    for (const d of pbo.details) expect(d.trainBestIdx).toBe(0);
  });

  it("PBO is 1.0 when IS-best is by construction the OOS-worst on every split", () => {
    // 4 folds, 4 combos. Combo c is rigged to win on its own fold and lose on
    // others. Pairing IS=fold 0 → combo 0 wins, but combo 0 is then ranked
    // last on the test folds.
    const metrics = [
      [10, 0, 0, 0],
      [0, 10, 0, 0],
      [0, 0, 10, 0],
      [0, 0, 0, 10],
    ];
    const splits = [
      { train: [0], test: [1, 2, 3] },
      { train: [1], test: [0, 2, 3] },
      { train: [2], test: [0, 1, 3] },
      { train: [3], test: [0, 1, 2] },
    ];
    const pbo = computePbo({ metrics, splits });
    expect(pbo.splitsEvaluated).toBe(4);
    expect(pbo.pbo).toBe(1);
  });

  it("PBO degenerate cases return 0.5 with no splits", () => {
    expect(computePbo({ metrics: [] }).pbo).toBe(0.5);
    expect(computePbo({ metrics: [[1]] }).splitsEvaluated).toBe(0);
  });

  it("PBO ignores NaN / non-finite cells", () => {
    const metrics = [
      [1, 2, NaN, 4],
      [0.5, 0.5, 0.5, 0.5],
    ];
    const pbo = computePbo({ metrics, k: 2 });
    expect(pbo.splitsEvaluated).toBeGreaterThan(0);
  });
});
