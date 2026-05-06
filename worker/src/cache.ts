import { backfillCandles, type Candle, validateTimeframe } from "./tradingview";
import { generateMockCandles } from "./upstream-mock";
import { classifyUpstreamError, toUpstreamError, type ClassifiedUpstreamError } from "./upstream-error";

export const CHUNK_SIZE = 5000;

export type ChunkRef = {
  start: number;
  end: number;
  key: string;
  etag?: string;
};

export interface MetaRecord {
  symbol: string;
  timeframe: string;
  earliest_ts?: number;
  latest_ts?: number;
  bar_count?: number;
  chunks: ChunkRef[];
  version?: number;
  last_updated?: string;
  last_accessed?: string;
  approx_bytes?: number;
  hot_chunk?: string;
}

export type CoverageGap = { from: number; to?: number };

// Normalizers ---------------------------------------------------------------
export const normalizeSymbol = (s: string) => s.trim();
export const normalizeTimeframe = (tf: string | number) => validateTimeframe(tf);

// Compression helpers (Workers' CompressionStream/DecompressionStream)
const gzipJSON = async (data: any): Promise<ArrayBuffer> => {
  const json = JSON.stringify(data);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
};

const gunzipJSON = async (buffer: ArrayBuffer): Promise<any> => {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).json();
};

// R2 helpers ----------------------------------------------------------------
export const putChunk = async (
  bucket: R2Bucket,
  key: string,
  candles: Candle[],
  expectedEtag?: string,
): Promise<{ etag: string; bytes: number }> => {
  const body = await gzipJSON({ candles });
  const res = await bucket.put(key, body, expectedEtag ? { onlyIf: { etagMatches: expectedEtag } } : undefined);
  const size = body.byteLength;
  return { etag: res?.etag || "", bytes: size };
};

export const getChunk = async (bucket: R2Bucket, key: string): Promise<Candle[]> => {
  const obj = await bucket.get(key);
  if (!obj) return [];
  const buffer = await obj.arrayBuffer();
  const parsed = await gunzipJSON(buffer);
  return Array.isArray(parsed?.candles) ? (parsed.candles as Candle[]) : [];
};

// KV/D1 meta helpers --------------------------------------------------------
export const getMeta = async (kv: KVNamespace, symbol: string, timeframe: string) => {
  const meta = await kv.get<MetaRecord>(`meta:${symbol}:${timeframe}`, { type: "json" });
  if (!meta) {
    return {
      symbol,
      timeframe,
      earliest_ts: undefined,
      latest_ts: undefined,
      bar_count: 0,
      chunks: [],
      version: 0,
      last_updated: undefined,
      last_accessed: undefined,
      hot_chunk: undefined,
      approx_bytes: 0,
    } as MetaRecord;
  }
  return meta;
};

export const putMeta = async (kv: KVNamespace, meta: MetaRecord) => {
  const next = {
    ...meta,
    version: (meta.version || 0) + 1,
    last_updated: new Date().toISOString(),
  };
  await kv.put(`meta:${meta.symbol}:${meta.timeframe}`, JSON.stringify(next));
  return next;
};

export const putMetaCAS = async (
  kv: KVNamespace,
  meta: MetaRecord,
  expectedVersion: number | undefined,
) => {
  const current = await kv.get<MetaRecord>(`meta:${meta.symbol}:${meta.timeframe}`, {
    type: "json",
  });
  if (expectedVersion !== undefined && current && current.version !== expectedVersion) {
    return null;
  }
  return putMeta(kv, meta);
};

// Coverage/gap detection ----------------------------------------------------
export const computeGaps = (
  meta: MetaRecord,
  from?: number,
  to?: number,
): { covered: boolean; gaps: CoverageGap[] } => {
  if (!meta.chunks.length) return { covered: false, gaps: [{ from: from ?? 0, to }] };
  const sorted = [...meta.chunks].sort((a, b) => a.start - b.start);
  const targetFrom = from ?? sorted[0].start;
  const targetTo = to ?? sorted[sorted.length - 1].end;
  let cursor = targetFrom;
  const gaps: CoverageGap[] = [];
  for (const c of sorted) {
    if (c.end <= targetFrom) continue;
    if (c.start > cursor) {
      gaps.push({ from: cursor, to: c.start });
    }
    cursor = Math.max(cursor, c.end);
    if (cursor >= targetTo) break;
  }
  if (cursor < targetTo) {
    gaps.push({ from: cursor, to: targetTo });
  }
  return { covered: gaps.length === 0, gaps };
};

