#!/usr/bin/env node
// A7: Live entitlement probe.
//
// Connects with the configured admin session, requests bars beyond the legacy
// 20k clamp against a known PUB; strategy, and reports the actual bar count
// the upstream returns. The output answers two operational questions:
//   1. Does this session entitle bar fetches above the historic 20k cap?
//   2. What is the upstream-imposed ceiling, if any, today?
//
// Usage:
//   TV_SESSION_ID=... TV_SESSION_SIGN=... node scripts/probes/strategy-entitlement.mjs \
//     --symbol NASDAQ:AAPL --tf 60 --study "STD;Supertrend Strategy" --bars 25000 \
//     --plan premium --out probe-output/entitlement-NASDAQ-AAPL.jsonl
//
// `--plan` is informational only — the probe never trusts the caller; it asks
// the upstream and records what it actually returns.

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
const bars = Number(args.bars ?? "25000");
const study = args.study ?? "STD;Supertrend Strategy";
const plan = args.plan ?? "unknown";
const outPath = args.out ?? `probe-output/entitlement-${symbol.replace(/[^A-Za-z0-9]+/g, "-")}-${tf}-${bars}.jsonl`;

mkdirSync(dirname(outPath), { recursive: true });
const out = createWriteStream(outPath, { encoding: "utf8" });

const startedAt = new Date().toISOString();
out.write(JSON.stringify({
  kind: "probe-envelope",
  startedAt, symbol, tf, bars, study, plan,
  endpoint: "wss://prodata.tradingview.com/socket.io/websocket",
  notes: "A7 entitlement probe — observes whether session unlocks bars beyond legacy 20k clamp",
}) + "\n");

const cookieHeader = sessionSign
  ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
  : `sessionid=${sessionId}`;

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
const authed = authToken !== "unauthorized_user_token";

logFrame("probe", "auth_token_resolved", { tokenSuffix: authToken.slice(-8), authed });

const ws = new WebSocket("wss://prodata.tradingview.com/socket.io/websocket", {
  headers: { Cookie: cookieHeader, Origin: "https://www.tradingview.com" },
});

const csId = `cs_${Math.random().toString(36).slice(2, 14)}`;
const stId = `st_${Math.random().toString(36).slice(2, 10)}`;
const seriesId = "sds_1";
let receivedBars = 0;
let upstreamErrors = [];

ws.addEventListener("message", (event) => {
  const text = typeof event.data === "string" ? event.data : event.data.toString();
  const frames = parseFrames(text);
  for (const frame of frames) {
    if (frame.type === "engineio_ping") { ws.send("3"); continue; }
    if (frame.type === "session") {
      sendFramed("set_auth_token", [authToken]);
      sendFramed("chart_create_session", [csId, ""]);
      sendFramed("resolve_symbol", [csId, seriesId, `={"symbol":"${symbol}","adjustment":"splits"}`]);
      sendFramed("create_series", [csId, seriesId, "s1", seriesId, tf, bars, ""]);
      sendFramed("create_study", [csId, stId, "st1", seriesId, study, { in_0: { initial_capital: 100000 } }]);
      logFrame("probe", "request_dispatched", { csId, stId, seriesId, requestedBars: bars });
      continue;
    }
    if (frame.type === "event") {
      const m = frame.data.m;
      if (m === "timescale_update") {
        const sessionData = frame.data.p?.[1];
        if (sessionData) {
          for (const key of Object.keys(sessionData)) {
            if (key.startsWith("sds_") && Array.isArray(sessionData[key]?.s)) {
              receivedBars += sessionData[key].s.length;
            }
          }
        }
      }
      if (m === "symbol_error" || m === "study_error" || m === "critical_error") {
        upstreamErrors.push({ name: m, params: frame.data.p });
      }
      logFrame("recv", m, { params: frame.data.p });
      if (m === "series_completed" || m === "study_completed" || m === "symbol_error" || m === "critical_error") {
        setTimeout(() => ws.close(), 1500);
      }
      continue;
    }
    logFrame("recv", `unknown-${frame.type}`, frame);
  }
});

ws.addEventListener("close", (event) => {
  const summary = {
    kind: "probe-summary",
    requestedBars: bars,
    receivedBars,
    legacyClamp: 20000,
    crossedLegacyClamp: receivedBars > 20000,
    upstreamErrors,
    closeCode: event.code,
    closeReason: event.reason,
    plan,
    authed,
  };
  out.write(JSON.stringify(summary) + "\n");
  out.end();
  stdout.write(`\nrequested=${bars}  received=${receivedBars}  crossedLegacyClamp=${summary.crossedLegacyClamp}\n`);
});

ws.addEventListener("error", (event) => {
  logFrame("probe", "ws_error", { message: event.message ?? "unknown" });
});

setTimeout(() => {
  stderr.write("timed out at 90s — closing\n");
  try { ws.close(); } catch {}
}, 90000).unref();

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
    if (s === "2" || s === "3") { out.push({ type: "engineio_ping" }); break; }
    const lengthMatch = s.match(/^~m~(\d+)~m~/);
    if (!lengthMatch) {
      try {
        const data = JSON.parse(s);
        if (data?.session_id) out.push({ type: "session", data });
        else out.push({ type: "json", data });
      } catch { out.push({ type: "raw", data: s }); }
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
    } catch { out.push({ type: "raw", data: body }); }
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
    if (next && !next.startsWith("--")) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}
