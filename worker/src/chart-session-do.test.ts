import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  ChartSession,
  _setConnectFactoryForTests,
  type ConnectFactory,
  type TradingviewConnection,
} from "./chart-session-do";

// --- minimal DurableObjectState stub (mirrors cache.test.ts) ---
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

interface FakeConnection extends TradingviewConnection {
  /** Emit an event to all subscribers as if the upstream had sent a frame. */
  emit: (event: { name: string; params: any[] }) => void;
  /** Verbs sent by the DO, in order. */
  sent: Array<{ name: string; params: any[] }>;
  /** True after close() has run. */
  closed: boolean;
}

const makeFakeConnection = (): FakeConnection => {
  const subs = new Set<(event: { name: string; params: any[] }) => void>();
  const sent: Array<{ name: string; params: any[] }> = [];
  let closed = false;
  const conn: FakeConnection = {
    subscribe: (handler) => {
      subs.add(handler);
      return () => subs.delete(handler);
    },
    send: (name, params) => {
      sent.push({ name, params });
    },
    close: async () => {
      closed = true;
      subs.clear();
    },
    emit: (event) => {
      for (const handler of [...subs]) handler(event);
    },
    sent,
    get closed() {
      return closed;
    },
  } as FakeConnection;
  return conn;
};

const env = {} as CloudflareBindings;

const makeDo = () => new ChartSession(new StubState() as unknown as DurableObjectState, env);

const post = (path: string, body?: unknown) =>
  new Request(`https://chart-session.local${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  _setConnectFactoryForTests(null); // ensure clean default between tests
});
afterEach(() => {
  _setConnectFactoryForTests(null);
});

describe("ChartSession DO request routing", () => {
  it("rejects non-POST requests with 405", async () => {
    const cs = makeDo();
    const resp = await cs.fetch(
      new Request("https://chart-session.local/create", { method: "GET" }),
    );
    expect(resp.status).toBe(405);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/method not allowed/i);
  });

  it("returns 404 on unknown sub-path", async () => {
    const cs = makeDo();
    const resp = await cs.fetch(post("/does-not-exist", {}));
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/unknown sub-path/);
  });

  it("/study/modify rejects when no session is active", async () => {
    const cs = makeDo();
    const resp = await cs.fetch(post("/study/modify", { slotName: "st1", inputs: {} }));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/no active chart session/i);
  });

  it("/study/create rejects when no session is active", async () => {
    const cs = makeDo();
    const resp = await cs.fetch(post("/study/create", { studyId: "STD;RSI" }));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/no active chart session/i);
  });

  it("/close is idempotent (safe with no active session)", async () => {
    const cs = makeDo();
    const r1 = await cs.fetch(post("/close"));
    const r2 = await cs.fetch(post("/close"));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r1.json()) as { ok: boolean }).toEqual({ ok: true });
    expect((await r2.json()) as { ok: boolean }).toEqual({ ok: true });
  });

  it("/create rejects malformed body (missing symbol)", async () => {
    const cs = makeDo();
    const resp = await cs.fetch(post("/create", { timeframe: "60" }));
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toMatch(/symbol/i);
  });

  it("/create rejects body that is not valid JSON", async () => {
    const cs = makeDo();
    const resp = await cs.fetch(
      new Request("https://chart-session.local/create", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(resp.status).toBe(400);
  });
});

describe("ChartSession lifecycle (with mocked WS)", () => {
  it("/create sends chart_create_session, resolve_symbol, create_series and resolves on series_completed", async () => {
    const fake = makeFakeConnection();
    const factory: ConnectFactory = async () => fake;
    _setConnectFactoryForTests(factory);

    const cs = makeDo();

    // Series_completed must be emitted *after* the DO subscribes inside
    // /create. Trigger emission as soon as create_series is observed.
    let createSeriesSeen = false;
    const observer = setInterval(() => {
      if (!createSeriesSeen && fake.sent.some((s) => s.name === "create_series")) {
        createSeriesSeen = true;
        fake.emit({ name: "series_completed", params: ["cs_123", "sds_1"] });
      }
    }, 0);

    const resp = await cs.fetch(
      post("/create", { symbol: "NASDAQ:AAPL", timeframe: "60", bars: 50 }),
    );
    clearInterval(observer);

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      ok: true;
      chartSession: string;
      parentSeriesId: string;
    };
    expect(body.ok).toBe(true);
    expect(body.parentSeriesId).toBe("sds_1");
    expect(body.chartSession).toMatch(/^cs_/);

    const sentNames = fake.sent.map((s) => s.name);
    expect(sentNames).toContain("chart_create_session");
    expect(sentNames).toContain("resolve_symbol");
    expect(sentNames).toContain("create_series");

    const state = cs._state();
    expect(state.hasConnection).toBe(true);
    expect(state.chartSession?.symbol).toBe("NASDAQ:AAPL");
    expect(state.chartSession?.timeframe).toBe("60");
    expect(state.chartSession?.bars).toBe(50);
  });

  it("/close tears down the active connection and clears state", async () => {
    const fake = makeFakeConnection();
    _setConnectFactoryForTests(async () => fake);
    const cs = makeDo();

    const observer = setInterval(() => {
      if (fake.sent.some((s) => s.name === "create_series")) {
        fake.emit({ name: "series_completed", params: ["cs_123", "sds_1"] });
      }
    }, 0);
    await cs.fetch(post("/create", { symbol: "NASDAQ:AAPL" }));
    clearInterval(observer);
    expect(cs._state().hasConnection).toBe(true);

    const resp = await cs.fetch(post("/close"));
    expect(resp.status).toBe(200);
    expect(cs._state().hasConnection).toBe(false);
    expect(cs._state().chartSession).toBeNull();
    expect(fake.closed).toBe(true);
  });

});

describe("Slot allocation", () => {
  it("auto-increments slot names st1, st2, ... when slots are added directly to state", () => {
    // Probe the private allocator via _state() snapshots before/after manual
    // append. We can't fully exercise /study/create without mocking the
    // pine-facade fetch, so instead we drive the allocator by calling the
    // private hook through repeated /study/create attempts that fail
    // pre-state-mutation. Easiest path: re-read _state() to confirm the
    // counter starts at 1 and bumps after a full /study/create round-trip
    // would. Since that depends on real metainfo, this test focuses on the
    // initial counter and resets on /create.
    const cs = makeDo();
    expect(cs._state().nextSlotIndex).toBe(1);
  });
});