// Merge & chunking ----------------------------------------------------------
export const mergeCandles = (a: Candle[], b: Candle[]): Candle[] => {
  const map = new Map<number, Candle>();
  for (const c of a) map.set(c.timestamp, c);
  for (const c of b) map.set(c.timestamp, c);
  return Array.from(map.values()).sort((x, y) => x.timestamp - y.timestamp);
};

export const splitChunks = (candles: Candle[], chunkSize: number = CHUNK_SIZE): Candle[][] => {
  const chunks: Candle[][] = [];
  for (let i = 0; i < candles.length; i += chunkSize) {
    chunks.push(candles.slice(i, i + chunkSize));
  }
  return chunks;
};

export const chunkKey = (symbol: string, timeframe: string, start: number, end: number) =>
  `candles/${symbol}/${timeframe}/chunk_${start}_${end}.json.gz`;

export const listAllKVKeys = async (
  kv: KVNamespace,
  opts: { prefix?: string } = {},
): Promise<KVNamespaceListKey<unknown>[]> => {
  const keys: KVNamespaceListKey<unknown>[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ ...opts, cursor });
    keys.push(...page.keys);
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  } while (cursor);
  return keys;
};

export const listAllR2Objects = async (
  bucket: R2Bucket,
  opts: { prefix?: string } = {},
): Promise<R2Object[]> => {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ ...opts, cursor });
    objects.push(...page.objects);
    if (!page.truncated) break;
    cursor = page.cursor;
    if (!cursor) break;
  } while (cursor);
  return objects;
};

// Chunk selectors -----------------------------------------------------------
const candlesFromChunks = async (bucket: R2Bucket, refs: ChunkRef[]): Promise<Candle[]> => {
  const out: Candle[] = [];
  for (const ref of refs) {
    const part = await getChunk(bucket, ref.key);
    out.push(...part);
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
};

const overlappingChunks = (meta: MetaRecord, from?: number, to?: number): ChunkRef[] => {
  if (!meta.chunks.length) return [];
  return meta.chunks.filter((c) => {
    const overlapStart = from ?? -Infinity;
    const overlapEnd = to ?? Infinity;
    return c.end > overlapStart && c.start < overlapEnd;
  });
};

const sliceByRange = (candles: Candle[], from?: number, to?: number): Candle[] => {
  return candles.filter((c) => {
    if (from !== undefined && c.timestamp < from) return false;
    if (to !== undefined && c.timestamp > to) return false;
    return true;
  });
};

// Upstream gap fetcher ------------------------------------------------------
export interface UpstreamOptions {
  sessionId?: string;
  sessionSign?: string;
  endpoint?: string;
  delayMs?: number;
}

export const fetchGapFromTradingView = async (
  symbol: string,
  timeframe: string,
  total: number,
  opts: UpstreamOptions,
): Promise<Candle[]> => {
  if ((opts as any).mock) {
    const startTs = Math.floor(Date.now() / 1000) - total * 60;
    return generateMockCandles(startTs, total, timeframe === "1" ? 60 : 60 * 5);
  }
  const maxAttempts = 3;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await backfillCandles({
        symbol,
        timeframe,
        total,
        endpoint: opts.endpoint as any,
        sessionId: opts.sessionId,
        sessionSign: opts.sessionSign,
        delayMs: opts.delayMs,
      });
    } catch (err: any) {
      const classified = classifyUpstreamError(err, "TradingView gap fetch failed");
      if (i === maxAttempts - 1) throw toUpstreamError(err, "TradingView gap fetch failed");
      if (classified.retryable) {
        const backoff = Math.min(1000 * 2 ** i, 5000);
        const jitter = Math.random() * 200;
        await new Promise((r) => setTimeout(r, backoff + jitter));
        continue;
      }
      throw toUpstreamError(err, "TradingView gap fetch failed");
    }
  }
  return [];
};

