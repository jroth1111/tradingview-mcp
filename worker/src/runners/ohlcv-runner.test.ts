import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildCellIndexKey,
  cellR2Key,
  manifestR2Key,
  runOhlcvExtract,
  type OhlcvExtractInput,
  type OhlcvManifest,
} from "./ohlcv-runner";
import type { Candle } from "../tradingview";

// In-memory R2 stub. R2 puts gzip ArrayBuffers; we keep them as ArrayBuffer
// copies so we can decompress / inspect contents without TypeScript's
// SharedArrayBuffer-vs-ArrayBuffer Blob constructor friction.
const buildR2 = () => {
  const store = new Map<string, { body: ArrayBuffer; meta?: any }>();
  let puts = 0;
  let gets = 0;
  const r2 = {
    put: vi.fn(
      async (
        key: string,
        value: ArrayBuffer | string,
        options?: any,
      ) => {
        puts += 1;
        const buf =
          typeof value === "string"
            ? new TextEncoder().encode(value).slice().buffer
            : value;
        store.set(key, { body: buf as ArrayBuffer, meta: options?.httpMetadata });
        return { etag: `etag-${puts}` };
      },
    ),
    get: vi.fn(async (key: string) => {
      gets += 1;
      const entry = store.get(key);
      if (!entry) return null;
      const stream = new Blob([entry.body]).stream();
      return { body: stream };
    }),
  };
  return {
    r2,
    store,
    get puts() { return puts; },
    get gets() { return gets; },
  };
};

const buildKv = () => {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  };
  return { kv, store };
};

const fakeCandles = (
  symbol: string,
  tf: string,
  count: number,
  startTs = 1_700_000_000,
  stepSec = 86_400,
): Candle[] => {
  const out: Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = startTs + i * stepSec;
    const base = symbol.charCodeAt(0) + Number(tf.replace(/[^0-9]/g, "")) || 1;
    out.push({
      timestamp: t,
      open: base + i,
      high: base + i + 1,
      low: base + i - 1,
      close: base + i + 0.5,
      volume: 1000 + i,
    });
  }
  return out;
};

const decompressJsonLines = async (
  buf: ArrayBuffer,
): Promise<Record<string, number>[]> => {
  const stream = new Blob([buf])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, number>);
};

const baseInput = (
  overrides: Partial<OhlcvExtractInput> = {},
): OhlcvExtractInput => ({
  jobId: "job-1",
  selector: { mode: "symbols", symbols: ["NASDAQ:AAPL"] },
  timeframes: ["1D"],
  fetchCandles: vi.fn(async ({ symbol, timeframe, total }) =>
    fakeCandles(symbol, timeframe?.toString() ?? "1", total ?? 5),
  ),
  ...overrides,
});

