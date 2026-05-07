import { describe, expect, it } from "vitest";
import {
  IDLE_STREAM_AUTO_CLOSE_MS,
  MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT,
  countActiveForClient,
  lookupStream,
  registerStream,
  releaseStream,
  touchStream,
} from "./quote-stream-registry";

const makeKV = () => {
  const store = new Map<string, string>();
  return {
    async get(key: string, opts?: { type?: string }) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts?.type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })) };
    },
  } as unknown as KVNamespace;
};

describe("quote-stream registry", () => {
  it("registers up to MAX_STREAMS_PER_HMAC_CLIENT then 429s the next", async () => {
    const kv = makeKV();
    for (let i = 0; i < MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT; i += 1) {
      const r = await registerStream({ kv, hmacClient: "c1", streamId: `s${i}` });
      expect(r.ok).toBe(true);
      expect(r.active).toBe(i + 1);
    }
    const sixth = await registerStream({ kv, hmacClient: "c1", streamId: "s5" });
    expect(sixth.ok).toBe(false);
    expect(sixth.reason).toBe("quota_exceeded");
    expect(sixth.active).toBe(MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT);
  });

  it("counts only the requesting client, not other clients", async () => {
    const kv = makeKV();
    for (let i = 0; i < 5; i += 1) {
      await registerStream({ kv, hmacClient: "c1", streamId: `c1-${i}` });
    }
    const otherClient = await registerStream({
      kv,
      hmacClient: "c2",
      streamId: "c2-0",
    });
    expect(otherClient.ok).toBe(true);
  });

  it("releaseStream frees a slot for the same client", async () => {
    const kv = makeKV();
    for (let i = 0; i < 5; i += 1) {
      await registerStream({ kv, hmacClient: "c1", streamId: `s${i}` });
    }
    await releaseStream(kv, "s2");
    const next = await registerStream({ kv, hmacClient: "c1", streamId: "s5" });
    expect(next.ok).toBe(true);
  });

  it("lazy GC prunes entries older than IDLE+grace before counting", async () => {
    const kv = makeKV();
    const t0 = 1_000_000_000;
    // Insert 5 stale entries, then attempt to register a 6th — GC should
    // prune all 5 first and let the 6th register.
    for (let i = 0; i < 5; i += 1) {
      await registerStream({
        kv,
        hmacClient: "c1",
        streamId: `stale-${i}`,
        now: t0,
      });
    }
    const tNow = t0 + IDLE_STREAM_AUTO_CLOSE_MS + 60_000;
    const fresh = await registerStream({
      kv,
      hmacClient: "c1",
      streamId: "fresh-0",
      now: tNow,
    });
    expect(fresh.ok).toBe(true);
    expect(fresh.active).toBe(1);
  });

  it("touchStream updates lastSeen so GC does not prune active streams", async () => {
    const kv = makeKV();
    const t0 = 1_000_000_000;
    await registerStream({ kv, hmacClient: "c1", streamId: "active", now: t0 });
    const tTouch = t0 + IDLE_STREAM_AUTO_CLOSE_MS - 10_000; // before idle threshold
    await touchStream(kv, "active", tTouch);
    const tNow = t0 + IDLE_STREAM_AUTO_CLOSE_MS + 60_000;
    // touch was recent enough that the GC at tNow keeps it.
    const stillThere = await lookupStream(kv, "active");
    expect(stillThere).toBeTruthy();
    // Try to register 4 more so 5 total, then 6th should fail.
    for (let i = 0; i < 4; i += 1) {
      const r = await registerStream({
        kv,
        hmacClient: "c1",
        streamId: `more-${i}`,
        now: tNow,
      });
      expect(r.ok).toBe(true);
    }
    const sixth = await registerStream({
      kv,
      hmacClient: "c1",
      streamId: "sixth",
      now: tNow,
    });
    expect(sixth.ok).toBe(false);
  });

  it("countActiveForClient ignores other clients' entries", () => {
    const reg = {
      a: { hmacClient: "c1", registeredAt: 1, lastSeen: 2 },
      b: { hmacClient: "c2", registeredAt: 1, lastSeen: 2 },
      c: { hmacClient: "c1", registeredAt: 1, lastSeen: 2 },
    };
    expect(countActiveForClient(reg, "c1")).toBe(2);
    expect(countActiveForClient(reg, "c2")).toBe(1);
    expect(countActiveForClient(reg, "c3")).toBe(0);
  });
});
