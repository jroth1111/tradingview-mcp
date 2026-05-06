import { describe, expect, it } from "vitest";
import {
  PUSHSTREAM_CHANNELS,
  buildPushstreamCookie,
  buildPushstreamSseUrl,
  buildPushstreamUpgradeHeaders,
  buildPushstreamWsUrl,
  extractPrivateChannelToken,
  isBootstrapFrame,
  parsePushstreamEvent,
  parsePushstreamFrame,
} from "./pushstream";

describe("pushstream URL builders", () => {
  it("buildPushstreamWsUrl joins channels into the path", () => {
    const url = buildPushstreamWsUrl(["public", "private_abc123"]);
    expect(url).toBe(
      "wss://pushstream.tradingview.com/message-pipe-ws/public/private_abc123",
    );
  });

  it("buildPushstreamSseUrl emits one channel param per channel", () => {
    const url = buildPushstreamSseUrl(["public", "news_xyz"]);
    expect(url).toContain("https://pushstream.tradingview.com/message-pipe-es?");
    expect(url).toContain("channel=public");
    expect(url).toContain("channel=news_xyz");
  });

  it("buildPushstreamWsUrl rejects empty channel lists", () => {
    expect(() => buildPushstreamWsUrl([])).toThrow(/at least one channel/);
  });

  it("PUSHSTREAM_CHANNELS.private_ formats the per-user channel", () => {
    expect(PUSHSTREAM_CHANNELS.private_("TOKEN42")).toBe("private_TOKEN42");
    expect(PUSHSTREAM_CHANNELS.public).toBe("public");
    expect(PUSHSTREAM_CHANNELS.bootstrap).toBe("pushstream_set_user_channel");
  });

  it("buildPushstreamCookie emits the correct cookie pair", () => {
    expect(buildPushstreamCookie("sid", "sign")).toBe("sessionid=sid;sessionid_sign=sign");
    expect(buildPushstreamCookie("sid")).toBe("sessionid=sid");
  });

  it("buildPushstreamUpgradeHeaders includes Origin + cookie when sid present", () => {
    const headers = buildPushstreamUpgradeHeaders("s1", "s2");
    expect(headers.Origin).toBe("https://www.tradingview.com");
    expect(headers.Upgrade).toBe("websocket");
    expect(headers.Cookie).toBe("sessionid=s1;sessionid_sign=s2");
  });
});

describe("parsePushstreamFrame", () => {
  it("parses a well-formed envelope", () => {
    const frame = parsePushstreamFrame(
      JSON.stringify({ id: 7, channel: "private_abc", text: "{\"m\":\"alert_fired\",\"p\":[]}" }),
    );
    expect(frame.id).toBe(7);
    expect(frame.channel).toBe("private_abc");
    expect(frame.text).toContain("alert_fired");
  });

  it("rejects empty input", () => {
    expect(() => parsePushstreamFrame("")).toThrow(/empty/);
  });

  it("rejects non-JSON payload", () => {
    expect(() => parsePushstreamFrame("not-json")).toThrow(/not JSON/);
  });

  it("rejects frames missing channel", () => {
    expect(() => parsePushstreamFrame(JSON.stringify({ id: 1, text: "" }))).toThrow(/channel/);
  });

  it("rejects frames missing numeric id", () => {
    expect(() =>
      parsePushstreamFrame(JSON.stringify({ id: "1", channel: "x", text: "" })),
    ).toThrow(/id/);
  });

  it("accepts keepalive frames with empty text", () => {
    const frame = parsePushstreamFrame(JSON.stringify({ id: 0, channel: "public" }));
    expect(frame.id).toBe(0);
    expect(frame.text).toBe("");
  });
});

describe("parsePushstreamEvent", () => {
  it("returns null for keepalive (id <= 0)", () => {
    expect(parsePushstreamEvent({ id: 0, channel: "public", text: "" })).toBeNull();
    expect(parsePushstreamEvent({ id: -2, channel: "public", text: "" })).toBeNull();
  });

  it("decodes the {m, p} envelope inside text", () => {
    const event = parsePushstreamEvent({
      id: 12,
      channel: "private_xyz",
      text: JSON.stringify({ m: "alert_fired", p: [{ alert_id: 42, fire_id: 99 }] }),
    });
    expect(event).not.toBeNull();
    expect(event!.m).toBe("alert_fired");
    expect(event!.p[0].alert_id).toBe(42);
  });

  it("throws when text is non-empty but invalid JSON", () => {
    expect(() =>
      parsePushstreamEvent({ id: 5, channel: "x", text: "not-json" }),
    ).toThrow(/not JSON/);
  });
});

describe("bootstrap channel handling", () => {
  it("isBootstrapFrame matches the bootstrap channel name", () => {
    expect(isBootstrapFrame({ id: 1, channel: "pushstream_set_user_channel", text: "" })).toBe(
      true,
    );
    expect(isBootstrapFrame({ id: 1, channel: "private_abc", text: "" })).toBe(false);
  });

  it("extractPrivateChannelToken handles plain string text", () => {
    const token = extractPrivateChannelToken({
      id: 1,
      channel: "pushstream_set_user_channel",
      text: "TOKEN_PLAIN",
    });
    expect(token).toBe("TOKEN_PLAIN");
  });

  it("extractPrivateChannelToken handles JSON string text", () => {
    const token = extractPrivateChannelToken({
      id: 1,
      channel: "pushstream_set_user_channel",
      text: JSON.stringify("TOKEN_JSON"),
    });
    expect(token).toBe("TOKEN_JSON");
  });

  it("extractPrivateChannelToken handles JSON object with private_channel", () => {
    const token = extractPrivateChannelToken({
      id: 1,
      channel: "pushstream_set_user_channel",
      text: JSON.stringify({ private_channel: "TOKEN_OBJ" }),
    });
    expect(token).toBe("TOKEN_OBJ");
  });

  it("extractPrivateChannelToken returns null for non-bootstrap channels", () => {
    expect(
      extractPrivateChannelToken({ id: 1, channel: "public", text: "TOKEN" }),
    ).toBeNull();
  });

  it("extractPrivateChannelToken returns null for empty bootstrap text", () => {
    expect(
      extractPrivateChannelToken({
        id: 1,
        channel: "pushstream_set_user_channel",
        text: "",
      }),
    ).toBeNull();
  });
});
