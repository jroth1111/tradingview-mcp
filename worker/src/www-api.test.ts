import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSymbol,
  resolveSymbolBatch,
  listStudyTemplatesStandard,
  getIdeasFeed,
  getTweetData,
  getPublicChats,
  getDmChats,
  getConversationStatus,
  getFundamentalsConfig,
  getSupportI18n,
  getBrokerPanel,
  getUserProfile,
  updateUserProfile,
} from "./www-api";

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

const makeKV = () => {
  const store = new Map<string, string>();
  return {
    async get(key: string, opts?: { type?: string }) {
      const value = store.get(key);
      if (value === undefined) return null;
      return opts?.type === "json" ? JSON.parse(value) : value;
    },
    async put(key: string, value: string, _opts?: { expirationTtl?: number }) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
};

const ctx = { sessionId: "sid", sessionSign: "sign" };

describe("www-api helpers", () => {
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

  // 1. resolveSymbol — preferred canonical resolver
  it("resolveSymbol hits /api/v1/search/resolver/ with q+hl+exchange and maps hits", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        symbols_remaining: 0,
        symbols: [
          { symbol: "NASDAQ:AAPL", description: "Apple Inc.", type: "stock", exchange: "NASDAQ" },
          { symbol: "NASDAQ:AAPL.L", description: "Apple long", type: "stock", exchange: "NASDAQ" },
        ],
      }),
    );

    const out = await resolveSymbol({ q: "AAPL", hl: true, exchange: "NASDAQ", ...ctx });

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      symbol: "NASDAQ:AAPL",
      description: "Apple Inc.",
      type: "stock",
      exchange: "NASDAQ",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/search/resolver/");
    expect(String(url)).toContain("q=AAPL");
    expect(String(url)).toContain("hl=1");
    expect(String(url)).toContain("exchange=NASDAQ");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    expect(headers.referer).toBe("https://www.tradingview.com/");
  });

  // 2. resolveSymbol — bare-array fallback + missing q rejection
  it("resolveSymbol accepts a bare-array response shape and rejects empty q", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse([{ symbol: "BINANCE:BTCUSDT", type: "crypto" }]),
    );
    const out = await resolveSymbol({ q: "BTC" });
    expect(out).toEqual([
      expect.objectContaining({ symbol: "BINANCE:BTCUSDT", type: "crypto" }),
    ]);

    await expect(resolveSymbol({ q: "" } as any)).rejects.toThrow(/q required/);
  });

  // 3. resolveSymbolBatch — fan-out, partial failure isolation
  it("resolveSymbolBatch fans queries out and isolates per-query failures", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResponse({ symbols: [{ symbol: "NASDAQ:AAPL" }] }))
      .mockResolvedValueOnce(
        mkResponse({ detail: "boom" }, { status: 500, statusText: "ServerError" }),
      )
      .mockResolvedValueOnce(mkResponse({ symbols: [{ symbol: "NASDAQ:MSFT" }] }));

    const out = await resolveSymbolBatch(ctx, ["AAPL", "FAIL", { q: "MSFT", exchange: "NASDAQ" }]);

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ q: "AAPL", hits: [expect.objectContaining({ symbol: "NASDAQ:AAPL" })] });
    expect(out[1]).toMatchObject({ q: "FAIL", error: expect.stringMatching(/500/) });
    expect(out[2]).toMatchObject({ q: "MSFT", hits: [expect.objectContaining({ symbol: "NASDAQ:MSFT" })] });
    // every call carried the shared cookie context
    for (const [, init] of fetchMock.mock.calls) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    }
  });

  // 4. listStudyTemplatesStandard — read-only standard bucket
  it("listStudyTemplatesStandard hits /api/v1/study-templates/standard/ with cookie", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ standard: [{ id: 1, name: "MA Cross" }] }),
    );
    const out = await listStudyTemplatesStandard(ctx);
    expect(out).toEqual({ standard: [{ id: 1, name: "MA Cross" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/study-templates/standard/",
    );
    expect(init?.method ?? "GET").toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  // 5. getIdeasFeed — query encoding, mapping, paging hint
  it("getIdeasFeed forwards symbol+sort+offset+count and maps idea cards", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        count: 2,
        next_offset: 20,
        results: [
          {
            id: 17,
            symbol: "NASDAQ:AAPL",
            url: "https://www.tradingview.com/chart/AAPL/abc/",
            title: "Bull case",
            likes_count: 42,
            comments_count: 7,
            date_timestamp: 1714000000,
            author: { username: "alice" },
          },
        ],
      }),
    );

    const out = await getIdeasFeed({ symbol: "NASDAQ:AAPL", sort: "popular", offset: 0, count: 20 });

    expect(out.count).toBe(2);
    expect(out.next_offset).toBe(20);
    expect(out.ideas[0]).toMatchObject({
      id: 17,
      symbol: "NASDAQ:AAPL",
      title: "Bull case",
      likes: 42,
      comments: 7,
      author: { username: "alice" },
    });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/ideas/?");
    expect(String(url)).toContain("symbol=NASDAQ%3AAAPL");
    expect(String(url)).toContain("sort=popular");
    expect(String(url)).toContain("offset=0");
    expect(String(url)).toContain("count=20");
  });

  // 6. getTweetData — embed proxy
  it("getTweetData hits /api/v1/get-tweet-data/?id= and surfaces oEmbed shape", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        html: "<blockquote>tweet</blockquote>",
        url: "https://twitter.com/x/status/12345",
        author_name: "X",
      }),
    );
    const out = await getTweetData("12345");
    expect(out).toMatchObject({
      id: "12345",
      html: "<blockquote>tweet</blockquote>",
      url: "https://twitter.com/x/status/12345",
      author_name: "X",
    });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/api/v1/get-tweet-data/?id=12345",
    );
    await expect(getTweetData("")).rejects.toThrow(/id required/);
  });

  // 7. getPublicChats — public room list
  it("getPublicChats hits /chats/public/get/?limit= and maps room shape", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        rooms: [
          { id: 100, name: "General", description: "Public", online: 12, members_count: 5000 },
        ],
      }),
    );
    const out = await getPublicChats(ctx, 25);
    expect(out.rooms).toHaveLength(1);
    expect(out.rooms[0]).toMatchObject({
      id: 100,
      name: "General",
      online_count: 12,
      members_count: 5000,
    });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.tradingview.com/chats/public/get/?limit=25");
  });

  // 8. getDmChats — admin only (rejects without sessionId)
  it("getDmChats requires sessionId (admin only) and forwards limit when present", async () => {
    await expect(getDmChats({})).rejects.toThrow(/sessionId required/);

    fetchMock.mockResolvedValueOnce(
      mkResponse({ rooms: [{ id: 9, name: "DM" }] }),
    );
    const out = await getDmChats(ctx, 50);
    expect(out.rooms[0]).toMatchObject({ id: 9, name: "DM" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.tradingview.com/chats/get/?limit=50");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  // 9. getConversationStatus — live presence with _rand cache buster
  it("getConversationStatus encodes room_id+offset+stat_symbol+stat_interval and adds _rand", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ online: 4, members: 500, symbol_quote: { last: 199.5 } }),
    );
    const out = await getConversationStatus({
      room_id: 17,
      offset: 0,
      stat_symbol: "NASDAQ:AAPL",
      stat_interval: "60",
      ...ctx,
    });
    expect(out).toMatchObject({
      room_id: 17,
      online: 4,
      members: 500,
      symbol_quote: { last: 199.5 },
    });
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/conversation-status/");
    expect(u.searchParams.get("room_id")).toBe("17");
    expect(u.searchParams.get("offset")).toBe("0");
    expect(u.searchParams.get("stat_symbol")).toBe("NASDAQ:AAPL");
    expect(u.searchParams.get("stat_interval")).toBe("60");
    expect(u.searchParams.get("_rand")).not.toBeNull();
    await expect(getConversationStatus({ room_id: "" } as any)).rejects.toThrow(/room_id required/);
  });

  // 10. getFundamentalsConfig — KV cache miss writes, hit short-circuits
  it("getFundamentalsConfig caches the 24h payload in KV and short-circuits on cache hit", async () => {
    const cache = makeKV();
    fetchMock.mockResolvedValueOnce(
      mkResponse({ groups: [{ id: "valuation", fields: ["pe_ratio"] }] }),
    );

    const first = await getFundamentalsConfig({ cache });
    expect(first.cached).toBe(false);
    expect(first.config.groups?.[0].id).toBe("valuation");
    expect((cache as any)._store.has("www-api:fundamentals-config-v2")).toBe(true);

    // second call should NOT hit fetch.
    const second = await getFundamentalsConfig({ cache });
    expect(second.cached).toBe(true);
    expect(second.config.groups?.[0].id).toBe("valuation");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 11. getSupportI18n — KV cache hit, language-keyed
  it("getSupportI18n caches the i18n pack per language and short-circuits on hit", async () => {
    const cache = makeKV();
    fetchMock.mockResolvedValueOnce(
      mkResponse({ problems: [{ id: "billing", title: "Billing" }] }),
    );

    const first = await getSupportI18n({ language: "en", cache });
    expect(first.cached).toBe(false);
    expect(first.pack.language).toBe("en");
    expect(first.pack.problems?.[0].id).toBe("billing");
    expect((cache as any)._store.has("www-api:support-i18n:en")).toBe(true);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("language=en");

    // Different language → fresh fetch (different cache key).
    fetchMock.mockResolvedValueOnce(
      mkResponse({ problems: [{ id: "facturation" }] }),
    );
    const fr = await getSupportI18n({ language: "fr", cache });
    expect(fr.cached).toBe(false);

    // Repeat en → cached.
    const enAgain = await getSupportI18n({ language: "en", cache });
    expect(enAgain.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 12. getBrokerPanel — broker integrations
  it("getBrokerPanel hits /api/v1/brokers/trading_panel and surfaces broker list", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        brokers: [
          { id: "alpaca", name: "Alpaca", url: "https://alpaca.markets" },
        ],
      }),
    );
    const out = await getBrokerPanel(ctx);
    expect(out.brokers).toHaveLength(1);
    expect(out.brokers?.[0]).toMatchObject({ id: "alpaca", name: "Alpaca" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.tradingview.com/api/v1/brokers/trading_panel");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  // 13. getUserProfile + updateUserProfile — admin profile (POST is admin only)
  it("getUserProfile/updateUserProfile require sessionId and POST FormData on update", async () => {
    await expect(getUserProfile({})).rejects.toThrow(/sessionId required/);
    await expect(
      updateUserProfile({ ctx: {}, fields: { about: "x" } }),
    ).rejects.toThrow(/sessionId required/);

    fetchMock.mockResolvedValueOnce(
      mkResponse({ id: 7, username: "tester", email: "t@example.com" }),
    );
    const profile = await getUserProfile(ctx);
    expect(profile).toMatchObject({ id: 7, username: "tester" });

    fetchMock.mockResolvedValueOnce(
      mkResponse({ id: 7, username: "tester", email: "t@example.com" }),
    );
    const updated = await updateUserProfile({ ctx, fields: { about: "Trader" } });
    expect(updated.username).toBe("tester");
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("https://www.tradingview.com/api/v1/user/profile/");
    expect(init?.method).toBe("POST");
    // FormData body — the Workers runtime will set the multipart content-type
    // automatically; we just confirm the helper passed a FormData instance.
    expect(init?.body).toBeInstanceOf(FormData);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  // 14. Negative / forbidden surfaces — assert helpers do NOT cover any
  // /accounts/, /pro-plans/, /api/v1/offers/, /market/shopconf/, /ec/cache,
  // /ec/etag path. Probes the public helper surface; the index.ts route
  // table is checked by the negative test in worker/src/index.test.ts.
  it("none of the exported www-api helpers reach forbidden upstream surfaces", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return mkResponse({});
    }) as unknown as typeof fetch;

    // Exercise every helper that does not require an extra arg shape.
    await resolveSymbol({ q: "AAPL", ...ctx }).catch(() => {});
    await resolveSymbolBatch(ctx, ["AAPL"]).catch(() => {});
    await listStudyTemplatesStandard(ctx).catch(() => {});
    await getIdeasFeed({}).catch(() => {});
    await getTweetData("1").catch(() => {});
    await getPublicChats(ctx).catch(() => {});
    await getDmChats(ctx).catch(() => {});
    await getConversationStatus({ room_id: 1 }).catch(() => {});
    await getFundamentalsConfig({}).catch(() => {});
    await getSupportI18n({}).catch(() => {});
    await getBrokerPanel(ctx).catch(() => {});
    await getUserProfile(ctx).catch(() => {});

    const forbidden = [
      /\/accounts\//,
      /\/pro-plans\//,
      /\/api\/v1\/offers\//,
      /\/market\/shopconf\//,
      /\/ec\/cache/,
      /\/ec\/etag/,
      /\/api\/v1\/recover_password/,
    ];
    for (const url of calls) {
      for (const pat of forbidden) {
        expect(url).not.toMatch(pat);
      }
    }
    // sanity — every helper actually fired at least once (12 helpers exercised).
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });
});
