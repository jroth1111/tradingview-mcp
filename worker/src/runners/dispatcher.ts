// Production runner dispatcher.
//
// Wires the BacktestJob DO's pluggable runner slot to the actual walkforward,
// matrix, and analyze implementations. Lives outside the DO file so the DO
// can be unit-tested without dragging in TradingView WebSocket code.
//
// Each job type pulls its inputs from `payload`, runs the corresponding
// runner, and returns the result that the DO will JSON-encode and store in
// R2 under `backtest/jobs/<jobId>/result.json`.

import {
  setBacktestRunner,
  type JobRunner,
  type JobRunnerContext,
} from "../backtest-job-do";
import {
  ANALYZE_SYNC_BODY_LIMIT_BYTES,
  estimateAnalyzeBodySize,
  runAnalyze,
  type AnalyzeRunnerInput,
} from "./analyze-runner";
import {
  runCpcv,
  type CpcvInput,
} from "./cpcv-runner";
import { runMatrix, type MatrixInput } from "./matrix-runner";
import {
  runOhlcvExtract,
  type OhlcvExtractInput,
  type OhlcvManifest,
} from "./ohlcv-runner";
import {
  runWalkforward,
  type WalkforwardInput,
} from "./walkforward-runner";

const dispatch: JobRunner = async (
  ctx: JobRunnerContext,
): Promise<Record<string, unknown>> => {
  switch (ctx.type) {
    case "analyze": {
      ctx.emitProgress("analyze:start");
      const input = ctx.payload as unknown as AnalyzeRunnerInput;
      const out = await runAnalyze(input);
      ctx.emitProgress("analyze:done");
      return out as unknown as Record<string, unknown>;
    }
    case "walkforward": {
      ctx.emitProgress("walkforward:start");
      const input: WalkforwardInput = {
        ...(ctx.payload as unknown as WalkforwardInput),
        kv: ctx.kv,
      };
      const out = await runWalkforward(input);
      ctx.emitProgress("walkforward:done", out.windows.length, out.windows.length);
      return out as unknown as Record<string, unknown>;
    }
    case "matrix": {
      ctx.emitProgress("matrix:start");
      const input: MatrixInput = {
        ...(ctx.payload as unknown as MatrixInput),
        kv: ctx.kv,
      };
      const out = await runMatrix(input);
      ctx.emitProgress("matrix:done", out.cellsCompleted, out.cellsRequested);
      return out as unknown as Record<string, unknown>;
    }
    case "cpcv": {
      ctx.emitProgress("cpcv:start");
      const input: CpcvInput = {
        ...(ctx.payload as unknown as CpcvInput),
        kv: ctx.kv,
      };
      const out = await runCpcv(input);
      ctx.emitProgress(
        `cpcv:done:${out.mode}`,
        out.pbo.splitsEvaluated,
        out.pbo.splitsEvaluated,
      );
      return out as unknown as Record<string, unknown>;
    }
    case "ohlcvExtract": {
      ctx.emitProgress("ohlcvExtract:start");
      const input: OhlcvExtractInput = {
        ...(ctx.payload as unknown as OhlcvExtractInput),
        jobId: ctx.jobId,
        kv: ctx.kv,
        r2: ctx.r2,
        onCellComplete: (cell) =>
          ctx.emitPartial("ohlcv:cell-complete", {
            symbol: cell.symbol,
            timeframe: cell.timeframe,
            bars: cell.bars,
            r2Key: cell.r2Key,
            cached: cell.cached,
          }),
      };
      const manifest: OhlcvManifest = await runOhlcvExtract(input);
      ctx.emitProgress(
        "ohlcvExtract:done",
        manifest.cells.length,
        manifest.symbolCount * manifest.timeframeCount,
      );
      // The manifest already lives in R2 at backtest/jobs/<jobId>/manifest.json.
      // Return a slim summary so the alarm handler's result.json stays small.
      return {
        manifestR2Key: `backtest/jobs/${ctx.jobId}/manifest.json`,
        symbolCount: manifest.symbolCount,
        timeframeCount: manifest.timeframeCount,
        cells: manifest.cells.length,
        totalBars: manifest.totalBars,
        totalBytes: manifest.totalBytes,
        cacheHits: manifest.cacheHits,
        missingCells: manifest.missingCells.length,
        errors: manifest.errors.length,
        durationMs: manifest.durationMs,
      };
    }
    case "optimize-deep": {
      // optimize-deep is a walk-forward sweep with deeper bar caps; it shares
      // the walkforward runner with a higher default warmup multiplier.
      ctx.emitProgress("optimize-deep:start");
      const input: WalkforwardInput = {
        ...(ctx.payload as unknown as WalkforwardInput),
        kv: ctx.kv,
      };
      const out = await runWalkforward(input);
      ctx.emitProgress(
        "optimize-deep:done",
        out.windows.length,
        out.windows.length,
      );
      return out as unknown as Record<string, unknown>;
    }
  }
};

// Module-load registration: the BacktestJob DO and the Worker fetch entry
// share a Cloudflare bundle, so importing this module from `worker/src/index.ts`
// causes the DO isolate to load it as well — both run this top-level
// registration on isolate startup.
setBacktestRunner(dispatch);

// Compatibility helper kept for callers that previously gated registration
// inside a request handler. Now a no-op because registration is unconditional.
export const ensureRunnerRegistered = (): void => {
  // Already registered at module load.
};

export {
  ANALYZE_SYNC_BODY_LIMIT_BYTES,
  estimateAnalyzeBodySize,
  runAnalyze,
  runCpcv,
  runMatrix,
  runOhlcvExtract,
  runWalkforward,
};
export type {
  AnalyzeRunnerInput,
  CpcvInput,
  MatrixInput,
  OhlcvExtractInput,
  OhlcvManifest,
  WalkforwardInput,
};
