import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  scanV2,
  screenerMetainfo,
  getOrderedEnum,
  getColumnCatalog,
  listMarkets,
  getSymbolFields,
  SCREENER_MARKETS,
  FILTER_OPERATIONS,
  __internals,
  type Filter2,
} from "./scanner-v2";

const mkResponse = (body: unknown, init: { status?: number; statusText?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

const makeKV = () => {
  const store = new Map<string, string>();
  let putCalls = 0;
  let getCalls = 0;
  const kv = {
    async get(key: string) {
      getCalls++;
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, _opts?: { expirationTtl?: number }) {
      putCalls++;
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return {
    kv,
    store,
    stats: () => ({ get: getCalls, put: putCalls }),
  };
};

let originalFetch: typeof fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// -----------------------------------------------------------------------
// 1. scanV2 — flat filter envelope (POST scanner.tv/{market}/scan2)
// -----------------------------------------------------------------------

describe("scanV2", () => {
  it("posts the v2 envelope to scanner.tv/{market}/scan2 with text/plain body", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ totalCount: 1, data: [{ s: "NASDAQ:AAPL", d: ["AAPL", 200] }], params: {} }),
    );

    const out = await scanV2({
      market: "america",
      columns: ["name", "close"],
      filter: [{ left: "type", operation: "equal", right: "stock" }],
      sort: { sortBy: "close", sortOrder: "desc" },
      range: [0, 50],
      options: { lang: "en" },
      labelProduct: "screener-stock",
    });

    expect(out.totalCount).toBe(1);
    expect(out.data[0].s).toBe("NASDAQ:AAPL");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://scanner.tradingview.com/america/scan2?label-product=screener-stock",
    );
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("text/plain;charset=UTF-8");

    const sent = JSON.parse(String(init?.body));
    expect(sent.columns).toEqual(["name", "close"]);
    expect(sent.filter).toEqual([{ left: "type", operation: "equal", right: "stock" }]);
    expect(sent.sort).toEqual({ sortBy: "close", sortOrder: "desc" });
    expect(sent.range).toEqual([0, 50]);
    // Untouched optional keys should not be serialised.
    expect("filter2" in sent).toBe(false);
    expect("markets" in sent).toBe(false);
  });

  it("serialises filter2 boolean tree with nested and/or operands", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ totalCount: 0, data: [] }));

    const filter2: Filter2 = {
      operator: "and",
      operands: [
        { expression: { left: "type", operation: "equal", right: "stock" } },
        {
          operation: {
            operator: "or",
            operands: [
              { expression: { left: "market_cap_basic", operation: "greater", right: 1e10 } },
              { expression: { left: "Recommend.All", operation: "in_range", right: [0.5, 1] } },
            ],
          },
        },
      ],
    };

    await scanV2({
      market: "global",
      columns: ["name", "close"],
      filter2,
      markets: ["america", "canada"],
      columnsets: ["overview"],
      currency: "USD",
      preset: "gainers",
      index_filters: [{ name: "index", values: ["SP500"] }],
      symbols: { tickers: [] },
      ignore_unknown_fields: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://scanner.tradingview.com/global/scan2");
    const sent = JSON.parse(String(init?.body));
    expect(sent.filter2.operator).toBe("and");
    expect(sent.filter2.operands).toHaveLength(2);
    expect(sent.filter2.operands[0].expression.left).toBe("type");
    expect(sent.filter2.operands[1].operation.operator).toBe("or");
    expect(sent.filter2.operands[1].operation.operands).toHaveLength(2);
    expect(sent.markets).toEqual(["america", "canada"]);
    expect(sent.columnsets).toEqual(["overview"]);
    expect(sent.currency).toBe("USD");
    expect(sent.preset).toBe("gainers");
    expect(sent.index_filters).toEqual([{ name: "index", values: ["SP500"] }]);
    expect(sent.symbols).toEqual({ tickers: [] });
    expect(sent.ignore_unknown_fields).toBe(true);
  });

  it("rejects malformed filter2 trees", async () => {
    await expect(
      scanV2({
        market: "america",
        columns: ["name"],
        filter2: { operator: "xor" as unknown as "and", operands: [] },
      }),
    ).rejects.toThrow(/operator must be/);

    await expect(
      scanV2({
        market: "america",
        columns: ["name"],
        // @ts-expect-error -- exercising runtime guard
        filter2: { operator: "and", operands: [{ foo: "bar" }] },
      }),
    ).rejects.toThrow(/expression.*or.*operation/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires market and at least one column", async () => {
    await expect(scanV2({ market: "", columns: ["x"] })).rejects.toThrow(/market required/);
    await expect(scanV2({ market: "america", columns: [] })).rejects.toThrow(/columns required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates upstream errors with status text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("rate limited", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "text/plain" },
      }),
    );
    await expect(scanV2({ market: "america", columns: ["name"] })).rejects.toThrow(
      /scan2 failed: 429.*rate limited/,
    );
  });
});

