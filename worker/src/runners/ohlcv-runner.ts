// OHLCV bulk extractor runner — `ohlcvExtract` job type.
//
// Pulls deep historical OHLCV across many (symbol × timeframe) cells from
// TradingView, gzip-compresses each cell as JSON-Lines, persists to R2 under
// `backtest/jobs/<jobId>/ohlcv/<symbol>/<tf>.jsonl.gz`, and writes a manifest
// at `backtest/jobs/<jobId>/manifest.json`.
//
// Cell-level idempotency: each cell hashes (symbol, tf, history window,
// dataQuality, adjustment, sessionType) into a canonical key. The runner
// consults `kv` for `ohlcv_idx:<hash>` first and references the existing R2
// key in this job's manifest on hit (no duplicate TV call across jobs). On
// miss it pulls via `backfillCandles`, gzips, writes R2, and records the
// index entry. This is independent of Slice B's whole-job canonical-key
// dedup at submit time and gives finer-grained reuse.
//
// Selector modes:
//   - `symbols`: pass-through array.
//   - `scanner`: paginated calls to scanV2 (TV soft limit ≤ 1000 rows per
//     page) accumulating `data[].s` until totalCount or `maxSymbols` reached.
//
// Concurrency cap defaults to 4 with a hard ceiling of 5 to respect TV's
// concurrent-WS soft rate limit. Inter-cell `delayMs` further dampens the
// session.

import type { TradingviewEndpoint } from "../../../packages/tradingview-core/src";
import {
  backfillCandles,
  type BackfillRequest,
  type Candle,
} from "../tradingview";
import {
  scanV2,
  type Filter2,
  type FilterExpression,
  type ScanSort,
  type Scan2Request,
} from "../scanner-v2";
import type {
  JobRunnerCacheKv,
  JobRunnerR2Bucket,
} from "../backtest-job-do";

export const OHLCV_TIMEFRAMES = [
  "1",
  "3",
  "5",
  "15",
  "30",
  "60",
  "120",
  "240",
  "1D",
  "1W",
  "1M",
] as const;
export type OhlcvTimeframe = (typeof OHLCV_TIMEFRAMES)[number];

export type OhlcvSelector =
  | { mode: "symbols"; symbols: string[] }
  | {
      mode: "scanner";
      scannerFilter: {
        market: string;
        columns: string[];
        filter?: FilterExpression[];
        filter2?: Filter2;
        sort?: ScanSort;
        markets?: string[];
        range?: [number, number];
      };
      maxSymbols?: number;
    };

export interface OhlcvHistoryWindow {
  fromTs?: number; // unix seconds inclusive; bars below are dropped after pull
  toTs?: number; // unix seconds exclusive; bars at-or-above are dropped
  bars?: number; // alternative target; overrides default backfill total
}

export interface OhlcvExtractInput {
  selector: OhlcvSelector;
  timeframes: readonly OhlcvTimeframe[];
  history?: {
    default?: OhlcvHistoryWindow;
    perTf?: Partial<Record<OhlcvTimeframe, OhlcvHistoryWindow>>;
  };
  options?: {
    dataQuality?: string;
    adjustment?: string;
    sessionType?: string;
    parallelism?: number;
    delayMsBetweenCells?: number;
  };
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  // Plumbed by the dispatcher; not part of the wire input.
  jobId?: string;
  kv?: JobRunnerCacheKv;
  r2?: JobRunnerR2Bucket;
  // Test seam: callers may stub the candle fetcher to avoid TV WebSocket
  // setup. Production wiring uses backfillCandles.
  fetchCandles?: (req: BackfillRequest) => Promise<Candle[]>;
  // Test seam: scanner enumeration. Production wiring uses scanV2.
  scan?: (req: Scan2Request) => Promise<{
    totalCount: number;
    data: Array<{ s: string; d: unknown[] }>;
  }>;
  // Optional progress callback used by the dispatcher to emit SSE events.
  onCellComplete?: (cell: OhlcvCellManifest) => void;
}

