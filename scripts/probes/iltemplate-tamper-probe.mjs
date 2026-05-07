#!/usr/bin/env node
// Authorized TradingView encrypted-artifact tamper probe.
//
// Scope boundary:
// - Uses only an explicitly supplied authorized PUB/USER script id.
// - Does not attempt key recovery, decryption, source recovery, or extraction
//   of unrelated protected scripts.
// - Compares response class, timing, and event shape for controlled mutations.
//
// External-call rollback: none. Live mode opens short-lived chart WebSocket
// sessions, sends bounded create_study requests, then closes the socket. It
// writes only local gitignored probe-output artifacts. Live mode is disabled
// unless session credentials and an explicit authorization flag are supplied.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  argv,
  cwd,
  env,
  exit,
  stderr,
  stdout,
  version as nodeVersion,
} from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);

const TV_WWW = "https://www.tradingview.com";
const PINE_FACADE = "https://pine-facade.tradingview.com";
const PINE_WIRE_ID = "Script@tv-scripting-101!";
const DEFAULT_ENDPOINT = "prodata";
const ENDPOINTS = {
  data: "wss://data.tradingview.com/socket.io/websocket",
  prodata: "wss://prodata.tradingview.com/socket.io/websocket",
  widgetdata: "wss://widgetdata.tradingview.com/socket.io/websocket",
};
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const args = parseArgs(argv.slice(2));
const startedAt = new Date();
const outDir = args.outDir ?? `probe-output/iltemplate-tamper-${stampForPath(startedAt)}`;
const scriptId = String(args.id ?? args.scriptId ?? "");
const artifactName = String(args.artifact ?? "IL");
const symbol = String(args.symbol ?? "BINANCE:BTCUSDT");
const timeframe = String(args.timeframe ?? "60");
const bars = Number(args.bars ?? 200);
const maxTests = Number(args.maxTests ?? 6);
const timeoutMs = Number(args.timeoutMs ?? 25000);
const pauseMs = Number(args.pauseMs ?? 1200);
const postCompleteMs = Number(args.postCompleteMs ?? 600);
const endpoint = String(args.endpoint ?? DEFAULT_ENDPOINT);
const inputMode = String(args.inputMode ?? "identity");
const offlineOnly = Boolean(args.offlineOnly);
const authorizationFlag = Boolean(args.authorizedTarget || args.iUnderstandScope);

mkdirSync(outDir, { recursive: true });

const evidence = {
  kind: "authorized-iltemplate-tamper-probe",
  startedAt: startedAt.toISOString(),
  cwd: cwd(),
  command: ["node", "scripts/probes/iltemplate-tamper-probe.mjs", ...argv.slice(2)].join(" "),
  commandArgv: ["node", "scripts/probes/iltemplate-tamper-probe.mjs", ...argv.slice(2)],
  nodeVersion,
  target: {
    scriptId,
    artifact: artifactName,
    endpoint,
    symbol,
    timeframe,
    bars,
    maxTests,
    timeoutMs,
    pauseMs,
    postCompleteMs,
    inputMode,
    offlineOnly,
  },
  safetyBoundary: [
    "Explicit authorized target required for live mode.",
    "No key recovery, decryption, source recovery, or unrelated protected script extraction.",
    "Tampering is segment-aware: header/IV/ciphertext are mutated independently.",
    "Only response classes, timing, and event-name shapes are recorded.",
    "Cookies/auth tokens are never written to evidence artifacts.",
  ],
  externalCalls: {
    rollbackPath: "No persistent TradingView state is intentionally mutated. Close the WebSocket session; local artifacts can be removed with rm -rf <outDir>.",
    noRollbackReason:
      "Live requests create short-lived chart study sessions only. Scope is bounded by explicit authorized script id, maxTests, timeoutMs, and pauseMs.",
  },
  probes: [],
};

