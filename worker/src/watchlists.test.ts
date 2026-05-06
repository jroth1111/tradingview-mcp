import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listWatchlists,
  getWatchlist,
  createWatchlist,
  deleteWatchlist,
  appendSymbols,
  removeSymbols,
  replaceSymbols,
  renameWatchlist,
  updateMeta,
  replaceSymbol,
  getActiveWatchlist,
  setActiveWatchlist,
  type WatchlistContext,
} from "./watchlists";

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

const ctx: WatchlistContext = { sessionId: "sid", sessionSign: "sign" };
const ctxWithCsrf: WatchlistContext = { sessionId: "sid", sessionSign: "sign", csrfToken: "csrf-tok" };

const sampleList = {
  id: 42,
  type: "custom",
  name: "Probe",
  symbols: ["NASDAQ:AAPL"],
  active: false,
  shared: false,
  color: null,
  description: null,
  created: "2026-01-01T00:00:00Z",
  modified: "2026-01-02T00:00:00Z",
};

describe("watchlists helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---- 1. listWatchlists ----

  it("listWatchlists hits /symbols_list/{type}/?source=web with cookie+referer and parses array", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse([sampleList]));

    const out = await listWatchlists(ctx, "custom");

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 42,
      type: "custom",
      name: "Probe",
      symbols: ["NASDAQ:AAPL"],
      active: false,
      shared: false,
      color: null,
      description: null,
      created: "2026-01-01T00:00:00Z",
      modified: "2026-01-02T00:00:00Z",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/?source=web",
    );
    expect(init?.method ?? "GET").toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    expect(headers.referer).toBe("https://www.tradingview.com/");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("listWatchlists defaults to type=all and rejects invalid types", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse([]));
    await listWatchlists(ctx);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/symbols_list/all/?source=web");

    await expect(
      listWatchlists(ctx, "bogus" as any),
    ).rejects.toThrow(/invalid watchlist type/);
  });

  it("listWatchlists surfaces 401 unauthorized as an error and does not return data", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ detail: "Authentication credentials were not provided." }, {
        status: 401,
        statusText: "Unauthorized",
      }),
    );
    await expect(listWatchlists(ctx, "custom")).rejects.toThrow(/unauthorized/);
  });

  // ---- 2. getWatchlist ----

  it("getWatchlist hits /symbols_list/custom/{id}/ and parses single object", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(sampleList));
    const out = await getWatchlist(ctx, 42);
    expect(out.id).toBe(42);
    expect(out.symbols).toEqual(["NASDAQ:AAPL"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/",
    );
    expect(init?.method ?? "GET").toBe("GET");
  });

  // ---- 3. createWatchlist ----

  it("createWatchlist POSTs JSON {name, symbols} to /symbols_list/custom/", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ...sampleList, id: 7, name: "New" }));
    const out = await createWatchlist(ctx, {
      name: "New",
      symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"],
    });
    expect(out.id).toBe(7);
    expect(out.name).toBe("New");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/",
    );
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    expect(headers.referer).toBe("https://www.tradingview.com/");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ name: "New", symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"] });
  });

  it("createWatchlist forwards X-CSRFToken when csrftoken cookie is present", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(sampleList));
    await createWatchlist(ctxWithCsrf, { name: "x", symbols: [] });
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-csrftoken"]).toBe("csrf-tok");
    expect(headers.cookie).toBe(
      "sessionid=sid;sessionid_sign=sign;csrftoken=csrf-tok",
    );
  });

  it("createWatchlist requires a name", async () => {
    await expect(
      createWatchlist(ctx, { name: "" } as any),
    ).rejects.toThrow(/name required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---- 4. deleteWatchlist ----

  it("deleteWatchlist DELETEs /symbols_list/custom/{id}/", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204, statusText: "No Content" }));
    const out = await deleteWatchlist(ctx, 42);
    expect(out).toEqual({});
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/",
    );
    expect(init?.method).toBe("DELETE");
  });

  // ---- 5. appendSymbols ----

  it("appendSymbols POSTs symbol array (not object) to /append/", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ ...sampleList, symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"] }),
    );
    const out = await appendSymbols(ctx, 42, ["NASDAQ:MSFT"]);
    expect(out.symbols).toEqual(["NASDAQ:AAPL", "NASDAQ:MSFT"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/append/",
    );
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(["NASDAQ:MSFT"]);
  });

  // ---- 6. removeSymbols ----

  it("removeSymbols POSTs symbol array to /remove/", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ...sampleList, symbols: [] }));
    const out = await removeSymbols(ctx, 42, ["NASDAQ:AAPL"]);
    expect(out.symbols).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/remove/",
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual(["NASDAQ:AAPL"]);
  });

  // ---- 7. replaceSymbols ----

  it("replaceSymbols POSTs whole new set to /replace/?unsafe=true", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ ...sampleList, symbols: ["NASDAQ:NVDA", "NASDAQ:TSLA"] }),
    );
    const out = await replaceSymbols(ctx, 42, ["NASDAQ:NVDA", "NASDAQ:TSLA"]);
    expect(out.symbols).toEqual(["NASDAQ:NVDA", "NASDAQ:TSLA"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/replace/?unsafe=true",
    );
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual(["NASDAQ:NVDA", "NASDAQ:TSLA"]);
  });

  // ---- 8. renameWatchlist ----

  it("renameWatchlist POSTs {name} JSON object to /rename/", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ...sampleList, name: "Renamed" }));
    const out = await renameWatchlist(ctx, 42, "Renamed");
    expect(out.name).toBe("Renamed");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/rename/",
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ name: "Renamed" });
  });

  // ---- 9. updateMeta ----

  it("updateMeta POSTs {description} JSON object to /update_meta/", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ ...sampleList, description: "swing-trade picks" }),
    );
    const out = await updateMeta(ctx, 42, "swing-trade picks");
    expect(out.description).toBe("swing-trade picks");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/update_meta/",
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ description: "swing-trade picks" });
  });

  // ---- 10. replaceSymbol (single, custom + colored) ----

  it("replaceSymbol POSTs {old,new} to /symbols_list/{type}/{id}/replace_symbol/", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ ...sampleList, symbols: ["NASDAQ:NVDA"] }),
    );
    const out = await replaceSymbol(ctx, {
      type: "custom",
      id: 42,
      old: "NASDAQ:AAPL",
      new: "NASDAQ:NVDA",
    });
    expect(out.symbols).toEqual(["NASDAQ:NVDA"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/custom/42/replace_symbol/",
    );
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ old: "NASDAQ:AAPL", new: "NASDAQ:NVDA" });
  });

  it("replaceSymbol routes type=colored to /colored/{id}/replace_symbol/", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        id: 1,
        type: "colored",
        name: "",
        symbols: ["NASDAQ:NVDA"],
        active: false,
        shared: false,
        color: "red",
        description: null,
        created: null,
        modified: null,
      }),
    );
    const out = await replaceSymbol(ctx, {
      type: "colored",
      id: 1,
      old: "NASDAQ:AAPL",
      new: "NASDAQ:NVDA",
    });
    expect(out.type).toBe("colored");
    expect(out.color).toBe("red");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/colored/1/replace_symbol/",
    );
  });

  it("replaceSymbol rejects invalid type values", async () => {
    await expect(
      replaceSymbol(ctx, { type: "bogus" as any, id: 1, old: "A", new: "B" }),
    ).rejects.toThrow(/type must be/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---- 11. getActiveWatchlist ----

  it("getActiveWatchlist GETs /symbols_list/active/ and parses object", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ...sampleList, active: true }));
    const out = await getActiveWatchlist(ctx);
    expect(out.active).toBe(true);
    expect(out.id).toBe(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/active/",
    );
    expect(init?.method ?? "GET").toBe("GET");
  });

  // ---- 12. setActiveWatchlist ----

  it("setActiveWatchlist POSTs to /symbols_list/active/{id}/", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ok: true }));
    const out = await setActiveWatchlist(ctx, 42);
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/symbols_list/active/42/",
    );
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    // Active POST has no body but we still send referer + content-type for parity.
    expect(headers.referer).toBe("https://www.tradingview.com/");
    expect(headers["content-type"]).toBe("application/json");
  });

  // ---- Cross-cutting: cookie injection without sessionSign ----

  it("emits cookie header without sessionid_sign when sign is absent", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(sampleList));
    await getWatchlist({ sessionId: "lonely" }, 42);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=lonely");
    expect(headers["x-csrftoken"]).toBeUndefined();
  });

  it("normalises null id and missing booleans on partial responses", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ id: null, type: "colored", color: "blue" }),
    );
    const out = await getActiveWatchlist(ctx);
    expect(out.id).toBeNull();
    expect(out.type).toBe("colored");
    expect(out.color).toBe("blue");
    expect(out.symbols).toEqual([]);
    expect(out.active).toBe(false);
    expect(out.shared).toBe(false);
  });
});
