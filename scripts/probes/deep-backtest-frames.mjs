#!/usr/bin/env node
// A4: Deep-mode discovery probe.
//
// Captures TradingView WebSocket frames during a strategy create_study + large
// bar request, with both `set_data_quality` levels exercised. The frames are
// the source of truth for deciding whether the worker can implement a deep
// mode wire (strategies.md leaves the wire form open until probe data lands).
//
// Usage:
//   TV_SESSION_ID=... TV_SESSION_SIGN=... node scripts/probes/deep-backtest-frames.mjs \
//     --symbol NASDAQ:AAPL --tf 60 --bars 30000 --study "STD;Supertrend Strategy" \
//     --quality optimal --out probe-output/deep-backtest-NASDAQ-AAPL.jsonl
//
// Quality flag values to try: "low", "optimal", "fast" (TV uses these; the
// probe only forwards the literal string — capture which values the WS
// upstream rejects).
//
// Output: JSONL of every WS frame received plus an envelope record at start
// describing the request, so we can grep frame names later (e.g. for
// "studies_count_changed", "deep_history" markers, etc.).

import { mkdirSync, createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { argv, env, exit, stderr, stdout } from "node:process";
// Node 22+ ships a built-in WebSocket; no `ws` dependency needed for probes.

const args = parseArgs(argv.slice(2));
const sessionId = env.TV_SESSION_ID;
const sessionSign = env.TV_SESSION_SIGN;

if (!sessionId) {
  stderr.write("error: set TV_SESSION_ID (and TV_SESSION_SIGN if your account requires it)\n");
  exit(2);
}

const symbol = args.symbol ?? "NASDAQ:AAPL";
const tf = args.tf ?? "60";
const bars = Number(args.bars ?? "30000");
const study = args.study ?? "STD;Supertrend Strategy";
const quality = args.quality ?? "optimal";
const outPath = args.out ?? `probe-output/deep-backtest-${symbol.replace(/[^A-Za-z0-9]+/g, "-")}-${tf}-${bars}-${quality}.jsonl`;

mkdirSync(dirname(outPath), { recursive: true });
const out = createWriteStream(outPath, { encoding: "utf8" });

const startedAt = new Date().toISOString();
out.write(JSON.stringify({
  kind: "probe-envelope",
  startedAt,
  symbol, tf, bars, study, quality,
  endpoint: "wss://prodata.tradingview.com/socket.io/websocket",
  notes: "A4 deep-mode discovery probe — capture full WS dialogue for analysis",
}) + "\n");

const cookieHeader = sessionSign
  ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
  : `sessionid=${sessionId}`;

// Resolve auth_token from disclaimer page (matches worker/src/tradingview.ts:101).
const disclaimer = await fetch("https://www.tradingview.com/disclaimer/", {
  method: "GET",
  headers: { Cookie: cookieHeader },
});
if (!disclaimer.ok) {
  stderr.write(`disclaimer fetch failed: ${disclaimer.status}\n`);
  exit(3);
}
const html = await disclaimer.text();
const match = html.match(/"auth_token":"(.+?)"/);
const authToken = match ? match[1] : "unauthorized_user_token";

logFrame("probe", "auth_token_resolved", { tokenSuffix: authToken.slice(-8), authed: authToken !== "unauthorized_user_token" });

// The built-in undici WebSocket does not currently surface the Cookie header
// override that TradingView requires. Using the `dispatcher` option via undici
// is the supported path; for a probe script we accept that the session cookie
// is piggy-backed via the Sec-WebSocket-Protocol mechanism is not viable and
// instead use the documented header injection through a wrapped fetch upgrade.
// In Node >= 22, custom headers on WebSocket are accepted via the second arg.
const ws = new WebSocket("wss://prodata.tradingview.com/socket.io/websocket", {
  headers: { Cookie: cookieHeader, Origin: "https://www.tradingview.com" },
});

const csId = `cs_${Math.random().toString(36).slice(2, 14)}`;
const stId = `st_${Math.random().toString(36).slice(2, 10)}`;
const seriesId = "sds_1";

ws.addEventListener("open", () => {
  logFrame("probe", "ws_open", {});
});

ws.addEventListener("message", (event) => {
  const text = typeof event.data === "string" ? event.data : event.data.toString();
  const frames = parseFrames(text);
  for (const frame of frames) {
    if (frame.type === "engineio_ping") { ws.send("3"); continue; }
    if (frame.type === "session") {
      sendFramed("set_auth_token", [authToken]);
      sendFramed("chart_create_session", [csId, ""]);
      sendFramed("set_data_quality", [csId, quality]);
      sendFramed("resolve_symbol", [csId, seriesId, `={"symbol":"${symbol}","adjustment":"splits"}`]);
      sendFramed("create_series", [csId, seriesId, "s1", seriesId, tf, bars, ""]);
      sendFramed("create_study", [csId, stId, "st1", seriesId, study, { in_0: { initial_capital: 100000 } }]);
      logFrame("probe", "study_create_dispatched", { csId, stId, seriesId, quality, bars });
      continue;
    }
    if (frame.type === "event") {
      logFrame("recv", frame.data.m, { params: frame.data.p });
      if (frame.data.m === "study_completed" || frame.data.m === "study_error") {
        setTimeout(() => ws.close(), 1500);
      }
      continue;
    }
    logFrame("recv", `unknown-${frame.type}`, frame);
  }
});

ws.addEventListener("close", (event) => {
  logFrame("probe", "ws_close", { code: event.code, reason: event.reason });
  out.end();
});

ws.addEventListener("error", (event) => {
  logFrame("probe", "ws_error", { message: event.message ?? "unknown" });
});

setTimeout(() => {
  stderr.write("timed out at 60s — closing\n");
  try { ws.close(); } catch {}
}, 60000).unref();

// ---------- helpers ----------

function logFrame(direction, name, payload) {
  out.write(JSON.stringify({ ts: new Date().toISOString(), direction, name, payload }) + "\n");
  if (direction === "recv") stdout.write(`<- ${name}\n`);
  if (direction === "send") stdout.write(`-> ${name}\n`);
}

function sendFramed(name, params) {
  const json = JSON.stringify({ m: name, p: params });
  const len = new TextEncoder().encode(json).length;
  ws.send(`~m~${len}~m~${json}`);
  logFrame("send", name, { params });
}

function parseFrames(input) {
  const out = [];
  let s = input;
  while (s.length > 0) {
    if (s === "2" || s === "3") {
      out.push({ type: "engineio_ping" });
      break;
    }
    const lengthMatch = s.match(/^~m~(\d+)~m~/);
    if (!lengthMatch) {
      try {
        const data = JSON.parse(s);
        if (data?.session_id) out.push({ type: "session", data });
        else out.push({ type: "json", data });
      } catch {
        out.push({ type: "raw", data: s });
      }
      break;
    }
    const totalLen = lengthMatch[0].length + Number(lengthMatch[1]);
    const body = s.slice(lengthMatch[0].length, totalLen);
    s = s.slice(totalLen);
    try {
      const data = JSON.parse(body);
      if (data?.session_id) out.push({ type: "session", data });
      else if (data?.m && Array.isArray(data?.p)) out.push({ type: "event", data });
      else out.push({ type: "json", data });
    } catch {
      out.push({ type: "raw", data: body });
    }
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