function usage(exitCode) {
  const text = `
Usage:
  node scripts/probes/iltemplate-tamper-probe.mjs --id PUB;<hash> --authorized-target [options]
  node scripts/probes/iltemplate-tamper-probe.mjs --id PUB;<hash> --offline-only [options]

Required for live mode:
  --id PUB;<hash> or --id USER;<id>
  --authorized-target or --i-understand-scope
  TRADINGVIEW_SESSION_ID or TRADINGVIEW_COOKIE

Options:
  --artifact IL|ilTemplate       Artifact field to test. Default: IL
  --symbol BINANCE:BTCUSDT       Chart symbol. Default: BINANCE:BTCUSDT
  --timeframe 60                 Chart timeframe. Default: 60
  --bars 200                     Initial bars. Default: 200
  --max-tests 6                  Cap live tests. Default: 6
  --pause-ms 1200                Delay between live tests. Default: 1200
  --timeout-ms 25000             Per-test timeout. Default: 25000
  --post-complete-ms 600         Wait after study_completed for trailing du frames. Default: 600
  --endpoint prodata             data|prodata|widgetdata. Default: prodata
  --input-mode identity|defaults Pine inputs. Default: identity
  --out-dir <path>               Output directory under probe-output/
`.trim();
  (exitCode === 0 ? stdout : stderr).write(`${text}\n`);
  exit(exitCode);
}

function parseArgs(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith("--")) continue;
    const eq = item.match(/^--([^=]+)=(.*)$/);
    if (eq) {
      out[toCamel(eq[1])] = eq[2];
      continue;
    }
    const key = toCamel(item.slice(2));
    const next = items[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function stampForPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function decodeB64(value) {
  return Buffer.from(value, "base64");
}

function encodeB64(buf) {
  return Buffer.from(buf).toString("base64");
}

function entropy(buf) {
  if (!buf.length) return 0;
  const counts = new Array(256).fill(0);
  for (const byte of buf) counts[byte] += 1;
  let total = 0;
  for (const count of counts) {
    if (!count) continue;
    const p = count / buf.length;
    total -= p * Math.log2(p);
  }
  return total;
}

function summarizeToken(token) {
  const parts = String(token ?? "").split("_");
  if (parts.length === 3) {
    const header = decodeB64(parts[0]);
    const iv = decodeB64(parts[1]);
    const ciphertext = decodeB64(parts[2]);
    return {
      structure: "header_iv_ciphertext",
      segmentCount: 3,
      tokenChars: token.length,
      tokenSha256: sha256(token),
      headerB64: parts[0],
      headerHex: header.toString("hex"),
      headerBytes: header.length,
      ivB64: parts[1],
      ivHex: iv.toString("hex"),
      ivBytes: iv.length,
      ciphertextB64Chars: parts[2].length,
      ciphertextBytes: ciphertext.length,
      ciphertextMultiple16: ciphertext.length % 16 === 0,
      ciphertextEntropyBitsPerByte: Number(entropy(ciphertext).toFixed(6)),
      ciphertextHeadHex: ciphertext.subarray(0, 16).toString("hex"),
      ciphertextTailHex: ciphertext.subarray(Math.max(0, ciphertext.length - 16)).toString("hex"),
    };
  }
  if (parts.length === 2) {
    const prefix = decodeB64(parts[0]);
    const payload = decodeB64(parts[1]);
    return {
      structure: "prefix_payload",
      segmentCount: 2,
      tokenChars: token.length,
      tokenSha256: sha256(token),
      prefixB64: parts[0],
      prefixHex: prefix.toString("hex"),
      prefixBytes: prefix.length,
      payloadB64Chars: parts[1].length,
      payloadBytes: payload.length,
      payloadMultiple16: payload.length % 16 === 0,
      payloadEntropyBitsPerByte: Number(entropy(payload).toFixed(6)),
      payloadHeadHex: payload.subarray(0, 16).toString("hex"),
      payloadTailHex: payload.subarray(Math.max(0, payload.length - 16)).toString("hex"),
    };
  }
  return {
    structure: "unknown",
    segmentCount: parts.length,
    tokenChars: String(token ?? "").length,
    tokenSha256: sha256(String(token ?? "")),
  };
}

function mutateByteB64(b64, byteIndex, mask = 0x01) {
  const buf = decodeB64(b64);
  if (!buf.length) return b64;
  const idx = Math.min(Math.max(0, byteIndex), buf.length - 1);
  buf[idx] ^= mask;
  return encodeB64(buf);
}

function truncateB64(b64, bytes = 1) {
  const buf = decodeB64(b64);
  return encodeB64(buf.subarray(0, Math.max(0, buf.length - bytes)));
}

function buildMutationMatrix(artifact, alternateArtifact) {
  const token = String(artifact ?? "");
  const parts = token.split("_");
  const tests = [{ label: "baseline-valid", artifact: token, mutation: "none" }];

  if (parts.length === 3) {
    tests.push({
      label: "flip-ciphertext-byte",
      artifact: `${parts[0]}_${parts[1]}_${mutateByteB64(parts[2], 0, 0x01)}`,
      mutation: "ciphertext byte 0 xor 0x01",
    });
    tests.push({
      label: "flip-iv-byte",
      artifact: `${parts[0]}_${mutateByteB64(parts[1], 0, 0x08)}_${parts[2]}`,
      mutation: "iv byte 0 xor 0x08",
    });
    tests.push({
      label: "flip-header-byte",
      artifact: `${mutateByteB64(parts[0], 0, 0x01)}_${parts[1]}_${parts[2]}`,
      mutation: "header/key byte 0 xor 0x01",
    });
    tests.push({
      label: "truncated-ciphertext",
      artifact: `${parts[0]}_${parts[1]}_${truncateB64(parts[2], 1)}`,
      mutation: "ciphertext last byte removed",
    });
  } else if (parts.length === 2) {
    tests.push({
      label: "flip-payload-byte",
      artifact: `${parts[0]}_${mutateByteB64(parts[1], 0, 0x01)}`,
      mutation: "payload byte 0 xor 0x01",
    });
    tests.push({
      label: "flip-prefix-byte",
      artifact: `${mutateByteB64(parts[0], 0, 0x01)}_${parts[1]}`,
      mutation: "prefix byte 0 xor 0x01",
    });
    tests.push({
      label: "truncated-payload",
      artifact: `${parts[0]}_${truncateB64(parts[1], 1)}`,
      mutation: "payload last byte removed",
    });
  } else {
    tests.push({ label: "empty-text", artifact: "", mutation: "empty text input" });
  }

  if (alternateArtifact && alternateArtifact !== token) {
    tests.push({
      label: "swap-il-iltemplate",
      artifact: alternateArtifact,
      mutation: "swap selected artifact with sibling IL/ilTemplate artifact from the same authorized target",
    });
  }

  tests.push({ label: "empty-text", artifact: "", mutation: "empty text input" });
  return tests.slice(0, Math.max(1, maxTests));
}

async function fetchText(url, options = {}) {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: options.accept ?? "*/*",
      referer: options.referer ?? `${TV_WWW}/chart/`,
      ...(options.headers ?? {}),
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${url} failed: ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, { ...options, accept: "application/json,text/plain,*/*" }));
}

