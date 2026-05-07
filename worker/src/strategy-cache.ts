// Per-cell strategy run cache.
//
// Slice C requirement: matrix and walkforward sweeps must short-circuit
// per-cell TradingView WS calls when the same (symbol × timeframe × params ×
// bars × pineVersion × source/studyId × properties × inputs) combination has
// already been computed inside the cache TTL.
//
// Key shape: `tv_cell:<sha256>` over a stable JSON of the strategy request,
// stripped of session credentials (sessionId/sessionSign do not change the
// strategy run output — they're auth-only). 24h default TTL keeps the cache
// hot across job submissions but cold enough to pick up upstream TV data
// updates intra-day.
//
// Cached value is a slim seed (`report + trades + equity`) — the only fields
// matrix-runner and walkforward-runner consume. Skipping `studyResult` and
// `wireDiagnostics` cuts the KV value 5-10× and keeps writes well under the
// 25MB per-key cap even for 10y-daily backtests.

import {
  runStrategy,
  type StrategyEquityPoint,
  type StrategyReport,
  type StrategyResult,
  type StrategyRunRequest,
  type StrategyTrade,
} from "./strategy";
import { sha256Hex } from "./backtest-job-do";

export interface RunStrategyCache {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>;
}

export interface CachedStrategySeed {
  report: StrategyReport;
  trades: StrategyTrade[];
  equity: StrategyEquityPoint[];
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
};

export const buildCellCacheKey = async (
  req: StrategyRunRequest,
): Promise<string> => {
  const seed = {
    symbol: req.symbol,
    studyId: req.studyId,
    source: req.source,
    pineVersion: req.pineVersion,
    properties: req.properties,
    inputs: req.inputs,
    params: req.params,
    timeframe: req.timeframe,
    bars: req.bars,
    endpoint: req.endpoint,
    to: req.to,
  };
  const hash = await sha256Hex(stableStringify(seed));
  return `tv_cell:${hash}`;
};

const toSeed = (result: StrategyResult): CachedStrategySeed => ({
  report: result.report,
  trades: result.trades,
  equity: result.equity,
});

export const DEFAULT_CELL_CACHE_TTL_SEC = 24 * 60 * 60;

// Wraps runStrategy with a KV-backed read-through cache. When `cache` is
// undefined or unset, falls through to a direct strategy run with no caching
// — this keeps unit tests and ad-hoc callers free of KV plumbing.
export const runStrategyCached = async (
  req: StrategyRunRequest,
  cache?: RunStrategyCache,
  ttlSec: number = DEFAULT_CELL_CACHE_TTL_SEC,
): Promise<CachedStrategySeed> => {
  if (!cache) {
    const out = await runStrategy(req);
    return toSeed(out);
  }
  const key = await buildCellCacheKey(req);
  const hit = await cache.get(key);
  if (hit) {
    try {
      return JSON.parse(hit) as CachedStrategySeed;
    } catch {
      // Tolerate malformed cache entries — fall through to a fresh run.
    }
  }
  const out = await runStrategy(req);
  const seed = toSeed(out);
  try {
    await cache.put(key, JSON.stringify(seed), { expirationTtl: ttlSec });
  } catch {
    // Cache write errors must not fail the run — surface the seed regardless.
  }
  return seed;
};
