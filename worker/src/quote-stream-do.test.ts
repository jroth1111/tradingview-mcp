import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  DEFAULT_QUOTE_FIELDS,
  IDLE_STREAM_AUTO_CLOSE_MS,
  MAX_SYMBOLS_PER_STREAM_DEFAULT,
  QUOTE_THROTTLE_INTERVAL_MS,
  QuoteStream,
  _setAuthTokenFetcherForTests,
  _setUpstreamFactoryForTests,
  type UpstreamFactory,
  type UpstreamSocket,
} from "./quote-stream-do";

class StubState {
  private queue = Promise.resolve();
  storage = (() => {
    const inner = new Map<string, unknown>();
    let alarm: number | null = null;
    return {
      put: async (k: string, v: unknown) => {
        inner.set(k, v);
      },
      get: async <T>(k: string): Promise<T | undefined> => inner.get(k) as T | undefined,
      delete: async (k: string) => {
        inner.delete(k);
      },
      setAlarm: async (when: number) => {
        alarm = when;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
      getAlarm: async () => alarm,
      _alarm: () => alarm,
    };
  })();
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
  fakeMessage: (text: string) => void;
}

const makeFactory = (sockets: FakeSocket[]): UpstreamFactory => async (opts, handlers) => {
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
    fakeMessage: (text: string) => handlers.onMessage(text),
  };
  sockets.push(sock);
  return sock;
};

const env = {} as CloudflareBindings;
const makeDo = () =>
  new QuoteStream(new StubState() as unknown as DurableObjectState, env);

