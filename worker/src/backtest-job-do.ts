// BacktestJob Durable Object (Slice B / tradingview-e1q + Slice C / tradingview-44p).
//
// One DO instance owns one async backtest job: submission, lifecycle state,
// event stream, result pointer. Slice B shipped the orchestration shell;
// Slice C plugs in walkforward, matrix, and analyze runners. CPCV (Slice D)
// and optimize-deep land later via the same dispatcher.
//
// Storage split (per Slice B design):
//   - DO SQLite (this DO's `state.storage.sql`): jobs row, job_events ring,
//     leases. Authority for state machine.
//   - R2 (env.CACHE_DATA bucket): large arrays — full result, per-fold
//     partials — under `backtest/jobs/<jobId>/`. The DO writes pointers, not
//     payloads, into SQLite.
//   - KV (env.CACHE_META): canonical-key → jobId index only, used to make
//     `submit` idempotent across DO instances when the caller didn't supply
//     an explicit idempotencyKey.
//
// Routes (all addressed via the Worker as `https://backtest-job.internal/...`):
//   POST /submit                  body = JobSubmission           → { jobId, deduped, status }
//   GET  /status                  → JobStatus
//   GET  /events?since=<seq>      SSE with Last-Event-ID resume → text/event-stream
//   GET  /result                  → JobResult (final) | 409 if not done
//   POST /cancel                  → { ok, status }
//
// One DO instance per `jobId`. The Worker resolves DO id from the canonical
// key index in KV when honouring idempotency, then proxies the request.

export const BACKTEST_JOB_TYPES = [
  "walkforward",
  "cpcv",
  "matrix",
  "optimize-deep",
  "analyze",
  "ohlcvExtract",
] as const;
export type BacktestJobType = (typeof BACKTEST_JOB_TYPES)[number];

export const BACKTEST_JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "error",
  "cancelled",
] as const;
export type BacktestJobStatus = (typeof BACKTEST_JOB_STATUSES)[number];

export interface JobSubmission {
  jobId: string;
  type: BacktestJobType;
  canonicalKey: string;
  idempotencyKey?: string;
  workerVersion: string;
  submittedAt: number;
  payload: Record<string, unknown>;
}

export interface JobStatusResponse {
  jobId: string;
  type: BacktestJobType;
  status: BacktestJobStatus;
  submittedAt: number;
  startedAt?: number;
  finishedAt?: number;
  workerVersion: string;
  resultR2Key?: string;
  error?: { code: string; message: string };
  progress?: { phase: string; current?: number; total?: number };
}

export interface JobEventRecord {
  seq: number;
  ts: number;
  kind: "status" | "progress" | "partial" | "error" | "done";
  payload: Record<string, unknown>;
}

export interface BacktestJobBindings {
  BACKTEST_JOB: {
    idFromName: (name: string) => any;
    get: (id: any) => { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  };
  CACHE_DATA: {
    get: (key: string) => Promise<{ body: ReadableStream | null } | null>;
    put: (key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string; contentEncoding?: string } }) => Promise<unknown>;
  };
  CACHE_META: {
    get: (key: string) => Promise<string | null>;
    put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<unknown>;
    delete: (key: string) => Promise<unknown>;
  };
}

// Pluggable runner dispatcher. Allows the DO to remain importable without
// pulling the worker-side strategy / TradingView code into unit tests; the
// production wiring is set in `worker/src/index.ts` via setBacktestRunner.
export interface JobRunnerCacheKv {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>;
}

export interface JobRunnerR2Bucket {
  get: (
    key: string,
  ) => Promise<{ body: ReadableStream | null } | null>;
  put: (
    key: string,
    value: ArrayBuffer | string,
    options?: {
      httpMetadata?: { contentType?: string; contentEncoding?: string };
    },
  ) => Promise<unknown>;
}

