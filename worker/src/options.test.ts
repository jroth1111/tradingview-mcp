import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAIN_COLUMNS,
  OptionsValidationError,
  VOLATILITY_XAXIS_VALUES,
  __internal,
  getExpiries,
  getGreeks,
  getInTimeIv,
  getOptionsChain,
  getOptionsMetainfo,
  getStrikes,
  getVolatilityChart,
  scanOptions,
} from "./options";

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

describe("options helpers (P14)", () => {
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

  // 1. in-time-iv parses real-ivs term structure
  it("getInTimeIv hits options-charting with details_widget label and parses real-ivs", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        "real-ivs": [
          { span: { value: 1, unit: "w" }, value: 0.31 },
          { span: { value: 1, unit: "m" }, value: 0.28 },
          { span: { value: 3, unit: "m" }, value: 0.25 },
          { span: { value: 1, unit: "y" }, value: 0.22 },
        ],
      }),
    );
    const out = await getInTimeIv({ symbol: "NASDAQ:AAPL" });
    expect(out.symbol).toBe("NASDAQ:AAPL");
    expect(out.points).toHaveLength(4);
    expect(out.points[0]).toEqual({ span: { value: 1, unit: "w" }, value: 0.31 });
    expect(out.points[3].span.unit).toBe("y");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "https://options-charting.tradingview.com/v1/in-time-iv/NASDAQ%3AAAPL",
    );
    expect(String(url)).toContain("label-product=details_widget_in_time_iv_chart");
    expect((init?.method ?? "GET").toUpperCase()).toBe("GET");
  });

  // 2. volatility-chart accepts strikes, parses x-axis + plots
  it("getVolatilityChart accepts xaxis=strikes, derives root from symbol, returns curve", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        "x-axis": { x: [180, 185, 190, 195, 200] },
        plots: [
          {
            optionSeriesId: "AAPL;20260605",
            plot: { y: [0.42, 0.36, 0.32, 0.34, 0.41] },
          },
        ],
      }),
    );
    const out = await getVolatilityChart({
      symbol: "NASDAQ:AAPL",
      expiry: "20260605",
      xaxis: "strikes",
    });
    expect(out.xaxis).toBe("strikes");
    expect(out.root).toBe("AAPL");
    expect(out.curve.xAxis).toEqual([180, 185, 190, 195, 200]);
    expect(out.curve.plots[0].optionSeriesId).toBe("AAPL;20260605");
    expect(out.curve.plots[0].plot.y).toHaveLength(5);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "https://options-charting.tradingview.com/v1/volatility-chart/NASDAQ%3AAAPL;AAPL;20260605",
    );
    expect(String(url)).toContain("xaxis=strikes");
    expect(String(url)).toContain("label-product=details_widget_volatility_chart");
  });

  // 3. volatility-chart accepts moneyness
  it("getVolatilityChart accepts xaxis=moneyness", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ "x-axis": { x: [-0.1, 0, 0.1] }, plots: [] }),
    );
    const out = await getVolatilityChart({
      symbol: "NASDAQ:AAPL",
      root: "AAPL",
      expiry: "20260605",
      xaxis: "moneyness",
    });
    expect(out.xaxis).toBe("moneyness");
    expect(String(fetchMock.mock.calls[0][0])).toContain("xaxis=moneyness");
  });

  // 4. xaxis enum strict — rejects delta, log_strike, deltas, delta_call locally before fetch
  it.each(["delta", "deltas", "delta_call", "log_strike", "DELTA", "", "Strikes"])(
    "getVolatilityChart rejects invalid xaxis=%s without fetching",
    async (bad) => {
      await expect(
        getVolatilityChart({
          symbol: "NASDAQ:AAPL",
          expiry: "20260605",
          xaxis: bad,
        }),
      ).rejects.toBeInstanceOf(OptionsValidationError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  // 5. expiries: distinct + sorted from global/scan2
  it("getExpiries posts global/scan2 with underlying filter and returns sorted-distinct expirations", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        totalCount: 6,
        data: [
          { s: "x1", d: ["20260620"] },
          { s: "x2", d: ["20260516"] },
          { s: "x3", d: ["20260620"] }, // dup
          { s: "x4", d: ["20260919"] },
          { s: "x5", d: [null] }, // null tolerated
          { s: "x6", d: ["20270116"] },
        ],
        fields: ["expiration"],
      }),
    );
    const out = await getExpiries({ symbol: "NASDAQ:AAPL" });
    expect(out.expiries).toEqual(["20260516", "20260620", "20260919", "20270116"]);
    expect(out.count).toBe(4);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://scanner.tradingview.com/global/scan2?label-product=symbols-options",
    );
    expect((init?.method ?? "").toUpperCase()).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.filter).toEqual([
      { left: "underlying_symbol", operation: "equal", right: "NASDAQ:AAPL" },
    ]);
    expect(body.columns).toEqual(["expiration"]);
  });

  // 6. strikes: distinct (strike,type) tuples, sorted
  it("getStrikes returns distinct (strike,type) sorted; honors expiry filter", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        data: [
          { s: "a", d: [185, "call"] },
          { s: "b", d: [180, "put"] },
          { s: "c", d: [185, "put"] },
          { s: "d", d: [185, "call"] }, // dup
          { s: "e", d: [190, "call"] },
        ],
        fields: ["strike", "option-type"],
      }),
    );
    const out = await getStrikes({ symbol: "NASDAQ:AAPL", expiry: "20260605" });
    expect(out.strikes.map((s) => `${s.strike}:${s.type}`)).toEqual([
      "180:put",
      "185:call",
      "185:put",
      "190:call",
    ]);
    expect(out.expiry).toBe("20260605");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.filter).toEqual([
      { left: "underlying_symbol", operation: "equal", right: "NASDAQ:AAPL" },
      { left: "expiration", operation: "equal", right: "20260605" },
    ]);
  });

  // 7. chain flatten: f[] aligned against fields produces typed contracts
  it("getOptionsChain flattens f[] against fields into typed OptionContract objects", async () => {
    const fields = [...CHAIN_COLUMNS];
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        totalCount: 2,
        data: [
          {
            s: "NASDAQ:AAPL260605C00185000",
            d: [
              "NASDAQ:AAPL260605C00185000",
              185,
              "20260605",
              "call",
              5.4,
              5.5,
              0.62,
              0.04,
              -0.08,
              0.18,
              0.05,
              0.27,
              1234,
              5.45,
              "AAPL",
            ],
          },
          {
            s: "NASDAQ:AAPL260605P00185000",
            d: [
              "NASDAQ:AAPL260605P00185000",
              185,
              "20260605",
              "put",
              4.2,
              4.3,
              -0.38,
              0.04,
              -0.07,
              0.18,
              -0.05,
              0.29,
              980,
              4.25,
              "AAPL",
            ],
          },
        ],
        fields,
      }),
    );
    const out = await getOptionsChain({
      symbol: "NASDAQ:AAPL",
      expiry: "20260605",
      type: "both",
    });
    expect(out.contracts).toHaveLength(2);
    expect(out.contracts[0]).toMatchObject({
      symbol: "NASDAQ:AAPL260605C00185000",
      strike: 185,
      expiration: "20260605",
      type: "call",
      bid: 5.4,
      ask: 5.5,
      delta: 0.62,
      gamma: 0.04,
      theta: -0.08,
      vega: 0.18,
      rho: 0.05,
      iv: 0.27,
      openInterest: 1234,
      theoreticalPrice: 5.45,
      underlying: "AAPL",
    });
    expect(out.contracts[1].type).toBe("put");
    expect(out.contracts[1].delta).toBe(-0.38);
    expect(out.totalCount).toBe(2);
    expect(out.fields).toEqual(fields);
  });

  // 8. chain null-cell tolerance for unauth/non-Pro responses
  it("getOptionsChain tolerates null cells for entitlement-gated greeks (unauth)", async () => {
    const fields = [...CHAIN_COLUMNS];
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        totalCount: 1,
        data: [
          {
            s: "NASDAQ:AAPL260605C00185000",
            d: [
              "NASDAQ:AAPL260605C00185000",
              185,
              "20260605",
              "call",
              null, // bid
              null, // ask
              null, // delta
              null, // gamma
              null, // theta
              null, // vega
              null, // rho
              null, // iv
              null, // open_interest
              null, // theoretical_price
              "AAPL",
            ],
          },
        ],
        fields,
      }),
    );
    const out = await getOptionsChain({ symbol: "NASDAQ:AAPL", type: "call" });
    expect(out.contracts).toHaveLength(1);
    const c = out.contracts[0];
    expect(c.symbol).toBe("NASDAQ:AAPL260605C00185000");
    expect(c.strike).toBe(185);
    expect(c.type).toBe("call");
    expect(c.bid).toBeNull();
    expect(c.ask).toBeNull();
    expect(c.delta).toBeNull();
    expect(c.gamma).toBeNull();
    expect(c.theta).toBeNull();
    expect(c.vega).toBeNull();
    expect(c.rho).toBeNull();
    expect(c.iv).toBeNull();
    expect(c.openInterest).toBeNull();
    expect(c.theoreticalPrice).toBeNull();
    expect(c.underlying).toBe("AAPL");
    // call+expiry=undefined applies type filter only
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.filter).toEqual([
      { left: "underlying_symbol", operation: "equal", right: "NASDAQ:AAPL" },
      { left: "option-type", operation: "equal", right: "call" },
    ]);
  });

  // 9. greeks for a single contract symbol
  it("getGreeks scans a single contract via tickers and returns OptionGreeks", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        data: [
          {
            s: "NASDAQ:AAPL260605C00185000",
            d: [
              "NASDAQ:AAPL260605C00185000",
              0.62, // delta
              0.04, // gamma
              -0.08, // theta
              0.18, // vega
              0.05, // rho
              0.27, // iv
            ],
          },
        ],
        fields: ["name", "delta", "gamma", "theta", "vega", "rho", "iv"],
      }),
    );
    const out = await getGreeks({ contractSymbol: "NASDAQ:AAPL260605C00185000" });
    expect(out.greeks).toEqual({
      delta: 0.62,
      gamma: 0.04,
      theta: -0.08,
      vega: 0.18,
      rho: 0.05,
      iv: 0.27,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.symbols).toEqual({
      tickers: ["NASDAQ:AAPL260605C00185000"],
      query: { types: [] },
    });
  });

  // 10. greeks tolerates entirely missing / null upstream cells
  it("getGreeks tolerates null/missing cells without throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        data: [
          {
            s: "NASDAQ:AAPL260605C00185000",
            d: ["NASDAQ:AAPL260605C00185000", null, null, null, null, null, null],
          },
        ],
        fields: ["name", "delta", "gamma", "theta", "vega", "rho", "iv"],
      }),
    );
    const out = await getGreeks({ contractSymbol: "NASDAQ:AAPL260605C00185000" });
    expect(out.greeks.delta).toBeNull();
    expect(out.greeks.iv).toBeNull();
  });

  // 11. scanOptions advanced (default options/scan2 path) passes index passthrough
  it("scanOptions defaults to options/scan2 and passes index/columns through", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ totalCount: 0, data: [], fields: ["name"] }),
    );
    await scanOptions({
      columns: ["name", "strike"],
      range: [0, 10],
      filter: [{ left: "underlying_symbol", operation: "equal", right: "NASDAQ:AAPL" }],
      index: { underlying_symbol: "NASDAQ:AAPL" },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://scanner.tradingview.com/options/scan2?label-product=symbols-options",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.columns).toEqual(["name", "strike"]);
    expect(body.range).toEqual([0, 10]);
    expect(body.index).toEqual({ underlying_symbol: "NASDAQ:AAPL" });
  });

  // 12. scanOptions can target global/scan2 variant
  it("scanOptions variant=global routes to global/scan2", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ data: [] }));
    await scanOptions({ variant: "global", columns: ["name"], range: [0, 5] });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/global/scan2?label-product=symbols-options");
  });

  // 13. scanOptions surfaces upstream 400 (recon §3 — index-shape unknown lead)
  it("scanOptions surfaces upstream 400 on unknown index payload shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("required index \"underlying_symbol\" is missing from request", {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    await expect(scanOptions({ columns: ["name"] })).rejects.toThrow(
      /POST options\/scan2 failed: 400/,
    );
  });

  // 14. metainfo parses 71-field schema
  it("getOptionsMetainfo returns options/metainfo field schema", async () => {
    const fakeFields = Array.from({ length: 71 }, (_, i) => ({
      n: `field_${i}`,
      t: i % 2 === 0 ? "number" : "string",
    }));
    fetchMock.mockResolvedValueOnce(mkResponse({ fields: fakeFields }));
    const out = await getOptionsMetainfo();
    expect(out.fields).toHaveLength(71);
    expect(out.fields[0]).toMatchObject({ name: "field_0", type: "number" });
    expect(out.fields[1]).toMatchObject({ name: "field_1", type: "string" });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://scanner.tradingview.com/options/metainfo?label-product=symbols-options",
    );
  });

  // 15. session cookie forwarded for entitlement-gated greek live values
  it("forwards admin session cookie when getOptionsChain provided sessionId/sign", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ data: [], fields: [...CHAIN_COLUMNS] }));
    await getOptionsChain({
      symbol: "NASDAQ:AAPL",
      sessionId: "sid",
      sessionSign: "sign",
      type: "both",
    });
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  // 16. xaxis enum allowlist exported (skill consumers can echo strict validation)
  it("VOLATILITY_XAXIS_VALUES is exactly ['strikes','moneyness']", () => {
    expect([...VOLATILITY_XAXIS_VALUES]).toEqual(["strikes", "moneyness"]);
  });

  // 17. chain rejects empty symbol before fetching
  it("getOptionsChain throws OptionsValidationError on empty symbol without fetching", async () => {
    await expect(getOptionsChain({ symbol: "" })).rejects.toBeInstanceOf(
      OptionsValidationError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 18. flattenChainRow falls back to row.s when name field absent
  it("flattenChainRow falls back to row.s when 'name' missing from f[]", () => {
    const row = { s: "NASDAQ:AAPL260605C00185000", d: [185, "20260605", "call"] };
    const fields = ["strike", "expiration", "option-type"];
    const c = __internal.flattenChainRow(row, fields);
    expect(c.symbol).toBe("NASDAQ:AAPL260605C00185000");
    expect(c.strike).toBe(185);
    expect(c.type).toBe("call");
    expect(c.bid).toBeNull(); // missing column → null
  });

  // 19. in-time-iv tolerates absent real-ivs (returns empty points)
  it("getInTimeIv tolerates missing real-ivs", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    const out = await getInTimeIv({ symbol: "NASDAQ:AAPL" });
    expect(out.points).toEqual([]);
  });
});
