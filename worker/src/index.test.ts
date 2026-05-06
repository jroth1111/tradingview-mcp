import { describe, expect, it, vi } from "vitest";
import app, { scheduled } from "./index";
import { getStoredSession, setStoredSession } from "./auth-store";
import * as tv from "./tradingview";
import * as cacheModule from "./cache";
import * as pruneModule from "./prune";

const encoder = new TextEncoder();

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const signRequest = async (
  method: string,
  path: string,
  body: string,
  clientId = "client",
  secret = "secret",
) => {
  const timestamp = Date.now().toString();
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  const canonical = [method, path, bodyHash, timestamp].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
  return {
    authorization: `HMAC ${clientId}:${signature}`,
    "x-timestamp": timestamp,
    "content-type": "application/json",
  };
};

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

const makeEnv = () =>
  ({
    HMAC_CLIENT_ID: "client",
    HMAC_SECRET: "secret",
    CACHE_META: makeKV(),
    CACHE_DATA: {} as R2Bucket,
    FETCH_COORDINATOR: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () => Response.json({ candles: [], meta: {}, partial: false }),
      }),
    },
  }) as unknown as CloudflareBindings;

describe("Worker auth boundary", () => {
  it("fails closed when HMAC env is missing", async () => {
    const res = await app.request("/v1/quotes", { method: "POST", body: "{}" }, { CACHE_META: makeKV() });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Auth not configured" });
  });

  it("rejects unauthenticated cache requests", async () => {
    const res = await app.request("/cache/AAPL/1D", { method: "GET" }, makeEnv());
    expect(res.status).toBe(401);
  });

  it("rejects forged HMAC signatures", async () => {
    const env = makeEnv();
    const headers = await signRequest("POST", "/v1/quotes", "{}");
    headers.authorization = "HMAC client:" + "0".repeat(64);
    const res = await app.request("/v1/quotes", { method: "POST", body: "{}", headers }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects malformed (non-hex) HMAC signatures without throwing", async () => {
    const env = makeEnv();
    const headers = await signRequest("POST", "/v1/quotes", "{}");
    headers.authorization = "HMAC client:not-a-hex-string";
    const res = await app.request("/v1/quotes", { method: "POST", body: "{}", headers }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects requests outside the 5-minute timestamp skew window", async () => {
    const env = makeEnv();
    const body = "{}";
    const stale = (Date.now() - 6 * 60 * 1000).toString();
    const bodyHash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
    const canonical = ["POST", "/v1/quotes", bodyHash, stale].join("\n");
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode("secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
    const headers = {
      authorization: `HMAC client:${signature}`,
      "x-timestamp": stale,
      "content-type": "application/json",
    };
    const res = await app.request("/v1/quotes", { method: "POST", body, headers }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Timestamp skew too large" });
  });

  it("does not fire auth failure on errors that merely contain the word 'expired'", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi
      .spyOn(tv, "getUserProfile")
      .mockRejectedValueOnce(new Error("Cache feature flag expired; rolled to defaults"));
    const body = JSON.stringify({});
    const headers = await signRequest("POST", "/v1/me", body);

    const res = await app.request("/v1/me", { method: "POST", body, headers }, env);

    expect(res.status).toBe(500);
    const json = (await res.json()) as { category?: string; retryable?: boolean };
    expect(json.category).toBe("unknown");
    expect(json.retryable).toBe(false);
    expect((await getStoredSession(env.CACHE_META))?.failures).toBe(0);
    spy.mockRestore();
  });

  it("treats anchored TradingView session phrases as auth failures", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi
      .spyOn(tv, "getUserProfile")
      .mockRejectedValueOnce(new Error("Wrong or expired sessionid/sessionid_sign"));
    const body = JSON.stringify({});
    const headers = await signRequest("POST", "/v1/me", body);

    const res = await app.request("/v1/me", { method: "POST", body, headers }, env);

    expect(res.status).toBe(401);
    const json = (await res.json()) as { category?: string };
    expect(json.category).toBe("auth");
    expect((await getStoredSession(env.CACHE_META))?.failures).toBe(1);
    spy.mockRestore();
  });

  it("rejects non-finite cache query numbers before cache logic runs", async () => {
    const headers = await signRequest("GET", "/cache/NASDAQ:AAPL/1D?total=not-a-number", "");

    const res = await app.request("/cache/NASDAQ:AAPL/1D?total=not-a-number", { method: "GET", headers }, makeEnv());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid total: not-a-number" });
  });

  it("uses stored session instead of body sessionId on /v1/candles", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi.spyOn(tv, "getCandles").mockResolvedValueOnce([]);
    const body = JSON.stringify({ symbols: ["NASDAQ:AAPL"], sessionId: "attacker" });
    const headers = await signRequest("POST", "/v1/candles", body);

    const res = await app.request("/v1/candles", { method: "POST", body, headers }, env);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "stored-session" }));
    spy.mockRestore();
  });

  it("preserves stored sessionSign on /v1/candles instead of downgrading the credential", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi.spyOn(tv, "getCandles").mockResolvedValueOnce([]);
    const body = JSON.stringify({ symbols: ["NASDAQ:AAPL"], sessionId: "attacker", sessionSign: "attacker-sign" });
    const headers = await signRequest("POST", "/v1/candles", body);

    const res = await app.request("/v1/candles", { method: "POST", body, headers }, env);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stored-session", sessionSign: "stored-sign" }),
    );
    spy.mockRestore();
  });

  it("validates admin session status through the auth-token path", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const tokenSpy = vi.spyOn(tv, "getAuthToken").mockResolvedValueOnce("authorized-token");
    const candleSpy = vi.spyOn(tv, "getCandles");
    const profileSpy = vi.spyOn(tv, "getUserProfile");
    const headers = await signRequest("GET", "/admin/session/status", "");

    const res = await app.request("/admin/session/status", { method: "GET", headers }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      recovered: false,
      stored: {
        sessionId: "stored-session",
        sessionSign: "stored-sign",
        failures: 0,
        blockedUntil: 0,
        updatedAt: expect.any(Number),
      },
    });
    expect(tokenSpy).toHaveBeenCalledWith("stored-session", "stored-sign");
    expect(candleSpy).not.toHaveBeenCalled();
    expect(profileSpy).not.toHaveBeenCalled();
    tokenSpy.mockRestore();
    candleSpy.mockRestore();
    profileSpy.mockRestore();
  });

  it("reports auth-token network failures as retryable without marking auth failure", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const tokenSpy = vi.spyOn(tv, "getAuthToken").mockRejectedValueOnce(new Error("fetch failed"));
    const body = JSON.stringify({});
    const headers = await signRequest("POST", "/v1/auth-token", body);

    const res = await app.request("/v1/auth-token", { method: "POST", body, headers }, env);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "fetch failed",
      category: "network",
      retryable: true,
    });
    expect(tokenSpy).toHaveBeenCalledWith("stored-session", "stored-sign");
    expect((await getStoredSession(env.CACHE_META))?.failures).toBe(0);
    tokenSpy.mockRestore();
  });

  it("sanitizes TradingView login error payloads", async () => {
    const rawError = `captcha\u0000\n${"x".repeat(300)}`;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: rawError }), { status: 400 }));

    let message = "";
    try {
      await tv.loginUser({ username: "user", password: "pass" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^captcha x{190,}$/);
    expect(message.length).toBeLessThanOrEqual(200);
    expect(message).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    fetchSpy.mockRestore();
  });

  it("returns retryable cache upstream errors without marking auth failure", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    env.FETCH_COORDINATOR = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () =>
          Response.json({
            candles: [],
            meta: {},
            partial: true,
            upstreamError: {
              category: "network",
              message: "Connection timeout to TradingView",
              retryable: true,
              status: 503,
            },
          }),
      }),
    } as unknown as CloudflareBindings["FETCH_COORDINATOR"];
    const headers = await signRequest("GET", "/cache/NASDAQ:AAPL/1D", "");

    const res = await app.request("/cache/NASDAQ:AAPL/1D", { method: "GET", headers }, env);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      candles: [],
      meta: {},
      partial: true,
      upstreamError: {
        category: "network",
        message: "Connection timeout to TradingView",
        retryable: true,
        status: 503,
      },
      authSource: "stored",
    });
    expect((await getStoredSession(env.CACHE_META))?.failures).toBe(0);
  });

  it("falls back to the market-data path for admin session status", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const tokenSpy = vi.spyOn(tv, "getAuthToken").mockResolvedValueOnce("unauthorized_user_token");
    const candleSpy = vi.spyOn(tv, "getCandles").mockResolvedValueOnce([
      { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    const profileSpy = vi.spyOn(tv, "getUserProfile");
    const headers = await signRequest("GET", "/admin/session/status", "");

    const res = await app.request("/admin/session/status", { method: "GET", headers }, env);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(tokenSpy).toHaveBeenCalledWith("stored-session", "stored-sign");
    expect(candleSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "stored-session" }));
    expect(profileSpy).not.toHaveBeenCalled();
    tokenSpy.mockRestore();
    candleSpy.mockRestore();
    profileSpy.mockRestore();
  });
});

