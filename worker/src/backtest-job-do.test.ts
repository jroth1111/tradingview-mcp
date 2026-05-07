import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKTEST_JOB_TYPES,
  BacktestJob,
  buildCanonicalKey,
  buildJobId,
  sha256Hex,
} from "./backtest-job-do";

// ---- in-memory SQL backing approximating Cloudflare's `state.storage.sql`. ----
// We only implement the subset of the API the DO uses (exec / toArray / one /
// AUTOINCREMENT-style PRIMARY KEY). The DO addresses storage as
// `(state.storage as any).sql.exec(...)`, so the stub mirrors that surface.

type Row = Record<string, any>;

class StubSql {
  private jobs: Row[] = [];
  private events: Row[] = [];
  private nextEventSeq = 1;

  exec(sql: string, ...bindings: any[]): { toArray: () => Row[]; one: () => Row | null } {
    const trimmed = sql.replace(/\s+/g, " ").trim();
    if (trimmed.startsWith("CREATE TABLE") || trimmed.startsWith("CREATE INDEX")) {
      return cursorOf([]);
    }
    if (trimmed.startsWith("SELECT * FROM jobs WHERE id = ?")) {
      const found = this.jobs.find((j) => j.id === bindings[0]);
      return cursorOf(found ? [found] : []);
    }
    if (trimmed.startsWith("SELECT * FROM jobs ORDER BY submitted_at DESC LIMIT 1")) {
      const sorted = [...this.jobs].sort((a, b) => b.submitted_at - a.submitted_at);
      return cursorOf(sorted.slice(0, 1));
    }
    if (trimmed.startsWith("INSERT INTO jobs")) {
      const [id, type, canonical_key, idempotency_key, submitted_at, payload, worker_version] = bindings;
      this.jobs.push({
        id,
        type,
        status: "queued",
        canonical_key,
        idempotency_key,
        submitted_at,
        started_at: null,
        finished_at: null,
        payload,
        result_r2_key: null,
        error_json: null,
        worker_version,
        progress_json: null,
      });
      return cursorOf([]);
    }
    if (trimmed.startsWith("UPDATE jobs SET status = ?, finished_at = ?, error_json = ? WHERE id = ?")) {
      const [status, finished_at, error_json, id] = bindings;
      const row = this.jobs.find((j) => j.id === id);
      if (row) Object.assign(row, { status, finished_at, error_json });
      return cursorOf([]);
    }
    if (trimmed.startsWith("UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?")) {
      const [status, finished_at, id] = bindings;
      const row = this.jobs.find((j) => j.id === id);
      if (row) Object.assign(row, { status, finished_at });
      return cursorOf([]);
    }
    if (trimmed.startsWith("INSERT INTO job_events")) {
      const [job_id, ts, kind, payload] = bindings;
      this.events.push({ seq: this.nextEventSeq++, job_id, ts, kind, payload });
      return cursorOf([]);
    }
    if (trimmed.startsWith("DELETE FROM job_events WHERE job_id = ? AND seq <=")) {
      // Soft cap is irrelevant for the small test event counts; ignore.
      return cursorOf([]);
    }
    if (trimmed.startsWith("SELECT seq, ts, kind, payload FROM job_events")) {
      const [job_id, since] = bindings;
      const rows = this.events
        .filter((e) => e.job_id === job_id && e.seq > since)
        .sort((a, b) => a.seq - b.seq);
      return cursorOf(rows);
    }
    throw new Error(`StubSql unhandled exec: ${trimmed}`);
  }

  // Inspection helpers for tests:
  allJobs() { return [...this.jobs]; }
  allEvents() { return [...this.events]; }
}

const cursorOf = (rows: Row[]) => ({
  toArray: () => rows,
  one: () => (rows.length > 0 ? rows[0] : null),
});

class StubState {
  storage: { sql: StubSql };
  constructor(sql: StubSql) {
    this.storage = { sql };
  }
}

