import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compilePine, runPine } from "./pine";
import * as tv from "./tradingview";

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

describe("compilePine", () => {
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

  it("light mode hits translate_light with pine_id and pine_version", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: true,
        ilTemplate: "IL_LIGHT",
        metaInfo: { scriptIdPart: "PUB;abc", pine: { version: "v5" } },
      }),
    );

    const out = await compilePine({ pineId: "PUB;abc", version: "v5" });
    expect(out.success).toBe(true);
    expect(out.mode).toBe("light");
    expect(out.ilTemplate).toBe("IL_LIGHT");
    expect(out.pineId).toBe("PUB;abc");
    expect(out.pineVersion).toBe("v5");
    expect(out.errors).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/translate_light/?pine_id=PUB%3Babc&pine_version=v5",
    );
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("light mode forwards session cookie when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ success: true, ilTemplate: "IL", metaInfo: {} }),
    );
    await compilePine({
      pineId: "USER;xyz",
      sessionId: "sid",
      sessionSign: "sign",
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  it("full mode posts form-encoded source to translate_source/<version>?is_pine_ex=true", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: true,
        pineId: "USER;new123",
        pineVersion: "v5",
        ilTemplate: "IL_FULL",
        metaInfo: { foo: "bar" },
        warnings: [],
      }),
    );

    const out = await compilePine({
      source: "//@version=5\nindicator('x')\nplot(close)",
      version: "v5",
      mode: "full",
    });
    expect(out.success).toBe(true);
    expect(out.mode).toBe("full");
    expect(out.pineId).toBe("USER;new123");
    expect(out.pineVersion).toBe("v5");
    expect(out.ilTemplate).toBe("IL_FULL");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/translate_source/v5?is_pine_ex=true",
    );
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const body = String(init?.body);
    const parsed = new URLSearchParams(body);
    expect(parsed.get("source")).toBe("//@version=5\nindicator('x')\nplot(close)");
  });

  it("eval mode posts JSON to eval_pine_ex/", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: true,
        result: {
          rootValues: { close: [1, 2, 3] },
          errors: [],
          warnings: [],
        },
      }),
    );

    const out = await compilePine({
      source: "//@version=5\nindicator('e')\nplot(close)",
      mode: "eval",
      inputs: { in_0: 14 },
    });
    expect(out.success).toBe(true);
    expect(out.mode).toBe("eval");
    expect(out.rootValues).toEqual({ close: [1, 2, 3] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/eval_pine_ex/",
    );
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body.source).toBe("//@version=5\nindicator('e')\nplot(close)");
    expect(body.version).toBe("v5");
    expect(body.inputs).toEqual({ in_0: 14 });
  });

  it("auto-resolves mode: pineId -> light", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ success: true, ilTemplate: "IL" }));
    const out = await compilePine({ pineId: "PUB;abc" });
    expect(out.mode).toBe("light");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/pine-facade/translate_light/");
  });

  it("auto-resolves mode: source -> full", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ success: true, pineId: "USER;new", ilTemplate: "IL" }),
    );
    const out = await compilePine({ source: "//@version=5\nindicator('a')\nplot(close)" });
    expect(out.mode).toBe("full");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/pine-facade/translate_source/");
  });

  it("normalizes upstream errors:[{start:{line,column},message}] into {message,line,column}", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: false,
        errors: [
          { start: { line: 7, column: 12 }, end: { line: 7, column: 20 }, message: "Mismatched type" },
        ],
        warnings: [
          { start: { line: 3, column: 1 }, message: "Unused variable" },
        ],
      }),
    );

    const out = await compilePine({ source: "bogus", mode: "full" });
    expect(out.success).toBe(false);
    expect(out.errors).toEqual([{ message: "Mismatched type", line: 7, column: 12 }]);
    expect(out.warnings).toEqual([{ message: "Unused variable", line: 3, column: 1 }]);
  });

  it("normalizes upstream `reason` string into errors", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: false,
        reason: "Syntax error at line 4, column 8",
      }),
    );

    const out = await compilePine({ source: "broken", mode: "full" });
    expect(out.success).toBe(false);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].message).toBe("Syntax error at line 4, column 8");
    expect(out.errors[0].line).toBe(4);
    expect(out.errors[0].column).toBe(8);
  });

  it("normalizes upstream `reason2` field into errors", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: false,
        reason2: { message: "Authorization required", line: 1 },
      }),
    );

    const out = await compilePine({ pineId: "PUB;forbidden" });
    expect(out.success).toBe(false);
    expect(out.errors).toEqual([{ message: "Authorization required", line: 1 }]);
  });

  it("throws 'source or pineId required' when neither is provided", async () => {
    await expect(compilePine({})).rejects.toThrow("source or pineId required");
  });

  it("throws on non-2xx upstream response", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({}, { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(compilePine({ pineId: "PUB;abc" })).rejects.toThrow(
      "translate_light failed: 500 Internal Server Error",
    );
  });
});

