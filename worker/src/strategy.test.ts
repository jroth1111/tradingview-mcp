import { describe, expect, it, vi } from "vitest";
import * as tv from "./tradingview";
import type { StudyResult } from "./tradingview";
import {
  buildStrategyInputs,
  cartesianProduct,
  optimizeStrategy,
  parseStrategyOutputs,
  runStrategy,
} from "./strategy";

const makeStudyResult = (
  nonseries: Record<string, any> | undefined,
): StudyResult => ({
  symbol: "NASDAQ:AAPL",
  studyId: "PUB;test",
  studyVersion: "1",
  wireId: "Script$PUB;test@tv-scripting-101!",
  timeframe: "60",
  bars: 300,
  plots: [],
  nonseries,
});

describe("buildStrategyInputs", () => {
  it("merges strategy properties at the top level alongside base inputs", () => {
    const merged = buildStrategyInputs(
      { in_0: 14, in_1: "close" },
      {
        initial_capital: 100000,
        commission_value: 0.05,
        commission_type: "percent",
        pyramiding: 2,
      },
    );
    expect(merged).toEqual({
      in_0: 14,
      in_1: "close",
      initial_capital: 100000,
      commission_value: 0.05,
      commission_type: "percent",
      pyramiding: 2,
    });
  });

  it("preserves exact strategy property key names (no transformation)", () => {
    const merged = buildStrategyInputs(undefined, {
      default_qty_type: "percent_of_equity",
      default_qty_value: 25,
      use_bar_magnifier: true,
    });
    // Keys must be the literal property names; no prefix is added.
    expect(Object.keys(merged).sort()).toEqual([
      "default_qty_type",
      "default_qty_value",
      "use_bar_magnifier",
    ]);
    expect(merged.default_qty_type).toBe("percent_of_equity");
    expect(merged.use_bar_magnifier).toBe(true);
  });

  it("lets caller-supplied inputs override property-derived defaults", () => {
    const merged = buildStrategyInputs(
      { initial_capital: 250000 },
      { initial_capital: 100000 },
    );
    expect(merged.initial_capital).toBe(250000);
  });

  it("skips undefined property values", () => {
    const merged = buildStrategyInputs(
      {},
      {
        initial_capital: 100000,
        commission_value: undefined,
        pyramiding: undefined,
      },
    );
    expect(merged).toEqual({ initial_capital: 100000 });
  });

  it("returns an empty object when no inputs or properties are provided", () => {
    expect(buildStrategyInputs(undefined, undefined)).toEqual({});
  });
});

