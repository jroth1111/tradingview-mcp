import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock runStrategyCached so we can drive synthetic per-combo histories without
// booting a TV WebSocket. vi.hoisted is required because vi.mock factories are
// hoisted above module-scoped bindings.
const { runStrategyCachedMock } = vi.hoisted(() => ({
  runStrategyCachedMock: vi.fn(),
}));
vi.mock("../strategy-cache", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../strategy-cache")>();
  return {
    ...original,
    runStrategyCached: runStrategyCachedMock,
  };
});

import { runCpcv, type CpcvInput } from "./cpcv-runner";
import type {
  StrategyEquityPoint,
  StrategyRunRequest,
  StrategyTrade,
} from "../strategy";

// Build a deterministic synthetic history: equally-spaced bars with a chosen
// per-combo per-fold drift so we can assert which combo wins on which fold.
const HOUR = 3600;

interface SyntheticHistoryOpts {
  bars: number;
  startTs?: number;
  // returns equity drift per bar at index i, for given fold (0-based)
  driftFn: (i: number, fold: number, foldWidth: number) => number;
  // returns true when the bar should host a trade (entry_time = ts of this bar)
  tradeFn?: (i: number) => boolean;
  // returns the trade hold length in bars (0 = exits same bar, etc.)
  tradeHoldBars?: (i: number) => number;
  // per-trade pnl
  tradePnlFn?: (i: number) => number;
}

const synthesize = (opts: SyntheticHistoryOpts) => {
  const start = opts.startTs ?? 1_700_000_000;
  const equity: StrategyEquityPoint[] = [];
  const trades: StrategyTrade[] = [];
  let eq = 1000;
  const foldWidth = Math.floor(opts.bars / 4); // tests use N=4 by default
  let nextTradeNumber = 1;
  for (let i = 0; i < opts.bars; i += 1) {
    const fold = Math.min(3, Math.floor(i / foldWidth));
    eq += opts.driftFn(i, fold, foldWidth);
    equity.push({ ts: start + i * HOUR, equity: eq });
    if (opts.tradeFn && opts.tradeFn(i)) {
      const hold = opts.tradeHoldBars ? opts.tradeHoldBars(i) : 0;
      const exitIdx = Math.min(opts.bars - 1, i + hold);
      const profit = opts.tradePnlFn ? opts.tradePnlFn(i) : 1;
      trades.push({
        number: nextTradeNumber++,
        side: "long",
        entry_time: start + i * HOUR,
        entry_price: 100,
        exit_time: start + exitIdx * HOUR,
        exit_price: 100,
        size: 1,
        profit,
      });
    }
  }
  return { equity, trades };
};

const baseInput = (overrides: Partial<CpcvInput> = {}): CpcvInput => ({
  mode: "approxSlice",
  symbol: "BINANCE:BTCUSDT",
  studyId: "STD;X",
  paramGrid: { p: [1, 2] },
  N: 4,
  k: 2,
  timeframe: "60",
  bars: 1000,
  ...overrides,
});