describe("ohlcv-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates required inputs", async () => {
    const { r2 } = buildR2();
    await expect(
      runOhlcvExtract({ ...baseInput({ r2 }), jobId: undefined }),
    ).rejects.toThrow(/jobId required/);
    await expect(
      runOhlcvExtract({ ...baseInput(), r2: undefined }),
    ).rejects.toThrow(/r2 binding required/);
    await expect(
      runOhlcvExtract({ ...baseInput({ r2 }), timeframes: [] as any }),
    ).rejects.toThrow(/timeframes must be a non-empty array/);
    await expect(
      runOhlcvExtract({
        ...baseInput({ r2 }),
        timeframes: ["999" as any],
      }),
    ).rejects.toThrow(/unsupported timeframe/);
  });

  it("buildCellIndexKey is stable under repeated calls and differs per shape", async () => {
    const w = { fromTs: 1, toTs: 2 };
    const a = await buildCellIndexKey("X", "1D", w, undefined);
    const b = await buildCellIndexKey("X", "1D", w, undefined);
    expect(a).toBe(b);
    const c = await buildCellIndexKey("X", "1D", { fromTs: 1, toTs: 3 }, undefined);
    expect(a).not.toBe(c);
    const d = await buildCellIndexKey("X", "60", w, undefined);
    expect(a).not.toBe(d);
    const e = await buildCellIndexKey("Y", "1D", w, undefined);
    expect(a).not.toBe(e);
    const f = await buildCellIndexKey("X", "1D", w, { dataQuality: "regular" });
    expect(a).not.toBe(f);
  });

  it("Probe 1 — extract 5y daily for 3 symbols, manifest valid, R2 cells decode", async () => {
    const { r2, store: r2Store } = buildR2();
    const { kv } = buildKv();
    const fetchCandles = vi.fn(async ({ symbol, timeframe }) =>
      fakeCandles(symbol, timeframe?.toString() ?? "1D", 1300),
    );
    const manifest = await runOhlcvExtract({
      jobId: "probe1",
      selector: {
        mode: "symbols",
        symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT", "NYSE:JNJ"],
      },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
    });
    expect(manifest.cells.length).toBe(3);
    expect(manifest.totalBars).toBe(3 * 1300);
    for (const cell of manifest.cells) {
      expect(cell.bars).toBe(1300);
      expect(cell.r2Key).toMatch(/^backtest\/jobs\/probe1\/ohlcv\/.+\/1D\.jsonl\.gz$/);
      const stored = r2Store.get(cell.r2Key);
      expect(stored).toBeDefined();
      const lines = await decompressJsonLines(stored!.body);
      expect(lines.length).toBe(1300);
      // Schema: each line has t/o/h/l/c/v.
      for (const k of ["t", "o", "h", "l", "c", "v"] as const) {
        expect(typeof lines[0][k]).toBe("number");
      }
    }
    // Manifest at the canonical key.
    const manifestStored = r2Store.get(manifestR2Key("probe1"));
    expect(manifestStored).toBeDefined();
    const manifestParsed = JSON.parse(
      new TextDecoder().decode(manifestStored!.body),
    ) as OhlcvManifest;
    expect(manifestParsed.jobId).toBe("probe1");
    expect(manifestParsed.cells.length).toBe(3);
    expect(manifestParsed.errors.length).toBe(0);
    expect(manifestParsed.missingCells.length).toBe(0);
  });

  it("Probe 2 — scanner mode paginates and aggregates symbols", async () => {
    const { r2 } = buildR2();
    const { kv } = buildKv();
    // Synthesize 1500 symbols across two pages of 1000 each (the second page
    // returns fewer than requested and stops the loop).
    const allSymbols = Array.from(
      { length: 1500 },
      (_, i) => `EX:S${i.toString().padStart(4, "0")}`,
    );
    const scan = vi.fn(async (req) => {
      const [start, end] = req.range ?? [0, 1000];
      const slice = allSymbols.slice(start, end);
      return {
        totalCount: allSymbols.length,
        data: slice.map((s) => ({ s, d: [] })),
      };
    });
    const fetchCandles = vi.fn(async ({ symbol, timeframe }) =>
      fakeCandles(symbol, timeframe?.toString() ?? "1D", 5),
    );
    const manifest = await runOhlcvExtract({
      jobId: "probe2",
      selector: {
        mode: "scanner",
        scannerFilter: { market: "america", columns: ["name"] },
      },
      timeframes: ["1D"],
      r2,
      kv,
      scan,
      fetchCandles,
      options: { parallelism: 5 },
    });
    expect(manifest.symbolCount).toBe(1500);
    expect(manifest.cells.length).toBe(1500);
    // Two scan calls expected: [0,1000) full + [1000,2000) returns 500 → loop ends.
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("Probe 3 — KV index hit short-circuits TV calls on second job", async () => {
    const { r2 } = buildR2();
    const { kv } = buildKv();
    const fetchCandles = vi.fn(async ({ symbol, timeframe }) =>
      fakeCandles(symbol, timeframe?.toString() ?? "1D", 100),
    );
    // First job populates KV index entries.
    await runOhlcvExtract({
      jobId: "first",
      selector: { mode: "symbols", symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
    });
    expect(fetchCandles).toHaveBeenCalledTimes(2);
    // Second job, same cell shape, different jobId — KV hits should short-circuit.
    fetchCandles.mockClear();
    const manifest2 = await runOhlcvExtract({
      jobId: "second",
      selector: { mode: "symbols", symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
    });
    expect(fetchCandles).not.toHaveBeenCalled();
    expect(manifest2.cacheHits).toBe(2);
    expect(manifest2.cells.every((c) => c.cached)).toBe(true);
    // R2 keys in the new manifest reference the FIRST job's path.
    for (const cell of manifest2.cells) {
      expect(cell.r2Key).toMatch(/backtest\/jobs\/first\/ohlcv\//);
    }
  });

  it("Probe 4 — KV index entry shape on success", async () => {
    const { r2 } = buildR2();
    const { kv, store: kvStore } = buildKv();
    const fetchCandles = vi.fn(async ({ symbol, timeframe }) =>
      fakeCandles(symbol, timeframe?.toString() ?? "1D", 50, 1_700_000_000, 86_400),
    );
    await runOhlcvExtract({
      jobId: "idx",
      selector: { mode: "symbols", symbols: ["X"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
      history: { default: { fromTs: 1_700_000_000, toTs: 1_700_000_000 + 86_400 * 30 } },
    });
    const idxKey = await buildCellIndexKey(
      "X",
      "1D",
      { fromTs: 1_700_000_000, toTs: 1_700_000_000 + 86_400 * 30 },
      undefined,
    );
    const raw = kvStore.get(idxKey);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.r2Key).toBe(cellR2Key("idx", "X", "1D"));
    expect(typeof parsed.bars).toBe("number");
    expect(typeof parsed.bytes).toBe("number");
    expect(parsed.jobId).toBe("idx");
    expect(typeof parsed.fromTs).toBe("number");
    expect(typeof parsed.toTs).toBe("number");
  });

  it("filters fetched candles by history window (fromTs/toTs)", async () => {
    const { r2, store: r2Store } = buildR2();
    const { kv } = buildKv();
    // Provide 100 bars; window keeps bars 30..70.
    const fetchCandles = vi.fn(async () =>
      fakeCandles("X", "1D", 100, 1_000_000_000, 86_400),
    );
    const fromTs = 1_000_000_000 + 30 * 86_400;
    const toTs = 1_000_000_000 + 70 * 86_400;
    const manifest = await runOhlcvExtract({
      jobId: "win",
      selector: { mode: "symbols", symbols: ["X"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
      history: { default: { fromTs, toTs } },
    });
    expect(manifest.cells[0].bars).toBe(40); // 70 - 30
    const stored = r2Store.get(manifest.cells[0].r2Key)!;
    const lines = await decompressJsonLines(stored.body);
    expect(lines.length).toBe(40);
    expect(lines[0].t).toBe(fromTs);
    expect(lines[lines.length - 1].t).toBe(toTs - 86_400);
  });

  it("collects per-cell errors without aborting the whole job", async () => {
    const { r2 } = buildR2();
    const { kv } = buildKv();
    const fetchCandles = vi.fn(async ({ symbol }) => {
      if (symbol === "BAD") throw new Error("session expired");
      return fakeCandles(symbol, "1D", 5);
    });
    const manifest = await runOhlcvExtract({
      jobId: "errs",
      selector: { mode: "symbols", symbols: ["GOOD", "BAD"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
    });
    expect(manifest.cells.length).toBe(1);
    expect(manifest.cells[0].symbol).toBe("GOOD");
    expect(manifest.errors.length).toBe(1);
    expect(manifest.errors[0]).toMatchObject({ symbol: "BAD", timeframe: "1D" });
    expect(manifest.errors[0].reason).toMatch(/session expired/);
  });

  it("flags cells with zero in-window bars as missing (not error)", async () => {
    const { r2 } = buildR2();
    const { kv } = buildKv();
    // Candles all sit above the window's toTs.
    const fetchCandles = vi.fn(async () =>
      fakeCandles("X", "1D", 5, 2_000_000_000, 86_400),
    );
    const manifest = await runOhlcvExtract({
      jobId: "miss",
      selector: { mode: "symbols", symbols: ["X"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
      history: { default: { fromTs: 1_000_000_000, toTs: 1_500_000_000 } },
    });
    expect(manifest.cells.length).toBe(0);
    expect(manifest.missingCells.length).toBe(1);
    expect(manifest.missingCells[0]).toMatchObject({ symbol: "X", timeframe: "1D" });
    expect(manifest.errors.length).toBe(0);
  });

  it("emits onCellComplete for both fresh and cached cells", async () => {
    const { r2 } = buildR2();
    const { kv } = buildKv();
    const fetchCandles = vi.fn(async () => fakeCandles("X", "1D", 5));
    const events: string[] = [];
    await runOhlcvExtract({
      jobId: "evt1",
      selector: { mode: "symbols", symbols: ["X", "Y"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
      onCellComplete: (cell) =>
        events.push(`${cell.symbol}:${cell.timeframe}:${cell.cached}`),
    });
    expect(events).toContain("X:1D:false");
    expect(events).toContain("Y:1D:false");
    // Second job uses the same KV → cached cells.
    events.length = 0;
    await runOhlcvExtract({
      jobId: "evt2",
      selector: { mode: "symbols", symbols: ["X"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
      onCellComplete: (cell) =>
        events.push(`${cell.symbol}:${cell.timeframe}:${cell.cached}`),
    });
    expect(events).toContain("X:1D:true");
  });

  it("tolerates malformed KV index entries by re-fetching", async () => {
    const { r2 } = buildR2();
    const { kv, store } = buildKv();
    const fetchCandles = vi.fn(async () => fakeCandles("X", "1D", 5));
    // Pre-poison the index entry.
    const idxKey = await buildCellIndexKey("X", "1D", {}, undefined);
    store.set(idxKey, "{not json");
    const manifest = await runOhlcvExtract({
      jobId: "poison",
      selector: { mode: "symbols", symbols: ["X"] },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
    });
    expect(fetchCandles).toHaveBeenCalledTimes(1);
    expect(manifest.cells[0].cached).toBe(false);
    // KV entry overwritten with a valid one.
    const after = store.get(idxKey);
    expect(after).toBeDefined();
    const parsed = JSON.parse(after!) as Record<string, unknown>;
    expect(typeof parsed.r2Key).toBe("string");
  });

  it("respects the parallelism cap (≤5 concurrent fetches)", async () => {
    const { r2 } = buildR2();
    const { kv } = buildKv();
    let inFlight = 0;
    let peak = 0;
    const fetchCandles = vi.fn(async ({ symbol }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return fakeCandles(symbol, "1D", 5);
    });
    const symbols = Array.from({ length: 20 }, (_, i) => `S${i}`);
    await runOhlcvExtract({
      jobId: "par",
      selector: { mode: "symbols", symbols },
      timeframes: ["1D"],
      r2,
      kv,
      fetchCandles,
      options: { parallelism: 99 }, // requested high; runner caps at 5
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });
});
