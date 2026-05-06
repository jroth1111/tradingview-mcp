import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  RING_BUFFER_MAX,
  StreamBridge,
  _setUpstreamFactoryForTests,
  type BufferedEvent,
  type PollResponse,
  type UpstreamFactory,
  type UpstreamSocket,
} from "./stream-do";

class StubState {
  private queue = Promise.resolve();
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const run = this.queue.then(callback, callback);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

interface FakeSocket extends UpstreamSocket {
  url: string;
  closed: boolean;
  closeCode?: number;
  closeReason?: string;
  sent: string[];
  /** Push a frame into the consumer hooked up at construction. */
  fakeMessage: (text: string) => void;
}

const makeFactory = (sockets: FakeSocket[]): UpstreamFactory => async (opts, handlers) => {
  let onMessage = handlers.onMessage;
  const sock: FakeSocket = {
    url: opts.url,
    closed: false,
    sent: [],
    send: (data: string) => {
      sock.sent.push(data);
    },
    close: (code = 1000, reason = "") => {
      if (sock.closed) return;
      sock.closed = true;
      sock.closeCode = code;
      sock.closeReason = reason;
      handlers.onClose?.(code, reason);
    },
    fakeMessage: (text: string) => onMessage(text),
  };
  sockets.push(sock);
  // Allow the DO to swap the consumer if onMessage is replaced via reattach.
  // Currently we just preserve initial handler.
  void onMessage;
  return sock;
};

const env = {} as CloudflareBindings;
const makeDo = () => new StreamBridge(new StubState() as unknown as DurableObjectState, env);

const post = (path: string, body?: unknown) =>
  new Request(`https://stream-bridge.local${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  _setUpstreamFactoryForTests(null);
});
afterEach(() => {
  _setUpstreamFactoryForTests(null);
});

describe("StreamBridge request routing", () => {
  it("rejects unknown sub-paths with 404", async () => {
    const sb = makeDo();
    const resp = await sb.fetch(post("/does-not-exist", {}));
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/unknown sub-path/);
  });

  it("rejects non-POST on /subscribe-alerts", async () => {
    const sb = makeDo();
    const resp = await sb.fetch(
      new Request("https://stream-bridge.local/subscribe-alerts", { method: "GET" }),
    );
    expect(resp.status).toBe(405);
  });

  it("/subscribe-alerts rejects missing sessionId", async () => {
    const sb = makeDo();
    const resp = await sb.fetch(post("/subscribe-alerts", {}));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/sessionId/);
  });

  it("/poll accepts an empty body and returns ok with no events", async () => {
    const sb = makeDo();
    const resp = await sb.fetch(post("/poll", {}));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as PollResponse;
    expect(body.ok).toBe(true);
    expect(body.events).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it("/close is idempotent (safe with no upstream)", async () => {
    const sb = makeDo();
    const r1 = await sb.fetch(post("/close"));
    const r2 = await sb.fetch(post("/close"));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(((await r1.json()) as any).ok).toBe(true);
    expect(((await r2.json()) as any).ok).toBe(true);
  });
});

describe("StreamBridge subscribe + buffer", () => {
  it("/subscribe-alerts opens a pushstream socket with the right channels", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();

    const resp = await sb.fetch(
      post("/subscribe-alerts", {
        sessionId: "sid",
        sessionSign: "sgn",
        privateChannel: "TKN",
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: true;
      channels: string[];
      privateChannel: string;
    };
    expect(body.channels).toEqual(["private_TKN", "public"]);
    expect(body.privateChannel).toBe("TKN");
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("/message-pipe-ws/private_TKN/public");
  });

  it("/subscribe-alerts uses the bootstrap channel when privateChannel missing", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    const resp = await sb.fetch(
      post("/subscribe-alerts", { sessionId: "sid", includePublic: false }),
    );
    expect(resp.status).toBe(200);
    expect(sockets[0].url).toContain("/message-pipe-ws/pushstream_set_user_channel");
    expect(sockets[0].url).not.toContain("/public");
  });

  it("buffers alert_fired frames into the ring", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));

    sockets[0].fakeMessage(
      JSON.stringify({
        id: 1,
        channel: "private_TKN",
        text: JSON.stringify({
          m: "alert_fired",
          p: [{ alert_id: 7, fire_id: 99, value: 200 }],
        }),
      }),
    );
    sockets[0].fakeMessage(
      JSON.stringify({
        id: 2,
        channel: "private_TKN",
        text: JSON.stringify({ m: "alerts_updated", p: [{ alert_id: 7 }] }),
      }),
    );

    const pollResp = await sb.fetch(post("/poll", {}));
    const body = (await pollResp.json()) as PollResponse;
    expect(body.events).toHaveLength(2);
    expect(body.events[0].kind).toBe("alert");
    expect(body.events[0].event).toBe("alert_fired");
    expect((body.events[0].data as any[])[0].alert_id).toBe(7);
    expect(body.events[1].event).toBe("alerts_updated");
  });

  it("ignores keepalive frames (id <= 0) and malformed frames", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));

    sockets[0].fakeMessage(
      JSON.stringify({ id: 0, channel: "private_TKN", text: "" }),
    );
    sockets[0].fakeMessage("not-json");
    sockets[0].fakeMessage(
      JSON.stringify({
        id: -2,
        channel: "private_TKN",
        text: "",
      }),
    );

    const body = (await (await sb.fetch(post("/poll", {}))).json()) as PollResponse;
    expect(body.events).toHaveLength(0);
  });
});

describe("StreamBridge bootstrap channel mint", () => {
  it("captures private_channel from bootstrap and reattaches", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid" }));
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("pushstream_set_user_channel");

    sockets[0].fakeMessage(
      JSON.stringify({
        id: 1,
        channel: "pushstream_set_user_channel",
        text: JSON.stringify({ private_channel: "MINTED" }),
      }),
    );

    // The DO triggers async re-attach. Wait a tick so the re-subscribe runs.
    await new Promise((r) => setTimeout(r, 5));
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    expect(sockets[1].url).toContain("/message-pipe-ws/private_MINTED");
    expect(sb._state().privateChannel).toBe("MINTED");

    // The control event should be visible in the buffer.
    const body = (await (await sb.fetch(post("/poll", {}))).json()) as PollResponse;
    const control = body.events.find((e) => e.kind === "control");
    expect(control?.event).toBe("private_channel_minted");
  });
});

describe("StreamBridge poll cursor + filtering", () => {
  it("applies `since` cursor to drop earlier events", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));
    sockets[0].fakeMessage(
      JSON.stringify({
        id: 1,
        channel: "private_TKN",
        text: JSON.stringify({ m: "alert_fired", p: [{ fire_id: 1 }] }),
      }),
    );
    // wait a sliver so timestamps differ
    await new Promise((r) => setTimeout(r, 5));
    sockets[0].fakeMessage(
      JSON.stringify({
        id: 2,
        channel: "private_TKN",
        text: JSON.stringify({ m: "alert_fired", p: [{ fire_id: 2 }] }),
      }),
    );
    const first = (await (await sb.fetch(post("/poll", {}))).json()) as PollResponse;
    expect(first.events).toHaveLength(2);
    const cursor = first.events[0].ts;
    const second = (await (await sb.fetch(post("/poll", { since: cursor }))).json()) as PollResponse;
    // Only events strictly after cursor.
    expect(second.events.every((e: BufferedEvent) => e.ts > cursor)).toBe(true);
  });

  it("filters by channel kind", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));
    await sb.fetch(post("/subscribe-news", {}));
    expect(sockets).toHaveLength(2);
    const psSocket = sockets[0];
    const nsSocket = sockets[1];

    psSocket.fakeMessage(
      JSON.stringify({
        id: 1,
        channel: "private_TKN",
        text: JSON.stringify({ m: "alert_fired", p: [{ alert_id: 1 }] }),
      }),
    );
    nsSocket.fakeMessage(
      JSON.stringify({
        kind: "news",
        id: "RTRS_1",
        title: "Earnings beat",
        symbols: ["NASDAQ:AAPL"],
      }),
    );

    const alertsOnly = (await (
      await sb.fetch(post("/poll", { channel: "alerts" }))
    ).json()) as PollResponse;
    expect(alertsOnly.events.every((e: BufferedEvent) => e.kind === "alert")).toBe(true);
    expect(alertsOnly.events.length).toBeGreaterThan(0);

    const newsOnly = (await (
      await sb.fetch(post("/poll", { channel: "news" }))
    ).json()) as PollResponse;
    expect(newsOnly.events.every((e: BufferedEvent) => e.kind === "news")).toBe(true);
    expect(newsOnly.events.length).toBeGreaterThan(0);
  });

  it("clamps limit to ring buffer size and reports truncation when overflowed", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));

    // Push slightly more than the ring buffer max to force truncation.
    for (let i = 0; i < RING_BUFFER_MAX + 5; i += 1) {
      sockets[0].fakeMessage(
        JSON.stringify({
          id: i + 1,
          channel: "private_TKN",
          text: JSON.stringify({ m: "alert_fired", p: [{ fire_id: i }] }),
        }),
      );
    }
    const body = (await (await sb.fetch(post("/poll", { limit: 5 }))).json()) as PollResponse;
    expect(body.events.length).toBe(5);
    expect(body.truncated).toBe(true);
  });
});

describe("StreamBridge SSE", () => {
  it("/sse returns a text/event-stream response", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));
    sockets[0].fakeMessage(
      JSON.stringify({
        id: 1,
        channel: "private_TKN",
        text: JSON.stringify({ m: "alert_fired", p: [{ fire_id: 1 }] }),
      }),
    );

    const sseResp = await sb.fetch(
      new Request("https://stream-bridge.local/sse", { method: "GET" }),
    );
    expect(sseResp.status).toBe(200);
    expect(sseResp.headers.get("content-type")).toBe("text/event-stream");
    expect(sseResp.headers.get("x-stream-id")).toMatch(/^sse_/);
    // Read the first chunk; should contain the retry hint and replay event.
    const reader = sseResp.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value!);
    expect(text).toContain("retry: 3000");
    // Read again — should contain replay of the alert_fired event id 1.
    const second = await reader.read();
    if (second.value) {
      const t2 = new TextDecoder().decode(second.value);
      // Combined sometimes; either way one of the two reads contains alert.
      expect(`${text}${t2}`).toContain("alert_fired");
    } else {
      expect(text).toContain("alert_fired");
    }
    await reader.cancel();
  });

  it("/sse supports `since` query param to skip earlier events", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));
    sockets[0].fakeMessage(
      JSON.stringify({
        id: 1,
        channel: "private_TKN",
        text: JSON.stringify({ m: "alert_fired", p: [{ fire_id: 1 }] }),
      }),
    );

    // since = future timestamp → no replay.
    const future = new Date(Date.now() + 60_000).toISOString();
    const sseResp = await sb.fetch(
      new Request(
        `https://stream-bridge.local/sse?since=${encodeURIComponent(future)}&channel=alerts`,
        { method: "GET" },
      ),
    );
    expect(sseResp.status).toBe(200);
    const reader = sseResp.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value!);
    expect(text).toContain("retry: 3000");
    expect(text).not.toContain("alert_fired");
    await reader.cancel();
  });
});

describe("StreamBridge upstream lifecycle", () => {
  it("logs an upstream_closed control event when the socket closes", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));
    expect(sockets).toHaveLength(1);
    sockets[0].close(1011, "boom");
    const body = (await (await sb.fetch(post("/poll", { channel: "all" }))).json()) as PollResponse;
    const control = body.events.find((e) => e.event === "upstream_closed");
    expect(control).toBeDefined();
    expect((control!.data as any).code).toBe(1011);
  });

  it("/close tears down both upstream sockets", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const sb = makeDo();
    await sb.fetch(post("/subscribe-alerts", { sessionId: "sid", privateChannel: "TKN" }));
    await sb.fetch(post("/subscribe-news", {}));
    expect(sockets).toHaveLength(2);
    expect(sockets.every((s) => !s.closed)).toBe(true);
    await sb.fetch(post("/close"));
    expect(sockets.every((s) => s.closed)).toBe(true);
    expect(sb._state().pushstreamChannels).toEqual([]);
    expect(sb._state().notificationsBound).toBe(false);
  });
});