describe("Scheduled cron", () => {
  const makeCronEnv = () =>
    ({
      CACHE_META: makeKV(),
      CACHE_DATA: {} as R2Bucket,
      CACHE_MAX_TOTAL_BYTES: "8000000000",
    }) as unknown as CloudflareBindings;

  const makeCtx = (pending: Promise<unknown>[]) =>
    ({
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => {},
    }) as unknown as ExecutionContext;

  it("invokes snapshotMeta and pruneCache with the configured budget", async () => {
    const env = makeCronEnv();
    const snapshotSpy = vi
      .spyOn(cacheModule, "snapshotMeta")
      .mockResolvedValueOnce("snapshots/2026-05-07.json");
    const pruneSpy = vi
      .spyOn(pruneModule, "pruneCache")
      .mockResolvedValueOnce({ pruned: 0, totalBytes: 1234 });
    const pending: Promise<unknown>[] = [];

    await scheduled({ scheduledTime: 0, cron: "0 3 * * *" } as ScheduledController, env, makeCtx(pending));
    await Promise.all(pending);

    expect(snapshotSpy).toHaveBeenCalledWith(env.CACHE_META, env.CACHE_DATA);
    expect(pruneSpy).toHaveBeenCalledWith(env.CACHE_META, env.CACHE_DATA, 8000000000);
    snapshotSpy.mockRestore();
    pruneSpy.mockRestore();
  });

  it("still runs pruneCache when snapshotMeta rejects", async () => {
    const env = makeCronEnv();
    const snapshotSpy = vi
      .spyOn(cacheModule, "snapshotMeta")
      .mockRejectedValueOnce(new Error("snapshot boom"));
    const pruneSpy = vi
      .spyOn(pruneModule, "pruneCache")
      .mockResolvedValueOnce({ pruned: 0, totalBytes: 0 });
    const pending: Promise<unknown>[] = [];

    await scheduled({ scheduledTime: 0, cron: "0 3 * * *" } as ScheduledController, env, makeCtx(pending));
    await Promise.all(pending);

    expect(snapshotSpy).toHaveBeenCalled();
    expect(pruneSpy).toHaveBeenCalledWith(env.CACHE_META, env.CACHE_DATA, 8000000000);
    snapshotSpy.mockRestore();
    pruneSpy.mockRestore();
  });
});