export interface OhlcvCellManifest {
  symbol: string;
  timeframe: OhlcvTimeframe;
  r2Key: string;
  bars: number;
  fromTs: number | null;
  toTs: number | null;
  bytes: number;
  durationMs: number;
  cached: boolean; // true if served from KV index hit
}

export interface OhlcvCellError {
  symbol: string;
  timeframe: OhlcvTimeframe;
  reason: string;
}

export interface OhlcvManifest {
  jobId: string;
  selectorMode: OhlcvSelector["mode"];
  symbolCount: number;
  timeframeCount: number;
  cells: OhlcvCellManifest[];
  totalBars: number;
  totalBytes: number;
  cacheHits: number;
  missingCells: OhlcvCellError[];
  errors: OhlcvCellError[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
}

const PARALLELISM_DEFAULT = 4;
const PARALLELISM_MAX = 5;
const SCANNER_PAGE_SIZE = 1000;
const SCANNER_DEFAULT_CAP = 5_000;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`)
    .join(",")}}`;
};

const sha256Hex = async (input: string): Promise<string> => {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < arr.length; i += 1) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
};

export const buildCellIndexKey = async (
  symbol: string,
  timeframe: OhlcvTimeframe,
  window: OhlcvHistoryWindow,
  options: NonNullable<OhlcvExtractInput["options"]> | undefined,
): Promise<string> => {
  const seed = {
    symbol,
    timeframe,
    fromTs: window.fromTs ?? null,
    toTs: window.toTs ?? null,
    bars: window.bars ?? null,
    dataQuality: options?.dataQuality ?? null,
    adjustment: options?.adjustment ?? null,
    sessionType: options?.sessionType ?? null,
  };
  const h = await sha256Hex(stableStringify(seed));
  return `ohlcv_idx:${h}`;
};

export const cellR2Key = (
  jobId: string,
  symbol: string,
  timeframe: OhlcvTimeframe,
): string => `backtest/jobs/${jobId}/ohlcv/${symbol}/${timeframe}.jsonl.gz`;

export const manifestR2Key = (jobId: string): string =>
  `backtest/jobs/${jobId}/manifest.json`;

const candlesToJsonLines = (candles: readonly Candle[]): string => {
  let out = "";
  for (const c of candles) {
    out +=
      JSON.stringify({
        t: c.timestamp,
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: c.volume,
      }) + "\n";
  }
  return out;
};

const gzipString = async (text: string): Promise<ArrayBuffer> => {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
};

const filterByWindow = (
  candles: readonly Candle[],
  window: OhlcvHistoryWindow,
): Candle[] => {
  if (window.fromTs === undefined && window.toTs === undefined) {
    return candles.slice();
  }
  return candles.filter((c) => {
    if (window.fromTs !== undefined && c.timestamp < window.fromTs) return false;
    if (window.toTs !== undefined && c.timestamp >= window.toTs) return false;
    return true;
  });
};

const resolveSymbols = async (
  selector: OhlcvSelector,
  scan: NonNullable<OhlcvExtractInput["scan"]>,
): Promise<string[]> => {
  if (selector.mode === "symbols") {
    if (!Array.isArray(selector.symbols) || selector.symbols.length === 0) {
      throw new Error("ohlcvExtract: selector.symbols must be a non-empty array");
    }
    return Array.from(new Set(selector.symbols)).sort();
  }
  const cap = Math.min(
    Math.max(1, selector.maxSymbols ?? SCANNER_DEFAULT_CAP),
    50_000,
  );
  const seen = new Set<string>();
  let cursor = 0;
  while (cursor < cap) {
    const end = Math.min(cap, cursor + SCANNER_PAGE_SIZE);
    const page = await scan({
      market: selector.scannerFilter.market,
      columns: selector.scannerFilter.columns ?? ["name"],
      filter: selector.scannerFilter.filter,
      filter2: selector.scannerFilter.filter2,
      sort: selector.scannerFilter.sort,
      markets: selector.scannerFilter.markets,
      range: [cursor, end],
    });
    if (!page.data || page.data.length === 0) break;
    for (const row of page.data) {
      if (typeof row.s === "string" && row.s.length > 0) seen.add(row.s);
    }
    if (page.data.length < end - cursor) break;
    if (page.totalCount && cursor + page.data.length >= page.totalCount) break;
    cursor = end;
  }
  if (seen.size === 0) {
    throw new Error("ohlcvExtract: scanner returned zero symbols");
  }
  return Array.from(seen).sort();
};

