import { describe, expect, it, vi, beforeEach } from "vitest";

// Stub runStrategy so we can count TV calls without booting a WS session.
// vi.hoisted runs before the mock factory which is itself hoisted to the top
// of the module — required because vi.mock cannot reference module-scoped
// bindings declared after it.
const { runStrategyMock } = vi.hoisted(() => ({ runStrategyMock: vi.fn() }));
vi.mock("./strategy", async (importOriginal) => {
  const original = await importOriginal<typeof import("./strategy")>();
  return {
    ...original,
    runStrategy: runStrategyMock,
  };
});

import {
  buildCellCacheKey,
  runStrategyCached,
  type RunStrategyCache,
} from "./strategy-cache";
import type { StrategyRunRequest, StrategyResult } from "./strategy";

const fakeResult = (tag: number): StrategyResult => ({
  studyResult: { headers: [], rows: [], plots: {} } as any,
  report: { net_profit: tag },
  trades: [
    {
      number: 1,
      side: "long",
      entry_time: tag,
      entry_price: 100,
      size: 1,
      exit_time: tag + 1,
      exit_price: 100,
      profit: tag,
    },
  ],
  equity: [{ ts: tag, equity: 1000 + tag }],
  wireDiagnostics: {} as any,
});

const buildKv = (): { kv: RunStrategyCache; store: Map<string, string>; gets: number; puts: number } => {
  const store = new Map<string, string>();
  let gets = 0;
  let puts = 0;
  const kv: RunStrategyCache = {
    get: async (k) => {
      gets += 1;
      return store.get(k) ?? null;
    },
    put: async (k, v) => {
      puts += 1;
      store.set(k, v);
    },
  };
  return {
    kv,
    store,
    get gets() { return gets; },
    get puts() { return puts; },
  };
};

describe("strategy-cache", () => {
  beforeEach(() => {
    runStrategyMock.mockReset();
  });

  it("buildCellCacheKey is stable across key reorderings", async () => {
    const a: StrategyRunRequest = {
      symbol: "BINANCE:BTCUSDT",
      studyId: "STD;Supertrend Strategy",
      timeframe: "60",
      params: { factor: 3, atr_length: 14 },
      bars: 5000,
    };
    const b: StrategyRunRequest = {
      bars: 5000,
      timeframe: "60",
      studyId: "STD;Supertrend Strategy",
      params: { atr_length: 14, factor: 3 },
      symbol: "BINANCE:BTCUSDT",
    };
    expect(await buildCellCacheKey(a)).toBe(await buildCellCacheKey(b));
  });

  it("buildCellCacheKey differs when behavior-defining input differs", async () => {
    const base: StrategyRunRequest = {
      symbol: "BINANCE:BTCUSDT",
      studyId: "STD;Supertrend Strategy",
      timeframe: "60",
      params: { factor: 3 },
    };
    const same = await buildCellCacheKey(base);
    expect(await buildCellCacheKey({ ...base, params: { factor: 4 } })).not.toBe(same);
    expect(await buildCellCacheKey({ ...base, timeframe: "240" })).not.toBe(same);
    expect(await buildCellCacheKey({ ...base, symbol: "NASDAQ:AAPL" })).not.toBe(same);
  });

  it("buildCellCacheKey ignores session credentials (auth-only fields)", async () => {
    const base: StrategyRunRequest = {
      symbol: "X",
      studyId: "Y",
      timeframe: "60",
      params: {},
    };
    const a = await buildCellCacheKey(base);
    const b = await buildCellCacheKey({
      ...base,
      sessionId: "sid-1",
      sessionSign: "sign-1",
    });
    expect(a).toBe(b);
  });

  it("falls through to runStrategy when no cache supplied", async () => {
    runStrategyMock.mockResolvedValueOnce(fakeResult(1));
    const out = await runStrategyCached({
      symbol: "X",
      studyId: "Y",
      timeframe: "60",
      params: {},
    });
    expect(runStrategyMock).toHaveBeenCalledTimes(1);
    expect(out.report).toEqual({ net_profit: 1 });
  });

  it("caches the slim seed and short-circuits the second run", async () => {
    const k = buildKv();
    runStrategyMock.mockResolvedValueOnce(fakeResult(7));
    const req: StrategyRunRequest = {
      symbol: "X",
      studyId: "Y",
      timeframe: "60",
      params: { p: 1 },
    };
    const first = await runStrategyCached(req, k.kv);
    const second = await runStrategyCached(req, k.kv);
    // runStrategy is called only once — second hit short-circuits via KV.
    expect(runStrategyMock).toHaveBeenCalledTimes(1);
    expect(first.report).toEqual({ net_profit: 7 });
    expect(second.report).toEqual({ net_profit: 7 });
    expect(second.equity[0]?.equity).toBe(first.equity[0]?.equity);
    expect(k.gets).toBe(2);
    expect(k.puts).toBe(1);
  });

  it("only caches the slim seed (no studyResult / wireDiagnostics)", async () => {
    const k = buildKv();
    runStrategyMock.mockResolvedValueOnce(fakeResult(2));
    await runStrategyCached(
      { symbol: "X", studyId: "Y", timeframe: "60", params: {} },
      k.kv,
    );
    expect(k.store.size).toBe(1);
    const stored = JSON.parse([...k.store.values()][0]) as Record<string, unknown>;
    expect("report" in stored).toBe(true);
    expect("trades" in stored).toBe(true);
    expect("equity" in stored).toBe(true);
    expect("studyResult" in stored).toBe(false);
    expect("wireDiagnostics" in stored).toBe(false);
  });

  it("re-runs when params differ even for the same symbol/timeframe", async () => {
    const k = buildKv();
    runStrategyMock
      .mockResolvedValueOnce(fakeResult(1))
      .mockResolvedValueOnce(fakeResult(2));
    await runStrategyCached(
      { symbol: "X", studyId: "Y", timeframe: "60", params: { p: 1 } },
      k.kv,
    );
    await runStrategyCached(
      { symbol: "X", studyId: "Y", timeframe: "60", params: { p: 2 } },
      k.kv,
    );
    expect(runStrategyMock).toHaveBeenCalledTimes(2);
    expect(k.store.size).toBe(2);
  });

  it("tolerates malformed cache entries by re-running", async () => {
    const k = buildKv();
    const req: StrategyRunRequest = {
      symbol: "X",
      studyId: "Y",
      timeframe: "60",
      params: {},
    };
    const key = await buildCellCacheKey(req);
    k.store.set(key, "{not json");
    runStrategyMock.mockResolvedValueOnce(fakeResult(9));
    const out = await runStrategyCached(req, k.kv);
    expect(out.report).toEqual({ net_profit: 9 });
    expect(runStrategyMock).toHaveBeenCalledTimes(1);
  });
});