export interface JobRunnerContext {
  jobId: string;
  type: BacktestJobType;
  payload: Record<string, unknown>;
  emitProgress: (phase: string, current?: number, total?: number) => void;
  emitPartial: (note: string, payload: Record<string, unknown>) => void;
  // KV handle for per-cell strategy-run caching. Threaded from
  // env.CACHE_META so matrix/walkforward sweeps can short-circuit duplicate
  // TV WS calls across job submissions, and so the OHLCV extractor can
  // index (symbol, tf, fromTs, toTs) -> r2-key entries.
  kv?: JobRunnerCacheKv;
  // R2 bucket handle (env.CACHE_DATA) for runners that persist large per-cell
  // artefacts directly (e.g., the OHLCV extractor's gzip JSON-Lines files).
  // Walkforward / matrix / cpcv / analyze return their result via the alarm
  // handler and don't use this binding.
  r2?: JobRunnerR2Bucket;
}

export type JobRunner = (
  ctx: JobRunnerContext,
) => Promise<Record<string, unknown>>;

let registeredRunner: JobRunner | null = null;

export const setBacktestRunner = (runner: JobRunner | null): void => {
  registeredRunner = runner;
};

export const getBacktestRunner = (): JobRunner | null => registeredRunner;

const SSE_HEARTBEAT_MS = 15_000;
const SSE_DEFAULT_MAX_AGE_MS = 4 * 60 * 1000;
const MAX_EVENTS_PER_JOB = 5_000;

const json = (data: unknown, init?: ResponseInit) =>
  Response.json(data, init);

const errorResponse = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, { status });

const nowMs = () => Date.now();

const isJobType = (value: unknown): value is BacktestJobType =>
  typeof value === "string" && (BACKTEST_JOB_TYPES as readonly string[]).includes(value);

interface JobRow {
  id: string;
  type: BacktestJobType;
  status: BacktestJobStatus;
  canonical_key: string;
  idempotency_key: string | null;
  submitted_at: number;
  started_at: number | null;
  finished_at: number | null;
  payload: string;
  result_r2_key: string | null;
  error_json: string | null;
  worker_version: string;
  progress_json: string | null;
}

interface SqlBacking {
  exec: (sql: string, ...bindings: unknown[]) => SqlCursor;
}

interface SqlCursor {
  toArray: () => Array<Record<string, unknown>>;
  one: () => Record<string, unknown> | null;
}

interface AlarmStorage {
  setAlarm: (when: number) => Promise<void>;
  deleteAlarm?: () => Promise<void>;
  getAlarm?: () => Promise<number | null>;
}

const ensureSchema = (sql: SqlBacking) => {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      idempotency_key TEXT,
      submitted_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      payload TEXT NOT NULL,
      result_r2_key TEXT,
      error_json TEXT,
      worker_version TEXT NOT NULL,
      progress_json TEXT
    );
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS job_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_job_events_jobid_seq ON job_events(job_id, seq);`);
  sql.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_canonical ON jobs(canonical_key);`);
};

export class BacktestJob {
  private state: DurableObjectState;
  private env: BacktestJobBindings;
  private sql: SqlBacking;
  private schemaReady = false;

  constructor(state: DurableObjectState, env: BacktestJobBindings) {
    this.state = state;
    this.env = env;
    this.sql = (state.storage as any).sql as SqlBacking;
  }