function buildCookieHeader() {
  if (env.TRADINGVIEW_COOKIE) return env.TRADINGVIEW_COOKIE;
  if (!env.TRADINGVIEW_SESSION_ID) return null;
  const parts = [`sessionid=${env.TRADINGVIEW_SESSION_ID}`];
  if (env.TRADINGVIEW_SESSION_SIGN) parts.push(`sessionid_sign=${env.TRADINGVIEW_SESSION_SIGN}`);
  return parts.join("; ");
}

async function fetchAuthToken(cookieHeader) {
  const disclaimer = await fetchText(`${TV_WWW}/disclaimer/`, {
    headers: { Cookie: cookieHeader },
  });
  const match = disclaimer.match(/"auth_token":"(.+?)"/);
  return {
    authed: Boolean(match),
    token: match?.[1] ?? "unauthorized_user_token",
  };
}

async function fetchIndicatorMeta(id, cookieHeader) {
  const url = `${PINE_FACADE}/pine-facade/translate/${encodeURIComponent(id)}/last`;
  const data = await fetchJson(url, {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
  });
  if (!data?.success || !data?.result) {
    throw new Error(`indicator meta unavailable for ${id}: ${data?.reason ?? "unknown"}`);
  }

  const result = data.result;
  const meta = result.metaInfo ?? {};
  const il = result.IL ?? null;
  const ilTemplate = result.ilTemplate ?? null;
  const inputIl = (meta.inputs ?? []).find((input) => input?.name === "ILScript" || input?.id === "text");
  const canonicalInputArtifact = inputIl?.defval ?? null;
  const selected =
    artifactName === "ilTemplate"
      ? ilTemplate ?? il ?? canonicalInputArtifact
      : artifactName === "ILScript" || artifactName === "text"
        ? canonicalInputArtifact ?? il ?? ilTemplate
        : il ?? ilTemplate ?? canonicalInputArtifact;

  if (!selected) throw new Error(`no ${artifactName} artifact found for ${id}`);

  return {
    id,
    scriptIdPart: result.scriptIdPart ?? null,
    version: meta.pine?.version ?? result.pineVersion ?? "1.0",
    isStrategy: Boolean(meta.is_strategy),
    runtimeId: meta.id ?? null,
    selectedArtifact: selected,
    selectedArtifactName: artifactName,
    siblingArtifact:
      selected === il
        ? ilTemplate
        : selected === ilTemplate
          ? il
          : il ?? ilTemplate,
    defaultInputs: defaultInputsFromMeta(meta.inputs ?? []),
    metaSummary: {
      name: meta.description ?? meta.shortDescription ?? null,
      pineVersion: meta.pine?.version ?? null,
      plots: Array.isArray(meta.plots) ? meta.plots.length : null,
      inputs: Array.isArray(meta.inputs) ? meta.inputs.length : null,
    },
    artifactSummary: summarizeToken(selected),
    siblingArtifactSummary: il || ilTemplate ? summarizeToken(selected === il ? ilTemplate : il) : null,
  };
}