// -----------------------------------------------------------------------
// 2. screenerMetainfo — POST scanner.tv/{market}/metainfo (24h KV cache)
// -----------------------------------------------------------------------

describe("screenerMetainfo", () => {
  it("posts {} to scanner.tv/{market}/metainfo and caches 24h", async () => {
    const { kv, store, stats } = makeKV();
    const upstream = {
      fields: [
        { n: "name", t: "string" },
        { n: "close", t: "number" },
      ],
    };
    fetchMock.mockResolvedValueOnce(mkResponse(upstream));

    const first = await screenerMetainfo("america", { cache: kv, labelProduct: "screener-stock" });
    expect(first.cached).toBe(false);
    expect(first.value.fields).toHaveLength(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://scanner.tradingview.com/america/metainfo?label-product=screener-stock",
    );
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe("{}");

    expect(stats().put).toBe(1);
    // KV key shape includes host + path + query so concurrent markets don't collide.
    const keys = Array.from(store.keys());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("/america/metainfo");
    expect(keys[0]).toContain("label-product=screener-stock");
  });

  it("returns cache hit on second call without a fetch", async () => {
    const { kv } = makeKV();
    fetchMock.mockResolvedValueOnce(mkResponse({ fields: [] }));

    const first = await screenerMetainfo("global", { cache: kv });
    expect(first.cached).toBe(false);

    const second = await screenerMetainfo("global", { cache: kv });
    expect(second.cached).toBe(true);
    expect(second.value).toEqual(first.value);

    // Only one upstream call total
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects empty market", async () => {
    await expect(screenerMetainfo("")).rejects.toThrow(/market required/);
  });
});

// -----------------------------------------------------------------------
// 3. getOrderedEnum — host routing (scanner vs scanner-backend)
// -----------------------------------------------------------------------

describe("getOrderedEnum", () => {
  it("routes sector/industry/country to scanner.tradingview.com", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        sector: [{ id: "Technology Services", name: "Technology Services" }],
        industry: [{ id: "Software", name: "Software" }],
        country: [{ id: "US", name: "United States" }],
      }),
    );

    const out = await getOrderedEnum(["sector", "industry", "country"], { lang: "en" });
    expect(out.cached).toBe(false);
    expect(Object.keys(out.value)).toEqual(
      expect.arrayContaining(["sector", "industry", "country"]),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("scanner.tradingview.com");
    expect(u.pathname).toBe("/enum/ordered");
    expect(u.searchParams.get("id")).toBe("sector,industry,country");
    expect(u.searchParams.get("lang")).toBe("en");
  });

  it("routes metrics ids to scanner-backend.tradingview.com", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        metrics: [{ id: "ytm", name: "Yield to Maturity" }],
        metrics_full_name: [{ id: "ytm_full", name: "Yield to Maturity (full)" }],
      }),
    );

    await getOrderedEnum("metrics,metrics_full_name", { labelProduct: "ytm-metrics-plan.json" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("scanner-backend.tradingview.com");
    expect(u.searchParams.get("id")).toBe("metrics,metrics_full_name");
    expect(u.searchParams.get("label-product")).toBe("ytm-metrics-plan.json");
  });

  it("splits mixed-id requests across both hosts and merges", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse({ sector: [{ id: "S", name: "S" }] }))
      .mockResolvedValueOnce(mkResponse({ metrics: [{ id: "ytm", name: "YTM" }] }));

    const out = await getOrderedEnum(["sector", "metrics"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const hosts = fetchMock.mock.calls.map(([url]) => new URL(String(url)).host).sort();
    expect(hosts).toEqual([
      "scanner-backend.tradingview.com",
      "scanner.tradingview.com",
    ].sort());

    expect(out.value).toEqual({
      sector: [{ id: "S", name: "S" }],
      metrics: [{ id: "ytm", name: "YTM" }],
    });
  });

  it("caches each host slice independently and returns cached on repeat", async () => {
    const { kv, stats } = makeKV();
    fetchMock.mockResolvedValueOnce(
      mkResponse({ sector: [{ id: "Tech", name: "Tech" }] }),
    );

    const first = await getOrderedEnum(["sector"], { cache: kv });
    expect(first.cached).toBe(false);

    const second = await getOrderedEnum(["sector"], { cache: kv });
    expect(second.cached).toBe(true);
    expect(second.value).toEqual(first.value);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stats().put).toBe(1);
  });

  it("requires at least one id", async () => {
    await expect(getOrderedEnum([])).rejects.toThrow(/ids required/);
    await expect(getOrderedEnum("")).rejects.toThrow(/ids required/);
  });
});

// -----------------------------------------------------------------------
// 4. getColumnCatalog — screener-facade.tv/screener-facade/api/v1/columns
// -----------------------------------------------------------------------