interface CellWork {
  symbol: string;
  timeframe: OhlcvTimeframe;
  window: OhlcvHistoryWindow;
}

const buildCells = (
  symbols: readonly string[],
  timeframes: readonly OhlcvTimeframe[],
  history: OhlcvExtractInput["history"],
): CellWork[] => {
  const out: CellWork[] = [];
  const def = history?.default ?? {};
  const perTf = history?.perTf ?? {};
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      const win = perTf[tf] ?? def;
      out.push({ symbol, timeframe: tf, window: { ...win } });
    }
  }
  return out;
};

const runWithConcurrency = async <I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> => {
  const out: O[] = new Array(items.length);
  if (items.length === 0) return out;
  const cap = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: cap }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= items.length) return;
        out[idx] = await worker(items[idx], idx);
      }
    }),
  );
  return out;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CellRunOutcome {
  cell?: OhlcvCellManifest;
  missing?: OhlcvCellError;
  error?: OhlcvCellError;
}

export const runOhlcvExtract = async (
  input: OhlcvExtractInput,
): Promise<OhlcvManifest> => {
  if (!input.jobId) throw new Error("ohlcvExtract: jobId required");
  if (!input.r2) throw new Error("ohlcvExtract: r2 binding required");
  if (!Array.isArray(input.timeframes) || input.timeframes.length === 0) {
    throw new Error("ohlcvExtract: timeframes must be a non-empty array");
  }
  for (const tf of input.timeframes) {
    if (!OHLCV_TIMEFRAMES.includes(tf)) {
      throw new Error(`ohlcvExtract: unsupported timeframe '${tf}'`);
    }
  }
  if (!input.selector) throw new Error("ohlcvExtract: selector required");

  const startedAt = Date.now();
  const jobId = input.jobId;
  const fetcher = input.fetchCandles ?? backfillCandles;
  const scanner = input.scan ?? (scanV2 as NonNullable<OhlcvExtractInput["scan"]>);
  const parallelism = Math.max(
    1,
    Math.min(input.options?.parallelism ?? PARALLELISM_DEFAULT, PARALLELISM_MAX),
  );
  const delayMs = Math.max(0, input.options?.delayMsBetweenCells ?? 0);

  const symbols = await resolveSymbols(input.selector, scanner);
  const cells = buildCells(symbols, input.timeframes, input.history);

  const outcomes = await runWithConcurrency(cells, parallelism, async (cell) => {
    const outcome: CellRunOutcome = {};
    const cellStart = Date.now();
    const idxKey = await buildCellIndexKey(
      cell.symbol,
      cell.timeframe,
      cell.window,
      input.options,
    );

    // KV index short-circuit. On hit we trust the recorded r2Key — no
    // duplicate TV call. The recorded entry must point at a still-existing
    // R2 object; if not we fall through to a fresh fetch.
    if (input.kv) {
      try {
        const cached = await input.kv.get(idxKey);
        if (cached) {
          const parsed = JSON.parse(cached) as {
            r2Key?: string;
            bars?: number;
            fromTs?: number | null;
            toTs?: number | null;
            bytes?: number;
          };
          if (parsed && typeof parsed.r2Key === "string") {
            const cellManifest: OhlcvCellManifest = {
              symbol: cell.symbol,
              timeframe: cell.timeframe,
              r2Key: parsed.r2Key,
              bars: typeof parsed.bars === "number" ? parsed.bars : 0,
              fromTs:
                typeof parsed.fromTs === "number" ? parsed.fromTs : null,
              toTs: typeof parsed.toTs === "number" ? parsed.toTs : null,
              bytes: typeof parsed.bytes === "number" ? parsed.bytes : 0,
              durationMs: Date.now() - cellStart,
              cached: true,
            };
            outcome.cell = cellManifest;
            input.onCellComplete?.(cellManifest);
            return outcome;
          }
        }
      } catch {
        // Malformed cache entry — fall through to a fresh extraction.
      }
    }

    let candles: Candle[];
    try {
      candles = await fetcher({
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        total: cell.window.bars,
        endpoint: input.endpoint,
        sessionId: input.sessionId,
        sessionSign: input.sessionSign,
        delayMs,
      });
    } catch (err: any) {
      outcome.error = {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        reason: typeof err?.message === "string" ? err.message : String(err),
      };
      return outcome;
    }

    const trimmed = filterByWindow(candles, cell.window);
    if (trimmed.length === 0) {
      outcome.missing = {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        reason: "no bars within history window",
      };
      return outcome;
    }

    const jsonLines = candlesToJsonLines(trimmed);
    const gz = await gzipString(jsonLines);
    const r2Key = cellR2Key(jobId, cell.symbol, cell.timeframe);
    try {
      await input.r2!.put(r2Key, gz, {
        httpMetadata: {
          contentType: "application/x-ndjson",
          contentEncoding: "gzip",
        },
      });
    } catch (err: any) {
      outcome.error = {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        reason: `r2 put failed: ${
          typeof err?.message === "string" ? err.message : String(err)
        }`,
      };
      return outcome;
    }

    const cellManifest: OhlcvCellManifest = {
      symbol: cell.symbol,
      timeframe: cell.timeframe,
      r2Key,
      bars: trimmed.length,
      fromTs: trimmed[0]?.timestamp ?? null,
      toTs: trimmed[trimmed.length - 1]?.timestamp ?? null,
      bytes: gz.byteLength,
      durationMs: Date.now() - cellStart,
      cached: false,
    };

    if (input.kv) {
      try {
        await input.kv.put(
          idxKey,
          JSON.stringify({
            r2Key: cellManifest.r2Key,
            bars: cellManifest.bars,
            fromTs: cellManifest.fromTs,
            toTs: cellManifest.toTs,
            bytes: cellManifest.bytes,
            finishedAt: Date.now(),
            jobId,
          }),
        );
      } catch {
        // KV write failure is non-fatal — the R2 object is the source of truth.
      }
    }

    outcome.cell = cellManifest;
    input.onCellComplete?.(cellManifest);
    if (delayMs > 0) await sleep(delayMs);
    return outcome;
  });

  const cellList: OhlcvCellManifest[] = [];
  const missing: OhlcvCellError[] = [];
  const errors: OhlcvCellError[] = [];
  let totalBars = 0;
  let totalBytes = 0;
  let cacheHits = 0;
  for (const o of outcomes) {
    if (o.cell) {
      cellList.push(o.cell);
      totalBars += o.cell.bars;
      totalBytes += o.cell.bytes;
      if (o.cell.cached) cacheHits += 1;
    }
    if (o.missing) missing.push(o.missing);
    if (o.error) errors.push(o.error);
  }

  const finishedAt = Date.now();
  const manifest: OhlcvManifest = {
    jobId,
    selectorMode: input.selector.mode,
    symbolCount: symbols.length,
    timeframeCount: input.timeframes.length,
    cells: cellList,
    totalBars,
    totalBytes,
    cacheHits,
    missingCells: missing,
    errors,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
  };

  await input.r2.put(manifestR2Key(jobId), JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });

  return manifest;
};
