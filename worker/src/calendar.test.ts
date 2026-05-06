import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEconomicEvents,
  getIposCalendar,
  getSplitsCalendar,
  IPO_DEFAULT_FIELDS,
  SPLITS_DEFAULT_FIELDS,
  _internal,
} from "./calendar";

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

describe("calendar helpers", () => {
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

  it("getEconomicEvents injects Origin header and parses {status,result}", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        status: "ok",
        result: [
          {
            id: "evt-1",
            title: "CPI YoY",
            country: "US",
            indicator: "Consumer Price Index",
            ticker: "ECONOMICS:USCPI",
            comment: "Headline inflation reading.",
            period: "Apr",
            actual: 3.4,
            forecast: 3.5,
            previous: 3.5,
            importance: 3,
            date: "2026-05-15T12:30:00Z",
          },
        ],
      }),
    );

    const out = await getEconomicEvents({
      from: "2026-05-01T00:00:00Z",
      to: "2026-05-31T00:00:00Z",
      countries: ["US", "EU"],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].title).toBe("CPI YoY");
    expect(out.events[0].importance).toBe(3);
    expect(out.events[0].ticker).toBe("ECONOMICS:USCPI");

    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("economic-calendar.tradingview.com");
    expect(u.pathname).toBe("/events");
    expect(u.searchParams.get("countries")).toBe("US,EU");
    expect(u.searchParams.get("from")).toBe("2026-05-01T00:00:00.000Z");
    expect(u.searchParams.get("to")).toBe("2026-05-31T00:00:00.000Z");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Origin).toBe("https://www.tradingview.com");
  });

  it("getEconomicEvents filters by minImportance client-side", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        status: "ok",
        result: [
          { id: "1", title: "Low", country: "US", date: "2026-05-15T00:00:00Z", importance: 0 },
          { id: "2", title: "Mid", country: "US", date: "2026-05-15T00:00:00Z", importance: 1 },
          { id: "3", title: "High", country: "US", date: "2026-05-15T00:00:00Z", importance: 3 },
        ],
      }),
    );
    const out = await getEconomicEvents({ minImportance: 2 });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].id).toBe("3");
  });

  it("getEconomicEvents throws on non-200 (anon 403 without Origin scenario)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403, statusText: "Forbidden" }));
    await expect(getEconomicEvents()).rejects.toThrow(/403/);
  });

  it("getEconomicEvents throws when status field is not 'ok'", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "error", result: [] }));
    await expect(getEconomicEvents()).rejects.toThrow(/status not ok/);
  });

  it("getIposCalendar posts scanner /global/scan?label-product=calendar-ipo with ipo_offer_date filter", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        data: [
          {
            s: "NASDAQ:NEWCO",
            d: [
              "Newco",
              "Newco Inc.",
              "newco-logo",
              1735689600,
              10.0,
              12.0,
              "USD",
              "NASDAQ",
              "USD",
              "america",
              500_000_000,
              "US",
            ],
          },
        ],
      }),
    );

    const out = await getIposCalendar({
      from: 1735689600,
      to: 1738368000,
      countries: ["US"],
      markets: ["america"],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].symbol).toBe("NASDAQ:NEWCO");
    expect(out.events[0].ipoOfferDate).toBe(1735689600);
    expect(out.events[0].ipoOfferPriceMin).toBe(10);
    expect(out.events[0].ipoOfferPriceMax).toBe(12);
    expect(out.events[0].ipoOfferPriceCurrency).toBe("USD");
    expect(out.events[0].ipoExchange).toBe("NASDAQ");

    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.host).toBe("scanner.tradingview.com");
    expect(u.pathname).toBe("/global/scan");
    expect(u.searchParams.get("label-product")).toBe("calendar-ipo");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.columns).toEqual(Array.from(IPO_DEFAULT_FIELDS));
    expect(body.markets).toEqual(["america"]);
    const offerFilter = body.filter.find((f: any) => f.left === "ipo_offer_date");
    expect(offerFilter).toBeDefined();
    expect(offerFilter.operation).toBe("in_range");
    expect(offerFilter.right).toEqual([1735689600, 1738368000]);
    const countryFilter = body.filter.find((f: any) => f.left === "country");
    expect(countryFilter).toBeDefined();
    expect(countryFilter.right).toEqual(["US"]);
  });

  it("getSplitsCalendar posts calendar-splits with last_split_date filter and parses split_factor", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        data: [
          {
            s: "NASDAQ:AAPL",
            d: [
              "AAPL",
              "Apple Inc.",
              "apple-logo",
              1735689600,
              4,
              "4-for-1",
              "america",
              "US",
            ],
          },
        ],
      }),
    );
    const out = await getSplitsCalendar({ from: 1735689600, to: 1738368000 });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].symbol).toBe("NASDAQ:AAPL");
    expect(out.events[0].splitFactor).toBe(4);
    expect(out.events[0].splitFactorRatio).toBe("4-for-1");
    expect(out.events[0].lastSplitDate).toBe(1735689600);

    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.searchParams.get("label-product")).toBe("calendar-splits");
    const body = JSON.parse(String(init?.body));
    expect(body.columns).toEqual(Array.from(SPLITS_DEFAULT_FIELDS));
    const filter = body.filter[0];
    expect(filter.left).toBe("last_split_date");
    expect(filter.right).toEqual([1735689600, 1738368000]);
  });

  it("default time ranges fall back to a window around now", () => {
    const before = Math.floor(Date.now() / 1000);
    const [from, to] = _internal.buildScannerRange(undefined, undefined, 30);
    const after = Math.floor(Date.now() / 1000);
    expect(from).toBeLessThanOrEqual(before - 30 * 86400 + 1);
    expect(from).toBeGreaterThanOrEqual(before - 30 * 86400 - 1);
    expect(to).toBeGreaterThanOrEqual(after + 30 * 86400);
  });

  it("isoToZ accepts unix-seconds string and ISO and returns ISO Z", () => {
    expect(_internal.isoToZ("1735689600")).toBe(new Date(1735689600 * 1000).toISOString());
    expect(_internal.isoToZ("2026-05-15T12:30:00Z")).toBe("2026-05-15T12:30:00.000Z");
    expect(_internal.isoToZ(undefined)).toBeUndefined();
    expect(_internal.isoToZ("not-a-date")).toBeUndefined();
  });
});