describe("getColumnCatalog", () => {
  it("hits screener-facade host with version param and caches by version", async () => {
    const { kv, store } = makeKV();
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        version: "54",
        columns: [
          { name: "close", type: "number" },
          { name: "name", type: "string" },
        ],
      }),
    );

    const first = await getColumnCatalog("54", { cache: kv });
    expect(first.cached).toBe(false);
    expect(first.value.version).toBe("54");
    expect(first.value.columns).toHaveLength(2);

    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("screener-facade.tradingview.com");
    expect(u.pathname).toBe("/screener-facade/api/v1/columns");
    expect(u.searchParams.get("version")).toBe("54");

    const keys = Array.from(store.keys());
    expect(keys[0]).toContain("version=54");
  });

  it("returns cache hit on second call for same version, miss for different version", async () => {
    const { kv } = makeKV();
    fetchMock
      .mockResolvedValueOnce(mkResponse({ version: "54", columns: [{ name: "a" }] }))
      .mockResolvedValueOnce(mkResponse({ version: "55", columns: [{ name: "b" }] }));

    const a1 = await getColumnCatalog(54, { cache: kv });
    const a2 = await getColumnCatalog(54, { cache: kv });
    const b1 = await getColumnCatalog(55, { cache: kv });

    expect(a1.cached).toBe(false);
    expect(a2.cached).toBe(true);
    expect(b1.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a2.value.columns[0].name).toBe("a");
    expect(b1.value.columns[0].name).toBe("b");
  });

  it("works without a KV cache (fetches every time)", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse({ version: "1", columns: [] }))
      .mockResolvedValueOnce(mkResponse({ version: "1", columns: [] }));

    const a = await getColumnCatalog(1);
    const b = await getColumnCatalog(1);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// -----------------------------------------------------------------------
// 5. listMarkets — static enum
// -----------------------------------------------------------------------

describe("listMarkets", () => {
  it("returns the static market list with no upstream call", () => {
    const out = listMarkets();
    expect(out.markets).toEqual([...SCREENER_MARKETS]);
    expect(out.markets).toContain("america");
    expect(out.markets).toContain("crypto");
    expect(out.markets).toContain("hong_kong");
    expect(out.markets).toContain("germany");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a fresh array each call so callers can mutate safely", () => {
    const a = listMarkets().markets;
    const b = listMarkets().markets;
    expect(a).not.toBe(b);
    a.push("never_shipped" as never);
    expect(b).not.toContain("never_shipped");
  });
});

// -----------------------------------------------------------------------
// 6. getSymbolFields — GET scanner.tv/symbol
// -----------------------------------------------------------------------

describe("getSymbolFields", () => {
  it("hits scanner.tv/symbol with symbol/fields/no_404/label-product", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ name: "AAPL", close: 200, market_cap_basic: 3e12 }),
    );

    const out = await getSymbolFields({
      symbol: "nasdaq:aapl",
      fields: ["name", "close", "market_cap_basic"],
      no_404: true,
      labelProduct: "details",
    });
    expect((out as { name: string }).name).toBe("AAPL");

    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("scanner.tradingview.com");
    expect(u.pathname).toBe("/symbol");
    expect(u.searchParams.get("symbol")).toBe("NASDAQ:AAPL");
    expect(u.searchParams.get("fields")).toBe("name,close,market_cap_basic");
    expect(u.searchParams.get("no_404")).toBe("true");
    expect(u.searchParams.get("label-product")).toBe("details");
  });

  it("rejects symbols without exchange prefix and missing fields", async () => {
    await expect(
      getSymbolFields({ symbol: "AAPL", fields: ["name"] }),
    ).rejects.toThrow(/exchange prefix/);
    await expect(
      getSymbolFields({ symbol: "NASDAQ:AAPL", fields: [] }),
    ).rejects.toThrow(/fields required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// 7. Cross-cutting — filter operations + cache key shape
// -----------------------------------------------------------------------

describe("filter operations & internals", () => {
  it("exposes the documented filter operations", () => {
    expect(FILTER_OPERATIONS).toEqual(
      expect.arrayContaining([
        "equal",
        "nequal",
        "in_range",
        "greater",
        "less",
        "has",
        "has_none_of",
        "nempty",
        "match",
        "nmatch",
        "egreater",
        "eless",
        "crosses",
        "crosses_above",
        "crosses_below",
        "above%",
        "below%",
        "in_day_range",
        "not_in_range",
      ]),
    );
  });

  it("cache key includes host, path and query so different surfaces never collide", () => {
    const { cacheKey } = __internals;
    const a = cacheKey("https://scanner.tradingview.com", "/america/metainfo", "");
    const b = cacheKey("https://scanner-backend.tradingview.com", "/enum/ordered", "?id=metrics");
    const c = cacheKey("https://scanner.tradingview.com", "/america/metainfo", "?label-product=x");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("screener:")).toBe(true);
  });
});
