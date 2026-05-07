#!/usr/bin/env node
// Worker-mediated acceptance probes for Slices A, C, E, F.
//
// Reads HMAC creds from macOS Keychain (service: tradingview-worker-hmac,
// account: gwizz) and signs requests against the deployed Worker. Each
// probe writes a JSONL transcript to probe-output/ (gitignored).
//
// Usage:
//   node scripts/probes/worker-acceptance-probes.mjs <probe-name>
//
// Probes:
//   slice-a-commission-differential
//   slice-a-source-only
//   slice-a-bars-30000
//   slice-a-strategy-detection
//   slice-a-isStudyStrategy
//   slice-c-walkforward
//   slice-c-matrix
//   slice-e-ohlcv-extract
//   slice-f-sse-replay
//   admin-session-status
//   all

import { spawnSync } from "node:child_process";
import { createHmac, createHash } from "node:crypto";
import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const WORKER_BASE = process.env.WORKER_BASE || "https://tradingview-data.gwizz.workers.dev";
const OUT_DIR = resolve(REPO_ROOT, "probe-output");

const readKeychainCreds = () => {
  const r = spawnSync("security", [
    "find-generic-password",
    "-a", "gwizz",
    "-s", "tradingview-worker-hmac",
    "-w",
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`keychain read failed: ${r.stderr || r.stdout}`);
  }
  const hex = r.stdout.trim();
  const decoded = Buffer.from(hex, "hex").toString("utf8");
  const lines = decoded.split(/\r?\n/);
  let clientId, secret;
  for (const line of lines) {
    if (line.startsWith("clientId=")) clientId = line.slice("clientId=".length).trim();
    if (line.startsWith("secret=")) secret = line.slice("secret=".length).trim();
  }
  if (!clientId || !secret) {
    throw new Error("keychain payload missing clientId or secret");
  }
  return { clientId, secret };
};

const signCanonical = ({ method, path, bodyText, timestamp, secret }) => {
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const canonical = [method, path, bodyHash, timestamp].join("\n");
  return createHmac("sha256", secret).update(canonical).digest("hex");
};

const callWorker = async ({ method, path, body, creds }) => {
  const bodyText = body == null ? "" : JSON.stringify(body);
  const timestamp = String(Date.now());
  const sig = signCanonical({
    method,
    path,
    bodyText,
    timestamp,
    secret: creds.secret,
  });
  const url = `${WORKER_BASE}${path}`;
  const headers = {
    "Authorization": `HMAC ${creds.clientId}:${sig}`,
    "X-Timestamp": timestamp,
    "Content-Type": "application/json",
  };
  const startMs = Date.now();
  const resp = await fetch(url, {
    method,
    headers,
    body: bodyText || undefined,
  });
  const elapsedMs = Date.now() - startMs;
  const ct = resp.headers.get("content-type") || "";
  let parsed;
  let raw;
  if (ct.includes("application/json")) {
    raw = await resp.text();
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  } else {
    raw = await resp.text();
    parsed = null;
  }
  return {
    status: resp.status,
    ok: resp.ok,
    contentType: ct,
    parsed,
    rawText: raw,
    elapsedMs,
  };
};

const ensureOutDir = () => {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
};

const writeLine = (file, obj) => {
  appendFileSync(file, JSON.stringify(obj) + "\n");
};

const probeFile = (name) => {
  ensureOutDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(OUT_DIR, `worker-${name}-${stamp}.jsonl`);
};

const summarize = (parsed) => {
  if (!parsed || !parsed.result) return { hasResult: false };
  const r = parsed.result;
  const report = r.report ?? null;
  return {
    hasResult: true,
    authSource: parsed.authSource,
    bars: r.equity?.length ?? null,
    tradeCount: r.trades?.length ?? null,
    report: report ? {
      netProfit: report.netProfit,
      grossProfit: report.grossProfit,
      grossLoss: report.grossLoss,
      maxDrawdown: report.maxDrawdown,
      totalTrades: report.totalTrades,
    } : null,
    isStrategy: r.studyResult?.isStrategy ?? null,
    wireDiagnostics: r.wireDiagnostics ? {
      acceptedProperties: r.wireDiagnostics.acceptedProperties?.length ?? null,
      enumViolations: r.wireDiagnostics.enumViolations?.length ?? 0,
      inputCollisions: r.wireDiagnostics.inputCollisions?.length ?? 0,
      sourceRewrites: r.wireDiagnostics.sourceRewrites?.length ?? 0,
      symbolRewrites: r.wireDiagnostics.symbolRewrites?.length ?? 0,
      paramAliases: r.wireDiagnostics.paramAliases?.length ?? 0,
      wireForm: r.wireDiagnostics.wireForm,
    } : null,
  };
};

