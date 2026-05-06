import { describe, expect, it } from "vitest";
import {
  buildNotificationsCookie,
  buildNotificationsUpgradeHeaders,
  buildNotificationsUrl,
  parseNewsFrame,
} from "./notifications";

describe("notifications URL + cookie helpers", () => {
  it("buildNotificationsUrl points at the news/channel host", () => {
    expect(buildNotificationsUrl()).toBe(
      "wss://notifications.tradingview.com/news/channel",
    );
  });

  it("buildNotificationsCookie emits a sessionid pair", () => {
    expect(buildNotificationsCookie("a", "b")).toBe("sessionid=a;sessionid_sign=b");
    expect(buildNotificationsCookie("a")).toBe("sessionid=a");
  });

  it("buildNotificationsUpgradeHeaders sets Origin, UA, and Cookie", () => {
    const headers = buildNotificationsUpgradeHeaders("sid", "sgn");
    expect(headers.Origin).toBe("https://www.tradingview.com");
    expect(headers.Upgrade).toBe("websocket");
    expect(headers.Cookie).toBe("sessionid=sid;sessionid_sign=sgn");
  });

  it("buildNotificationsUpgradeHeaders omits Cookie when no session", () => {
    const headers = buildNotificationsUpgradeHeaders();
    expect(headers.Cookie).toBeUndefined();
  });
});

describe("parseNewsFrame", () => {
  it("parses a flat news object with title + symbols", () => {
    const event = parseNewsFrame(
      JSON.stringify({
        kind: "news",
        id: "DJN_1234",
        title: "Apple beats expectations",
        published: "2026-05-07T10:00:00Z",
        symbols: ["NASDAQ:AAPL"],
        provider: { id: "djn", name: "Dow Jones" },
      }),
    );
    expect(event.kind).toBe("news");
    expect(event.id).toBe("DJN_1234");
    expect(event.title).toBe("Apple beats expectations");
    expect(event.symbols).toEqual(["NASDAQ:AAPL"]);
    expect(event.provider?.name).toBe("Dow Jones");
  });

  it("parses a pushstream-style {channel, content} envelope", () => {
    const event = parseNewsFrame(
      JSON.stringify({
        channel: "abc123",
        content: JSON.stringify({
          kind: "update",
          id: "RTRS_99",
          title: "Markets close higher",
          relatedSymbols: ["NYSE:SPY", { symbol: "NASDAQ:QQQ" }],
        }),
      }),
    );
    expect(event.channel).toBe("abc123");
    expect(event.kind).toBe("update");
    expect(event.id).toBe("RTRS_99");
    expect(event.symbols).toEqual(["NYSE:SPY", "NASDAQ:QQQ"]);
  });

  it("parses an item-wrapped news payload", () => {
    const event = parseNewsFrame(
      JSON.stringify({
        kind: "news",
        item: {
          id: "INT_1",
          relatedSymbols: ["FX:EURUSD"],
          provider: { name: "Reuters" },
        },
      }),
    );
    expect(event.id).toBe("INT_1");
    expect(event.symbols).toEqual(["FX:EURUSD"]);
    expect(event.provider?.name).toBe("Reuters");
  });

  it("falls back to `headline` when `title` is absent", () => {
    const event = parseNewsFrame(JSON.stringify({ kind: "news", headline: "Old style" }));
    expect(event.title).toBe("Old style");
  });

  it("rejects empty or non-JSON frames", () => {
    expect(() => parseNewsFrame("")).toThrow(/empty/);
    expect(() => parseNewsFrame("not-json")).toThrow(/not JSON/);
  });

  it("rejects non-object JSON", () => {
    expect(() => parseNewsFrame(JSON.stringify(["array"]))).toThrow(/object/);
  });

  it("defaults kind to 'news' when absent", () => {
    const event = parseNewsFrame(JSON.stringify({ id: "X", title: "Y" }));
    expect(event.kind).toBe("news");
  });
});