describe("parseStrategyOutputs", () => {
  it("returns empty defaults for null/undefined ns", () => {
    const out = parseStrategyOutputs(undefined);
    expect(out.report).toEqual({});
    expect(out.trades).toEqual([]);
    expect(out.equity).toEqual([]);
  });

  it("parses a representative ns payload with report, trades, and equity", () => {
    const ns = {
      netProfit: 12345.6,
      net_profit_percent: 12.34,
      grossProfit: 20000,
      grossLoss: -7654.4,
      totalTrades: 10,
      winningTrades: 6,
      losingTrades: 4,
      winRate: 0.6,
      profitFactor: 2.61,
      maxDrawdown: 1500.5,
      max_drawdown_percent: 1.5,
      sharpe_ratio: 1.42,
      trades: [
        {
          number: 1,
          side: "long",
          entryTime: 1_700_000_000,
          entryPrice: 100,
          size: 1,
          exitTime: 1_700_003_600,
          exitPrice: 110,
          profit: 10,
          profitPct: 10,
          cumProfit: 10,
        },
        {
          number: 2,
          side: "short",
          entryTime: 1_700_007_200,
          entryPrice: 110,
          size: 1,
          exitTime: 1_700_010_800,
          exitPrice: 105,
          profit: 5,
          cumProfit: 15,
        },
      ],
      equity: [
        { ts: 1_700_000_000, equity: 100000 },
        { ts: 1_700_003_600, equity: 100010, drawdown: 0 },
        { ts: 1_700_010_800, equity: 100015, drawdown: 0 },
      ],
    };
    const out = parseStrategyOutputs(ns);
    expect(out.report.netProfit).toBe(12345.6);
    expect(out.report.netProfitPct).toBe(12.34);
    expect(out.report.grossProfit).toBe(20000);
    expect(out.report.grossLoss).toBe(-7654.4);
    expect(out.report.totalTrades).toBe(10);
    expect(out.report.winningTrades).toBe(6);
    expect(out.report.losingTrades).toBe(4);
    expect(out.report.winRate).toBe(0.6);
    expect(out.report.profitFactor).toBe(2.61);
    expect(out.report.maxDrawdown).toBe(1500.5);
    expect(out.report.maxDrawdownPct).toBe(1.5);
    expect(out.report.sharpeRatio).toBe(1.42);
    expect(out.report.raw).toBe(ns);

    expect(out.trades).toHaveLength(2);
    expect(out.trades[0]).toMatchObject({
      number: 1,
      side: "long",
      entryTime: 1_700_000_000,
      entryPrice: 100,
      exitTime: 1_700_003_600,
      exitPrice: 110,
      profit: 10,
      profitPct: 10,
      cumProfit: 10,
    });
    expect(out.trades[1].side).toBe("short");

    expect(out.equity).toHaveLength(3);
    expect(out.equity[0]).toEqual({ ts: 1_700_000_000, equity: 100000 });
    expect(out.equity[1]).toEqual({
      ts: 1_700_003_600,
      equity: 100010,
      drawdown: 0,
    });
  });

  it("parses ns.d when it is a JSON-encoded string", () => {
    const inner = {
      netProfit: 42,
      winRate: 0.5,
      trades: [
        {
          number: 1,
          side: "long",
          entryTime: 1_700_000_000,
          entryPrice: 50,
          size: 1,
        },
      ],
    };
    const ns = { d: JSON.stringify(inner) };
    const out = parseStrategyOutputs(ns);
    expect(out.report.netProfit).toBe(42);
    expect(out.report.winRate).toBe(0.5);
    expect(out.trades).toHaveLength(1);
  });

  it("derives an equity curve from trade exits when no equity series is provided", () => {
    const ns = {
      trades: [
        {
          number: 1,
          side: "long",
          entryTime: 1,
          entryPrice: 100,
          size: 1,
          exitTime: 2,
          exitPrice: 110,
          cumProfit: 10,
        },
        {
          number: 2,
          side: "long",
          entryTime: 3,
          entryPrice: 110,
          size: 1,
          exitTime: 4,
          exitPrice: 115,
          cumProfit: 15,
        },
      ],
    };
    const out = parseStrategyOutputs(ns);
    expect(out.equity).toEqual([
      { ts: 2, equity: 10 },
      { ts: 4, equity: 15 },
    ]);
  });

  it("preserves the raw payload on report.raw for unknown shapes", () => {
    const ns = { something: "weird", nested: { foo: 1 } };
    const out = parseStrategyOutputs(ns);
    expect(out.report.raw).toBe(ns);
    expect(out.trades).toEqual([]);
    expect(out.equity).toEqual([]);
  });
});

describe("cartesianProduct", () => {
  it("returns the full product for a 2x2 matrix", () => {
    const combos = cartesianProduct({ a: [1, 2], b: [10, 20] });
    expect(combos).toEqual([
      { a: 1, b: 10 },
      { a: 1, b: 20 },
      { a: 2, b: 10 },
      { a: 2, b: 20 },
    ]);
  });

  it("returns [{}] for an empty matrix", () => {
    expect(cartesianProduct({})).toEqual([{}]);
  });

  it("returns [] when any dimension is empty", () => {
    expect(cartesianProduct({ a: [1, 2], b: [] })).toEqual([]);
  });

  it("handles a 3-dimensional sweep", () => {
    const combos = cartesianProduct({ a: [1], b: [2, 3], c: [4, 5] });
    expect(combos).toHaveLength(4);
    expect(combos[0]).toEqual({ a: 1, b: 2, c: 4 });
  });
});

