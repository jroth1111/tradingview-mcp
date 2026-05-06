// Pine compile + run helpers (P-Pine)
// Surface: pine-facade.tradingview.com
//   - GET  /pine-facade/translate_light/?pine_id=<id>&pine_version=<ver>
//       Light compile of an existing script id. Fast, returns ilTemplate + metaInfo.
//   - POST /pine-facade/translate_source/<pine_version>?is_pine_ex=true
//       Full compile from raw source. Body: form-encoded `source=<urlencoded>`.
//       Returns {success, pineId, pineVersion, ilTemplate, metaInfo, errors, warnings}.
//   - POST /pine-facade/eval_pine_ex/
//       Quick eval / dry-run. Body: JSON {source, inputs?, version?}.
//       Returns {success, result:{rootValues, errors, warnings, ...}}.
//
// Errors come back in heterogeneous shapes: top-level `errors`, `reason`, `reason2`.
// Each error may be a string or an object {start:{line,column}, end:{...}, message}.
// We normalize to {message, line?, column?}.

import { runStudy, type StudyResult } from "./tradingview";
import type { TradingviewEndpoint } from "../../packages/tradingview-core/src";

const PINE_FACADE = "https://pine-facade.tradingview.com";

const cookieHeader = (sessionId?: string, sessionSign?: string): Record<string, string> => {
  if (!sessionId) return {};
  return {
    cookie: sessionSign
      ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`,
  };
};

export type PineCompileMode = "eval" | "full" | "light";

export interface PineCompileRequest {
  source?: string;
  pineId?: string;
  version?: string;
  mode?: PineCompileMode;
  inputs?: Record<string, any>;
  sessionId?: string;
  sessionSign?: string;
}

export interface PineCompileError {
  message: string;
  line?: number;
  column?: number;
}

export interface PineCompileResult {
  success: boolean;
  mode: PineCompileMode;
  pineId?: string;
  pineVersion?: string;
  metaInfo?: any;
  ilTemplate?: string;
  rootValues?: any;
  errors: PineCompileError[];
  warnings: PineCompileError[];
  raw?: any;
}

const normalizeOne = (entry: any): PineCompileError | null => {
  if (entry == null) return null;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    // Try to extract `line N, column M` patterns commonly emitted by Pine.
    const lineMatch = trimmed.match(/line\s+(\d+)(?:[,\s]+col(?:umn)?\s+(\d+))?/i);
    const out: PineCompileError = { message: trimmed };
    if (lineMatch) {
      out.line = Number(lineMatch[1]);
      if (lineMatch[2] != null) out.column = Number(lineMatch[2]);
    }
    return out;
  }
  if (typeof entry === "object") {
    const message =
      typeof entry.message === "string"
        ? entry.message
        : typeof entry.text === "string"
          ? entry.text
          : typeof entry.reason === "string"
            ? entry.reason
            : JSON.stringify(entry);
    const out: PineCompileError = { message };
    const start = entry.start || entry.position || entry.location || null;
    const line = start?.line ?? entry.line ?? entry.row ?? null;
    const column = start?.column ?? entry.column ?? entry.col ?? null;
    if (line != null) out.line = Number(line);
    if (column != null) out.column = Number(column);
    return out;
  }
  return null;
};

const normalizeList = (input: any): PineCompileError[] => {
  if (input == null) return [];
  const arr = Array.isArray(input) ? input : [input];
  const out: PineCompileError[] = [];
  for (const item of arr) {
    const norm = normalizeOne(item);
    if (norm) out.push(norm);
  }
  return out;
};

interface NormalizedDiagnostics {
  errors: PineCompileError[];
  warnings: PineCompileError[];
}

const collectDiagnostics = (...sources: any[]): NormalizedDiagnostics => {
  const errors: PineCompileError[] = [];
  const warnings: PineCompileError[] = [];
  const seen = new Set<any>();
  for (const src of sources) {
    if (src == null) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    if (src.errors != null) errors.push(...normalizeList(src.errors));
    if (src.warnings != null) warnings.push(...normalizeList(src.warnings));
    if (src.reason != null) errors.push(...normalizeList(src.reason));
    if (src.reason2 != null) errors.push(...normalizeList(src.reason2));
  }
  return { errors, warnings };
};

const resolveMode = (req: PineCompileRequest): PineCompileMode => {
  if (req.mode) return req.mode;
  if (req.pineId) return "light";
  if (req.source) return "full";
  throw new Error("source or pineId required");
};

const compileLight = async (req: PineCompileRequest): Promise<PineCompileResult> => {
  if (!req.pineId) throw new Error("pineId required for light compile");
  const version = req.version || "v5";
  const params = new URLSearchParams();
  params.set("pine_id", req.pineId);
  params.set("pine_version", version);
  const url = `${PINE_FACADE}/pine-facade/translate_light/?${params.toString()}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: cookieHeader(req.sessionId, req.sessionSign),
  });
  if (!resp.ok) {
    throw new Error(`translate_light failed: ${resp.status} ${resp.statusText}`);
  }
  const data: any = await resp.json();
  const result = data?.result ?? data;
  const { errors, warnings } = collectDiagnostics(data, result);
  const success = data?.success !== false && errors.length === 0;
  return {
    success,
    mode: "light",
    pineId: result?.pineId ?? data?.pineId ?? req.pineId,
    pineVersion: result?.pineVersion ?? data?.pineVersion ?? version,
    metaInfo: result?.metaInfo ?? data?.metaInfo,
    ilTemplate: result?.ilTemplate ?? data?.ilTemplate,
    errors,
    warnings,
    raw: data,
  };
};

