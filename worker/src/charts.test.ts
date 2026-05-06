import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyLayout,
  deleteLayout,
  getLayout,
  getUserSources,
  invalidateChartToken,
  listCharts,
  mintChartToken,
  moveLayout,
  saveLayout,
} from "./charts";

const NOW = 1_778_097_600; // matches HAR sample iat
const TTL = 867_600; // ~10 day exp - iat
const LAYOUT = "bNkGnPfv";
const USER = 11023901;

const base64url = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const makeJwt = (claims: Record<string, any>) => {
  const header = base64url(JSON.stringify({ alg: "RS512", kid: "qF3i", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  return `${header}.${payload}.signature_placeholder`;
};

const sampleClaims = (overrides: Record<string, any> = {}) => ({
  iss: "tv_chart",
  iat: NOW,
  exp: NOW + TTL,
  type: "owner",
  layoutId: LAYOUT,
  ownerId: USER,
  shared: false,
  ...overrides,
});

const makeKV = () => {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  const kv = {
    async get(key: string, opts?: { type?: string }) {
      const value = store.get(key);
      if (value === undefined) return null;
      return opts?.type === "json" ? JSON.parse(value) : value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, value);
      if (opts?.expirationTtl != null) ttls.set(key, opts.expirationTtl);
    },
    async delete(key: string) {
      store.delete(key);
      ttls.delete(key);
    },
  } as unknown as KVNamespace;
  return Object.assign(kv as any, { __store: store, __ttls: ttls }) as KVNamespace & {
    __store: Map<string, string>;
    __ttls: Map<string, number>;
  };
};

const ctx = (kv: KVNamespace) => ({
  sessionId: "stored-session",
  sessionSign: "stored-sign",
  userId: USER,
  kv,
});

const jsonResponse = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("charts.ts — chart-token mint and KV cache", () => {
  it("mints a fresh JWT, decodes claims, caches under chart-token:userId:layoutId", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ token }));

    const rec = await mintChartToken(ctx(kv), LAYOUT);

    expect(rec.token).toBe(token);
    expect(rec.iat).toBe(NOW);
    expect(rec.exp).toBe(NOW + TTL);
    expect(rec.layoutId).toBe(LAYOUT);
    expect(rec.ownerId).toBe(USER);
    expect(rec.type).toBe("owner");
    expect(rec.shared).toBe(false);

    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.host).toBe("www.tradingview.com");
    expect(url.pathname).toBe("/chart-token/");
    expect(url.searchParams.get("image_url")).toBe(LAYOUT);
    expect(url.searchParams.get("user_id")).toBe(String(USER));

    const cached = JSON.parse((kv as any).__store.get(`chart-token:${USER}:${LAYOUT}`)!);
    expect(cached.token).toBe(token);
    expect((kv as any).__ttls.get(`chart-token:${USER}:${LAYOUT}`)).toBe(TTL - 60);
  });

  it("returns cached token on second call without hitting upstream", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ token }));

    await mintChartToken(ctx(kv), LAYOUT);
    const second = await mintChartToken(ctx(kv), LAYOUT);

    expect(second.token).toBe(token);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-mints when force=true even if cache present", async () => {
    const kv = makeKV();
    const first = makeJwt(sampleClaims({ exp: NOW + TTL }));
    const second = makeJwt(sampleClaims({ exp: NOW + TTL + 100 }));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token: first }))
      .mockResolvedValueOnce(jsonResponse({ token: second }));

    await mintChartToken(ctx(kv), LAYOUT);
    const refreshed = await mintChartToken(ctx(kv), LAYOUT, { force: true });

    expect(refreshed.token).toBe(second);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws on malformed jwt (not 3 segments)", async () => {
    const kv = makeKV();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ token: "not.jwt" }));
    await expect(mintChartToken(ctx(kv), LAYOUT)).rejects.toThrow(/malformed jwt/);
  });

  it("throws when upstream returns no token", async () => {
    const kv = makeKV();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(mintChartToken(ctx(kv), LAYOUT)).rejects.toThrow(/no token/);
  });

  it("rejects mintChartToken when layoutId is empty", async () => {
    const kv = makeKV();
    await expect(mintChartToken(ctx(kv), "")).rejects.toThrow(/layoutId required/);
  });
});

describe("charts.ts — listCharts (/my-charts/)", () => {
  it("returns the array of saved layouts with cookie auth", async () => {
    const rows = [
      { id: 1, image_url: LAYOUT, symbol: "NASDAQ:AAPL", name: "Apple" },
      { id: 2, image_url: "abc", symbol: "NASDAQ:TSLA", name: "Tesla" },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(rows));

    const out = await listCharts({ sessionId: "stored-session", sessionSign: "stored-sign" });

    expect(out).toEqual(rows);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("https://www.tradingview.com/my-charts/");
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=stored-session;sessionid_sign=stored-sign");
  });

  it("throws on non-2xx /my-charts/", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(
      listCharts({ sessionId: "stored-session", sessionSign: "stored-sign" }),
    ).rejects.toThrow(/GET \/my-charts\/ failed: 500/);
  });
});

