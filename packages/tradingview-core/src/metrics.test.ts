import { describe, expect, it } from "vitest";
import {
  buildMetricBundle,
  cagrFromEquity,
  calmarRatio,
  defaultRankingMetric,
  deflatedSharpe,
  deflatedSortino,
  downsideDeviation,
  excessKurtosis,
  maxDrawdownPct,
  mean,
  normInvCdf,
  pickMetric,
  profitFactor,
  returnsFromEquity,
  sharpeRatio,
  skewness,
  sortinoRatio,
  stdev,
  variance,
  winRate,
} from "./metrics";

const seedRandom = (seed: number): (() => number) => {
  // Mulberry32 — small, deterministic; avoids dragging in a dep.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const normalSample = (n: number, mu: number, sigma: number, seed = 1): number[] => {
  const rng = seedRandom(seed);
  const out: number[] = [];
  // Box-Muller, two-at-a-time.
  while (out.length < n) {
    const u = Math.max(rng(), Number.EPSILON);
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    out.push(mu + sigma * r * Math.cos(2 * Math.PI * v));
    if (out.length < n) out.push(mu + sigma * r * Math.sin(2 * Math.PI * v));
  }
  return out;
};

describe("metrics: basic statistics", () => {
  it("mean / variance / stdev match standard formulas", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(mean(xs)).toBe(3);
    // sample variance: sum((x-3)^2) / (n-1) = 10/4 = 2.5
    expect(variance(xs)).toBeCloseTo(2.5, 12);
    expect(stdev(xs)).toBeCloseTo(Math.sqrt(2.5), 12);
  });

  it("skewness is ~0 for symmetric N(0,1) and positive for log-normal", () => {
    const sym = normalSample(2000, 0, 1, 11);
    expect(Math.abs(skewness(sym))).toBeLessThan(0.2);

    // log-normal — strong positive skew.
    const lognorm = normalSample(2000, 0, 1, 12).map((x) => Math.exp(x));
    expect(skewness(lognorm)).toBeGreaterThan(0.5);
  });

  it("excessKurtosis is ~0 for N(0,1) and >0 for log-normal heavy tails", () => {
    const norm = normalSample(2000, 0, 1, 13);
    expect(Math.abs(excessKurtosis(norm))).toBeLessThan(0.5);

    const lognorm = normalSample(2000, 0, 1, 14).map((x) => Math.exp(x));
    expect(excessKurtosis(lognorm)).toBeGreaterThan(2);
  });

  it("downsideDeviation only counts negative deviations", () => {
    const xs = [1, 1, 1, -1, -1];
    // negatives: -1, -1 below threshold 0; sum sq = 2; n-1 = 4; sqrt(2/4) = sqrt(0.5)
    expect(downsideDeviation(xs, 0)).toBeCloseTo(Math.sqrt(0.5), 12);
  });
});

describe("metrics: ratios", () => {
  it("sharpe ratio of N(0.001, 0.01) over 1000 obs is in expected range", () => {
    const r = normalSample(1000, 0.001, 0.01, 21);
    const sr = sharpeRatio(r, { periodsPerYear: 252 });
    // Theoretical Sharpe = 0.1 * sqrt(252) ≈ 1.587. Sampling noise widens the band.
    expect(sr).toBeGreaterThan(0.8);
    expect(sr).toBeLessThan(2.5);
  });

  it("sortino ratio is greater than sharpe when only downside is penalized for symmetric returns", () => {
    // For symmetric returns, sortino > sharpe because downside deviation < total stdev.
    const r = normalSample(1000, 0.001, 0.01, 22);
    expect(sortinoRatio(r)).toBeGreaterThan(sharpeRatio(r));
  });

  it("ratios return 0 for fewer than 2 observations", () => {
    expect(sharpeRatio([])).toBe(0);
    expect(sharpeRatio([0.01])).toBe(0);
    expect(sortinoRatio([])).toBe(0);
    expect(sortinoRatio([0.01])).toBe(0);
  });

  it("ratios return 0 when stdev / downside-deviation is 0", () => {
    expect(sharpeRatio([0.01, 0.01, 0.01, 0.01])).toBe(0);
    expect(sortinoRatio([0.01, 0.01, 0.01, 0.01])).toBe(0);
  });
});

