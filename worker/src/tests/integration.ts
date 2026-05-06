import { runSelfTests } from "../selftest";
import { getCachedCandles } from "../cache";

// NOTE: This is still a limited integration harness because we don't have a live TradingView
// upstream or a mocked R2/KV. We simulate by calling the cache service twice to validate
// the hit/miss path without true upstream dependency.

export const runIntegration = async () => {
  const self = runSelfTests();
  const kvStore = new Map<string, string>();
  const fakeKV = {
    async get<T>(key: string, opts?: any) {
      const v = kvStore.get(key);
      if (!v) return null;
      return opts?.type === "json" ? (JSON.parse(v) as T) : (v as any);
    },
    async put(key: string, value: string) {
      kvStore.set(key, value);
    },
    async delete(key: string) {
      kvStore.delete(key);
    },
    async list(opts?: any) {
      const prefix = opts?.prefix || "";
      const keys = Array.from(kvStore.keys())
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ name: k }));
      return { keys };
    },
  } as unknown as KVNamespace;

  const r2Store = new Map<string, Uint8Array>();
  const fakeR2 = {
    async put(key: string, value: any, _opts?: any) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array((await value.arrayBuffer?.()) || []);
      r2Store.set(key, bytes);
      return { etag: `"${Math.random().toString(16).slice(2)}"` };
    },
    async get(key: string) {
      const val = r2Store.get(key);
      if (!val) return null;
      return {
        arrayBuffer: async () => val.buffer,
      } as any;
    },
    async delete(key: string) {
      r2Store.delete(key);
    },
    async list(opts?: any) {
      const prefix = opts?.prefix || "";
      const objects = Array.from(r2Store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k }));
      return { objects };
    },
  } as unknown as R2Bucket;

  // First call: expect partial because upstream gap fetch will fail (no TV)
  const first = await getCachedCandles(fakeKV, fakeR2, {
    symbol: "TEST:INTEG",
    timeframe: "1",
    total: 10,
    mock: true,
  }).catch(() => null);

  // Second call: should hit cache (still empty) but not throw
  const second = await getCachedCandles(fakeKV, fakeR2, {
    symbol: "TEST:INTEG",
    timeframe: "1",
    total: 10,
    mock: true,
  }).catch(() => null);

  const ok =
    self.every((r) => r.ok) &&
    first !== null &&
    second !== null;

  return {
    ok,
    self,
    cacheCalls: [
      { partial: first?.partial ?? true, candles: first?.candles?.length || 0 },
      { partial: second?.partial ?? true, candles: second?.candles?.length || 0 },
    ],
    note: "Integration harness is limited; no live upstream. Expand with real HTTP e2e in staging.",
  };
};
