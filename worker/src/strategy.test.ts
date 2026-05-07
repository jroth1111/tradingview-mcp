import { afterEach, describe, expect, it, vi } from "vitest";

import * as pine from "./pine";
import * as pineCrud from "./pine-crud";
import {
  buildPlotEchoSource,
  buildStrategyWireInputs,
  cartesianProduct,
  optimizeStrategy,
  parseStrategyOutputs,
  runStrategy,
} from "./strategy";
import * as tv from "./tradingview";
import type { StudyResult } from "./tradingview";

afterEach(() => {
  vi.restoreAllMocks();
});

const makeStudyResult = (
  nonseries: Record<string, any> | undefined,
): StudyResult => ({
  symbol: "NASDAQ:AAPL",
  studyId: "PUB;test",
  studyVersion: "1",
  wireId: "Script@tv-scripting-101!",
  timeframe: "60",
  bars: 300,
  plots: [],
  nonseries,
});

const mockNoMeta = () =>
  vi.spyOn(tv, "getIndicatorMeta").mockRejectedValue(new Error("no meta in test"));

describe("buildStrategyWireInputs", () => {
  it("bundles validated properties into the in_0 envelope and tags wireForm", () => {
    const out = buildStrategyWireInputs({
      properties: {
        initial_capital: 100000,
        commission_value: 0.05,
        commission_type: "percent",
        pyramiding: 2,
      },
    });
    expect(out.inputs.in_0).toEqual({
      initial_capital: 100000,
      commission_value: 0.05,
      commission_type: "percent",
      pyramiding: 2,
    });
    expect(out.diagnostics.wireForm).toBe("conservative-bundle");
    expect(out.diagnostics.acceptedProperties.sort()).toEqual([
      "commission_type",
      "commission_value",
      "initial_capital",
      "pyramiding",
    ]);
  });

  it("rejects unknown property keys into diagnostics.rejectedProperties", () => {
    const out = buildStrategyWireInputs({
      properties: {
        initial_capital: 100000,
        // @ts-expect-error — testing the runtime guard rejects unknown keys
        bogus_legacy_key: 42,
      },
    });
    expect(out.inputs.in_0).toEqual({ initial_capital: 100000 });
    expect(out.diagnostics.rejectedProperties).toEqual({ bogus_legacy_key: 42 });
  });

  it("flags bad default_qty_type enum values and drops the property", () => {
    const out = buildStrategyWireInputs({
      properties: {
        initial_capital: 100000,
        // @ts-expect-error — old "fixed_units" value is no longer canonical
        default_qty_type: "fixed_units",
      },
    });
    expect(out.inputs.in_0).toEqual({ initial_capital: 100000 });
    expect(out.diagnostics.enumViolations).toEqual([
      {
        key: "default_qty_type",
        value: "fixed_units",
        allowed: ["fixed", "cash_per_order", "percent_of_equity"],
      },
    ]);
  });

  it("flags bad commission_type enum values and drops the property", () => {
    const out = buildStrategyWireInputs({
      properties: {
        // @ts-expect-error — invalid enum
        commission_type: "absolute",
      },
    });
    expect(out.inputs.in_0).toEqual({});
    expect(out.diagnostics.enumViolations).toHaveLength(1);
    expect(out.diagnostics.enumViolations[0].key).toBe("commission_type");
  });

  it("keeps slot-1+ user inputs at the top level (conservative-bundle)", () => {
    const out = buildStrategyWireInputs({
      properties: { initial_capital: 50000 },
      rawInputs: { in_0: 14, in_1: 20, in_2: "RSI" },
    });
    expect(out.inputs.in_1).toBe(20);
    expect(out.inputs.in_2).toBe("RSI");
    // in_0 is bundled (slot-0 user value tucked inside the envelope using the
    // literal slot id when no meta-name is available).
    expect(out.inputs.in_0).toEqual({ initial_capital: 50000, in_0: 14 });
  });

  it("uses the meta-name for the slot-0 key when metaInfo is available", () => {
    const meta = {
      inputs: [
        { id: "in_0", name: "Length", type: "integer" },
        { id: "in_1", name: "ATR Length", type: "integer" },
      ],
    };
    const out = buildStrategyWireInputs({
      properties: { initial_capital: 50000 },
      rawInputs: { in_0: 14, in_1: 20 },
      meta,
    });
    expect(out.inputs.in_0).toEqual({ initial_capital: 50000, Length: 14 });
    expect(out.inputs.in_1).toBe(20);
  });

  it("merges a caller-pre-shaped in_0 dict with property-derived envelope", () => {
    const out = buildStrategyWireInputs({
      properties: { initial_capital: 50000, commission_value: 0.1 },
      rawInputs: { in_0: { customLevel: 1.5 } },
    });
    expect(out.inputs.in_0).toEqual({
      initial_capital: 50000,
      commission_value: 0.1,
      customLevel: 1.5,
    });
  });

  it("records collision when caller-pre-shaped in_0 overrides a property", () => {
    const out = buildStrategyWireInputs({
      properties: { initial_capital: 50000 },
      rawInputs: { in_0: { initial_capital: 250000 } },
    });
    expect(out.inputs.in_0).toEqual({ initial_capital: 250000 });
    expect(out.diagnostics.inputCollisions).toEqual([
      { key: "initial_capital", propertyValue: 50000, inputValue: 250000 },
    ]);
  });

  it("resolves paramsByName via meta to slot ids", () => {
    const meta = {
      inputs: [
        { id: "in_0", name: "Length", type: "integer" },
        { id: "in_1", name: "Source", type: "source" },
      ],
    };
    const out = buildStrategyWireInputs({
      paramsByName: { Length: 21, Source: "close" },
      meta,
    });
    expect(out.inputs.in_0).toEqual({ Length: 21 });
    expect(out.inputs.in_1).toBe("sds_1$close");
    expect(out.diagnostics.paramAliases.sort((a, b) => a.name.localeCompare(b.name)))
      .toEqual([
        { name: "Length", resolvedId: "in_0" },
        { name: "Source", resolvedId: "in_1" },
      ]);
  });

  it("rewrites source-typed inputs using the parent series id", () => {
    const meta = {
      inputs: [
        { id: "in_0", name: "Length", type: "integer" },
        { id: "in_1", name: "Source", type: "source" },
      ],
    };
    const out = buildStrategyWireInputs({
      rawInputs: { in_0: 14, in_1: "hl2" },
      meta,
    });
    expect(out.inputs.in_1).toBe("sds_1$hl2");
    expect(out.diagnostics.sourceRewrites).toEqual([
      { id: "in_1", before: "hl2", after: "sds_1$hl2" },
    ]);
  });

  it("wraps symbol-typed inputs as {type:'symbol', value}", () => {
    const meta = {
      inputs: [
        { id: "in_0", name: "Length", type: "integer" },
        { id: "in_1", name: "Compare", type: "symbol" },
      ],
    };
    const out = buildStrategyWireInputs({
      rawInputs: { in_0: 14, in_1: "NASDAQ:MSFT" },
      meta,
    });
    expect(out.inputs.in_1).toEqual({ type: "symbol", value: "NASDAQ:MSFT" });
    expect(out.diagnostics.symbolRewrites).toEqual([
      {
        id: "in_1",
        before: "NASDAQ:MSFT",
        after: { type: "symbol", value: "NASDAQ:MSFT" },
      },
    ]);
  });

  it("returns an empty bundle when no inputs or properties are provided", () => {
    const out = buildStrategyWireInputs({});
    expect(out.inputs).toEqual({ in_0: {} });
  });
});

