import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addFavoriteDrawing,
  addFavoriteIndicator,
  addRecentStudyTemplate,
  deleteSavedScreen,
  getRawPrefs,
  listFavoriteDrawings,
  listFavoriteIndicators,
  listRecentStudyTemplates,
  listSavedScreens,
  removeFavoriteDrawing,
  removeFavoriteIndicator,
  saveScreen,
  type UserPrefsContext,
} from "./user-prefs";

const ctx: UserPrefsContext = { sessionId: "sid", sessionSign: "sign" };

const mkResponse = (body: any, init: { status?: number; statusText?: string } = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

// Find the latest call where /savesettings/ was invoked and parse the
// FormData delta back to an object so tests can assert merge correctness.
const lastSavedDelta = (fetchMock: ReturnType<typeof vi.fn>): any => {
  for (let i = fetchMock.mock.calls.length - 1; i >= 0; i--) {
    const [url, init] = fetchMock.mock.calls[i];
    if (String(url).includes("/savesettings/")) {
      const body = init?.body as FormData;
      const delta = body.get("delta");
      return JSON.parse(String(delta));
    }
  }
  throw new Error("no /savesettings/ call recorded");
};

const loadCallCount = (fetchMock: ReturnType<typeof vi.fn>): number =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/loadsettings/")).length;

const saveCallCount = (fetchMock: ReturnType<typeof vi.fn>): number =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/savesettings/")).length;

describe("user-prefs helpers", () => {
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

  // ---- 1. getRawPrefs passthrough ----
  it("getRawPrefs hits /loadsettings/ once and returns the nested settings tree", async () => {
    const tree = {
      chart: { favoriteLibraryIndicators: ["STD;RSI"] },
      StudyTemplates: { recent: [1, 2] },
      screener: { savedScreens: [] },
    };
    fetchMock.mockResolvedValueOnce(mkResponse(tree));
    const out = await getRawPrefs(ctx);
    expect(out).toEqual(tree);
    expect(loadCallCount(fetchMock)).toBe(1);
    expect(saveCallCount(fetchMock)).toBe(0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.tradingview.com/loadsettings/");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
  });

  // ---- 2. listFavoriteIndicators on empty / missing keys ----
  it("listFavoriteIndicators returns [] when chart key is absent", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    expect(await listFavoriteIndicators(ctx)).toEqual([]);
    fetchMock.mockResolvedValueOnce(mkResponse({ chart: {} }));
    expect(await listFavoriteIndicators(ctx)).toEqual([]);
  });

  it("listFavoriteIndicators returns a copy (mutation does not leak back)", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ chart: { favoriteLibraryIndicators: ["STD;RSI", "STD;MACD"] } }),
    );
    const out = await listFavoriteIndicators(ctx);
    expect(out).toEqual(["STD;RSI", "STD;MACD"]);
    out.push("STD;Stochastic");
    fetchMock.mockResolvedValueOnce(
      mkResponse({ chart: { favoriteLibraryIndicators: ["STD;RSI", "STD;MACD"] } }),
    );
    expect(await listFavoriteIndicators(ctx)).toEqual(["STD;RSI", "STD;MACD"]);
  });

  // ---- 3. addFavoriteIndicator round-trip merge ----
  it("addFavoriteIndicator loads, appends, and saves the merged delta", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ chart: { favoriteLibraryIndicators: ["STD;RSI"] } }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await addFavoriteIndicator(ctx, "STD;MACD");
    expect(out.favorites).toEqual(["STD;RSI", "STD;MACD"]);
    expect(loadCallCount(fetchMock)).toBe(1);
    expect(saveCallCount(fetchMock)).toBe(1);
    expect(lastSavedDelta(fetchMock)).toEqual({
      chart: { favoriteLibraryIndicators: ["STD;RSI", "STD;MACD"] },
    });
  });

  it("addFavoriteIndicator dedups when id already present (no duplicate insert)", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ chart: { favoriteLibraryIndicators: ["STD;RSI"] } }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await addFavoriteIndicator(ctx, "STD;RSI");
    expect(out.favorites).toEqual(["STD;RSI"]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      chart: { favoriteLibraryIndicators: ["STD;RSI"] },
    });
  });

  it("addFavoriteIndicator rejects empty / nullish ids before any fetch", async () => {
    await expect(addFavoriteIndicator(ctx, "")).rejects.toThrow(/id required/);
    await expect(addFavoriteIndicator(ctx, undefined as any)).rejects.toThrow(/id required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---- 4. removeFavoriteIndicator ----
  it("removeFavoriteIndicator filters by id and saves remainder", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        chart: { favoriteLibraryIndicators: ["STD;RSI", "STD;MACD", "STD;Stochastic"] },
      }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await removeFavoriteIndicator(ctx, "STD;MACD");
    expect(out.favorites).toEqual(["STD;RSI", "STD;Stochastic"]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      chart: { favoriteLibraryIndicators: ["STD;RSI", "STD;Stochastic"] },
    });
  });

  it("removeFavoriteIndicator on absent id leaves list unchanged", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ chart: { favoriteLibraryIndicators: ["STD;RSI"] } }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await removeFavoriteIndicator(ctx, "STD;Nope");
    expect(out.favorites).toEqual(["STD;RSI"]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      chart: { favoriteLibraryIndicators: ["STD;RSI"] },
    });
  });

  // ---- 5. Drawing favorites parity ----
  it("listFavoriteDrawings + addFavoriteDrawing target chart.favoriteDrawingTools", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    expect(await listFavoriteDrawings(ctx)).toEqual([]);

    fetchMock.mockResolvedValueOnce(
      mkResponse({ chart: { favoriteDrawingTools: ["LineToolTrendLine"] } }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await addFavoriteDrawing(ctx, "LineToolHorzLine");
    expect(out.favorites).toEqual(["LineToolTrendLine", "LineToolHorzLine"]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      chart: { favoriteDrawingTools: ["LineToolTrendLine", "LineToolHorzLine"] },
    });
  });

  it("removeFavoriteDrawing strips a tool and persists remainder", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        chart: { favoriteDrawingTools: ["LineToolTrendLine", "LineToolHorzLine"] },
      }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await removeFavoriteDrawing(ctx, "LineToolTrendLine");
    expect(out.favorites).toEqual(["LineToolHorzLine"]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      chart: { favoriteDrawingTools: ["LineToolHorzLine"] },
    });
  });

  // ---- 6. Recents capacity-5 + MRU dedup ----
  it("addRecentStudyTemplate prepends and dedups, capping at 5 entries", async () => {
    // Existing recents (newest-first): [10, 9, 8, 7, 6]; pushing 9 should
    // move 9 to front and re-cap at 5: [9, 10, 8, 7, 6].
    fetchMock.mockResolvedValueOnce(
      mkResponse({ StudyTemplates: { recent: [10, 9, 8, 7, 6] } }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await addRecentStudyTemplate(ctx, 9);
    expect(out.recents).toEqual([9, 10, 8, 7, 6]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      StudyTemplates: { recent: [9, 10, 8, 7, 6] },
    });
  });

  it("addRecentStudyTemplate trims excess to capacity 5 when adding fresh id", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ StudyTemplates: { recent: [10, 9, 8, 7, 6] } }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await addRecentStudyTemplate(ctx, 42);
    expect(out.recents).toEqual([42, 10, 9, 8, 7]);
    expect(out.recents).toHaveLength(5);
    expect(lastSavedDelta(fetchMock)).toEqual({
      StudyTemplates: { recent: [42, 10, 9, 8, 7] },
    });
  });

  it("addRecentStudyTemplate seeds list when no prior recents exist", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await addRecentStudyTemplate(ctx, "tpl-1");
    expect(out.recents).toEqual(["tpl-1"]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      StudyTemplates: { recent: ["tpl-1"] },
    });
  });

  it("listRecentStudyTemplates returns [] when StudyTemplates key absent", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    expect(await listRecentStudyTemplates(ctx)).toEqual([]);
  });

  // ---- 7. Saved screens lead path ----
  it("listSavedScreens reads screener.savedScreens (LEAD path)", async () => {
    const screens = [{ name: "earnings_today", market: "america" }];
    fetchMock.mockResolvedValueOnce(mkResponse({ screener: { savedScreens: screens } }));
    expect(await listSavedScreens(ctx)).toEqual(screens);
  });

  it("saveScreen replaces by name and persists merged screener tree", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        screener: {
          savedScreens: [
            { name: "earnings_today", market: "america", columns: ["close"] },
            { name: "ipo_calendar", market: "america" },
          ],
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await saveScreen(ctx, {
      name: "earnings_today",
      market: "global",
      columns: ["name", "close", "change"],
      filter: [{ left: "type", operation: "equal", right: "stock" }],
    });
    expect(out.screens).toHaveLength(2);
    const replaced = out.screens.find((s) => s.name === "earnings_today");
    expect(replaced).toMatchObject({
      name: "earnings_today",
      market: "global",
      columns: ["name", "close", "change"],
    });
    expect(replaced?.filter).toEqual([
      { left: "type", operation: "equal", right: "stock" },
    ]);
    const delta = lastSavedDelta(fetchMock);
    expect(delta.screener.savedScreens).toHaveLength(2);
    expect(delta.screener.savedScreens.find((s: any) => s.name === "ipo_calendar")).toMatchObject({
      name: "ipo_calendar",
      market: "america",
    });
  });

  it("saveScreen rejects empty name without hitting upstream", async () => {
    await expect(
      saveScreen(ctx, { name: "" } as any),
    ).rejects.toThrow(/name required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deleteSavedScreen drops by name and persists remainder", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        screener: {
          savedScreens: [
            { name: "earnings_today" },
            { name: "ipo_calendar" },
          ],
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    const out = await deleteSavedScreen(ctx, "earnings_today");
    expect(out.screens).toEqual([{ name: "ipo_calendar" }]);
    expect(lastSavedDelta(fetchMock)).toEqual({
      screener: { savedScreens: [{ name: "ipo_calendar" }] },
    });
  });

  // ---- 8. /savesettings/ wire shape (FormData with delta=JSON) ----
  it("saves use FormData body with `delta` JSON-stringified — matches recon §10 wire shape", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    await addFavoriteIndicator(ctx, "STD;ATR");
    const saveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/savesettings/"));
    expect(saveCall).toBeDefined();
    const [url, init] = saveCall!;
    expect(String(url)).toBe("https://www.tradingview.com/savesettings/");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const fd = init?.body as FormData;
    const delta = JSON.parse(String(fd.get("delta")));
    expect(delta).toEqual({ chart: { favoriteLibraryIndicators: ["STD;ATR"] } });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    // FormData sets its own multipart content-type; we should NOT override it.
    expect(headers["content-type"]).toBeUndefined();
  });

  // ---- 9. Settings envelope shape variants ----
  it("unwraps {settings:{…}} envelope variant from /loadsettings/", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ settings: { chart: { favoriteLibraryIndicators: ["STD;A"] } } }),
    );
    expect(await listFavoriteIndicators(ctx)).toEqual(["STD;A"]);
  });

  it("treats null/empty /loadsettings/ response as fresh prefs (no crash)", async () => {
    // Empty body → loadSettings returns {} per templates.ts readJson.
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200, statusText: "OK" }));
    expect(await listFavoriteIndicators(ctx)).toEqual([]);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200, statusText: "OK" }));
    expect(await listRecentStudyTemplates(ctx)).toEqual([]);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200, statusText: "OK" }));
    expect(await listSavedScreens(ctx)).toEqual([]);
  });

  // ---- 10. cookie-without-sign parity ----
  it("emits cookie header without sessionid_sign when sign is absent", async () => {
    fetchMock.mockResolvedValueOnce(mkResponse({}));
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    await addFavoriteIndicator({ sessionId: "lonely" }, "STD;X");
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1]?.headers ?? {}) as Record<string, string>;
      expect(headers.cookie).toBe("sessionid=lonely");
    }
  });

  // ---- 11. namespace isolation: each helper only writes its own namespace ----
  it("addFavoriteIndicator delta does not include unrelated StudyTemplates/screener keys", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({
        chart: { favoriteLibraryIndicators: [] },
        StudyTemplates: { recent: [1, 2, 3] },
        screener: { savedScreens: [{ name: "keep" }] },
      }),
    );
    fetchMock.mockResolvedValueOnce(mkResponse({ status: "ok" }));
    await addFavoriteIndicator(ctx, "STD;NEW");
    const delta = lastSavedDelta(fetchMock);
    expect(Object.keys(delta)).toEqual(["chart"]);
    expect(delta.StudyTemplates).toBeUndefined();
    expect(delta.screener).toBeUndefined();
  });

  // ---- 12. surfaces upstream errors (does not swallow) ----
  it("surfaces 401 from /loadsettings/ and skips the save call", async () => {
    fetchMock.mockResolvedValueOnce(
      mkResponse({ detail: "auth" }, { status: 401, statusText: "Unauthorized" }),
    );
    await expect(addFavoriteIndicator(ctx, "STD;X")).rejects.toThrow(
      /GET \/loadsettings\/ failed: 401/,
    );
    expect(saveCallCount(fetchMock)).toBe(0);
  });
});
