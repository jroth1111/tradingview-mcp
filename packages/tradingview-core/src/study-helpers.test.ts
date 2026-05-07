import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetBuiltinAliasCache,
  resolveStudyWireId,
} from "./study-helpers";
import {
  TRADINGVIEW_PINE_SCRIPT_WIRE_ID,
  TRADINGVIEW_PINE_STRATEGY_WIRE_ID,
  TRADINGVIEW_BASICSTUDIES_VERSION,
} from "./constants";

const mkResp = (body: any, init: { status?: number } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });

const LIST_BODY = [
  {
    scriptIdPart: "STD;Average%1Directional%1Index",
    scriptName: "Average Directional Index",
    extra: { shortDescription: "ADX" },
  },
  {
    scriptIdPart: "STD;Average_True_Range",
    scriptName: "Average True Range",
    extra: { shortDescription: "ATR" },
  },
  {
    scriptIdPart: "STD;Money_Flow",
    scriptName: "Money Flow Index",
    extra: { shortDescription: "MFI" },
  },
  {
    scriptIdPart: "STD;Willams_R",
    scriptName: "Williams Percent Range",
    extra: { shortDescription: "Williams %R" },
  },
];

const TRANSLATE_OK = {
  success: true,
  result: {
    ilTemplate: "ENC_IL",
    metaInfo: { is_strategy: false, pine: { version: "5.0" } },
  },
};

describe("resolveStudyWireId — friendly built-in aliases", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    __resetBuiltinAliasCache();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetBuiltinAliasCache();
  });

  const expectListFetch = (call: any) => {
    expect(String(call[0])).toContain(
      "pine-facade/list?filter=standard",
    );
  };

  it("ADX → STD;Average%1Directional%1Index via Pine flow", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(mkResp(TRANSLATE_OK));

    const out = await resolveStudyWireId("ADX");

    expect(out).toEqual({
      wireId: TRADINGVIEW_PINE_SCRIPT_WIRE_ID,
      version: "5.0",
      pineId: "STD;Average%1Directional%1Index",
    });
    expectListFetch(fetchMock.mock.calls[0]);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      encodeURIComponent("STD;Average%1Directional%1Index"),
    );
  });

  it("strips STD; prefix when caller passes the friendly form already prefixed (STD;ATR)", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(mkResp(TRANSLATE_OK));

    const out = await resolveStudyWireId("STD;ATR");

    expect(out.pineId).toBe("STD;Average_True_Range");
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      encodeURIComponent("STD;Average_True_Range"),
    );
  });

  it("Williams %R → STD;Willams_R (handles spaces and punctuation in friendly form)", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(mkResp(TRANSLATE_OK));

    const out = await resolveStudyWireId("Williams %R");

    expect(out.pineId).toBe("STD;Willams_R");
  });

  it("MFI → STD;Money_Flow (canonical id is not STD;MFI)", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(mkResp(TRANSLATE_OK));

    const out = await resolveStudyWireId("MFI");

    expect(out.pineId).toBe("STD;Money_Flow");
  });

  it("unknown name falls back to <bareId>@tv-basicstudies-<ver> when translate 404s", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(mkResp({ success: false }, { status: 404 }));

    const out = await resolveStudyWireId("NotARealIndicator");

    expect(out).toEqual({
      wireId: `NotARealIndicator@tv-basicstudies-${TRADINGVIEW_BASICSTUDIES_VERSION}`,
      version: TRADINGVIEW_BASICSTUDIES_VERSION,
    });
  });

  it("strategy from list resolves to StrategyScript wire id", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(
        mkResp({
          success: true,
          result: {
            ilTemplate: "ENC_IL_STRAT",
            metaInfo: { is_strategy: true, pine: { version: "1.0" } },
          },
        }),
      );

    const out = await resolveStudyWireId("ADX");

    expect(out.wireId).toBe(TRADINGVIEW_PINE_STRATEGY_WIRE_ID);
  });

  it("built-in strategy with isTVScriptStrategy=true resolves to StrategyScript wire id", async () => {
    // TV's built-in strategies (STD;Supertrend%Strategy, etc.) set
    // metaInfo.isTVScriptStrategy=true and leave is_strategy undefined.
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(
        mkResp({
          success: true,
          result: {
            ilTemplate: "ENC_IL_BUILTIN_STRAT",
            metaInfo: { isTVScriptStrategy: true, pine: { version: "7.0" } },
          },
        }),
      );

    const out = await resolveStudyWireId("ADX");

    expect(out.wireId).toBe(TRADINGVIEW_PINE_STRATEGY_WIRE_ID);
    expect(out.version).toBe("7.0");
  });

  it("memoises the list fetch across resolver calls", async () => {
    fetchMock
      .mockResolvedValueOnce(mkResp(LIST_BODY))
      .mockResolvedValueOnce(mkResp(TRANSLATE_OK))
      .mockResolvedValueOnce(mkResp(TRANSLATE_OK));

    await resolveStudyWireId("ADX");
    await resolveStudyWireId("ATR");

    const listCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("pine-facade/list"),
    );
    expect(listCalls).toHaveLength(1);
  });

  it("PUB; ids skip alias lookup entirely", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResp([{ version: "1.0" }]),
    );

    const out = await resolveStudyWireId("PUB;abc123");

    expect(out.wireId).toBe(TRADINGVIEW_PINE_SCRIPT_WIRE_ID);
    expect(out.pineId).toBe("PUB;abc123");
    const listCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("pine-facade/list"),
    );
    expect(listCalls).toHaveLength(0);
  });

  it("pre-qualified wire id (RSI@tv-basicstudies-265) passes through without any fetch", async () => {
    const out = await resolveStudyWireId("RSI@tv-basicstudies-265");

    expect(out).toEqual({
      wireId: "RSI@tv-basicstudies-265",
      version: "265",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