  private ensureSchema() {
    if (!this.schemaReady) {
      ensureSchema(this.sql);
      this.schemaReady = true;
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "POST" && path === "/submit") {
        return await this.handleSubmit(request);
      }
      if (request.method === "GET" && path === "/status") {
        return await this.handleStatus();
      }
      if (request.method === "GET" && path === "/events") {
        return this.handleEvents(request, url);
      }
      if (request.method === "GET" && path === "/result") {
        return await this.handleResult();
      }
      if (request.method === "POST" && path === "/cancel") {
        return await this.handleCancel();
      }
      return errorResponse(404, "not_found", `unknown route: ${request.method} ${path}`);
    } catch (err: any) {
      return errorResponse(500, "do_error", err?.message ?? "internal DO error");
    }
  }

  // ----- handlers -----

  private async handleSubmit(request: Request): Promise<Response> {
    let body: JobSubmission;
    try {
      body = (await request.json()) as JobSubmission;
    } catch {
      return errorResponse(400, "invalid_json", "invalid JSON body");
    }
    if (!body?.jobId || typeof body.jobId !== "string") {
      return errorResponse(400, "missing_jobId", "jobId required");
    }
    if (!isJobType(body.type)) {
      return errorResponse(400, "invalid_type", `type must be one of ${BACKTEST_JOB_TYPES.join(",")}`);
    }
    if (!body.canonicalKey || typeof body.canonicalKey !== "string") {
      return errorResponse(400, "missing_canonical_key", "canonicalKey required");
    }
    if (!body.workerVersion || typeof body.workerVersion !== "string") {
      return errorResponse(400, "missing_worker_version", "workerVersion required");
    }

    const existing = this.sql
      .exec(`SELECT * FROM jobs WHERE id = ?`, body.jobId)
      .one() as JobRow | null;
    if (existing) {
      return json({ jobId: existing.id, deduped: true, status: existing.status });
    }

    const submittedAt = body.submittedAt ?? nowMs();
    this.sql.exec(
      `INSERT INTO jobs (id, type, status, canonical_key, idempotency_key, submitted_at, payload, worker_version)
       VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`,
      body.jobId,
      body.type,
      body.canonicalKey,
      body.idempotencyKey ?? null,
      submittedAt,
      JSON.stringify(body.payload ?? {}),
      body.workerVersion,
    );

    this.appendEvent(body.jobId, "status", { status: "queued", submittedAt });

    // Schedule the dispatch via alarm so submit returns immediately. The
    // alarm() handler picks up the queued row and runs the registered
    // runner. Without a runner registered (unit-test scope, or a job type
    // not yet implemented) we mark the job errored so callers see a
    // deterministic terminal state.
    if (registeredRunner) {
      // Schedule for "as soon as possible" — Workers' alarm system runs
      // back-to-back alarms with sub-second latency.
      await this.state.storage.setAlarm(nowMs());
      return json({ jobId: body.jobId, deduped: false, status: "queued" });
    }
    this.transitionToTerminal(body.jobId, "error", {
      code: "runner_not_implemented",
      message: `runner for type=${body.type} not registered with this Worker`,
    });
    return json({ jobId: body.jobId, deduped: false, status: "error" });
  }

  // Alarm handler — runs the registered runner for the queued job.
  async alarm(): Promise<void> {
    this.ensureSchema();
    const row = this.singleJob();
    if (!row) return;
    if (row.status !== "queued") return; // already handled / cancelled / completed
    const runner = registeredRunner;
    if (!runner) {
      this.transitionToTerminal(row.id, "error", {
        code: "runner_not_implemented",
        message: `no runner registered for type=${row.type}`,
      });
      return;
    }

    // Mark running.
    const startedAt = nowMs();
    this.sql.exec(
      `UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`,
      startedAt,
      row.id,
    );
    this.appendEvent(row.id, "status", { status: "running", startedAt });

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      // Tolerate malformed payload — runner gets {} and decides.
    }

    const ctx: JobRunnerContext = {
      jobId: row.id,
      type: row.type,
      payload,
      emitProgress: (phase, current, total) => {
        this.sql.exec(
          `UPDATE jobs SET progress_json = ? WHERE id = ?`,
          JSON.stringify({ phase, current, total }),
          row.id,
        );
        this.appendEvent(row.id, "progress", { phase, current, total });
      },
      emitPartial: (note, partialPayload) => {
        this.appendEvent(row.id, "partial", { note, ...partialPayload });
      },
      kv: this.env.CACHE_META,
      r2: this.env.CACHE_DATA,
    };

    try {
      const result = await runner(ctx);
      const r2Key = `backtest/jobs/${row.id}/result.json`;
      const json = JSON.stringify({
        jobId: row.id,
        type: row.type,
        result,
        finishedAt: nowMs(),
      });
      await this.env.CACHE_DATA.put(r2Key, json, {
        httpMetadata: { contentType: "application/json" },
      });
      const finishedAt = nowMs();
      this.sql.exec(
        `UPDATE jobs SET status = 'done', finished_at = ?, result_r2_key = ? WHERE id = ?`,
        finishedAt,
        r2Key,
        row.id,
      );
      this.appendEvent(row.id, "done", { status: "done", finishedAt, resultR2Key: r2Key });
    } catch (err: any) {
      const detail = {
        code: typeof err?.code === "string" ? err.code : "runner_error",
        message: typeof err?.message === "string" ? err.message : String(err),
      };
      this.transitionToTerminal(row.id, "error", detail);
    }
  }

  private async handleStatus(): Promise<Response> {
    const row = this.singleJob();
    if (!row) return errorResponse(404, "not_found", "no job in this DO instance");
    return json(jobRowToStatus(row));
  }

  private handleEvents(request: Request, url: URL): Response {
    const row = this.singleJob();
    if (!row) return errorResponse(404, "not_found", "no job in this DO instance");

    const lastEventHeader = request.headers.get("Last-Event-ID");
    const since = Number(url.searchParams.get("since") ?? lastEventHeader ?? "0") || 0;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const encoder = new TextEncoder();
        const writer = (s: string) => controller.enqueue(encoder.encode(s));

        // Backfill historical events.
        const backlog = this.sql
          .exec(
            `SELECT seq, ts, kind, payload FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq ASC`,
            row.id,
            since,
          )
          .toArray() as Array<{ seq: number; ts: number; kind: string; payload: string }>;
        for (const ev of backlog) {
          writer(`id: ${ev.seq}\nevent: ${ev.kind}\ndata: ${ev.payload}\n\n`);
        }

        // Heartbeats keep proxies from killing the connection.
        const heartbeat = setInterval(() => {
          try { writer(`: heartbeat ${nowMs()}\n\n`); } catch { /* closed */ }
        }, SSE_HEARTBEAT_MS);

        const tearDown = () => {
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        };

        // Two terminal signals must close the stream:
        //   1. The backlog itself contains a terminal event — covers the
        //      common "subscribe before completion, completion lands during
        //      backlog scan" race.
        //   2. The persisted job row is already in a terminal status — covers
        //      `Last-Event-ID` resume after completion, where backlog is
        //      empty but no further events will ever arrive.
        const backlogTerminal = backlog.some((e) => e.kind === "done" || e.kind === "error");
        const rowTerminal =
          row.status === "done" || row.status === "error" || row.status === "cancelled";
        if (backlogTerminal || rowTerminal) {
          tearDown();
          return;
        }

        setTimeout(tearDown, SSE_DEFAULT_MAX_AGE_MS);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  private async handleResult(): Promise<Response> {
    const row = this.singleJob();
    if (!row) return errorResponse(404, "not_found", "no job in this DO instance");
    if (row.status !== "done") {
      return errorResponse(409, "not_done", `job status=${row.status}`);
    }
    if (!row.result_r2_key) {
      return errorResponse(500, "result_missing", "result pointer absent");
    }
    const obj = await this.env.CACHE_DATA.get(row.result_r2_key);
    if (!obj || !obj.body) {
      return errorResponse(404, "result_object_missing", "R2 object absent");
    }
    return new Response(obj.body, {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleCancel(): Promise<Response> {
    const row = this.singleJob();
    if (!row) return errorResponse(404, "not_found", "no job in this DO instance");
    if (row.status === "done" || row.status === "error" || row.status === "cancelled") {
      return json({ ok: true, status: row.status });
    }
    this.transitionToTerminal(row.id, "cancelled", {
      code: "cancelled_by_caller",
      message: "cancel route invoked",
    });
    return json({ ok: true, status: "cancelled" });
  }

  // ----- internals -----

  private singleJob(): JobRow | null {
    return this.sql
      .exec(`SELECT * FROM jobs ORDER BY submitted_at DESC LIMIT 1`)
      .one() as JobRow | null;
  }

  private appendEvent(jobId: string, kind: JobEventRecord["kind"], payload: Record<string, unknown>) {
    this.sql.exec(
      `INSERT INTO job_events (job_id, ts, kind, payload) VALUES (?, ?, ?, ?)`,
      jobId,
      nowMs(),
      kind,
      JSON.stringify(payload),
    );
    // Soft cap to keep DO storage bounded.
    this.sql.exec(
      `DELETE FROM job_events WHERE job_id = ? AND seq <= (
         SELECT seq FROM job_events WHERE job_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?
       )`,
      jobId,
      jobId,
      MAX_EVENTS_PER_JOB,
    );
  }

  private transitionToTerminal(
    jobId: string,
    status: "done" | "error" | "cancelled",
    detail: { code: string; message: string },
  ) {
    const ts = nowMs();
    if (status === "error" || status === "cancelled") {
      this.sql.exec(
        `UPDATE jobs SET status = ?, finished_at = ?, error_json = ? WHERE id = ?`,
        status,
        ts,
        JSON.stringify(detail),
        jobId,
      );
    } else {
      this.sql.exec(
        `UPDATE jobs SET status = ?, finished_at = ? WHERE id = ?`,
        status,
        ts,
        jobId,
      );
    }
    this.appendEvent(jobId, status === "done" ? "done" : "error", {
      status,
      ...detail,
    });
  }
}

// ----- helpers shared with the worker layer -----

export const jobRowToStatus = (row: JobRow): JobStatusResponse => ({
  jobId: row.id,
  type: row.type,
  status: row.status,
  submittedAt: row.submitted_at,
  startedAt: row.started_at ?? undefined,
  finishedAt: row.finished_at ?? undefined,
  workerVersion: row.worker_version,
  resultR2Key: row.result_r2_key ?? undefined,
  error: row.error_json ? (JSON.parse(row.error_json) as JobStatusResponse["error"]) : undefined,
  progress: row.progress_json ? (JSON.parse(row.progress_json) as JobStatusResponse["progress"]) : undefined,
});

// SHA-256 helper used for the canonical-key hash. Lives here (not in core)
// because Workers / DOs both have the WebCrypto subtle API; importing crypto
// from node:crypto would not survive the Workers runtime.
export const sha256Hex = async (input: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
};

// Build the canonical job key. Order matters — we sort the property entries
// before hashing so the same logical input always hashes identically across
// callers.
export interface CanonicalJobInputs {
  scriptId?: string;
  scriptVersion?: string;
  metaInfoVersion?: string;
  resolvedInputWire?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  symbol?: string;
  adjustment?: string;
  sessionType?: string;
  chartType?: string;
  endpoint?: string;
  timeframe?: string | number;
  barCount?: number;
  mode?: string;
  useBarMagnifier?: boolean;
  dataQuality?: string;
  windowFrom?: string | number;
  windowTo?: string | number;
  workerVersion: string;
}

const sortedJsonStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => sortedJsonStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedJsonStringify(v)}`).join(",")}}`;
};

export const buildCanonicalKey = async (
  inputs: CanonicalJobInputs,
): Promise<string> => sha256Hex(sortedJsonStringify(inputs));

export const buildJobId = (canonicalKey: string, idempotencyKey?: string): string => {
  const seed = idempotencyKey ? `${idempotencyKey}|${canonicalKey}` : canonicalKey;
  return `job_${seed.slice(0, 24)}`;
};