describe("charts.ts — getLayout", () => {
  it("calls charts-storage/get/layout/{ID}/sources with chart_id=1 and embeds the JWT", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token })) // mint
      .mockResolvedValueOnce(jsonResponse({ success: true, payload: { sources: {} } }));

    const out = await getLayout(ctx(kv), { layoutId: LAYOUT, chartId: 1, symbol: "NASDAQ:AAPL" });

    expect(out).toEqual({ success: true, payload: { sources: {} } });
    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.host).toBe("charts-storage.tradingview.com");
    expect(url.pathname).toBe(`/charts-storage/get/layout/${LAYOUT}/sources`);
    expect(url.searchParams.get("layout_id")).toBe(LAYOUT);
    expect(url.searchParams.get("chart_id")).toBe("1");
    expect(url.searchParams.get("symbol")).toBe("NASDAQ:AAPL");
    expect(url.searchParams.get("jwt")).toBe(token);
  });

  it("supports chart_id=_shared with includeOwnerSource=1", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token }))
      .mockResolvedValueOnce(jsonResponse({ success: true, payload: {} }));

    await getLayout(ctx(kv), { layoutId: LAYOUT, chartId: "_shared", includeOwnerSource: true });

    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.searchParams.get("chart_id")).toBe("_shared");
    expect(url.searchParams.get("includeOwnerSource")).toBe("1");
  });
});

describe("charts.ts — getUserSources", () => {
  it("hits /charts-storage/get/user/sources with the JWT", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token }))
      .mockResolvedValueOnce(jsonResponse({ success: true, payload: { drawings: [] } }));

    const out = await getUserSources(ctx(kv), { layoutId: LAYOUT });

    expect(out).toEqual({ success: true, payload: { drawings: [] } });
    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.pathname).toBe("/charts-storage/get/user/sources");
    expect(url.searchParams.get("layout_id")).toBe(LAYOUT);
    expect(url.searchParams.get("jwt")).toBe(token);
  });
});

describe("charts.ts — saveLayout / deleteLayout", () => {
  it("POSTs FormData to charts-storage/save/layout/{ID}/sources", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const out = await saveLayout(ctx(kv), {
      layoutId: LAYOUT,
      chartId: 1,
      content: { sources: { foo: { type: "study" } } },
      name: "My Layout",
      symbol: "NASDAQ:AAPL",
      resolution: "1D",
    });

    expect(out).toEqual({ success: true });
    const init = fetchSpy.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(JSON.parse(form.get("content") as string)).toEqual({
      sources: { foo: { type: "study" } },
    });
    expect(form.get("name")).toBe("My Layout");
    expect(form.get("symbol")).toBe("NASDAQ:AAPL");
    expect(form.get("resolution")).toBe("1D");

    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.pathname).toBe(`/charts-storage/save/layout/${LAYOUT}/sources`);
    expect(url.searchParams.get("chart_id")).toBe("1");
  });

  it("POSTs to charts-storage/remove/layout/{ID}/sources with chart_id", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const out = await deleteLayout(ctx(kv), { layoutId: LAYOUT, chartId: 1 });

    expect(out).toEqual({ success: true });
    const init = fetchSpy.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe("POST");
    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.pathname).toBe(`/charts-storage/remove/layout/${LAYOUT}/sources`);
    expect(url.searchParams.get("chart_id")).toBe("1");
  });
});

describe("charts.ts — copyLayout / moveLayout", () => {
  it("issues copy with to_layout_id form field", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await copyLayout(ctx(kv), { fromLayout: LAYOUT, toLayout: "newId", chartId: 1 });

    const init = fetchSpy.mock.calls[1][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("to_layout_id")).toBe("newId");
    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.pathname).toBe(`/charts-storage/copy/layout/${LAYOUT}/sources`);
  });

  it("issues move with to_layout_id form field", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await moveLayout(ctx(kv), { fromLayout: LAYOUT, toLayout: "newId" });

    const url = new URL(fetchSpy.mock.calls[1][0] as string);
    expect(url.pathname).toBe(`/charts-storage/move/layout/${LAYOUT}/sources`);
  });
});

describe("charts.ts — 401/403 refresh path", () => {
  it("invalidates the cached token and re-mints once on 401, then succeeds", async () => {
    const kv = makeKV();
    const stale = makeJwt(sampleClaims({ exp: NOW + TTL }));
    const fresh = makeJwt(sampleClaims({ exp: NOW + TTL + 100 }));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token: stale })) // initial mint
      .mockResolvedValueOnce(new Response("expired", { status: 401 })) // first attempt
      .mockResolvedValueOnce(jsonResponse({ token: fresh })) // re-mint
      .mockResolvedValueOnce(jsonResponse({ success: true, payload: {} })); // retry

    const out = await getLayout(ctx(kv), { layoutId: LAYOUT, chartId: 1 });

    expect(out).toEqual({ success: true, payload: {} });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const lastUrl = new URL(fetchSpy.mock.calls[3][0] as string);
    expect(lastUrl.searchParams.get("jwt")).toBe(fresh);
    const cached = JSON.parse((kv as any).__store.get(`chart-token:${USER}:${LAYOUT}`)!);
    expect(cached.token).toBe(fresh);
  });

  it("re-throws when the second attempt also returns 401 (no infinite loop)", async () => {
    const kv = makeKV();
    const stale = makeJwt(sampleClaims());
    const fresh = makeJwt(sampleClaims({ exp: NOW + TTL + 100 }));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ token: stale }))
      .mockResolvedValueOnce(new Response("nope", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ token: fresh }))
      .mockResolvedValueOnce(new Response("still nope", { status: 401 }));

    await expect(getLayout(ctx(kv), { layoutId: LAYOUT })).rejects.toThrow(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

describe("charts.ts — invalidateChartToken", () => {
  it("removes the cached entry under the documented key", async () => {
    const kv = makeKV();
    const token = makeJwt(sampleClaims());
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ token }));

    await mintChartToken(ctx(kv), LAYOUT);
    expect((kv as any).__store.has(`chart-token:${USER}:${LAYOUT}`)).toBe(true);

    await invalidateChartToken(kv, USER, LAYOUT);
    expect((kv as any).__store.has(`chart-token:${USER}:${LAYOUT}`)).toBe(false);
  });
});