const makeEnv = () => ({
  CACHE_DATA: {
    objects: new Map<string, ArrayBuffer | string>(),
    async get(key: string) {
      const v = this.objects.get(key);
      if (v === undefined) return null;
      const text = typeof v === "string" ? v : new TextDecoder().decode(v);
      return { body: new Response(text).body };
    },
    async put(key: string, value: ArrayBuffer | string) {
      this.objects.set(key, value);
    },
  },
  CACHE_META: {
    map: new Map<string, string>(),
    async get(key: string) { return this.map.get(key) ?? null; },
    async put(key: string, value: string) { this.map.set(key, value); },
    async delete(key: string) { this.map.delete(key); },
  },
});

const makeDo = () => {
  const sql = new StubSql();
  const env = makeEnv() as any;
  const state = new StubState(sql) as unknown as DurableObjectState;
  return { sql, env, do: new BacktestJob(state, env) };
};

const post = (path: string, body?: unknown) =>
  new Request(`https://backtest-job.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://backtest-job.local${path}`, { method: "GET", headers });

describe("BacktestJob DO routing", () => {
  it("routes unknown paths to 404", async () => {
    const { do: doInst } = makeDo();
    const resp = await doInst.fetch(post("/does-not-exist", {}));
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as any;
    expect(body.error.code).toBe("not_found");
  });

  it("/submit rejects invalid JSON", async () => {
    const { do: doInst } = makeDo();
    const resp = await doInst.fetch(
      new Request("https://backtest-job.local/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as any;
    expect(body.error.code).toBe("invalid_json");
  });

  it("/submit rejects unknown job type", async () => {
    const { do: doInst } = makeDo();
    const resp = await doInst.fetch(
      post("/submit", {
        jobId: "job_abc",
        type: "nonsense",
        canonicalKey: "k",
        workerVersion: "test",
      }),
    );
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as any;
    expect(body.error.code).toBe("invalid_type");
  });
});

describe("BacktestJob /submit lifecycle", () => {
  it("inserts a job row, transitions to error with runner_not_implemented (Slice B shell)", async () => {
    const { do: doInst, sql } = makeDo();
    const resp = await doInst.fetch(
      post("/submit", {
        jobId: "job_test_1",
        type: "walkforward",
        canonicalKey: "deadbeef",
        workerVersion: "slice-b@test",
        submittedAt: 1700000000000,
        payload: { foo: 1 },
      }),
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.jobId).toBe("job_test_1");
    expect(body.deduped).toBe(false);
    expect(body.status).toBe("error");

    const jobs = sql.allJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job_test_1");
    expect(jobs[0].status).toBe("error");
    expect(jobs[0].canonical_key).toBe("deadbeef");
    expect(JSON.parse(jobs[0].payload)).toEqual({ foo: 1 });
    expect(JSON.parse(jobs[0].error_json).code).toBe("runner_not_implemented");

    const events = sql.allEvents();
    // queued status event then terminal error event:
    expect(events.map((e) => e.kind)).toEqual(["status", "error"]);
  });

  it("returns deduped:true on resubmit with the same jobId", async () => {
    const { do: doInst } = makeDo();
    const submission = {
      jobId: "job_dedupe",
      type: "matrix",
      canonicalKey: "abc",
      workerVersion: "slice-b@test",
    };
    const a = await doInst.fetch(post("/submit", submission));
    expect(a.status).toBe(200);
    expect(((await a.json()) as any).deduped).toBe(false);

    const b = await doInst.fetch(post("/submit", submission));
    expect(b.status).toBe(200);
    const bbody = (await b.json()) as any;
    expect(bbody.deduped).toBe(true);
    expect(bbody.jobId).toBe("job_dedupe");
  });
});

describe("BacktestJob status / cancel / events", () => {
  it("/status returns 404 before any submit", async () => {
    const { do: doInst } = makeDo();
    const resp = await doInst.fetch(get("/status"));
    expect(resp.status).toBe(404);
  });

  it("/status returns the inserted job row after submit", async () => {
    const { do: doInst } = makeDo();
    await doInst.fetch(
      post("/submit", {
        jobId: "job_status",
        type: "analyze",
        canonicalKey: "k",
        workerVersion: "v",
      }),
    );
    const resp = await doInst.fetch(get("/status"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    expect(body.jobId).toBe("job_status");
    expect(body.type).toBe("analyze");
    expect(body.status).toBe("error"); // Slice B always lands in error.
  });

  it("/cancel is idempotent against a terminal job", async () => {
    const { do: doInst } = makeDo();
    await doInst.fetch(
      post("/submit", {
        jobId: "job_cancel",
        type: "cpcv",
        canonicalKey: "k",
        workerVersion: "v",
      }),
    );
    const resp = await doInst.fetch(post("/cancel"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as any;
    // submit already drove this to `error`; cancel should not flip terminal status.
    expect(body.status).toBe("error");
    expect(body.ok).toBe(true);
  });

  it("/events streams backlog as SSE and terminates on terminal frame", async () => {
    const { do: doInst } = makeDo();
    await doInst.fetch(
      post("/submit", {
        jobId: "job_events",
        type: "optimize-deep",
        canonicalKey: "k",
        workerVersion: "v",
      }),
    );
    const resp = await doInst.fetch(get("/events"));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("text/event-stream");
    const text = await resp.text();
    expect(text).toMatch(/event: status/);
    expect(text).toMatch(/event: error/);
    // Ordering: status event id < error event id.
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids[0]).toBeLessThan(ids[1]);
  });

  it("/events Last-Event-ID skips replayed events", async () => {
    const { do: doInst } = makeDo();
    await doInst.fetch(
      post("/submit", {
        jobId: "job_resume",
        type: "walkforward",
        canonicalKey: "k",
        workerVersion: "v",
      }),
    );
    // First request to capture seq IDs.
    const first = await doInst.fetch(get("/events"));
    const firstText = await first.text();
    const ids = [...firstText.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    const lastId = ids[ids.length - 1];

    const second = await doInst.fetch(get("/events", { "Last-Event-ID": String(lastId) }));
    const secondText = await second.text();
    expect(secondText).not.toMatch(new RegExp(`^id: ${ids[0]}$`, "m"));
  });
});

describe("canonical-key + jobId helpers", () => {
  it("BACKTEST_JOB_TYPES enumerates the documented set", () => {
    expect([...BACKTEST_JOB_TYPES].sort()).toEqual(
      [
        "analyze",
        "cpcv",
        "matrix",
        "ohlcvExtract",
        "optimize-deep",
        "walkforward",
      ].sort(),
    );
  });

  it("sha256Hex returns the canonical 64-char hex string", async () => {
    const out = await sha256Hex("hello");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
    // Independent reference value:
    expect(out).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("buildCanonicalKey is order-insensitive on the inputs envelope", async () => {
    const a = await buildCanonicalKey({
      workerVersion: "v",
      symbol: "AAPL",
      barCount: 1000,
      timeframe: "60",
    });
    const b = await buildCanonicalKey({
      workerVersion: "v",
      timeframe: "60",
      barCount: 1000,
      symbol: "AAPL",
    });
    expect(a).toBe(b);
  });

  it("buildCanonicalKey diverges when any envelope field changes", async () => {
    const base = {
      workerVersion: "v",
      symbol: "AAPL",
      barCount: 1000,
      timeframe: "60",
    };
    const a = await buildCanonicalKey(base);
    const b = await buildCanonicalKey({ ...base, barCount: 1001 });
    expect(a).not.toBe(b);
  });

  it("buildJobId folds in the idempotency key when present", () => {
    const canonical = "abc".repeat(22); // 66 chars
    const a = buildJobId(canonical);
    const b = buildJobId(canonical, "user-supplied");
    expect(a).not.toBe(b);
    expect(a.startsWith("job_")).toBe(true);
    expect(b.startsWith("job_")).toBe(true);
  });
});
