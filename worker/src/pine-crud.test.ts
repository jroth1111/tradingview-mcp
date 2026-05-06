import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyPineScript,
  convertPineScript,
  deletePineScript,
  genPineAlert,
  getScriptInfo,
  getVersionsAll,
  getVersionsLast,
  isAuthToGet,
  isAllowedFilter,
  listPineScripts,
  normalizeEnvelope,
  parsePineTitle,
  publishPineScript,
  renamePineScript,
  savePineScript,
  translateLightSource,
} from "./pine-crud";

const ctx = { sessionId: "sid", sessionSign: "sign" };

const jsonResponse = (
  body: any,
  init: { status?: number; statusText?: string } = {},
): Response =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });

const textResponse = (
  body: string,
  init: { status?: number; statusText?: string } = {},
): Response =>
  new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "content-type": "text/plain" },
  });

const expectCookie = (init: any) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
};

describe("pine-crud", () => {
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

  // ---------------------------------------------------------------------
  // GET endpoints
  // ---------------------------------------------------------------------

  it("getScriptInfo: passes pine_id query and forwards cookie auth", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        userId: 12345,
        userName: "alice",
        chartImageUrl: "https://example/chart.png",
      }),
    );
    const out = await getScriptInfo(ctx, "PUB;abc");
    expect(out.userId).toBe(12345);
    expect(out.userName).toBe("alice");
    expect(out.chartImageUrl).toBe("https://example/chart.png");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/get_script_info/?pine_id=PUB%3Babc",
    );
    expect(init?.method ?? "GET").toBe("GET");
    expectCookie(init);
  });

  it("getVersionsLast: parses single-element [{version,created}] array", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ created: 1700000000, version: "5.0" }]),
    );
    const out = await getVersionsLast(ctx, "PUB;abc");
    expect(out.version).toBe("5.0");
    expect(out.created).toBe(1700000000);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/versions/PUB%3Babc/last",
    );
  });

  it("getVersionsAll: returns full list when 200; falls back to /last on 404", async () => {
    // 200 path
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { created: 1700000000, version: "5.0" },
        { created: 1701000000, version: "6.0" },
      ]),
    );
    const all = await getVersionsAll(ctx, "PUB;abc");
    expect(all).toEqual([
      { version: "5.0", created: 1700000000 },
      { version: "6.0", created: 1701000000 },
    ]);

    // 404 path -> falls back to /last
    fetchMock.mockResolvedValueOnce(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ created: 1702000000, version: "7.0" }]),
    );
    const fallback = await getVersionsAll(ctx, "USER;xyz");
    expect(fallback).toEqual([{ version: "7.0", created: 1702000000 }]);
    // Calls: [0] /all (success), [1] /all (404), [2] /last (fallback)
    expect(fetchMock.mock.calls).toHaveLength(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/pine-facade/versions/USER%3Bxyz/all",
    );
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "/pine-facade/versions/USER%3Bxyz/last",
    );
  });

  it("isAuthToGet: parses 'true' / 'false' text/plain responses", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("true"));
    const yes = await isAuthToGet(ctx, "PUB;abc", "5.0");
    expect(yes.authorized).toBe(true);

    fetchMock.mockResolvedValueOnce(textResponse("false\n"));
    const no = await isAuthToGet(ctx, "PUB;abc", "5.0");
    expect(no.authorized).toBe(false);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/is_auth_to_get/PUB%3Babc/5.0",
    );
  });

  it("listPineScripts: rejects filter not in allowlist", async () => {
    await expect(listPineScripts(ctx, "imported")).rejects.toMatchObject({
      status: 400,
      code: "filter_not_allowed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("listPineScripts: passes allowlisted filter and maps response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          scriptName: "RSI",
          scriptIdPart: "STD;RSI",
          userId: -1,
          version: "1.0",
          scriptAccess: "public",
          extra: { kind: "study" },
          lastVersionMaj: 1,
        },
      ]),
    );
    const items = await listPineScripts(ctx, "standard");
    expect(items).toHaveLength(1);
    expect(items[0].scriptName).toBe("RSI");
    expect(items[0].scriptIdPart).toBe("STD;RSI");
    expect(items[0].extra?.kind).toBe("study");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/list?filter=standard",
    );
  });

  it("isAllowedFilter: only the recon §1 set passes", () => {
    for (const ok of ["standard", "candlestick", "fundamental", "saved", "favorites", "public", "recent"]) {
      expect(isAllowedFilter(ok)).toBe(true);
    }
    for (const bad of ["imported", "private", "all", "", "SAVED"]) {
      expect(isAllowedFilter(bad)).toBe(false);
    }
  });

  // ---------------------------------------------------------------------
  // POST endpoints — save / publish / delete / rename / copy / convert / parse_title / gen_alert
  // ---------------------------------------------------------------------

  it("savePineScript new: name + allow_overwrite query, form-encoded source body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, scriptIdPart: "USER;new1", version: "1.0" }),
    );
    const out = await savePineScript(ctx, {
      mode: "new",
      name: "Hello",
      source: "//@version=5\nindicator('Hello')\nplot(close)",
      allowOverwrite: false,
    });
    expect(out.success).toBe(true);
    expect(out.scriptIdPart).toBe("USER;new1");
    expect(out.version).toBe("1.0");
    expect(out.errors).toEqual([]);

    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/pine-facade/save/new");
    expect(u.searchParams.get("name")).toBe("Hello");
    expect(u.searchParams.get("allow_overwrite")).toBe("false");
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    const parsed = new URLSearchParams(String(init?.body));
    expect(parsed.get("source")).toBe("//@version=5\nindicator('Hello')\nplot(close)");
  });

  it("savePineScript next: encodes id in path and forwards allow_create_new", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, version: "2.0" }));
    await savePineScript(ctx, {
      mode: "next",
      id: "USER;abc",
      source: "//@version=5\n",
      allowCreateNew: true,
      name: "Renamed",
    });
    const [url] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/pine-facade/save/next/USER%3Babc");
    expect(u.searchParams.get("allow_create_new")).toBe("true");
    expect(u.searchParams.get("name")).toBe("Renamed");
  });

  it("savePineScript new_draft + next_draft hit the right paths", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    await savePineScript(ctx, {
      mode: "new_draft",
      source: "//@version=5\n",
      allowUseExistingDraft: true,
    });
    let url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/pine-facade/save/new_draft");
    expect(url).toContain("allow_use_existing_draft=true");

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    await savePineScript(ctx, {
      mode: "next_draft",
      id: "USER;d1",
      source: "//@version=5\n",
    });
    url = String(fetchMock.mock.calls[1][0]);
    expect(url).toContain("/pine-facade/save/next_draft/USER%3Bd1");

    // Required-field validation
    await expect(
      savePineScript(ctx, { mode: "new", source: "x" } as any),
    ).rejects.toThrow("name required for save/new");
    await expect(
      savePineScript(ctx, { mode: "next", source: "x" } as any),
    ).rejects.toThrow("id required for save/next");
  });

  it("publishPineScript new: posts to publish/new/ with access query and extra JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, scriptIdPart: "PUB;new1", version: "1.0" }),
    );
    const out = await publishPineScript(ctx, {
      mode: "new",
      source: "//@version=5\n",
      access: "open",
      extra: { originalScriptId: "USER;abc", originalScriptVersion: "1.0" },
    });
    expect(out.success).toBe(true);
    expect(out.scriptIdPart).toBe("PUB;new1");
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.pathname).toBe("/pine-facade/publish/new/");
    expect(u.searchParams.get("access")).toBe("open");
    const parsed = new URLSearchParams(String(init?.body));
    expect(parsed.get("source")).toBe("//@version=5\n");
    expect(JSON.parse(parsed.get("extra")!)).toEqual({
      originalScriptId: "USER;abc",
      originalScriptVersion: "1.0",
    });
  });

  it("publishPineScript next: requires id and encodes it in path", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    await publishPineScript(ctx, {
      mode: "next",
      id: "PUB;v1",
      source: "//@version=5\n",
    });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/pine-facade/publish/next/PUB%3Bv1");

    await expect(
      publishPineScript(ctx, { mode: "next", source: "x" } as any),
    ).rejects.toThrow("id required for publish/next");
  });

  it("deletePineScript / renamePineScript / copyPineScript hit correct paths and forms", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    await deletePineScript(ctx, "USER;abc");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/pine-facade/delete/USER%3Babc",
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    await renamePineScript(ctx, { id: "USER;abc", name: "Renamed", force: true });
    const renameUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(renameUrl.pathname).toBe("/pine-facade/rename/USER%3Babc");
    expect(renameUrl.searchParams.get("name")).toBe("Renamed");
    expect(renameUrl.searchParams.get("force")).toBe("true");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, scriptIdPart: "USER;copy1" }),
    );
    const copy = await copyPineScript(ctx, { id: "USER;abc", name: "Copy of A" });
    expect(copy.scriptIdPart).toBe("USER;copy1");
    const copyUrl = new URL(String(fetchMock.mock.calls[2][0]));
    expect(copyUrl.pathname).toBe("/pine-facade/copy/USER%3Babc");
    expect(copyUrl.searchParams.get("name")).toBe("Copy of A");
  });

  it("convertPineScript: posts source + version_to to /convert", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, source: "//@version=6\n" }),
    );
    const out = await convertPineScript(ctx, {
      source: "//@version=5\n",
      version_to: "6",
    });
    expect(out.success).toBe(true);
    expect(out.source).toBe("//@version=6\n");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://pine-facade.tradingview.com/pine-facade/convert");
    const parsed = new URLSearchParams(String(init?.body));
    expect(parsed.get("source")).toBe("//@version=5\n");
    expect(parsed.get("version_to")).toBe("6");
  });

  it("parsePineTitle: extracts title from result envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: { title: "RSI", shortTitle: "RSI", scriptKind: "study" },
      }),
    );
    const out = await parsePineTitle(ctx, "//@version=5\nindicator('RSI')\nplot(close)");
    expect(out.success).toBe(true);
    expect(out.title).toBe("RSI");
    expect(out.shortTitle).toBe("RSI");
    expect(out.scriptKind).toBe("study");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/parse_title",
    );
    const parsed = new URLSearchParams(String(init?.body));
    expect(parsed.get("source")).toBe("//@version=5\nindicator('RSI')\nplot(close)");
  });

  it("translateLightSource: encodes id + version into path", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        result: { source: "//@version=5\n", metaInfo: { foo: "bar" } },
      }),
    );
    const out = await translateLightSource(ctx, "PUB;abc", "5.0");
    expect(out.success).toBe(true);
    expect(out.source).toBe("//@version=5\n");
    expect(out.metaInfo).toEqual({ foo: "bar" });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/translate-light-source/PUB%3Babc/5.0",
    );
  });

  it("genPineAlert: posts JSON with alert_info / source / inputs", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ alert_info: { id: "alert-x", studyKey: "k" } }),
    );
    const out = await genPineAlert(ctx, {
      alert_info: { fields: { study: "Script$PUB;abc@tv-scripting-101!" } },
      inputs: { in_0: 14 },
    });
    expect(out.success).toBe(true);
    expect(out.alert_info).toEqual({ id: "alert-x", studyKey: "k" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://pine-facade.tradingview.com/pine-facade/gen_alert/",
    );
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.cookie).toBe("sessionid=sid;sessionid_sign=sign");
    const body = JSON.parse(String(init?.body));
    expect(body.alert_info.fields.study).toBe(
      "Script$PUB;abc@tv-scripting-101!",
    );
    expect(body.inputs).toEqual({ in_0: 14 });
  });

  // ---------------------------------------------------------------------
  // Error-envelope normalization
  // ---------------------------------------------------------------------

  it("normalizeEnvelope: flattens TV {success:false, reason2:{errors[],warnings[]}}", () => {
    const env = normalizeEnvelope({
      success: false,
      reason: "compile_error",
      reason2: {
        errors: [
          {
            message: "Mismatched type",
            start: { line: 7, column: 12 },
            end: { line: 7, column: 20 },
          },
        ],
        warnings: [{ message: "Unused variable", start: { line: 3, column: 1 } }],
      },
    });
    expect(env.success).toBe(false);
    expect(env.errors).toEqual([
      { message: "Mismatched type", line: 7, column: 12 },
    ]);
    expect(env.warnings).toEqual([
      { message: "Unused variable", line: 3, column: 1 },
    ]);
  });

  it("savePineScript surfaces normalized error envelope when upstream rejects", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: false,
        reason2: {
          errors: [
            {
              message: "Undeclared identifier 'foo'",
              start: { line: 12, column: 5 },
            },
          ],
          warnings: [],
        },
      }),
    );
    const out = await savePineScript(ctx, {
      mode: "new",
      name: "Bad",
      source: "//@version=5\nfoo()",
    });
    expect(out.success).toBe(false);
    expect(out.errors).toEqual([
      { message: "Undeclared identifier 'foo'", line: 12, column: 5 },
    ]);
  });

  // ---------------------------------------------------------------------
  // Version 'last' resolution sanity (covers spec acceptance bullet).
  // ---------------------------------------------------------------------

  it("getVersionsLast: throws when upstream returns empty array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await expect(getVersionsLast(ctx, "PUB;abc")).rejects.toThrow(
      "versions/last returned no version",
    );
  });
});