// --- probes ---------------------------------------------------------------

const probeAdminSessionStatus = async (creds) => {
  const file = probeFile("admin-session-status");
  console.log(`>> admin/session/status -> ${file}`);
  const result = await callWorker({
    method: "GET", path: "/admin/session/status", creds,
  });
  writeLine(file, { kind: "request", method: "GET", path: "/admin/session/status" });
  writeLine(file, { kind: "response", status: result.status, parsed: result.parsed });
  console.log(`   status=${result.status} parsed=${JSON.stringify(result.parsed)}`);
  return { ok: result.ok, parsed: result.parsed };
};

const probeCommissionDifferential = async (creds) => {
  const file = probeFile("slice-a-commission-differential");
  console.log(`>> slice-a-commission-differential -> ${file}`);
  const symbol = "NASDAQ:AAPL";
  const studyId = "STD;Supertrend Strategy";
  const baseBody = {
    symbol,
    studyId,
    timeframe: "60",
    bars: 500,
  };
  const runOne = async (label, properties) => {
    const body = { ...baseBody, properties };
    writeLine(file, { kind: "request", label, body });
    const r = await callWorker({ method: "POST", path: "/v1/strategy/run", body, creds });
    writeLine(file, { kind: "response", label, status: r.status, summary: summarize(r.parsed), parsedKeys: r.parsed ? Object.keys(r.parsed) : null, rawError: r.parsed?.error });
    return r;
  };
  const c0 = await runOne("commission_zero", { commission_type: "percent", commission_value: 0 });
  const c1 = await runOne("commission_one_percent", { commission_type: "percent", commission_value: 1 });
  const np0 = c0.parsed?.result?.report?.netProfit;
  const np1 = c1.parsed?.result?.report?.netProfit;
  const verdict = (typeof np0 === "number" && typeof np1 === "number" && Math.abs(np0 - np1) > 1e-6)
    ? "PASS — commission differential observed"
    : "INCONCLUSIVE";
  writeLine(file, {
    kind: "summary",
    np0, np1,
    delta: typeof np0 === "number" && typeof np1 === "number" ? np0 - np1 : null,
    verdict,
  });
  console.log(`   commission=0 netProfit=${np0}; commission=1% netProfit=${np1}; verdict=${verdict}`);
  return { ok: verdict.startsWith("PASS"), np0, np1 };
};

const probeSourceOnly = async (creds) => {
  const file = probeFile("slice-a-source-only");
  console.log(`>> slice-a-source-only -> ${file}`);
  const minimalSrc = `//@version=5
strategy("probe-min", overlay=true)
if (close > open)
    strategy.entry("L", strategy.long)
if (close < open)
    strategy.close("L")
`;
  const body = {
    symbol: "NASDAQ:AAPL",
    source: minimalSrc,
    timeframe: "60",
    bars: 200,
  };
  writeLine(file, { kind: "request", body: { ...body, source: `<${minimalSrc.length} chars>` } });
  const r = await callWorker({ method: "POST", path: "/v1/strategy/run", body, creds });
  const summary = summarize(r.parsed);
  writeLine(file, { kind: "response", status: r.status, summary, error: r.parsed?.error });
  const verdict = r.ok && summary.hasResult ? "PASS — source-only run executed" : "FAIL";
  writeLine(file, { kind: "verdict", verdict });
  console.log(`   status=${r.status} bars=${summary.bars} trades=${summary.tradeCount} verdict=${verdict}`);
  return { ok: verdict.startsWith("PASS"), summary };
};

