import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listLineTools,
  listLineToolTemplates,
  loadLineToolTemplate,
  saveLineToolTemplate,
  deleteLineToolTemplate,
  isDrawingTool,
  LINE_TOOLS,
  type LineToolCallContext,
} from "./line-tools";

const ctx: LineToolCallContext = { sessionId: "sid", sessionSign: "sign" };
const ctxNoSign: LineToolCallContext = { sessionId: "sid-only" };

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

describe("line-tools helpers (P19)", () => {
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

  // -------- 1. listLineTools (static enum) --------

  it("listLineTools returns the static drawing-tool enum verbatim", () => {
    const out = listLineTools();
    expect(out.tools).toBe(LINE_TOOLS);
    expect(out.tools).toContain("LineToolTrendLine");
    expect(out.tools).toContain("LineToolFibRetracement");
    expect(out.tools).toContain("LineToolPitchfork");
    expect(out.tools).toContain("LineToolElliottWave1");
    expect(out.tools).toContain("LineToolAnchoredVWAP");
    expect(out.tools).toContain("LineToolCrossLine");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------- 2. tool enum exhaustiveness against bead spec --------

  it("LINE_TOOLS exhaustively covers the tradingview-34p tool spec", () => {
    // Must cover every tool listed in the bead spec, including all
    // Elliott waves 1-5, both Fib spiral/circles/timezone, Schiff
    // variants, and the high-frequency drawing primitives.
    const required = [
      "LineToolTrendLine",
      "LineToolHorzLine",
      "LineToolHorzRay",
      "LineToolVertLine",
      "LineToolFibRetracement",
      "LineToolFibExtension",
      "LineToolFibChannel",
      "LineToolFibSpiral",
      "LineToolFibTimeZone",
      "LineToolFibCircles",
      "LineToolPitchfork",
      "LineToolGannFan",
      "LineToolGannSquare",
      "LineToolGannBox",
      "LineToolElliottWave1",
      "LineToolElliottWave2",
      "LineToolElliottWave3",
      "LineToolElliottWave4",
      "LineToolElliottWave5",
      "LineToolElliottCorrection",
      "LineToolElliottTriangle",
      "LineToolElliottDoubleCombo",
      "LineToolElliottTripleCombo",
      "LineToolText",
      "LineToolNote",
      "LineToolArrow",
      "LineToolRectangle",
      "LineToolEllipse",
      "LineToolCircle",
      "LineToolTriangle",
      "LineToolPath",
      "LineToolPolyline",
      "LineToolBrush",
      "LineToolBalloon",
      "LineToolPriceRange",
      "LineToolDateRange",
      "LineToolDateAndPriceRange",
      "LineToolPriceLabel",
      "LineToolFlag",
      "LineToolSignpost",
      "LineToolEmoji",
      "LineToolImage",
      "LineToolCallout",
      "LineToolAnchoredVWAP",
      "LineToolAnchoredText",
      "LineToolMeasure",
      "LineToolSchiffPitchfork",
      "LineToolModifiedSchiffPitchfork",
      "LineToolInsidePitchfork",
      "LineToolHeadAndShoulders",
      "LineToolThreeDrivers",
      "LineToolDisjointAngle",
      "LineToolFlatTopBottom",
      "LineToolBarsPattern",
      "LineToolGhostFeed",
      "LineToolPriceNote",
      "LineToolHighlighter",
      "LineToolCrossLine",
    ];
    for (const tool of required) {
      expect(isDrawingTool(tool), `missing tool: ${tool}`).toBe(true);
    }
    expect(LINE_TOOLS.length).toBeGreaterThanOrEqual(required.length);
  });

  it("isDrawingTool rejects unknown identifiers", () => {
    expect(isDrawingTool("LineToolTrendLine")).toBe(true);
    expect(isDrawingTool("LineToolBogus")).toBe(false);
    expect(isDrawingTool("")).toBe(false);
    expect(isDrawingTool("trendline")).toBe(false);
  });

  // -------- 3. listLineToolTemplates --------

  it("listLineToolTemplates GETs /list-drawing-templates/?tool= with cookie auth and parses JSON", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse(["MyDefault", "Wide"]));
    const out = await listLineToolTemplates(ctx, "LineToolTrendLine");
    expect(out).toEqual(["MyDefault", "Wide"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/list-drawing-templates/?tool=LineToolTrendLine",
    );
    expect(init?.method ?? "GET").toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  it("listLineToolTemplates omits sessionid_sign when only sessionId is present", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse([]));
    await listLineToolTemplates(ctxNoSign, "LineToolFibRetracement");
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid-only");
    expect(headers.cookie).not.toContain("sessionid_sign");
  });

  it("listLineToolTemplates rejects unknown tools without performing a fetch", async () => {
    await expect(listLineToolTemplates(ctx, "LineToolNotReal")).rejects.toThrow(
      /unknown drawing tool/,
    );
    await expect(listLineToolTemplates(ctx, "")).rejects.toThrow(/tool required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listLineToolTemplates surfaces upstream 500 with status detail", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse("upstream busted", { status: 500, statusText: "Server Error" }),
    );
    await expect(
      listLineToolTemplates(ctx, "LineToolPitchfork"),
    ).rejects.toThrow(/500 Server Error.*upstream busted/);
  });

  // -------- 4. loadLineToolTemplate --------

  it("loadLineToolTemplate GETs /load-drawing-template/?tool=&templateName= and url-encodes both params", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ payload: JSON.stringify({ color: "#fff", linewidth: 2 }) }),
    );
    const out = await loadLineToolTemplate(ctx, "LineToolTrendLine", "My Template/2");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.tradingview.com/load-drawing-template/" +
        "?tool=LineToolTrendLine&templateName=My%20Template%2F2",
    );
    // payload string is parsed into structured content
    expect(out.content).toEqual({ color: "#fff", linewidth: 2 });
  });

  it("loadLineToolTemplate falls back to raw payload if upstream returns a non-JSON string", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ payload: "not-json-data" }));
    const out = await loadLineToolTemplate(ctx, "LineToolHorzLine", "Default");
    expect(out.content).toBe("not-json-data");
  });

  it("loadLineToolTemplate requires tool and templateName", async () => {
    await expect(
      loadLineToolTemplate(ctx, "LineToolTrendLine", ""),
    ).rejects.toThrow(/templateName required/);
    await expect(
      loadLineToolTemplate(ctx, "" as any, "x"),
    ).rejects.toThrow(/tool required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------- 5. saveLineToolTemplate (FormData encoding) --------

  it("saveLineToolTemplate POSTs FormData(tool,name,content) to /save-drawing-template/", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ok: true }));
    const out = await saveLineToolTemplate(ctx, {
      tool: "LineToolTrendLine",
      name: "alpha",
      content: { color: "#fff", linewidth: 3 },
    });
    expect(out).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.tradingview.com/save-drawing-template/");
    expect(init?.method).toBe("POST");

    // FormData encoding assertion: body must be a FormData instance, not
    // a JSON string, and must carry exactly the three fields stamped by
    // the bundle-confirmed save surface.
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("tool")).toBe("LineToolTrendLine");
    expect(body.get("name")).toBe("alpha");
    expect(body.get("content")).toBe(JSON.stringify({ color: "#fff", linewidth: 3 }));

    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    // Don't override content-type — fetch must auto-set the multipart boundary.
    expect(headers["content-type"]).toBeUndefined();
  });

  it("saveLineToolTemplate accepts a pre-stringified content payload without re-encoding", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ok: true }));
    const stringified = '{"already":"stringified"}';
    await saveLineToolTemplate(ctx, {
      tool: "LineToolFibRetracement",
      name: "preset",
      content: stringified,
    });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("content")).toBe(stringified);
    expect(body.get("tool")).toBe("LineToolFibRetracement");
  });

  it("saveLineToolTemplate validates tool and name and never touches the network on bad input", async () => {
    await expect(
      saveLineToolTemplate(ctx, { tool: "Bogus", name: "x", content: {} }),
    ).rejects.toThrow(/unknown drawing tool/);
    await expect(
      saveLineToolTemplate(ctx, { tool: "LineToolTrendLine", name: "", content: {} }),
    ).rejects.toThrow(/name required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------- 6. deleteLineToolTemplate (FormData encoding) --------

  it("deleteLineToolTemplate POSTs FormData(tool,name) to /remove-drawing-template/", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({ ok: true }));
    const out = await deleteLineToolTemplate(ctx, "LineToolPitchfork", "wide-blue");
    expect(out).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.tradingview.com/remove-drawing-template/");
    expect(init?.method).toBe("POST");

    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("tool")).toBe("LineToolPitchfork");
    expect(body.get("name")).toBe("wide-blue");
    expect(body.get("content")).toBeNull();

    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("deleteLineToolTemplate validates tool and name", async () => {
    await expect(
      deleteLineToolTemplate(ctx, "LineToolBogus", "x"),
    ).rejects.toThrow(/unknown drawing tool/);
    await expect(
      deleteLineToolTemplate(ctx, "LineToolTrendLine", ""),
    ).rejects.toThrow(/name required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deleteLineToolTemplate surfaces upstream 403 with body detail", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ detail: "Forbidden" }, { status: 403, statusText: "Forbidden" }),
    );
    await expect(
      deleteLineToolTemplate(ctx, "LineToolTrendLine", "shared-default"),
    ).rejects.toThrow(/403 Forbidden/);
  });
});