describe("metrics: equity-derived", () => {
  it("returnsFromEquity produces n-1 returns, skips non-positive prev", () => {
    const r = returnsFromEquity([100, 110, 121]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(0.1, 12);
    expect(returnsFromEquity([100, 0, 50])).toHaveLength(0);
  });

  it("maxDrawdownPct catches the deepest peak-to-trough drop", () => {
    // peak at 120, trough at 60 → 0.5 drawdown.
    expect(maxDrawdownPct([100, 120, 90, 60, 110])).toBeCloseTo(0.5, 12);
  });

  it("cagrFromEquity matches geometric annualisation", () => {
    // 252 daily steps from 100 → 110 = 10% in one year.
    const eq = [100];
    for (let i = 0; i < 252; i += 1) eq.push(eq[eq.length - 1] * Math.pow(1.1, 1 / 252));
    const cagr = cagrFromEquity(eq, 252);
    expect(cagr).toBeCloseTo(0.1, 4);
  });

  it("calmarRatio is 0 when no drawdown happened", () => {
    const monotonic = [100, 101, 102, 103, 104];
    expect(calmarRatio(monotonic)).toBe(0);
  });
});

describe("metrics: trade-level", () => {
  it("profitFactor handles the basic case + edge cases", () => {
    expect(profitFactor([10, 20, -5, -5])).toBeCloseTo(3, 12);
    expect(profitFactor([10, 20])).toBe(Number.POSITIVE_INFINITY);
    expect(profitFactor([])).toBe(0);
    expect(profitFactor([0, 0, 0])).toBe(0);
  });

  it("winRate excludes zero-PnL trades", () => {
    expect(winRate([1, -1, 0, 1])).toBeCloseTo(2 / 3, 12);
    expect(winRate([])).toBe(0);
    expect(winRate([0, 0, 0])).toBe(0);
  });
});

describe("metrics: deflated metrics", () => {
  it("normInvCdf inverts known quantiles", () => {
    expect(normInvCdf(0.5)).toBeCloseTo(0, 6);
    expect(normInvCdf(0.975)).toBeCloseTo(1.96, 2);
    expect(normInvCdf(0.025)).toBeCloseTo(-1.96, 2);
  });

  it("deflatedSharpe shrinks toward 0 as trial count grows for noise returns", () => {
    // Pure-noise returns: true edge is zero. Increasing trial multiplicity
    // should drag the deflated probability down toward zero.
    const noise = normalSample(1000, 0, 0.01, 31);
    const ds1 = deflatedSharpe(noise, 1);
    const dsN = deflatedSharpe(noise, 1000);
    expect(ds1).toBeGreaterThanOrEqual(dsN);
    expect(dsN).toBeLessThan(0.5);
  });

  it("deflatedSortino on synthetic random walk of N(0.001,0.01) yields a non-trivial probability", () => {
    // Mild edge but compounding drift: deflated should still register some
    // signal at trial count = 1.
    const r = normalSample(1000, 0.001, 0.01, 32);
    const ds = deflatedSortino(r, 1);
    expect(ds).toBeGreaterThan(0);
    expect(ds).toBeLessThanOrEqual(1);
  });

  it("deflatedSharpe handles degenerate inputs gracefully", () => {
    expect(deflatedSharpe([], 5)).toBe(0);
    expect(deflatedSharpe([0.01], 5)).toBe(0);
    expect(deflatedSharpe([0.01, 0.01], 0)).toBe(0);
  });
});

describe("metrics: bundle + ranking", () => {
  it("defaultRankingMetric is sortino — Sharpe must not be the default", () => {
    expect(defaultRankingMetric()).toBe("sortino");
  });

  it("buildMetricBundle composes ratios from equity / trades / returns", () => {
    const equity = [100, 105, 102, 110, 108, 115];
    const tradePnl = [5, -3, 8, -2, 7];
    const bundle = buildMetricBundle({ equity, tradePnl, periodsPerYear: 252 });
    expect(bundle.observations).toBe(equity.length - 1);
    expect(bundle.netProfit).toBeCloseTo(15, 12);
    expect(bundle.cagr).toBeGreaterThan(0);
    expect(bundle.maxDrawdown).toBeGreaterThan(0);
    expect(bundle.profitFactor).toBeCloseTo((5 + 8 + 7) / (3 + 2), 6);
    expect(bundle.winRate).toBeCloseTo(3 / 5, 12);
  });

  it("pickMetric exposes every metric and never returns NaN for the default ranking", () => {
    const bundle = buildMetricBundle({
      equity: [100, 110, 121],
      tradePnl: [10, 11],
      periodsPerYear: 252,
    });
    expect(pickMetric(bundle, "sortino")).toBe(bundle.sortino);
    expect(pickMetric(bundle, "sharpe")).toBe(bundle.sharpe);
    expect(pickMetric(bundle, "calmar")).toBe(bundle.calmar);
    expect(pickMetric(bundle, "profitFactor")).toBe(bundle.profitFactor);
    expect(pickMetric(bundle, "netProfit")).toBe(bundle.netProfit);
    expect(pickMetric(bundle, "winRate")).toBe(bundle.winRate);
    expect(Number.isFinite(pickMetric(bundle, defaultRankingMetric()))).toBe(true);
  });
});