function defaultInputsFromMeta(inputs) {
  const out = {};
  for (const input of inputs) {
    if (!input?.id || input.defval === undefined) continue;
    out[input.id] = input.defval;
  }
  return out;
}

function buildChartSessionWsUrl(endpointName) {
  const base = ENDPOINTS[endpointName];
  if (!base) throw new Error(`unsupported endpoint ${endpointName}; expected one of ${Object.keys(ENDPOINTS).join(", ")}`);
  const date = new Date().toISOString().slice(0, 19);
  return `${base}?from=chart%2F&date=${date}&type=chart&auth=sessionid`;
}

function loadWebSocket() {
  try {
    return require("ws");
  } catch {}
  try {
    return require("../node_modules/.pnpm/ws@8.18.0/node_modules/ws");
  } catch {}
  try {
    return require("../../node_modules/.pnpm/ws@8.18.0/node_modules/ws");
  } catch {}
  throw new Error(
    "live mode requires the ws package from the local pnpm install; run pnpm install or use --offline-only"
  );
}

function parseFrames(input) {
  const out = [];
  let s = String(input);
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

function frameMessage(name, params) {
  const json = JSON.stringify({ m: name, p: params });
  const len = new TextEncoder().encode(json).length;
  return `~m~${len}~m~${json}`;
}

function frameNamesFromPayloads(payloads) {
  const names = [];
  for (const payload of payloads) {
    for (const frame of parseFrames(payload)) {
      if (frame.type === "event") names.push(frame.data.m);
    }
  }
  return Array.from(new Set(names));
}

function redactStudyError(frame) {
  if (frame?.data?.m !== "study_error") return null;
  return {
    slot: frame.data.p?.[1],
    reason: String(frame.data.p?.[2] ?? "").slice(0, 200),
    detail: String(frame.data.p?.[3] ?? "").slice(0, 300),
  };
}

async function runStudyTest({ label, artifact, mutation, meta, authToken, cookieHeader, WS }) {
  const wsUrl = buildChartSessionWsUrl(endpoint);
  const csId = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const stId = `st_${Math.random().toString(36).slice(2, 8)}`;
  const symbolId = "sds_sym_1";
  const seriesId = "sds_1";
  const recvPayloads = [];
  const sent = [];
  const startTime = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let bootstrapped = false;
    let studyDispatched = false;
    let duRows = 0;
    let completedTimer = null;

    const finish = (result, ws) => {
      if (settled) return;
      settled = true;
      result.receivedEvents = frameNamesFromPayloads(recvPayloads);
      result.durationMs = Date.now() - startTime;
      result.sentMessages = sent;
      result.duRows = duRows;
      result.executionClass = result.studyCompleted
        ? duRows > 0
          ? "completed_with_output"
          : "completed_no_output"
        : result.outcome;
      result.wsUrlShape = `${ENDPOINTS[endpoint]}?from=chart%2F&date=<redacted>&type=chart&auth=sessionid`;
      clearTimeout(timeout);
      if (completedTimer) clearTimeout(completedTimer);
      try {
        ws.close();
      } catch {}
      resolve(result);
    };

    const ws = new WS(wsUrl, {
      headers: {
        Cookie: cookieHeader,
        Origin: TV_WWW,
        "User-Agent": USER_AGENT,
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
    });

    const timeout = setTimeout(() => {
      finish({ label, mutation, outcome: "timeout", studyCompleted: false, studyError: null }, ws);
    }, timeoutMs);
    timeout.unref();

    const send = (name, params) => {
      sent.push(name);
      ws.send(frameMessage(name, params));
    };

    ws.on("message", (data) => {
      const text = data.toString();
      recvPayloads.push(text);

      for (const frame of parseFrames(text)) {
        if (frame.type === "engineio_ping") {
          ws.send("3");
          continue;
        }
        if (frame.type === "session" && !bootstrapped) {
          bootstrapped = true;
          send("set_auth_token", [authToken]);
          send("set_locale", ["en", "US"]);
          send("chart_create_session", [csId, ""]);
          send("switch_timezone", [csId, "exchange"]);
          send("resolve_symbol", [
            csId,
            symbolId,
            `={"adjustment":"splits","symbol":"${symbol}"}`,
          ]);
          send("create_series", [csId, seriesId, "s1", symbolId, timeframe, bars, ""]);
          continue;
        }
        if (frame.type !== "event") continue;
        if (frame.data.m === "series_completed" && !studyDispatched) {
          studyDispatched = true;
          const identityInputs = {
            text: artifact,
            pineId: meta.id,
            pineVersion: meta.version,
          };
          const inputs =
            inputMode === "defaults"
              ? { ...meta.defaultInputs, ...identityInputs }
              : identityInputs;
          send("create_study", [csId, stId, "st1", seriesId, PINE_WIRE_ID, inputs]);
          continue;
        }
        if (frame.data.m === "du") {
          const slotMap = frame.data.p?.[1] ?? {};
          for (const payload of Object.values(slotMap)) duRows += Array.isArray(payload?.st) ? payload.st.length : 0;
          continue;
        }
        if (frame.data.m === "study_completed") {
          if (!completedTimer) {
            completedTimer = setTimeout(() => {
              finish({ label, mutation, outcome: "study_completed", studyCompleted: true, studyError: null }, ws);
            }, postCompleteMs);
            completedTimer.unref();
          }
          continue;
        }
        if (frame.data.m === "study_error" || frame.data.m === "critical_error") {
          finish({
            label,
            mutation,
            outcome: frame.data.m,
            studyCompleted: false,
            studyError: redactStudyError(frame),
          }, ws);
        }
      }
    });

    ws.on("error", (err) => {
      finish({
        label,
        mutation,
        outcome: "ws_error",
        studyCompleted: false,
        studyError: null,
        error: String(err?.message ?? err).slice(0, 300),
      }, ws);
    });

    ws.on("close", (code, reason) => {
      finish({
        label,
        mutation,
        outcome: "ws_close",
        studyCompleted: false,
        studyError: null,
        closeCode: code,
        closeReason: Buffer.isBuffer(reason) ? reason.toString("utf8").slice(0, 200) : String(reason ?? "").slice(0, 200),
      }, ws);
    });
  });
}