describe("runPine", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;
  let runStudySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    runStudySpy = vi.spyOn(tv, "runStudy");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    runStudySpy.mockRestore();
  });

  const studyResult: tv.StudyResult = {
    symbol: "BINANCE:BTCUSDT",
    studyId: "USER;new123",
    studyVersion: "v5",
    wireId: "Script$USER;new123@tv-scripting-101!",
    timeframe: "60",
    bars: 300,
    plots: [],
  };

  it("source path: full-compiles, then dispatches runStudy with returned pineId", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: true,
        pineId: "USER;new123",
        pineVersion: "v5",
        ilTemplate: "IL",
        metaInfo: {},
      }),
    );
    runStudySpy.mockResolvedValueOnce(studyResult);

    const out = await runPine({
      symbol: "BINANCE:BTCUSDT",
      source: "//@version=5\nindicator('x')\nplot(close)",
      timeframe: "60",
      bars: 300,
      params: { length: 14 },
    });

    expect(out.compile.mode).toBe("full");
    expect(out.compile.pineId).toBe("USER;new123");
    expect(out.result).toEqual(studyResult);
    expect(runStudySpy).toHaveBeenCalledTimes(1);
    expect(runStudySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "BINANCE:BTCUSDT",
        studyId: "USER;new123",
        timeframe: "60",
        bars: 300,
        params: { length: 14 },
      }),
    );
  });

  it("pineId path: light-compiles for metaInfo, then dispatches runStudy with the pineId", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: true,
        ilTemplate: "IL_LIGHT",
        metaInfo: { scriptIdPart: "PUB;abc", inputs: [{ id: "in_0", name: "Length", defval: 14 }] },
      }),
    );
    runStudySpy.mockResolvedValueOnce({ ...studyResult, studyId: "PUB;abc" });

    const out = await runPine({
      symbol: "BINANCE:BTCUSDT",
      pineId: "PUB;abc",
    });

    expect(out.compile.mode).toBe("light");
    expect(out.compile.metaInfo?.inputs?.[0]?.name).toBe("Length");
    expect(runStudySpy).toHaveBeenCalledWith(
      expect.objectContaining({ studyId: "PUB;abc", symbol: "BINANCE:BTCUSDT" }),
    );

    // Confirm the light translate URL was the one fetched
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/pine-facade/translate_light/");
    expect(String(url)).toContain("pine_id=PUB%3Babc");
  });

  it("throws when compile fails, attaches compile result on the error", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        success: false,
        errors: [{ start: { line: 2, column: 5 }, message: "Unexpected token" }],
      }),
    );

    let caught: any = null;
    try {
      await runPine({
        symbol: "BINANCE:BTCUSDT",
        source: "//@version=5\nbroken",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught.message)).toContain("Unexpected token");
    expect(caught.compile).toBeDefined();
    expect(caught.compile.success).toBe(false);
    expect(caught.compile.errors[0]).toEqual({
      message: "Unexpected token",
      line: 2,
      column: 5,
    });
    expect(runStudySpy).not.toHaveBeenCalled();
  });

  it("throws 'source or pineId required' when both are missing", async () => {
    await expect(runPine({ symbol: "BINANCE:BTCUSDT" })).rejects.toThrow(
      "source or pineId required",
    );
  });
});
