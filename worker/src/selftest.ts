import { computeGaps, mergeCandles, splitChunks } from "./cache";

export const runSelfTests = () => {
  const results: { name: string; ok: boolean; detail?: string }[] = [];

  // Merge dedupe
  try {
    const a = [
      { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { timestamp: 2, open: 2, high: 2, low: 2, close: 2, volume: 2 },
    ];
    const b = [
      { timestamp: 2, open: 2.1, high: 2.1, low: 2.1, close: 2.1, volume: 2 },
      { timestamp: 3, open: 3, high: 3, low: 3, close: 3, volume: 3 },
    ];
    const merged = mergeCandles(a as any, b as any);
    results.push({ name: "merge_dedupe", ok: merged.length === 3 });
  } catch (err: any) {
    results.push({ name: "merge_dedupe", ok: false, detail: err?.message });
  }

  // Split/join
  try {
    const candles = Array.from({ length: 12 }).map((_, i) => ({
      timestamp: i,
      open: i,
      high: i,
      low: i,
      close: i,
      volume: i,
    }));
    const chunks = splitChunks(candles as any, 5);
    const rejoin = chunks.flat();
    results.push({ name: "split_join", ok: rejoin.length === candles.length });
  } catch (err: any) {
    results.push({ name: "split_join", ok: false, detail: err?.message });
  }

  // Coverage with internal gap
  try {
    const meta = {
      symbol: "TEST",
      timeframe: "1",
      chunks: [
        { start: 0, end: 10, key: "a" },
        { start: 20, end: 30, key: "b" },
      ],
    } as any;
    const gaps = computeGaps(meta, 0, 30);
    results.push({ name: "coverage_internal_gap", ok: gaps.gaps.length === 1 });
  } catch (err: any) {
    results.push({ name: "coverage_internal_gap", ok: false, detail: err?.message });
  }

  return results;
};