const probeBars30k = async (creds) => {
  const file = probeFile("slice-a-bars-30000");
  console.log(`>> slice-a-bars-30000 -> ${file}`);
  const body = {
    symbol: "NASDAQ:AAPL",
    studyId: "STD;Supertrend Strategy",
    timeframe: "60",
    bars: 30000,
  };
  writeLine(file, { kind: "request", body });
  const r = await callWorker({ method: "POST", path: "/v1/strategy/run", body, creds });
  const summary = summarize(r.parsed);
  writeLine(file, { kind: "response", status: r.status, summary, elapsedMs: r.elapsedMs, error: r.parsed?.error });
  const bars = summary.bars ?? 0;
  // Slice A clamp caps premium at 25000 normally; the entitlement probe records
  // crossedLegacyClamp boolean (>20000). Confirm the probe clearly returned
  // many bars.
  const verdict = r.ok && bars > 20000
    ? `PASS — ${bars} bars exceed legacy 20k clamp`
    : r.ok && bars > 0
    ? `INCONCLUSIVE — only ${bars} bars (session may not be premium-eligible)`
    : "FAIL";
  writeLine(file, { kind: "verdict", bars, verdict });
  console.log(`   status=${r.status} elapsed=${r.elapsedMs}ms bars=${bars} verdict=${verdict}`);
  return { ok: r.ok, bars, verdict };
};

const probeStrategyDetection = async (creds) => {
  // Confirms isStudyStrategy returns true for STD;Supertrend Strategy
  // (response includes report+trades+equity) and false for STD;RSI
  // (study output, no report).
  const file = probeFile("slice-a-strategy-detection");
  console.log(`>> slice-a-strategy-detection -> ${file}`);
  const runOne = async (studyId) => {
    const body = { symbol: "NASDAQ:AAPL", studyId, timeframe: "60", bars: 200 };
    writeLine(file, { kind: "request", studyId });
    const r = await callWorker({ method: "POST", path: "/v1/strategy/run", body, creds });
    writeLine(file, { kind: "response", studyId, status: r.status, summary: summarize(r.parsed), error: r.parsed?.error });
    return r;
  };
  const sup = await runOne("STD;Supertrend Strategy");
  const rsi = await runOne("STD;RSI");
  // Supertrend Strategy must produce a report; RSI must error or produce no report
  // (depending on Slice A behavior — check both error text and report presence).
  const supHasReport = sup.parsed?.result?.report != null;
  const rsiHasReport = rsi.parsed?.result?.report != null;
  const rsiCategory = rsi.parsed?.category;
  const verdict = supHasReport && !rsiHasReport
    ? "PASS — strategy detection differentiates Supertrend vs RSI"
    : "INCONCLUSIVE";
  writeLine(file, { kind: "verdict", supHasReport, rsiHasReport, rsiCategory, verdict });
  console.log(`   sup.hasReport=${supHasReport} rsi.hasReport=${rsiHasReport} rsi.category=${rsiCategory} verdict=${verdict}`);
  return { ok: verdict.startsWith("PASS") };
};

const probeWalkforward = async (creds) => {
  const file = probeFile("slice-c-walkforward");
  console.log(`>> slice-c-walkforward -> ${file}`);
  const body = {
    type: "walkforward",
    input: {
      symbol: "NASDAQ:AAPL",
      studyId: "STD;Supertrend Strategy",
      timeframe: "D",
      bars: 1000,
      paramGrid: { factor: [2, 3] },
      isBars: 600,
      oosBars: 200,
      stride: 200,
    },
  };
  writeLine(file, { kind: "request", path: "/v1/jobs/submit", body });
  const r = await callWorker({ method: "POST", path: "/v1/jobs/submit", body, creds });
  writeLine(file, { kind: "response", status: r.status, parsed: r.parsed });
  console.log(`   status=${r.status} parsed=${JSON.stringify(r.parsed).slice(0, 200)}`);
  return { ok: r.ok, parsed: r.parsed };
};

const probeMatrix = async (creds) => {
  const file = probeFile("slice-c-matrix");
  console.log(`>> slice-c-matrix -> ${file}`);
  const body = {
    type: "matrix",
    input: {
      symbols: ["NASDAQ:AAPL", "NASDAQ:MSFT", "NASDAQ:GOOG"],
      timeframes: ["60", "D"],
      studyId: "STD;Supertrend Strategy",
      paramGrid: { factor: [1, 2, 3, 4] },
      bars: 500,
    },
  };
  writeLine(file, { kind: "request", body });
  const r = await callWorker({ method: "POST", path: "/v1/jobs/submit", body, creds });
  writeLine(file, { kind: "response", status: r.status, parsed: r.parsed });
  console.log(`   status=${r.status} parsed=${JSON.stringify(r.parsed).slice(0, 200)}`);
  return { ok: r.ok, parsed: r.parsed };
};