describe("runStrategy", () => {
  it("calls runStudy with merged inputs and returns a parsed result", async () => {
    const spy = vi.spyOn(tv, "runStudy").mockResolvedValueOnce(
      makeStudyResult({
        netProfit: 500,
        winRate: 0.7,
        trades: [
          {
            number: 1,
            side: "long",
            entryTime: 1_700_000_000,
            entryPrice: 100,
            size: 1,
          },
        ],
      }),
    );

    const result = await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      properties: { initial_capital: 50000 },
      inputs: { in_0: 14 },
      params: { length: 20 },
      timeframe: "1D",
      bars: 500,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg.symbol).toBe("NASDAQ:AAPL");
    expect(arg.studyId).toBe("PUB;test");
    expect(arg.inputs).toEqual({ in_0: 14, initial_capital: 50000 });
    expect(arg.params).toEqual({ length: 20 });
    expect(arg.timeframe).toBe("1D");
    expect(arg.bars).toBe(500);

    expect(result.report.netProfit).toBe(500);
    expect(result.report.winRate).toBe(0.7);
    expect(result.trades).toHaveLength(1);
    expect(result.studyResult.studyId).toBe("PUB;test");

    spy.mockRestore();
  });

  it("throws when source is provided without a studyId (pre-compile required)", async () => {
    await expect(
      runStrategy({
        symbol: "NASDAQ:AAPL",
        source: "//@version=5\nstrategy('x')\nplot(close)",
      }),
    ).rejects.toThrow(/source path requires pre-compile/);
  });

  it("throws when studyId is missing", async () => {
    await expect(
      runStrategy({ symbol: "NASDAQ:AAPL" } as any),
    ).rejects.toThrow(/studyId required/);
  });

  it("returns empty arrays when nonseries is undefined", async () => {
    const spy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValueOnce(makeStudyResult(undefined));
    const result = await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
    });
    expect(result.report).toEqual({});
    expect(result.trades).toEqual([]);
    expect(result.equity).toEqual([]);
    spy.mockRestore();
  });
});

describe("optimizeStrategy", () => {
  it("runs a 2x2 sweep, returns sorted results, and selects best by netProfit", async () => {
    // Map (length, threshold) -> netProfit so we can verify combo plumbing.
    const profitTable: Record<string, number> = {
      "10|60": 100,
      "10|70": 250,
      "20|60": 175,
      "20|70": 50,
    };
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async (req) => {
      const key = `${req.params!.length}|${req.params!.threshold}`;
      return makeStudyResult({ netProfit: profitTable[key] });
    });

    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { length: [10, 20], threshold: [60, 70] },
    });

    expect(spy).toHaveBeenCalledTimes(4);
    expect(out.combos).toBe(4);
    expect(out.results).toHaveLength(4);
    expect(out.results.map((r) => r.params)).toEqual([
      { length: 10, threshold: 60 },
      { length: 10, threshold: 70 },
      { length: 20, threshold: 60 },
      { length: 20, threshold: 70 },
    ]);
    expect(out.best).toBeDefined();
    expect(out.best!.params).toEqual({ length: 10, threshold: 70 });
    expect(out.best!.report.netProfit).toBe(250);

    spy.mockRestore();
  });

  it("respects the concurrency parameter", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async () => {
      inFlight += 1;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      // Yield a few microtasks to give the limiter a chance to schedule
      // additional concurrent calls; without this every promise would
      // resolve before the next is scheduled and inFlight would never grow.
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return makeStudyResult({ netProfit: 1 });
    });

    await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { a: [1, 2, 3, 4, 5, 6] },
      concurrency: 2,
    });

    expect(spy).toHaveBeenCalledTimes(6);
    expect(peakInFlight).toBeGreaterThan(0);
    expect(peakInFlight).toBeLessThanOrEqual(2);

    spy.mockRestore();
  });

  it("skips combos with undefined metric when picking best", async () => {
    const profitByA: Record<number, number | undefined> = {
      1: undefined,
      2: 100,
      3: undefined,
    };
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async (req) => {
      const a = req.params!.a as number;
      const ns = profitByA[a] !== undefined ? { netProfit: profitByA[a] } : {};
      return makeStudyResult(ns);
    });

    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { a: [1, 2, 3] },
    });

    expect(out.results).toHaveLength(3);
    expect(out.best).toBeDefined();
    expect(out.best!.params).toEqual({ a: 2 });
    expect(out.best!.report.netProfit).toBe(100);

    spy.mockRestore();
  });

  it("returns best=undefined when no combo produces the metric", async () => {
    const spy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValue(makeStudyResult({}));
    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { a: [1, 2] },
    });
    expect(out.best).toBeUndefined();
    expect(out.results).toHaveLength(2);
    spy.mockRestore();
  });

  it("can rank by an alternate metric like winRate", async () => {
    const winRateByA: Record<number, number> = { 1: 0.4, 2: 0.9, 3: 0.6 };
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async (req) => {
      const a = req.params!.a as number;
      return makeStudyResult({ winRate: winRateByA[a] });
    });

    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { a: [1, 2, 3] },
      metric: "winRate",
    });

    expect(out.best!.params).toEqual({ a: 2 });
    expect(out.best!.report.winRate).toBe(0.9);
    spy.mockRestore();
  });
});