function writeJson(name, data) {
  writeFileSync(join(outDir, name), `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  if (args.help || args.h) usage(0);
  if (!scriptId || !/^(PUB|USER);/.test(scriptId)) {
    stderr.write("Missing or unsupported --id. Use an explicit authorized PUB;<hash> or USER;<id> target.\n\n");
    usage(2);
  }
  if (!ENDPOINTS[endpoint]) {
    stderr.write(`Unsupported --endpoint ${endpoint}.\n`);
    usage(2);
  }

  const cookieHeader = buildCookieHeader();
  if (!offlineOnly && !authorizationFlag) {
    throw new Error("live mode requires --authorized-target or --i-understand-scope");
  }
  if (!offlineOnly && !cookieHeader) {
    throw new Error("live mode requires TRADINGVIEW_SESSION_ID or TRADINGVIEW_COOKIE; use --offline-only for artifact parsing only");
  }

  stdout.write("=== Authorized ilTemplate Tamper Probe ===\n\n");
  stdout.write(`Target: ${scriptId}\n`);
  stdout.write(`Mode: ${offlineOnly ? "offline-only" : "live"}\n`);

  const meta = await fetchIndicatorMeta(scriptId, cookieHeader);
  evidence.target.scriptIdPart = meta.scriptIdPart;
  evidence.target.pineVersion = meta.version;
  evidence.target.metaSummary = meta.metaSummary;
  evidence.target.artifactSummary = meta.artifactSummary;
  evidence.target.siblingArtifactSummary = meta.siblingArtifactSummary;

  const matrix = buildMutationMatrix(meta.selectedArtifact, meta.siblingArtifact);
  evidence.probes = matrix.map((test) => ({
    label: test.label,
    mutation: test.mutation,
    artifactSummary: summarizeToken(test.artifact),
  }));

  writeJson("planned-probes.json", evidence.probes);
  writeJson("target-summary.json", evidence.target);

  stdout.write(`Artifact structure: ${meta.artifactSummary.structure}\n`);
  if (meta.artifactSummary.structure === "header_iv_ciphertext") {
    stdout.write(`  header=${meta.artifactSummary.headerHex} iv=${meta.artifactSummary.ivHex} ciphertext=${meta.artifactSummary.ciphertextBytes} bytes entropy=${meta.artifactSummary.ciphertextEntropyBitsPerByte}\n`);
  } else if (meta.artifactSummary.structure === "prefix_payload") {
    stdout.write(`  prefix=${meta.artifactSummary.prefixHex} payload=${meta.artifactSummary.payloadBytes} bytes entropy=${meta.artifactSummary.payloadEntropyBitsPerByte}\n`);
  }

  if (offlineOnly) {
    evidence.completedAt = new Date().toISOString();
    evidence.result = "offline_planned_only";
    writeJson("evidence.json", evidence);
    stdout.write(`\nOffline probe plan written to ${outDir}\n`);
    return;
  }

  const auth = await fetchAuthToken(cookieHeader);
  if (!auth.authed) {
    throw new Error("TradingView disclaimer page did not expose an authenticated auth_token for supplied cookies");
  }

  const WS = loadWebSocket();
  const results = [];
  for (const test of matrix) {
    stdout.write(`\n[${test.label}] ${test.mutation}\n`);
    const result = await runStudyTest({
      label: test.label,
      artifact: test.artifact,
      mutation: test.mutation,
      meta,
      authToken: auth.token,
      cookieHeader,
      WS,
    });
    results.push(result);
    stdout.write(`  outcome=${result.outcome} class=${result.executionClass} duRows=${result.duRows} duration=${result.durationMs}ms events=${result.receivedEvents.join(",") || "none"}\n`);
    if (result.studyError) stdout.write(`  study_error=${JSON.stringify(result.studyError)}\n`);
    await delay(pauseMs);
  }

  evidence.completedAt = new Date().toISOString();
  evidence.authenticated = true;
  evidence.results = results;
  evidence.analysis = {
    distinctOutcomes: Array.from(new Set(results.map((r) => r.outcome))),
    distinctExecutionClasses: Array.from(new Set(results.map((r) => r.executionClass))),
    distinctStudyErrorReasons: Array.from(new Set(results.map((r) => r.studyError?.reason).filter(Boolean))),
    distinctStudyErrorDetails: Array.from(new Set(results.map((r) => r.studyError?.detail).filter(Boolean))),
    cryptoSensitiveTermsInErrors: Array.from(
      new Set(
        JSON.stringify(results.map((r) => r.studyError).filter(Boolean))
          .match(/decrypt|integrity|auth tag|gcm|aes|cipher|mac/gi) ?? []
      )
    ),
  };

  writeJson("evidence.json", evidence);
  writeJson("tamper-results.json", results);
  stdout.write(`\nEvidence written to ${outDir}\n`);
}

main().catch((err) => {
  evidence.completedAt = new Date().toISOString();
  evidence.error = String(err?.stack ?? err);
  writeJson("evidence-error.json", evidence);
  stderr.write(`${evidence.error}\n`);
  exit(1);
});
