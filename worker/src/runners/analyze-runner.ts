// Analyze runner — wraps the pure analyzeSuite for the BacktestJob DO.
//
// Used both for the synchronous `/v1/strategy/analyze` route (caller-supplied
// trades + equity, capped at ~1MB) and the async "analyze" job type (large
// payloads routed through the DO and persisted to R2).

import {
  analyzeSuite,
  type AnalyzeSuiteInput,
  type AnalyzeSuiteResult,
} from "../../../packages/tradingview-core/src";

export interface AnalyzeRunnerInput extends AnalyzeSuiteInput {}

export interface AnalyzeRunnerResult {
  result: AnalyzeSuiteResult;
  durationMs: number;
}

const DEFAULT_ITERATIONS = 1000;

export const runAnalyze = async (
  input: AnalyzeRunnerInput,
): Promise<AnalyzeRunnerResult> => {
  const start = Date.now();
  if (!Array.isArray(input.trades) && !Array.isArray(input.equity)) {
    throw new Error("analyze: at least one of trades or equity is required");
  }
  const trades = Array.isArray(input.trades) ? input.trades : [];
  const equity = Array.isArray(input.equity) ? input.equity : [];
  if (trades.length === 0 && equity.length < 2) {
    throw new Error("analyze: empty input — need at least 2 equity points or 1 trade");
  }
  const result = analyzeSuite({
    trades,
    equity,
    iterations: input.iterations ?? DEFAULT_ITERATIONS,
    seed: input.seed ?? 1,
    alpha: input.alpha ?? 0.05,
    periodsPerYear: input.periodsPerYear ?? 252,
    trialCount: input.trialCount ?? 1,
    benchmarkReturns: input.benchmarkReturns,
    candidateReturns: input.candidateReturns,
    buckets: input.buckets,
  });
  return { result, durationMs: Date.now() - start };
};

// Estimate request payload size to enforce the sync-route ~1MB cap. Caller
// passes the JSON body; we approximate using JSON.stringify length.
export const estimateAnalyzeBodySize = (body: unknown): number => {
  try {
    return JSON.stringify(body).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export const ANALYZE_SYNC_BODY_LIMIT_BYTES = 1_048_576; // 1 MB