describe("buildPlotEchoSource", () => {
  it("emits a Pine v5 strategy with one input.source per public plot", () => {
    const src = buildPlotEchoSource({
      plots: [
        { id: "plot_0", title: "Buy Signal", type: "shapes" },
        { id: "plot_1", title: "Sell Signal", type: "shapes" },
        { id: "plot_2", title: "internal", type: "no_series" }, // filtered
      ],
    });
    expect(src).toContain("//@version=5");
    expect(src).toContain('strategy("Plot Echo", overlay=true)');
    expect(src).toContain('src1 = input.source(close, "Buy Signal")');
    expect(src).toContain('src2 = input.source(close, "Sell Signal")');
    expect(src).not.toContain("internal");
  });

  it("scrubs quote characters from plot titles", () => {
    const src = buildPlotEchoSource({
      plots: [{ id: "plot_0", title: 'tricky"name', type: "line" }],
    });
    expect(src).toContain('src1 = input.source(close, "trickyname")');
  });

  it("falls back gracefully when no plots are public", () => {
    const src = buildPlotEchoSource({ plots: [] });
    expect(src).toContain("No public plots");
    expect(src).toContain("strategy(");
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
      net_profit: 12345.6,
      net_profit_percent: 12.34,
      gross_profit: 20000,
      profit_factor: 2.61,
      total_trades: 10,
      winning_trades: 6,
      losing_trades: 4,
      even_trades: 0,
      win_rate: 0.6,
      max_drawdown: 1500.5,
      max_drawdown_percent: 1.5,
      max_runup: 800,
      max_runup_percent: 0.8,
      sharpe_ratio: 1.42,
      sortino_ratio: 1.95,
      avg_trade: 50,
      avg_winning_trade: 200,
      avg_losing_trade: -100,
      largest_winning_trade: 500,
      largest_losing_trade: -200,
      buy_hold_return: 0.05,
      alpha: 0.01,
      beta: 0.9,
      ratio_avg_win_avg_loss: 2,
      currency_rate: 1,
      trades: [
        {
          number: 1,
          side: "long",
          entry_time: 1_700_000_000,
          entry_price: 100,
          size: 1,
          exit_time: 1_700_003_600,
          exit_price: 110,
          profit: 10,
          profit_pct: 10,
          cumulative_profit: 10,
        },
        {
          number: 2,
          side: "short",
          entry_time: 1_700_007_200,
          entry_price: 110,
          size: 1,
          exit_time: 1_700_010_800,
          exit_price: 105,
          profit: 5,
          cumulative_profit: 15,
        },
      ],
      equity: [
        { ts: 1_700_000_000, equity: 100000 },
        { ts: 1_700_003_600, equity: 100010, drawdown: 0 },
        { ts: 1_700_010_800, equity: 100015, drawdown: 0 },
      ],
    };
    const out = parseStrategyOutputs(ns);
    expect(out.report.net_profit).toBe(12345.6);
    expect(out.report.net_profit_percent).toBe(12.34);
    expect(out.report.gross_profit).toBe(20000);
    expect(out.report.total_trades).toBe(10);
    expect(out.report.winning_trades).toBe(6);
    expect(out.report.losing_trades).toBe(4);
    expect(out.report.even_trades).toBe(0);
    expect(out.report.win_rate).toBe(0.6);
    expect(out.report.profit_factor).toBe(2.61);
    expect(out.report.max_drawdown).toBe(1500.5);
    expect(out.report.max_drawdown_percent).toBe(1.5);
    expect(out.report.max_runup).toBe(800);
    expect(out.report.max_runup_percent).toBe(0.8);
    expect(out.report.sharpe_ratio).toBe(1.42);
    expect(out.report.sortino_ratio).toBe(1.95);
    expect(out.report.avg_trade).toBe(50);
    expect(out.report.avg_winning_trade).toBe(200);
    expect(out.report.avg_losing_trade).toBe(-100);
    expect(out.report.largest_winning_trade).toBe(500);
    expect(out.report.largest_losing_trade).toBe(-200);
    expect(out.report.buy_hold_return).toBe(0.05);
    expect(out.report.alpha).toBe(0.01);
    expect(out.report.beta).toBe(0.9);
    expect(out.report.ratio_avg_win_avg_loss).toBe(2);
    expect(out.report.currency_rate).toBe(1);
    expect(out.report.raw).toBe(ns);

    expect(out.trades).toHaveLength(2);
    expect(out.trades[0]).toMatchObject({
      number: 1,
      side: "long",
      entry_time: 1_700_000_000,
      entry_price: 100,
      exit_time: 1_700_003_600,
      exit_price: 110,
      profit: 10,
      profit_pct: 10,
      cumulative_profit: 10,
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

  it("preserves camelCase wire-form aliases for backwards-compat parsing", () => {
    // TradingView upstreams emit camelCase variants in some Pine versions.
    // Aliases must continue to parse into canonical snake_case fields.
    const ns = {
      netProfit: 100,
      grossProfit: 150,
      maxDrawdown: 50,
      maxDrawdownPct: 5,
      sharpeRatio: 1.0,
      sortinoRatio: 1.5,
      profitFactor: 3,
      totalTrades: 5,
      winningTrades: 3,
      losingTrades: 2,
      winRate: 0.6,
      avgTrade: 20,
      largestWin: 50,
      largestLoss: -10,
    };
    const out = parseStrategyOutputs(ns);
    expect(out.report.net_profit).toBe(100);
    expect(out.report.gross_profit).toBe(150);
    expect(out.report.max_drawdown).toBe(50);
    expect(out.report.max_drawdown_percent).toBe(5);
    expect(out.report.sharpe_ratio).toBe(1.0);
    expect(out.report.sortino_ratio).toBe(1.5);
    expect(out.report.profit_factor).toBe(3);
    expect(out.report.total_trades).toBe(5);
    expect(out.report.winning_trades).toBe(3);
    expect(out.report.losing_trades).toBe(2);
    expect(out.report.win_rate).toBe(0.6);
    expect(out.report.avg_trade).toBe(20);
    expect(out.report.largest_winning_trade).toBe(50);
    expect(out.report.largest_losing_trade).toBe(-10);
  });

  it("parses ns.d when it is a JSON-encoded string", () => {
    const inner = {
      net_profit: 42,
      win_rate: 0.5,
      trades: [
        {
          number: 1,
          side: "long",
          entry_time: 1_700_000_000,
          entry_price: 50,
          size: 1,
        },
      ],
    };
    const ns = { d: JSON.stringify(inner) };
    const out = parseStrategyOutputs(ns);
    expect(out.report.net_profit).toBe(42);
    expect(out.report.win_rate).toBe(0.5);
    expect(out.trades).toHaveLength(1);
  });

  it("derives an equity curve from trade exits when no equity series is provided", () => {
    const ns = {
      trades: [
        {
          number: 1,
          side: "long",
          entry_time: 1,
          entry_price: 100,
          size: 1,
          exit_time: 2,
          exit_price: 110,
          cumulative_profit: 10,
        },
        {
          number: 2,
          side: "long",
          entry_time: 3,
          entry_price: 110,
          size: 1,
          exit_time: 4,
          exit_price: 115,
          cumulative_profit: 15,
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
  it("calls runStudy with the in_0 envelope, inputsPreShaped, and parses the result", async () => {
    const metaSpy = mockNoMeta();
    const runSpy = vi.spyOn(tv, "runStudy").mockResolvedValueOnce(
      makeStudyResult({
        net_profit: 500,
        win_rate: 0.7,
        trades: [
          {
            number: 1,
            side: "long",
            entry_time: 1_700_000_000,
            entry_price: 100,
            size: 1,
          },
        ],
      }),
    );

    const result = await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      properties: {
        initial_capital: 50000,
        default_qty_type: "percent_of_equity",
        default_qty_value: 10,
      },
      inputs: { in_1: 20 },
      timeframe: "1D",
      bars: 500,
    });

    expect(runSpy).toHaveBeenCalledTimes(1);
    const arg = runSpy.mock.calls[0][0];
    expect(arg.symbol).toBe("NASDAQ:AAPL");
    expect(arg.studyId).toBe("PUB;test");
    expect(arg.inputsPreShaped).toBe(true);
    expect(arg.inputs).toEqual({
      in_0: {
        initial_capital: 50000,
        default_qty_type: "percent_of_equity",
        default_qty_value: 10,
      },
      in_1: 20,
    });
    expect(arg.timeframe).toBe("1D");
    expect(arg.bars).toBe(500);

    expect(result.report.net_profit).toBe(500);
    expect(result.report.win_rate).toBe(0.7);
    expect(result.trades).toHaveLength(1);
    expect(result.studyResult.studyId).toBe("PUB;test");
    expect(result.wireDiagnostics.acceptedProperties.sort()).toEqual([
      "default_qty_type",
      "default_qty_value",
      "initial_capital",
    ]);

    runSpy.mockRestore();
    metaSpy.mockRestore();
  });

  it("compiles source via pine-facade and runs the resulting pineId", async () => {
    const metaSpy = mockNoMeta();
    const compileSpy = vi.spyOn(pine, "compilePine").mockResolvedValueOnce({
      success: true,
      mode: "full",
      pineId: "USER;tmp123",
      pineVersion: "1",
      errors: [],
      warnings: [],
    });
    const runSpy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValueOnce(makeStudyResult({}));

    const result = await runStrategy({
      symbol: "NASDAQ:AAPL",
      source: '//@version=5\nstrategy("x")\nplot(close)',
    });

    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0].studyId).toBe("USER;tmp123");
    expect(result.wireDiagnostics.wireForm).toBe("conservative-bundle");

    compileSpy.mockRestore();
    runSpy.mockRestore();
    metaSpy.mockRestore();
  });

  it("surfaces compile errors with category:'validation'", async () => {
    const compileSpy = vi.spyOn(pine, "compilePine").mockResolvedValueOnce({
      success: false,
      mode: "full",
      errors: [{ message: "unexpected token", line: 3 }],
      warnings: [],
    });

    await expect(
      runStrategy({
        symbol: "NASDAQ:AAPL",
        source: "broken pine",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("unexpected token"),
      category: "validation",
    });

    compileSpy.mockRestore();
  });

  it("throws when neither studyId nor source is provided", async () => {
    await expect(
      runStrategy({ symbol: "NASDAQ:AAPL" } as any),
    ).rejects.toThrow(/studyId or source required/);
  });

  it("throws when symbol is missing", async () => {
    await expect(
      runStrategy({ studyId: "PUB;test" } as any),
    ).rejects.toThrow(/symbol required/);
  });

  it("returns empty arrays when nonseries is undefined", async () => {
    const metaSpy = mockNoMeta();
    const runSpy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValueOnce(makeStudyResult(undefined));
    const result = await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
    });
    expect(result.report).toEqual({});
    expect(result.trades).toEqual([]);
    expect(result.equity).toEqual([]);
    runSpy.mockRestore();
    metaSpy.mockRestore();
  });

  it("pre-flights closed-source PUB; studyId via is_auth_to_get when a sessionId is provided", async () => {
    const metaSpy = mockNoMeta();
    const authSpy = vi
      .spyOn(pineCrud, "isAuthToGet")
      .mockResolvedValueOnce({ authorized: true, raw: "true" });
    const runSpy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValueOnce(makeStudyResult({}));

    await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;closed@2.0",
      sessionId: "sid-abc",
      sessionSign: "sign-abc",
    });

    expect(authSpy).toHaveBeenCalledTimes(1);
    expect(authSpy.mock.calls[0][1]).toBe("PUB;closed");
    expect(authSpy.mock.calls[0][2]).toBe("2.0");
    expect(runSpy).toHaveBeenCalledTimes(1);

    authSpy.mockRestore();
    runSpy.mockRestore();
    metaSpy.mockRestore();
  });

  it("throws plan_required when is_auth_to_get returns authorized:false", async () => {
    const metaSpy = mockNoMeta();
    const authSpy = vi
      .spyOn(pineCrud, "isAuthToGet")
      .mockResolvedValueOnce({ authorized: false, raw: "false" });
    const runSpy = vi.spyOn(tv, "runStudy");

    await expect(
      runStrategy({
        symbol: "NASDAQ:AAPL",
        studyId: "PUB;invite-only@1.0",
        sessionId: "sid-abc",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("not accessible"),
      category: "plan_required",
      code: "is_auth_to_get_false",
      status: 403,
    });

    expect(runSpy).not.toHaveBeenCalled();

    authSpy.mockRestore();
    runSpy.mockRestore();
    metaSpy.mockRestore();
  });

  it("skips is_auth_to_get when no sessionId is provided", async () => {
    const metaSpy = mockNoMeta();
    const authSpy = vi.spyOn(pineCrud, "isAuthToGet");
    const runSpy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValueOnce(makeStudyResult({}));

    await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;closed@1.0",
    });

    expect(authSpy).not.toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledTimes(1);

    authSpy.mockRestore();
    runSpy.mockRestore();
    metaSpy.mockRestore();
  });

  it("skips is_auth_to_get for built-in STD; studyIds", async () => {
    const metaSpy = mockNoMeta();
    const authSpy = vi.spyOn(pineCrud, "isAuthToGet");
    const runSpy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValueOnce(makeStudyResult({}));

    await runStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "STD;BB",
      sessionId: "sid-abc",
    });

    expect(authSpy).not.toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledTimes(1);

    authSpy.mockRestore();
    runSpy.mockRestore();
    metaSpy.mockRestore();
  });
});