const post = (path: string, body?: unknown) =>
  new Request(`https://quote-stream.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const tvFrame = (m: string, p: any[]) => {
  const json = JSON.stringify({ m, p });
  const len = new TextEncoder().encode(json).length;
  return `~m~${len}~m~${json}`;
};

beforeEach(() => {
  _setUpstreamFactoryForTests(null);
  _setAuthTokenFetcherForTests(async () => "fake-auth-token");
});
afterEach(() => {
  _setUpstreamFactoryForTests(null);
  _setAuthTokenFetcherForTests(null);
  vi.useRealTimers();
});

describe("QuoteStream init / safety gates", () => {
  it("rejects subscribe with > MAX_SYMBOLS_PER_STREAM", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    const symbols = Array.from({ length: 101 }, (_, i) => `SYM${i}`);
    const resp = await qs.fetch(
      post("/init", {
        streamId: "s1",
        hmacClient: "client-a",
        symbols,
        sessionId: "abc",
      }),
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as any;
    expect(body.error).toBe("max_symbols_exceeded");
    expect(body.limit).toBe(MAX_SYMBOLS_PER_STREAM_DEFAULT);
    expect(body.requested).toBe(101);
    expect(sockets).toHaveLength(0);
  });

  it("rejects /update that would push symbols above the cap", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    const symbols = Array.from({ length: 100 }, (_, i) => `SYM${i}`);
    const init = await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "client-a", symbols, sessionId: "abc" }),
    );
    expect(init.status).toBe(200);
    const resp = await qs.fetch(post("/update", { add: ["EXTRA"] }));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as any;
    expect(body.error).toBe("max_symbols_exceeded");
  });

  it("rejects init with missing required fields", async () => {
    const qs = makeDo();
    expect((await qs.fetch(post("/init", {}))).status).toBe(400);
    expect(
      (await qs.fetch(post("/init", { streamId: "s", hmacClient: "c", symbols: [] }))).status,
    ).toBe(400);
    expect(
      (
        await qs.fetch(
          post("/init", { streamId: "s", hmacClient: "c", symbols: ["X"] }),
        )
      ).status,
    ).toBe(400);
  });

  it("rejects double init while ready", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    const ok = await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "a" }),
    );
    expect(ok.status).toBe(200);
    const dup = await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "a" }),
    );
    expect(dup.status).toBe(409);
  });

  it("auth_error during init returns 401 and clears state", async () => {
    _setAuthTokenFetcherForTests(async () => {
      throw new Error("auth_error");
    });
    const qs = makeDo();
    const resp = await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "a" }),
    );
    expect(resp.status).toBe(401);
    const snap = qs._snapshot();
    expect(snap.ready).toBe(false);
  });
});

describe("QuoteStream upstream init messages", () => {
  it("sends quote_create_session, quote_set_fields, quote_add_symbols, quote_fast_symbols", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    const resp = await qs.fetch(
      post("/init", {
        streamId: "s1",
        hmacClient: "c",
        symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT"],
        sessionId: "sid",
      }),
    );
    expect(resp.status).toBe(200);
    expect(sockets).toHaveLength(1);
    const sock = sockets[0];
    expect(sock.sent.some((f) => f.includes('"m":"set_auth_token"'))).toBe(true);
    expect(sock.sent.some((f) => f.includes('"m":"quote_create_session"'))).toBe(true);
    expect(sock.sent.some((f) => f.includes('"m":"quote_set_fields"'))).toBe(true);
    const addFrame = sock.sent.find((f) => f.includes('"m":"quote_add_symbols"'));
    expect(addFrame).toBeTruthy();
    expect(addFrame).toContain("NASDAQ:AAPL");
    expect(addFrame).toContain("NASDAQ:MSFT");
  });

  it("when includeMinuteBars=true, also opens chart session and create_series", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    const resp = await qs.fetch(
      post("/init", {
        streamId: "s1",
        hmacClient: "c",
        symbols: ["NASDAQ:AAPL"],
        sessionId: "sid",
        includeMinuteBars: true,
      }),
    );
    expect(resp.status).toBe(200);
    const sock = sockets[0];
    const chartFrame = sock.sent.find((f) => f.includes('"m":"chart_create_session"'));
    expect(chartFrame).toBeTruthy();
    const createSeriesFrame = sock.sent.find((f) => f.includes('"m":"create_series"'));
    expect(createSeriesFrame).toBeTruthy();
    expect(createSeriesFrame).toContain('"1"'); // tf=1 (minute)
  });

  it("uses default fields when none provided", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    const fieldsFrame = sockets[0].sent.find((f) => f.includes('"quote_set_fields"'));
    expect(fieldsFrame).toBeTruthy();
    for (const f of DEFAULT_QUOTE_FIELDS.slice(0, 3)) expect(fieldsFrame).toContain(f);
  });
});

describe("QuoteStream quote throttle (Probe 7)", () => {
  it("100 qsd updates within 1s for a single symbol → ≤4 SSE events forwarded", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );

    // Inject 100 qsd frames at 10ms intervals = 1s total.
    for (let i = 0; i < 100; i += 1) {
      qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 100 + i } }]));
      vi.advanceTimersByTime(10);
    }
    // Drain any final pending timer.
    vi.advanceTimersByTime(QUOTE_THROTTLE_INTERVAL_MS + 5);

    const snap = qs._snapshot();
    // Each emitted SSE event corresponds to one ring entry of kind=quote.
    // Expect ≤4 quote events in 1s (1000ms / 250ms).
    expect(snap.nextSeq - 1).toBeLessThanOrEqual(4);
    expect(snap.nextSeq - 1).toBeGreaterThanOrEqual(3);
  });

  it("coalesces fields within one throttle window", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 100 } }]));
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { volume: 1000 } }]));
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { ch: 0.5, chp: 0.005 } }]));
    vi.advanceTimersByTime(QUOTE_THROTTLE_INTERVAL_MS + 5);
    const snap = qs._snapshot();
    // Single coalesced event emitted.
    expect(snap.nextSeq - 1).toBe(1);
  });

  it("separate symbols throttle independently", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X", "Y"], sessionId: "sid" }),
    );
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 1 } }]));
    qs._injectFrame(tvFrame("qsd", [0, { n: "Y", s: { lp: 2 } }]));
    vi.advanceTimersByTime(QUOTE_THROTTLE_INTERVAL_MS + 5);
    const snap = qs._snapshot();
    expect(snap.nextSeq - 1).toBe(2); // one per symbol
  });
});

describe("QuoteStream auth + retry (Probe 6)", () => {
  it("auth failure during streaming closes upstream and emits error event", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    qs._injectAuthFailure();
    const snap = qs._snapshot();
    expect(snap.authBlocked).toBe(true);
    expect(snap.nextSeq - 1).toBeGreaterThan(0);
    expect(sockets[0].closed).toBe(true);
  });

  it("auth-blocked stream does not retry on upstream close", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    qs._injectAuthFailure();
    qs._injectUpstreamClose(1006, "closed");
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(1); // no reconnect attempts
  });
});

describe("QuoteStream symbol updates (Probe 4)", () => {
  it("/update add/remove reshapes upstream subscriptions without dropping unrelated symbols", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", {
        streamId: "s1",
        hmacClient: "c",
        symbols: ["A", "B", "C"],
        sessionId: "sid",
      }),
    );
    const sock = sockets[0];
    sock.sent.length = 0;
    const resp = await qs.fetch(post("/update", { add: ["D"], remove: ["B"] }));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.added).toEqual(["D"]);
    expect(body.removed).toEqual(["B"]);
    expect(new Set(body.symbols)).toEqual(new Set(["A", "C", "D"]));

    const removeFrame = sock.sent.find((f) => f.includes('"quote_remove_symbols"'));
    const addFrame = sock.sent.find((f) => f.includes('"quote_add_symbols"'));
    expect(removeFrame).toContain("B");
    expect(addFrame).toContain("D");
    // A and C should not appear in add or remove frames issued during the update.
    expect(removeFrame).not.toContain('"A"');
    expect(removeFrame).not.toContain('"C"');
    expect(addFrame).not.toContain('"A"');
    expect(addFrame).not.toContain('"C"');
  });
});

describe("QuoteStream SSE replay (Probe 3)", () => {
  it("Last-Event-ID resumes from ring buffer", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    const flushDelay = QUOTE_THROTTLE_INTERVAL_MS + 30;
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 100 } }]));
    await new Promise((r) => setTimeout(r, flushDelay));
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 101 } }]));
    await new Promise((r) => setTimeout(r, flushDelay));
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 102 } }]));
    await new Promise((r) => setTimeout(r, flushDelay));

    const snap = qs._snapshot();
    expect(snap.ringLength).toBe(3);

    // Connect SSE asking for events after seq=1.
    const sse = await qs.fetch(
      new Request("https://quote-stream.local/sse", {
        method: "GET",
        headers: { "last-event-id": "1" },
      }),
    );
    expect(sse.status).toBe(200);
    const reader = sse.body!.getReader();
    const td = new TextDecoder();
    let payload = "";
    // Drain SSE chunks until both replayed events are visible or we time out.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if (payload.includes("id: 2") && payload.includes("id: 3")) break;
      const next = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: true }), 100),
        ),
      ]);
      if (next.done) break;
      if (next.value) payload += td.decode(next.value as Uint8Array);
    }
    await reader.cancel().catch(() => undefined);
    expect(payload).toContain("id: 2");
    expect(payload).toContain("id: 3");
    // Should NOT contain id: 1 (it was filtered as "since" cursor).
    const rawIdx = payload.indexOf("id: 1\n");
    expect(rawIdx).toBe(-1);
  });
});

describe("QuoteStream idle alarm (Probe 5 idle close)", () => {
  it("setAlarm scheduled when last consumer disconnects, deleteAlarm when consumer attached", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const stub = new StubState();
    const qs = new QuoteStream(stub as unknown as DurableObjectState, env);
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    // No consumers initially. Open SSE → alarm should be cancelled.
    const sse = await qs.fetch(
      new Request("https://quote-stream.local/sse", { method: "GET" }),
    );
    expect(sse.status).toBe(200);
    expect((stub.storage as any)._alarm()).toBe(null);
  });

  it("alarm() handler closes upstream and clears state when idle threshold elapsed", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const stub = new StubState();
    const qs = new QuoteStream(stub as unknown as DurableObjectState, env);
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    // Force lastConsumerSeenAt to long ago so alarm() triggers cleanup.
    (qs as any).lastConsumerSeenAt = Date.now() - IDLE_STREAM_AUTO_CLOSE_MS - 1000;
    await qs.alarm();
    expect(sockets[0].closed).toBe(true);
    const snap = qs._snapshot();
    expect(snap.ready).toBe(false);
    expect(snap.symbols).toEqual([]);
  });
});

describe("QuoteStream lifecycle", () => {
  it("/close tears down upstream, SSE clients, pending timers", async () => {
    const sockets: FakeSocket[] = [];
    _setUpstreamFactoryForTests(makeFactory(sockets));
    const qs = makeDo();
    await qs.fetch(
      post("/init", { streamId: "s1", hmacClient: "c", symbols: ["X"], sessionId: "sid" }),
    );
    qs._injectFrame(tvFrame("qsd", [0, { n: "X", s: { lp: 100 } }]));
    const closeResp = await qs.fetch(post("/close"));
    expect(closeResp.status).toBe(200);
    expect(sockets[0].closed).toBe(true);
    const snap = qs._snapshot();
    expect(snap.ready).toBe(false);
    expect(snap.symbols).toEqual([]);
    expect(snap.pendingSymbols).toEqual([]);
  });

  it("/update before /init returns 409", async () => {
    const qs = makeDo();
    const resp = await qs.fetch(post("/update", { add: ["X"] }));
    expect(resp.status).toBe(409);
  });

  it("/sse before /init returns 409", async () => {
    const qs = makeDo();
    const resp = await qs.fetch(
      new Request("https://quote-stream.local/sse", { method: "GET" }),
    );
    expect(resp.status).toBe(409);
  });
});