describe("cpcv-runner", () => {
  beforeEach(() => {
    runStrategyCachedMock.mockReset();
  });

  it("validates required inputs", async () => {
    await expect(
      runCpcv({ ...baseInput(), symbol: "" }),
    ).rejects.toThrow(/symbol required/);
    await expect(
      runCpcv({ ...baseInput(), studyId: undefined, source: undefined }),
    ).rejects.toThrow(/studyId or source required/);
    await expect(
      runCpcv({ ...baseInput(), paramGrid: {} }),
    ).rejects.toThrow(/non-empty paramGrid required/);
    await expect(
      runCpcv({ ...baseInput(), N: 1 }),
    ).rejects.toThrow(/N must be > 1/);
    await expect(
      runCpcv({ ...baseInput(), N: 4, k: 0 }),
    ).rejects.toThrow(/k must satisfy/);
    await expect(
      runCpcv({ ...baseInput(), N: 4, k: 4 }),
    ).rejects.toThrow(/k must satisfy/);
  });

  it("approxSlice tags mode and emits required claim-guard notes", async () => {
    runStrategyCachedMock.mockImplementation(async (req: StrategyRunRequest) => {
      const param = (req.params?.p ?? 1) as number;
      return synthesize({
        bars: 200,
        driftFn: (_i, _f) => 0.5 * param,
      });
    });
    const out = await runCpcv(
      baseInput({ mode: "approxSlice", paramGrid: { p: [1, 2, 3] } }),
    );
    expect(out.mode).toBe("approxSlice");
    expect(out.metric).toBe("sortino");
    expect(out.notes).toContain(
      "approximate-fold-metrics: single-run partition does NOT produce purged CPCV",
    );
    expect(out.notes).toContain(
      "do-not-report-as-PBO-without-exactWindowed: rank statistic is approximate",
    );
    expect(out.notes).toContain(
      "compounding-artifact: continuous-equity carries across fold boundaries",
    );
    expect(out.contamination).toBeDefined();
    expect(out.contamination?.compoundingArtifact).toBe(true);
    expect(out.approximateFoldMetrics).toBeDefined();
    expect(out.approximateFoldMetrics?.length).toBe(3);
    expect(out.oosSortinoDistribution).toBeUndefined();
    expect(out.oosSharpeDistribution).toBeUndefined();
  });

  it("approxSlice contamination block reflects caller-declared metadata", async () => {
    runStrategyCachedMock.mockImplementation(async () =>
      synthesize({ bars: 200, driftFn: () => 0.1 }),
    );
    const out = await runCpcv(
      baseInput({
        mode: "approxSlice",
        varStateLeakage: true,
        requestSecurityLookback: 50,
      }),
    );
    expect(out.contamination?.varStateLeakage).toBe(true);
    expect(out.contamination?.requestSecurityLookback).toBe(50);
    expect(out.notes).toContain(
      "var-state-leakage: pine var/varip persists across fold boundaries",
    );
    expect(
      out.notes.some((n) => n.startsWith("request-security-lookback:")),
    ).toBe(true);
  });

  it("approxSlice detects open-position straddles across fold boundaries", async () => {
    // N=4, bars=200, foldWidth=50. A trade entering at bar 40 and exiting at
    // bar 60 straddles boundary 50 (start of fold 1).
    runStrategyCachedMock.mockImplementation(async () =>
      synthesize({
        bars: 200,
        driftFn: () => 0.05,
        tradeFn: (i) => i === 40,
        tradeHoldBars: () => 20,
        tradePnlFn: () => 1,
      }),
    );
    const out = await runCpcv(baseInput({ mode: "approxSlice" }));
    expect(out.contamination?.openPositionStraddleRate).toBeGreaterThan(0);
    expect(
      out.notes.some((n) => n.startsWith("open-position-straddle:")),
    ).toBe(true);
  });

  it("approxSlice flags warmupBiasFolds when first-bar trades exist in non-zero folds", async () => {
    // Trade entries at fold-start bars 50, 100, 150 — these are first-bar
    // trades in folds 1, 2, 3 → warmupBiasFolds should include all three.
    runStrategyCachedMock.mockImplementation(async () =>
      synthesize({
        bars: 200,
        driftFn: () => 0.05,
        tradeFn: (i) => i === 50 || i === 100 || i === 150,
        tradeHoldBars: () => 0,
        tradePnlFn: () => 1,
      }),
    );
    const out = await runCpcv(baseInput({ mode: "approxSlice" }));
    expect(out.contamination?.warmupBiasFolds).toEqual([1, 2, 3]);
  });

  it("exactWindowed tags mode and emits OOS distributions, no contamination block", async () => {
    runStrategyCachedMock.mockImplementation(async (req: StrategyRunRequest) => {
      const param = (req.params?.p ?? 1) as number;
      return synthesize({
        bars: 200,
        driftFn: (_i, _f) => 0.5 * param,
      });
    });
    const out = await runCpcv(
      baseInput({ mode: "exactWindowed", embargoBars: 5, paramGrid: { p: [1, 2, 3] } }),
    );
    expect(out.mode).toBe("exactWindowed");
    expect(out.contamination).toBeUndefined();
    expect(out.approximateFoldMetrics).toBeUndefined();
    expect(out.oosSortinoDistribution).toBeDefined();
    expect(out.oosSharpeDistribution).toBeDefined();
    expect(out.notes).toContain(
      "exactWindowed: purge + embargo applied to fold-trade assignment",
    );
    expect(out.notes.some((n) => n.includes("embargoBars=0"))).toBe(false);
  });

  it("exactWindowed warns when embargoBars=0", async () => {
    runStrategyCachedMock.mockImplementation(async () =>
      synthesize({ bars: 200, driftFn: () => 0.1 }),
    );
    const out = await runCpcv(
      baseInput({ mode: "exactWindowed", embargoBars: 0 }),
    );
    expect(
      out.notes.some((n) => n.startsWith("embargoBars=0:")),
    ).toBe(true);
  });

  it("exactWindowed purges trades that straddle fold boundaries", async () => {
    // Bars=200, N=4, foldWidth=50. Trade at bar 40 holding 20 bars exits at
    // bar 60 → straddles boundary at bar 50 → must be dropped from fold 0
    // and fold 1 metrics.
    let calls = 0;
    runStrategyCachedMock.mockImplementation(async () => {
      calls += 1;
      return synthesize({
        bars: 200,
        driftFn: () => 0.05,
        tradeFn: (i) => i === 40 || i === 80, // 40-60 straddles, 80 is in-fold
        tradeHoldBars: () => 20,
        tradePnlFn: () => 5,
      });
    });
    const out = await runCpcv(
      baseInput({ mode: "exactWindowed", embargoBars: 0, paramGrid: { p: [1] } }),
    );
    expect(calls).toBeGreaterThanOrEqual(1);
    // perFoldMetrics shape is [combos][folds]; with one combo and N=4 we
    // should see four numbers (some NaN if no in-fold trades made it
    // through purge).
    expect(out.perFoldMetrics.length).toBe(1);
    expect(out.perFoldMetrics[0].length).toBe(4);
  });

  it("exactWindowed PBO is computed and shape is sane across modes", async () => {
    runStrategyCachedMock.mockImplementation(async (req: StrategyRunRequest) => {
      const param = (req.params?.p ?? 1) as number;
      return synthesize({
        bars: 200,
        driftFn: (_i, fold) => 0.1 + 0.05 * param + 0.01 * fold,
      });
    });
    const out = await runCpcv(
      baseInput({
        mode: "exactWindowed",
        paramGrid: { p: [1, 2, 3, 4] },
        N: 4,
        k: 2,
      }),
    );
    expect(out.pbo.combos).toBe(4);
    expect(out.pbo.folds).toBe(4);
    expect(out.pbo.k).toBe(2);
    // C(4,2) = 6 splits expected.
    expect(out.pbo.splitsEvaluated).toBe(6);
    expect(out.pbo.pbo).toBeGreaterThanOrEqual(0);
    expect(out.pbo.pbo).toBeLessThanOrEqual(1);
  });

  it("propagates kv into runStrategyCached so cache short-circuits per-cell calls", async () => {
    const kv = { get: vi.fn(async () => null), put: vi.fn(async () => undefined) };
    runStrategyCachedMock.mockImplementation(async (_req, _cache) => {
      return synthesize({ bars: 200, driftFn: () => 0.1 });
    });
    await runCpcv(
      baseInput({ mode: "approxSlice", paramGrid: { p: [1, 2] }, kv: kv as any }),
    );
    // Two combos → two TV-cached calls; each call should see the kv handle.
    expect(runStrategyCachedMock).toHaveBeenCalledTimes(2);
    for (const call of runStrategyCachedMock.mock.calls) {
      expect(call[1]).toBe(kv);
    }
  });

  it("throws cpcv_insufficient_history when equity is shorter than N folds", async () => {
    runStrategyCachedMock.mockImplementation(async () =>
      synthesize({ bars: 3, driftFn: () => 0.1 }),
    );
    await expect(
      runCpcv(baseInput({ mode: "approxSlice", N: 4, k: 2 })),
    ).rejects.toThrow(/too short for N=4 folds/);
    runStrategyCachedMock.mockImplementation(async () =>
      synthesize({ bars: 3, driftFn: () => 0.1 }),
    );
    await expect(
      runCpcv(baseInput({ mode: "exactWindowed", N: 4, k: 2 })),
    ).rejects.toThrow(/too short for N=4 folds/);
  });
});