describe("optimizeStrategy", () => {
  it("runs a 2x2 sweep, returns sorted results, and selects best by net_profit", async () => {
    const metaSpy = mockNoMeta();
    const profitTable: Record<string, number> = {
      "10|60": 100,
      "10|70": 250,
      "20|60": 175,
      "20|70": 50,
    };
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async (req) => {
      // The wire-form inputs envelope no longer surfaces friendly names; the
      // sweep test uses paramsByName which (without meta) doesn't resolve to
      // slot ids. So we encode the combo directly into in_1/in_2 instead.
      const length = (req.inputs as any)?.in_1;
      const threshold = (req.inputs as any)?.in_2;
      return makeStudyResult({ net_profit: profitTable[`${length}|${threshold}`] });
    });

    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { in_1: [10, 20], in_2: [60, 70] },
    });

    expect(spy).toHaveBeenCalledTimes(4);
    expect(out.combos).toBe(4);
    expect(out.results).toHaveLength(4);
    expect(out.results.map((r) => r.params)).toEqual([
      { in_1: 10, in_2: 60 },
      { in_1: 10, in_2: 70 },
      { in_1: 20, in_2: 60 },
      { in_1: 20, in_2: 70 },
    ]);
    expect(out.best).toBeDefined();
    expect(out.best!.params).toEqual({ in_1: 10, in_2: 70 });
    expect(out.best!.report.net_profit).toBe(250);

    spy.mockRestore();
    metaSpy.mockRestore();
  });

  it("respects the concurrency parameter", async () => {
    const metaSpy = mockNoMeta();
    let inFlight = 0;
    let peakInFlight = 0;
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async () => {
      inFlight += 1;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return makeStudyResult({ net_profit: 1 });
    });

    await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { in_1: [1, 2, 3, 4, 5, 6] },
      concurrency: 2,
    });

    expect(spy).toHaveBeenCalledTimes(6);
    expect(peakInFlight).toBeGreaterThan(0);
    expect(peakInFlight).toBeLessThanOrEqual(2);

    spy.mockRestore();
    metaSpy.mockRestore();
  });

  it("skips combos with undefined metric when picking best", async () => {
    const metaSpy = mockNoMeta();
    const profitByA: Record<number, number | undefined> = {
      1: undefined,
      2: 100,
      3: undefined,
    };
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async (req) => {
      const a = (req.inputs as any)?.in_1 as number;
      const ns = profitByA[a] !== undefined ? { net_profit: profitByA[a] } : {};
      return makeStudyResult(ns);
    });

    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { in_1: [1, 2, 3] },
    });

    expect(out.results).toHaveLength(3);
    expect(out.best).toBeDefined();
    expect(out.best!.params).toEqual({ in_1: 2 });
    expect(out.best!.report.net_profit).toBe(100);

    spy.mockRestore();
    metaSpy.mockRestore();
  });

  it("returns best=undefined when no combo produces the metric", async () => {
    const metaSpy = mockNoMeta();
    const spy = vi
      .spyOn(tv, "runStudy")
      .mockResolvedValue(makeStudyResult({}));
    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { in_1: [1, 2] },
    });
    expect(out.best).toBeUndefined();
    expect(out.results).toHaveLength(2);
    spy.mockRestore();
    metaSpy.mockRestore();
  });

  it("can rank by an alternate metric like win_rate", async () => {
    const metaSpy = mockNoMeta();
    const winRateByA: Record<number, number> = { 1: 0.4, 2: 0.9, 3: 0.6 };
    const spy = vi.spyOn(tv, "runStudy").mockImplementation(async (req) => {
      const a = (req.inputs as any)?.in_1 as number;
      return makeStudyResult({ win_rate: winRateByA[a] });
    });

    const out = await optimizeStrategy({
      symbol: "NASDAQ:AAPL",
      studyId: "PUB;test",
      sweep: { in_1: [1, 2, 3] },
      metric: "win_rate",
    });

    expect(out.best!.params).toEqual({ in_1: 2 });
    expect(out.best!.report.win_rate).toBe(0.9);
    spy.mockRestore();
    metaSpy.mockRestore();
  });
});
