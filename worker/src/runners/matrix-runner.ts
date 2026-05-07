// Matrix runner.
//
// Cartesian sweep over (symbols × timeframes × paramGrid). Each cell is one
// strategy run. Concurrency capped at default 4-5 to respect TradingView's
// soft per-account WS rate-limit (>5 concurrent WS sessions trip throttling
// on the prodata endpoint).
//
// Default ranking metric is Sortino (per CLAUDE.md memory
// always-use-sortino-over-sharpe-in-metric-defaults). Sharpe is reported as
// a secondary column for cross-comparison; it never wins ties for ranking.

import {
  buildMetricBundle,
  defaultRankingMetric,
  pickMetric,
  type MetricBundle,
  type RankingMetric,
  type TradingviewEndpoint,
} from "../../../packages/tradingview-core/src";
import {
  cartesianProduct,
  type StrategyProperties,
  type StrategyRunRequest,
} from "../strategy";
import {
  runStrategyCached,
  type RunStrategyCache,
} from "../strategy-cache";

export interface MatrixInput {
  symbols: string[];
  timeframes: Array<string | number>;
  paramGrid: Record<string, any[]>;
  studyId?: string;
  source?: string;
  pineVersion?: string;
  baseInputs?: Record<string, any>;
  baseParams?: Record<string, any>;
  properties?: StrategyProperties;
  bars?: number;
  metric?: RankingMetric; // default "sortino"
  concurrency?: number; // default 4
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  periodsPerYear?: number;
  // Optional KV cache for per-cell strategy-run reuse across job submissions.
  // When omitted, every cell hits TradingView fresh.
  kv?: RunStrategyCache;
}

export interface MatrixCell {
  symbol: string;
  timeframe: string | number;
  params: Record<string, any>;
  metric: number; // ranking metric value
  metrics: MetricBundle;
  durationMs: number;
  error?: { code: string; message: string };
}

export interface MatrixResult {
  metric: RankingMetric;
  cellsRequested: number;
  cellsCompleted: number;
  cellsErrored: number;
  ranked: MatrixCell[]; // sorted descending by ranking metric
  best?: MatrixCell;
  durationMs: number;
}

const runWithConcurrency = async <I, O>(
  items: readonly I[],
  limit: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> => {
  const results: O[] = new Array(items.length);
  if (items.length === 0) return results;
  const cap = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: cap }, async () => {
      while (true) {
        const idx = cursor;
        cursor += 1;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
      }
    }),
  );
  return results;
};

interface MatrixCellRequest {
  symbol: string;
  timeframe: string | number;
  params: Record<string, any>;
}

const buildCellRequests = (input: MatrixInput): MatrixCellRequest[] => {
  const combos = cartesianProduct(input.paramGrid);
  const cells: MatrixCellRequest[] = [];
  for (const symbol of input.symbols) {
    for (const tf of input.timeframes) {
      for (const combo of combos) {
        cells.push({ symbol, timeframe: tf, params: combo });
      }
    }
  }
  return cells;
};

export const runMatrix = async (input: MatrixInput): Promise<MatrixResult> => {
  if (!input.symbols?.length) throw new Error("matrix: symbols required");
  if (!input.timeframes?.length) throw new Error("matrix: timeframes required");
  if (!input.paramGrid || Object.keys(input.paramGrid).length === 0) {
    throw new Error("matrix: non-empty paramGrid required");
  }
  if (!input.studyId && !input.source) {
    throw new Error("matrix: studyId or source required");
  }

  const start = Date.now();
  const metric = input.metric ?? defaultRankingMetric();
  const ppy = input.periodsPerYear ?? 252;
  // TradingView's soft rate-limit allows ~4-5 concurrent WS sessions per
  // account before throttling kicks in on prodata. Default to 4 to leave
  // headroom for streaming consumers running on the same session.
  const concurrency = Math.max(1, Math.min(input.concurrency ?? 4, 5));

  const cells = buildCellRequests(input);
  const results = await runWithConcurrency(cells, concurrency, async (cell) => {
    const cellStart = Date.now();
    try {
      const params = { ...(input.baseParams ?? {}), ...cell.params };
      const req: StrategyRunRequest = {
        symbol: cell.symbol,
        studyId: input.studyId,
        source: input.source,
        pineVersion: input.pineVersion,
        properties: input.properties,
        inputs: input.baseInputs,
        params,
        timeframe: cell.timeframe,
        bars: input.bars,
        sessionId: input.sessionId,
        sessionSign: input.sessionSign,
        endpoint: input.endpoint,
      };
      const out = await runStrategyCached(req, input.kv);
      const equityValues = out.equity.map((p) => p.equity);
      const tradePnl = out.trades.map((t) => (typeof t.profit === "number" ? t.profit : 0));
      const bundle = buildMetricBundle({
        equity: equityValues,
        tradePnl,
        periodsPerYear: ppy,
      });
      return {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        params: cell.params,
        metric: pickMetric(bundle, metric),
        metrics: bundle,
        durationMs: Date.now() - cellStart,
      } satisfies MatrixCell;
    } catch (err: any) {
      return {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        params: cell.params,
        metric: Number.NEGATIVE_INFINITY,
        metrics: buildMetricBundle({ periodsPerYear: ppy }),
        durationMs: Date.now() - cellStart,
        error: {
          code: err?.code ?? "matrix_cell_error",
          message: typeof err?.message === "string" ? err.message : String(err),
        },
      } satisfies MatrixCell;
    }
  });

  const valid = results.filter((c) => !c.error && Number.isFinite(c.metric));
  const erroredCount = results.length - valid.length;
  const ranked = [...valid].sort((a, b) => b.metric - a.metric);

  return {
    metric,
    cellsRequested: cells.length,
    cellsCompleted: valid.length,
    cellsErrored: erroredCount,
    ranked,
    best: ranked[0],
    durationMs: Date.now() - start,
  };
};