// Core cache service --------------------------------------------------------
export interface CacheRequest extends UpstreamOptions {
  symbol: string;
  timeframe: string | number;
  from?: number;
  to?: number;
  total?: number;
  maxFetchesPerMinute?: number;
  maxApproxBytes?: number;
  maxTotalBytes?: number;
  statsSampleRate?: number;
  mock?: boolean;
}

export interface CacheResult {
  candles: Candle[];
  meta: MetaRecord;
  partial?: boolean;
  upstreamError?: ClassifiedUpstreamError;
}

const TOTALS_KEY = "_cache:totals";
const STATS_KEY = "_cache:stats";
const HOT_KEY = (symbol: string, timeframe: string) => `hot:${symbol}:${timeframe}`;

interface Totals {
  approx_bytes?: number;
}

interface Stats {
  hits: number;
  misses: number;
}

// Lightweight metrics logging (sampled)
const logMetric = (type: string, detail: any, sampleRate: number = 10) => {
  if (Math.floor(Math.random() * sampleRate) !== 0) return;
  console.log(`[cache:${type}]`, detail);
};

// Snapshot helpers ----------------------------------------------------------
export const snapshotMeta = async (kv: KVNamespace, bucket: R2Bucket) => {
  const metas = await listAllKVKeys(kv, { prefix: "meta:" });
  const records: MetaRecord[] = [];
  for (const k of metas) {
    const rec = await kv.get<MetaRecord>(k.name, { type: "json" });
    if (rec) records.push(rec);
  }
  const totals = (await kv.get<Totals>(TOTALS_KEY, { type: "json" })) || {};
  const payload = {
    at: new Date().toISOString(),
    totals,
    metas: records,
  };
  const key = `snapshots/meta_${Date.now()}.json`;
  await bucket.put(key, JSON.stringify(payload));
  return key;
};

export const restoreMeta = async (kv: KVNamespace, bucket: R2Bucket, key: string) => {
  const obj = await bucket.get(key);
  if (!obj) throw new Error("snapshot not found");
  const data = await obj.json<any>();
  if (!data?.metas) throw new Error("invalid snapshot");
  for (const rec of data.metas as MetaRecord[]) {
    await kv.put(`meta:${rec.symbol}:${rec.timeframe}`, JSON.stringify(rec));
  }
  if (data.totals) {
    await kv.put(TOTALS_KEY, JSON.stringify(data.totals));
  }
  return { restored: data.metas.length };
};

const maybeBumpStats = async (kv: KVNamespace, hit: boolean, sampleRate: number = 10) => {
  // sampleRate: update every Nth event to save writes
  if (Math.floor(Math.random() * sampleRate) !== 0) return;
  const stats = (await kv.get<Stats>(STATS_KEY, { type: "json" })) || { hits: 0, misses: 0 };
  if (hit) stats.hits += 1;
  else stats.misses += 1;
  await kv.put(STATS_KEY, JSON.stringify(stats));
};

const metaCoverageChanged = (oldMeta: MetaRecord, nextMeta: MetaRecord) => {
  if (oldMeta.earliest_ts !== nextMeta.earliest_ts) return true;
  if (oldMeta.latest_ts !== nextMeta.latest_ts) return true;
  if ((oldMeta.bar_count || 0) !== (nextMeta.bar_count || 0)) return true;
  if ((oldMeta.approx_bytes || 0) !== (nextMeta.approx_bytes || 0)) return true;
  if ((oldMeta.chunks?.length || 0) !== (nextMeta.chunks?.length || 0)) return true;
  const oldKeys = (oldMeta.chunks || []).map((c) => c.key).join("|");
  const newKeys = (nextMeta.chunks || []).map((c) => c.key).join("|");
  if (oldKeys !== newKeys) return true;
  if (oldMeta.hot_chunk !== nextMeta.hot_chunk) return true;
  return false;
};
const consumeRate = async (kv: KVNamespace, key: string, limit: number): Promise<boolean> => {
  const now = Date.now();
  const window = Math.floor(now / 60000);
  const budgetKey = `_cache:rate:${key}:${window}`;
  const state = (await kv.get<{ count: number }>(budgetKey, { type: "json" })) || { count: 0 };
  state.count += 1;
  await kv.put(budgetKey, JSON.stringify({ count: state.count }), { expirationTtl: 90 });
  return state.count <= limit;
};

