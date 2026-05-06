import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCategoryNews,
  getStoryJson,
  getSymbolNews,
  getSymbolNewsView,
  _internal,
} from "./news-mediator";

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

describe("news-mediator helpers", () => {
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

  it("getSymbolNews hits mediator host with symbol filter and chart client", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        items: [
          {
            id: "DJN_abc",
            title: "Apple beats estimates",
            published: 1700000000,
            urgency: 2,
            storyPath: "/news/DJN_abc/",
            provider: { id: "djn", name: "Dow Jones", logo_id: "dj-logo" },
            relatedSymbols: [{ symbol: "NASDAQ:AAPL" }, "NASDAQ:AAPL"],
            permission: "public",
            isFlash: false,
          },
        ],
        pagination: { cursor: "next-cursor-token" },
      }),
    );

    const out = await getSymbolNews({ symbol: "NASDAQ:AAPL" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].title).toBe("Apple beats estimates");
    expect(out.items[0].storyPath).toBe("/news/DJN_abc/");
    expect(out.items[0].provider.logoId).toBe("dj-logo");
    expect(out.items[0].relatedSymbols).toContain("NASDAQ:AAPL");
    expect(out.cursor).toBe("next-cursor-token");

    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("news-mediator.tradingview.com");
    expect(u.pathname).toBe("/public/news-flow/v2/news");
    expect(u.searchParams.get("filter")).toBe("symbol:NASDAQ:AAPL,lang:en");
    expect(u.searchParams.get("client")).toBe("chart");
  });

  it("getSymbolNews forwards cursor and streaming flag", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        items: [],
        pagination: {},
        streaming: { channel: "abc123" },
      }),
    );
    const out = await getSymbolNews({
      symbol: "BINANCE:BTCUSDT",
      cursor: "page-2",
      streaming: true,
      lang: "fr",
      client: "news_flow",
    });
    expect(out.streamingChannel).toBe("abc123");

    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.searchParams.get("filter")).toBe("symbol:BINANCE:BTCUSDT,lang:fr");
    expect(u.searchParams.get("cursor")).toBe("page-2");
    expect(u.searchParams.get("streaming")).toBe("true");
    expect(u.searchParams.get("client")).toBe("news_flow");
  });

  it("getCategoryNews composes market + country + tag + priority filters", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ items: [] }));
    await getCategoryNews({
      market: "stock",
      country: "US",
      tag: "overview",
      priority: "top_stories",
    });
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("news-mediator.tradingview.com");
    expect(u.pathname).toBe("/public/news-flow/v2/news");
    const filter = u.searchParams.get("filter");
    // The composed filter must contain every requested axis joined with `,`.
    expect(filter).toContain("market:stock");
    expect(filter).toContain("market_country:US");
    expect(filter).toContain("tag:overview");
    expect(filter).toContain("priority:top_stories");
    expect(filter).toContain("lang:en");
  });

  it("getCategoryNews rejects when no axes provided", async () => {
    await expect(getCategoryNews({})).rejects.toThrow(/at least one of/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getSymbolNewsView calls /public/view/v1/symbol with overview client", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        sections: [
          {
            id: "press_release",
            title: "Press Release",
            items: [
              {
                id: "p1",
                title: "Quarterly press",
                published: 1,
                provider: { name: "PRNewswire" },
              },
            ],
          },
          {
            id: "financial_statement",
            title: "Financials",
            items: [],
          },
        ],
        items: [],
      }),
    );
    const out = await getSymbolNewsView({ symbol: "NYSE:IBM" });
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].id).toBe("press_release");
    expect(out.sections[0].items[0].title).toBe("Quarterly press");

    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/public/view/v1/symbol");
    expect(u.searchParams.get("client")).toBe("overview");
  });

  it("getStoryJson hits headlines /v2/story?id= with lang", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        id: "DJN_xyz",
        title: "Headline title",
        shortDescription: "Short desc",
        published: 1700000123,
        provider: { name: "Dow Jones" },
        storyPath: "/news/DJN_xyz/",
      }),
    );
    const out = await getStoryJson({ id: "DJN_xyz" });
    expect(out.title).toBe("Headline title");
    expect(out.shortDescription).toBe("Short desc");
    expect(out.source).toBe("Dow Jones");
    expect(out.storyPath).toBe("/news/DJN_xyz/");

    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("news-headlines.tradingview.com");
    expect(u.pathname).toBe("/v2/story");
    expect(u.searchParams.get("id")).toBe("DJN_xyz");
    expect(u.searchParams.get("lang")).toBe("en");
  });

  it("propagates upstream non-2xx as Error with status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("oops", { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(getSymbolNews({ symbol: "NASDAQ:AAPL" })).rejects.toThrow(/503/);
  });

  it("getSymbolNews requires non-empty symbol", async () => {
    await expect(getSymbolNews({ symbol: "" })).rejects.toThrow(/symbol required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes provider.logo_id to logoId and missing relatedSymbols to []", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        items: [
          {
            id: "x",
            title: "y",
            published: 1,
            provider: { id: "p", name: "Reuters", logo_id: "rt" },
          },
        ],
      }),
    );
    const out = await getSymbolNews({ symbol: "FX:EURUSD" });
    expect(out.items[0].provider).toEqual({ id: "p", name: "Reuters", logoId: "rt" });
    expect(out.items[0].relatedSymbols).toEqual([]);
  });

  it("internal composeFilter drops undefined axes", () => {
    expect(
      _internal.composeFilter([
        ["market", "stock"],
        ["market_country", undefined],
        ["tag", ""],
        ["priority", "top_stories"],
      ]),
    ).toBe("market:stock,priority:top_stories");
  });
});
