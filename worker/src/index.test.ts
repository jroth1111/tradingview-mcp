import { describe, expect, it, vi } from "vitest";
import app, { scheduled } from "./index";
import { getStoredSession, setStoredSession } from "./auth-store";
import * as tv from "./tradingview";
import * as pubscripts from "./pubscripts";
import * as alertsModule from "./alerts";
import * as templates from "./templates";
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

describe("New surfaces (P3-P6, P10)", () => {
  it("/v1/indicators/inputs forwards to typed-input helper", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi.spyOn(tv, "getTypedIndicatorInputs").mockResolvedValueOnce({
      id: "STD;RSI",
      version: "60",
      inputs: [{ id: "in_0", name: "Length", type: "integer", defval: 14 }],
    });
    const body = JSON.stringify({ id: "STD;RSI" });
    const headers = await signRequest("POST", "/v1/indicators/inputs", body);
    const res = await app.request("/v1/indicators/inputs", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.result.inputs[0].type).toBe("integer");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "STD;RSI", sessionId: "stored-session" }),
    );
    spy.mockRestore();
  });

  it("/v1/indicators/builtin caches via CACHE_META and forwards filters", async () => {
    const env = makeEnv();
    const spy = vi.spyOn(pubscripts, "getBuiltinCatalog").mockResolvedValueOnce({
      count: 2,
      cached: false,
      results: [
        { id: "STD;RSI", version: "60", name: "RSI", kind: "study", filter: "standard" },
        { id: "STD;MACD", version: "60", name: "MACD", kind: "study", filter: "standard" },
      ],
    });
    const body = JSON.stringify({ kind: "study", q: "rsi" });
    const headers = await signRequest("POST", "/v1/indicators/builtin", body);
    const res = await app.request("/v1/indicators/builtin", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.result.count).toBe(2);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "study", q: "rsi", cache: env.CACHE_META }),
    );
    spy.mockRestore();
  });

  it("/v1/pubscripts/library passes through query params", async () => {
    const env = makeEnv();
    const spy = vi
      .spyOn(pubscripts, "getPubLibrary")
      .mockResolvedValueOnce({ results: [{ scriptIdPart: "PUB;abc" }] });
    const body = JSON.stringify({ offset: 0, count: 5, sort: "top" });
    const headers = await signRequest("POST", "/v1/pubscripts/library", body);
    const res = await app.request("/v1/pubscripts/library", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ count: 5, sort: "top" }));
    spy.mockRestore();
  });

  it("/v1/pubscripts/personal-access requires a session", async () => {
    const env = makeEnv();
    const body = JSON.stringify({});
    const headers = await signRequest("POST", "/v1/pubscripts/personal-access", body);
    const res = await app.request("/v1/pubscripts/personal-access", { method: "POST", body, headers }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "sessionId required" });
  });

  it("/v1/alerts/list requires username", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const body = JSON.stringify({ userId: 12345 });
    const headers = await signRequest("POST", "/v1/alerts/list", body);
    const res = await app.request("/v1/alerts/list", { method: "POST", body, headers }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "username required" });
  });

  it("/v1/alerts/list dispatches to listAlerts with stored session", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi
      .spyOn(alertsModule, "listAlerts")
      .mockResolvedValueOnce({ s: "ok", r: [] });
    const body = JSON.stringify({ userId: 12345, username: "tester" });
    const headers = await signRequest("POST", "/v1/alerts/list", body);
    const res = await app.request("/v1/alerts/list", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stored-session", username: "tester" }),
      12345,
    );
    spy.mockRestore();
  });

  it("/v1/alerts/delete dispatches via the bulk-op handler", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi
      .spyOn(alertsModule, "deleteAlerts")
      .mockResolvedValueOnce({ s: "ok" });
    const body = JSON.stringify({ alerts: [1, 2, 3], username: "tester" });
    const headers = await signRequest("POST", "/v1/alerts/delete", body);
    const res = await app.request("/v1/alerts/delete", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stored-session" }),
      [1, 2, 3],
    );
    spy.mockRestore();
  });

  it("/v1/alerts/pine-alert combines gen_alert and create_alert", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const genSpy = vi
      .spyOn(alertsModule, "generatePineAlert")
      .mockResolvedValueOnce({ alert_info: { foo: "bar" } });
    const createSpy = vi
      .spyOn(alertsModule, "createAlert")
      .mockResolvedValueOnce({ s: "ok", id: 99 });
    const body = JSON.stringify({
      alertInfo: { source: "//@version=5\nplot(close)" },
      alert: { name: "x", symbol: "AAPL" },
      username: "tester",
    });
    const headers = await signRequest("POST", "/v1/alerts/pine-alert", body);
    const res = await app.request("/v1/alerts/pine-alert", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    expect(genSpy).toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ username: "tester" }),
      expect.objectContaining({
        name: "x",
        symbol: "AAPL",
        alert_info: { foo: "bar" },
        condition: { type: "pine_alert" },
      }),
    );
    genSpy.mockRestore();
    createSpy.mockRestore();
  });

  it("/v1/study-templates/list dispatches to template helper", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi
      .spyOn(templates, "listStudyTemplates")
      .mockResolvedValueOnce({ custom: [], standard: [], fundamentals: [] });
    const body = JSON.stringify({});
    const headers = await signRequest("POST", "/v1/study-templates/list", body);
    const res = await app.request("/v1/study-templates/list", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stored-session" }),
    );
    spy.mockRestore();
  });

  it("/v1/study-templates/create rejects non-string content", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const body = JSON.stringify({ name: "probe", content: { panes: [] } });
    const headers = await signRequest("POST", "/v1/study-templates/create", body);
    const res = await app.request("/v1/study-templates/create", { method: "POST", body, headers }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "content must be a JSON-encoded string" });
  });

  it("/v1/drawing-templates/save FormData-encodes via templates.saveDrawingTemplate", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const spy = vi
      .spyOn(templates, "saveDrawingTemplate")
      .mockResolvedValueOnce({ ok: true });
    const body = JSON.stringify({ tool: "LineToolTrendLine", name: "alpha", content: { color: "#fff" } });
    const headers = await signRequest("POST", "/v1/drawing-templates/save", body);
    const res = await app.request("/v1/drawing-templates/save", { method: "POST", body, headers }, env);
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stored-session" }),
      expect.objectContaining({
        tool: "LineToolTrendLine",
        name: "alpha",
        content: { color: "#fff" },
      }),
    );
    spy.mockRestore();
  });

  it("/v1/settings/save validates that delta is an object", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const body = JSON.stringify({ delta: "not-an-object" });
    const headers = await signRequest("POST", "/v1/settings/save", body);
    const res = await app.request("/v1/settings/save", { method: "POST", body, headers }, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "delta object required" });
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