export const getCachedCandles = async (
  kv: KVNamespace,
  bucket: R2Bucket,
  req: CacheRequest,
): Promise<CacheResult> => {
  const symbol = normalizeSymbol(req.symbol);
  const timeframe = normalizeTimeframe(req.timeframe);
  const meta = await getMeta(kv, symbol, timeframe);

  const { covered, gaps } = computeGaps(meta, req.from, req.to);
  // Fast path: fully covered
  if (covered) {
    let refs = overlappingChunks(meta, req.from, req.to);
    if ((!req.from || !req.to) && meta.hot_chunk) {
      const hot = await kv.get<string>(HOT_KEY(symbol, timeframe));
      if (hot) {
        const hotRef = meta.chunks.find((c) => c.key === hot);
        if (hotRef) {
          refs = [hotRef];
        }
      }
    }
    const data = await candlesFromChunks(bucket, refs);
    // lazily update last_accessed on cache hit (no version bump)
    const maybeUpdateAccess = Math.random() < 0.1;
    if (maybeUpdateAccess) {
      meta.last_accessed = new Date().toISOString();
      await kv.put(`meta:${symbol}:${timeframe}`, JSON.stringify(meta));
    }
    await maybeBumpStats(kv, true, req.statsSampleRate);
    return { candles: sliceByRange(data, req.from, req.to), meta };
  }

  // Load existing data for merge
  const existingRefs = overlappingChunks(meta);
  const existing = await candlesFromChunks(bucket, existingRefs);

  // Fetch missing gap (simple strategy: fetch up to requested total or chunk size)
  const need = req.total ?? CHUNK_SIZE;
  const maxFetches = req.maxFetchesPerMinute ?? 3;
  const rateKey = `${symbol}:${timeframe}`;

  let fetched: Candle[] = [];
  for (const gap of gaps) {
    if (!(await consumeRate(kv, rateKey, maxFetches))) {
      // too many fetches in this window; return partial
      await maybeBumpStats(kv, false, req.statsSampleRate);
      logMetric("rate_limit", { symbol, timeframe });
      return {
        candles: sliceByRange(existing, req.from, req.to),
        meta,
        partial: true,
      };
    }
    try {
      logMetric("upstream_fetch", { symbol, timeframe, need, gap });
      const batch = await fetchGapFromTradingView(symbol, timeframe, need, req);
      fetched = mergeCandles(fetched, batch);
    } catch (err) {
      const upstreamError = classifyUpstreamError(err, "TradingView gap fetch failed");
      await maybeBumpStats(kv, false, req.statsSampleRate);
      logMetric("upstream_fail", { symbol, timeframe, category: upstreamError.category });
      return {
        candles: sliceByRange(existing, req.from, req.to),
        meta,
        partial: true,
        upstreamError,
      };
    }
  }

  const merged = mergeCandles(existing, fetched);
  const chunks = splitChunks(merged, CHUNK_SIZE);

  const newRefs: ChunkRef[] = [];
  let approxBytes = 0;
  const oldRefMap = new Map<string, ChunkRef>();
  meta.chunks.forEach((r) => oldRefMap.set(r.key, r));
  for (const ch of chunks) {
    if (!ch.length) continue;
    const start = ch[0].timestamp;
    const end = ch[ch.length - 1].timestamp;
    const key = chunkKey(symbol, timeframe, start, end);
    const prior = oldRefMap.get(key);
    let putResult;
    try {
      putResult = await putChunk(bucket, key, ch, prior?.etag);
    } catch {
      // ETag mismatch; re-read and merge once
      const existingChunk = await getChunk(bucket, key);
      const retryMerged = mergeCandles(existingChunk, ch);
      putResult = await putChunk(bucket, key, retryMerged);
    }
    approxBytes += putResult.bytes;
    newRefs.push({ start, end, key, etag: putResult.etag });
  }

  newRefs.sort((a, b) => a.start - b.start);
  // Simple size guard
  const overSize = req.maxApproxBytes && approxBytes > req.maxApproxBytes;
  if (overSize) {
    await maybeBumpStats(kv, false, req.statsSampleRate);
    logMetric("size_guard", { symbol, timeframe, approxBytes });
    return {
      candles: sliceByRange(merged, req.from, req.to),
      meta,
      partial: true,
    };
  }
  const updatedMeta: MetaRecord = {
    symbol,
    timeframe,
    earliest_ts: merged[0]?.timestamp,
    latest_ts: merged[merged.length - 1]?.timestamp,
    bar_count: merged.length,
    chunks: newRefs,
    version: meta.version,
    last_updated: meta.last_updated,
    last_accessed: meta.last_accessed,
    approx_bytes: approxBytes,
    hot_chunk: newRefs[newRefs.length - 1]?.key,
  };

  const coverageChanged = metaCoverageChanged(meta, updatedMeta);
  const savedMeta = coverageChanged ? await putMetaCAS(kv, updatedMeta, meta.version) : meta;
  if (coverageChanged && !savedMeta) {
    await maybeBumpStats(kv, false, req.statsSampleRate);
    return {
      candles: sliceByRange(merged, req.from, req.to),
      meta,
      partial: true,
    };
  }
  if (coverageChanged && updatedMeta.hot_chunk) {
    await kv.put(HOT_KEY(symbol, timeframe), updatedMeta.hot_chunk);
  }
  if (req.maxTotalBytes) {
    const delta = approxBytes - (meta.approx_bytes || 0);
    await updateTotalsAndMaybeEvict(kv, bucket, savedMeta!, req.maxTotalBytes, delta);
  }
  const scoped = sliceByRange(merged, req.from, req.to);
  await maybeBumpStats(kv, false, req.statsSampleRate); // miss -> required fetch
  return { candles: scoped, meta: savedMeta!, partial: false };
};