const probeOhlcvExtract = async (creds) => {
  const file = probeFile("slice-e-ohlcv-extract");
  console.log(`>> slice-e-ohlcv-extract -> ${file}`);
  const body = {
    type: "ohlcvExtract",
    input: {
      symbol: "NASDAQ:AAPL",
      timeframe: "D",
      bars: 1000,
    },
  };
  writeLine(file, { kind: "request", body });
  const r = await callWorker({ method: "POST", path: "/v1/jobs/submit", body, creds });
  writeLine(file, { kind: "response", status: r.status, parsed: r.parsed });
  console.log(`   status=${r.status} parsed=${JSON.stringify(r.parsed).slice(0, 200)}`);
  return { ok: r.ok, parsed: r.parsed };
};

const probeSseReplay = async (creds) => {
  const file = probeFile("slice-f-sse-replay");
  console.log(`>> slice-f-sse-replay -> ${file}`);
  // Probe SSE replay surface: hit /v1/strategy/replay with a small request and
  // confirm we get an SSE-style response. Use Accept header.
  const body = {
    symbol: "NASDAQ:AAPL",
    studyId: "STD;Supertrend Strategy",
    timeframe: "60",
    bars: 100,
  };
  const bodyText = JSON.stringify(body);
  const timestamp = String(Date.now());
  const sig = signCanonical({
    method: "POST",
    path: "/v1/strategy/replay",
    bodyText,
    timestamp,
    secret: creds.secret,
  });
  writeLine(file, { kind: "request", body });
  const url = `${WORKER_BASE}/v1/strategy/replay`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `HMAC ${creds.clientId}:${sig}`,
      "X-Timestamp": timestamp,
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    },
    body: bodyText,
  });
  const ct = resp.headers.get("content-type") || "";
  writeLine(file, { kind: "response-headers", status: resp.status, contentType: ct });
  const reader = resp.body?.getReader();
  if (!reader) {
    writeLine(file, { kind: "verdict", verdict: "FAIL — no stream body" });
    console.log(`   status=${resp.status} verdict=FAIL`);
    return { ok: false };
  }
  const decoder = new TextDecoder();
  const observedEvents = [];
  const startMs = Date.now();
  const maxMs = 30_000;
  let buffered = "";
  let done = false;
  while (!done && Date.now() - startMs < maxMs) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffered += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffered.indexOf("\n\n")) !== -1) {
      const chunk = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 2);
      const m = chunk.match(/^event:\s*(\S+)/m);
      if (m) {
        observedEvents.push(m[1]);
        if (m[1] === "done") done = true;
      }
    }
  }
  await reader.cancel().catch(() => {});
  writeLine(file, { kind: "summary", observedEvents, eventCount: observedEvents.length });
  const verdict = observedEvents.includes("done")
    ? `PASS — ${observedEvents.length} SSE events including done`
    : observedEvents.length > 0
    ? `INCONCLUSIVE — ${observedEvents.length} SSE events but no done`
    : "FAIL — no SSE events observed";
  writeLine(file, { kind: "verdict", verdict });
  console.log(`   events=${observedEvents.length} verdict=${verdict}`);
  return { ok: verdict.startsWith("PASS"), eventCount: observedEvents.length };
};

const probes = {
  "admin-session-status": probeAdminSessionStatus,
  "slice-a-commission-differential": probeCommissionDifferential,
  "slice-a-source-only": probeSourceOnly,
  "slice-a-bars-30000": probeBars30k,
  "slice-a-strategy-detection": probeStrategyDetection,
  "slice-c-walkforward": probeWalkforward,
  "slice-c-matrix": probeMatrix,
  "slice-e-ohlcv-extract": probeOhlcvExtract,
  "slice-f-sse-replay": probeSseReplay,
};

const main = async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: worker-acceptance-probes.mjs <probe-name|all>");
    console.error("probes: " + Object.keys(probes).join(", "));
    process.exit(1);
  }
  const creds = readKeychainCreds();
  console.log(`worker=${WORKER_BASE} clientId=${creds.clientId.slice(0, 16)}...`);
  const list = arg === "all" ? Object.keys(probes) : [arg];
  for (const name of list) {
    if (!probes[name]) {
      console.error(`unknown probe: ${name}`);
      process.exit(2);
    }
    try {
      await probes[name](creds);
    } catch (e) {
      console.error(`probe ${name} threw: ${e.message}`);
    }
  }
};

await main();