const compileFull = async (req: PineCompileRequest): Promise<PineCompileResult> => {
  if (!req.source) throw new Error("source required for full compile");
  const version = req.version || "v5";
  const url = `${PINE_FACADE}/pine-facade/translate_source/${encodeURIComponent(version)}?is_pine_ex=true`;
  const body = new URLSearchParams();
  body.set("source", req.source);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...cookieHeader(req.sessionId, req.sessionSign),
    },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`translate_source failed: ${resp.status} ${resp.statusText}`);
  }
  const data: any = await resp.json();
  const result = data?.result ?? data;
  const { errors, warnings } = collectDiagnostics(data, result);
  const success = data?.success !== false && errors.length === 0;
  return {
    success,
    mode: "full",
    pineId: result?.pineId ?? data?.pineId,
    pineVersion: result?.pineVersion ?? data?.pineVersion ?? version,
    metaInfo: result?.metaInfo ?? data?.metaInfo,
    ilTemplate: result?.ilTemplate ?? data?.ilTemplate,
    errors,
    warnings,
    raw: data,
  };
};

const compileEval = async (req: PineCompileRequest): Promise<PineCompileResult> => {
  if (!req.source) throw new Error("source required for eval compile");
  const version = req.version || "v5";
  const url = `${PINE_FACADE}/pine-facade/eval_pine_ex/`;
  const payload: Record<string, any> = { source: req.source, version };
  if (req.inputs) payload.inputs = req.inputs;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...cookieHeader(req.sessionId, req.sessionSign),
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`eval_pine_ex failed: ${resp.status} ${resp.statusText}`);
  }
  const data: any = await resp.json();
  const result = data?.result ?? data;
  const { errors, warnings } = collectDiagnostics(data, result);
  const success = data?.success !== false && errors.length === 0;
  return {
    success,
    mode: "eval",
    pineId: result?.pineId ?? data?.pineId,
    pineVersion: result?.pineVersion ?? data?.pineVersion ?? version,
    metaInfo: result?.metaInfo ?? data?.metaInfo,
    ilTemplate: result?.ilTemplate ?? data?.ilTemplate,
    rootValues: result?.rootValues ?? data?.rootValues,
    errors,
    warnings,
    raw: data,
  };
};

export const compilePine = async (req: PineCompileRequest): Promise<PineCompileResult> => {
  const mode = resolveMode(req);
  if (mode === "light") return compileLight(req);
  if (mode === "full") return compileFull(req);
  return compileEval(req);
};

export interface PineRunRequest {
  symbol: string;
  source?: string;
  pineId?: string;
  version?: string;
  inputs?: Record<string, any>;
  params?: Record<string, any>;
  timeframe?: string | number;
  bars?: number;
  sessionId?: string;
  sessionSign?: string;
  endpoint?: TradingviewEndpoint;
  parentSeriesId?: string;
}

export interface PineRunResult {
  compile: PineCompileResult;
  result: StudyResult;
}

export const runPine = async (req: PineRunRequest): Promise<PineRunResult> => {
  if (!req.symbol) throw new Error("symbol required");
  if (!req.source && !req.pineId) throw new Error("source or pineId required");

  const compile = await compilePine({
    source: req.source,
    pineId: req.pineId,
    version: req.version,
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
  });

  if (!compile.success) {
    const err: any = new Error(
      compile.errors[0]?.message
        ? `pine compile failed: ${compile.errors[0].message}`
        : "pine compile failed",
    );
    err.compile = compile;
    throw err;
  }

  const studyId = compile.pineId ?? req.pineId;
  if (!studyId) {
    const err: any = new Error("pine compile did not return a pineId");
    err.compile = compile;
    throw err;
  }

  const result = await runStudy({
    symbol: req.symbol,
    studyId,
    inputs: req.inputs,
    params: req.params,
    timeframe: req.timeframe,
    bars: req.bars,
    sessionId: req.sessionId,
    sessionSign: req.sessionSign,
    endpoint: req.endpoint,
    parentSeriesId: req.parentSeriesId,
  });

  return { compile, result };
};