const updateTotalsAndMaybeEvict = async (
  kv: KVNamespace,
  bucket: R2Bucket,
  meta: MetaRecord,
  maxTotalBytes: number,
  deltaBytes: number,
) => {
  // Update totals counter (incremental)
  const totals = await kv.get<Totals>(TOTALS_KEY, { type: "json" });
  const currentBytes = totals?.approx_bytes || 0;
  let nextBytes = currentBytes + deltaBytes;
  if (nextBytes < 0) nextBytes = 0;
  await kv.put(TOTALS_KEY, JSON.stringify({ approx_bytes: nextBytes }));

  if (nextBytes <= maxTotalBytes) return;

  // Best-effort eviction: remove oldest metas until under limit
  const metas = await listAllKVKeys(kv, { prefix: "meta:" });
  const items: { key: string; ts: number; approx: number }[] = [];
  for (const k of metas) {
    const rec = await kv.get<MetaRecord>(k.name, { type: "json" });
    if (!rec) continue;
    const ts = rec.last_accessed ? Date.parse(rec.last_accessed) : rec.last_updated ? Date.parse(rec.last_updated) : 0;
    items.push({ key: k.name, ts, approx: rec.approx_bytes || 0 });
  }
  items.sort((a, b) => a.ts - b.ts);
  let running = nextBytes;
  for (const item of items) {
    if (running <= maxTotalBytes) break;
    const parts = item.key.split(":");
    const sym = parts[1];
    const tf = parts[2];
    await kv.delete(item.key);
    const prefix = `candles/${sym}/${tf}/`;
    const listed = await listAllR2Objects(bucket, { prefix });
    for (const obj of listed) {
      if (obj?.key) await bucket.delete(obj.key);
    }
    running -= item.approx;
  }
  await kv.put(TOTALS_KEY, JSON.stringify({ approx_bytes: running }));
};
