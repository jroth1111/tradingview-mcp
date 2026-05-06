import { describe, expect, it, vi } from "vitest";
import app from "./index";
import { setStoredSession } from "./auth-store";
import * as tv from "./tradingview";

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

  it("validates admin session status through the auth-token path", async () => {
    const env = makeEnv();
    await setStoredSession(env.CACHE_META, "stored-session", "stored-sign");
    const tokenSpy = vi.spyOn(tv, "getAuthToken").mockResolvedValueOnce("authorized-token");
    const profileSpy = vi.spyOn(tv, "getUserProfile");
    const headers = await signRequest("GET", "/admin/session/status", "");

    const res = await app.request("/admin/session/status", { method: "GET", headers }, env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      stored: {
        sessionId: "stored-session",
        sessionSign: "stored-sign",
        failures: 0,
        blockedUntil: 0,
        updatedAt: expect.any(Number),
      },
    });
    expect(tokenSpy).toHaveBeenCalledWith("stored-session", "stored-sign");
    expect(profileSpy).not.toHaveBeenCalled();
    tokenSpy.mockRestore();
    profileSpy.mockRestore();
  });
});
