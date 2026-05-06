import { describe, expect, it } from "vitest";
import { listAllKVKeys, listAllR2Objects } from "./cache";
import { FetchCoordinator } from "./fetch-coordinator";

const makeKV = () => {
  const store = new Map<string, string>();
  return {
    async get(key: string, opts?: { type?: string }) {
      const value = store.get(key);
      if (value === undefined) return null;
      return opts?.type === "json" ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? "";
      return { keys: Array.from(store.keys()).filter((name) => name.startsWith(prefix)).map((name) => ({ name })) };
    },
  } as unknown as KVNamespace;
};

const makeR2 = () => {
  const store = new Map<string, ArrayBuffer>();
  return {
    async put(key: string, value: ArrayBuffer | Blob) {
      const buffer = value instanceof Blob ? await value.arrayBuffer() : value;
      store.set(key, buffer);
      return { etag: key };
    },
    async get(key: string) {
      const buffer = store.get(key);
      return buffer ? { arrayBuffer: async () => buffer } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? "";
      return { objects: Array.from(store.keys()).filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  } as unknown as R2Bucket;
};

class State {
  private queue = Promise.resolve();

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const run = this.queue.then(callback, callback);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

describe("FetchCoordinator", () => {
  it("serializes concurrent same-key cache misses into one populated result", async () => {
    const env = {
      CACHE_META: makeKV(),
      CACHE_DATA: makeR2(),
    } as CloudflareBindings;
    const coordinator = new FetchCoordinator(new State() as unknown as DurableObjectState, env);
    const body = JSON.stringify({ symbol: "TEST:ONE", timeframe: "1", total: 10, mock: true });

    const [first, second] = await Promise.all([
      coordinator.fetch(new Request("https://cache.local/fetch", { method: "POST", body })),
      coordinator.fetch(new Request("https://cache.local/fetch", { method: "POST", body })),
    ]);
    const a = (await first.json()) as { partial?: boolean; candles: unknown[] };
    const b = (await second.json()) as { partial?: boolean; candles: unknown[] };

    expect(a.partial).toBe(false);
    expect(b.partial).toBeUndefined();
    expect(a.candles.length).toBeGreaterThan(0);
    expect(b.candles.length).toBe(a.candles.length);
  });
});

describe("pagination helpers", () => {
  it("reads every KV list page", async () => {
    const kv = {
      async list(opts?: { cursor?: string }) {
        if (!opts?.cursor) {
          return {
            keys: [{ name: "meta:first" }],
            list_complete: false,
            cursor: "next",
          };
        }
        return {
          keys: [{ name: "meta:second" }],
          list_complete: true,
        };
      },
    } as unknown as KVNamespace;

    const keys = await listAllKVKeys(kv, { prefix: "meta:" });

    expect(keys.map((key) => key.name)).toEqual(["meta:first", "meta:second"]);
  });

  it("reads every R2 list page", async () => {
    const bucket = {
      async list(opts?: { cursor?: string }) {
        if (!opts?.cursor) {
          return {
            objects: [{ key: "candles/one" }],
            truncated: true,
            cursor: "next",
          };
        }
        return {
          objects: [{ key: "candles/two" }],
          truncated: false,
        };
      },
    } as unknown as R2Bucket;

    const objects = await listAllR2Objects(bucket, { prefix: "candles/" });

    expect(objects.map((object) => object.key)).toEqual(["candles/one", "candles/two"]);
  });
});
