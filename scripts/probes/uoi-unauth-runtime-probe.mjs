#!/usr/bin/env node
// Attempt a no-cookie create_study runtime baseline for one authorized UOI PUB
// script using the encrypted artifact fetched from pine-facade/translate.
//
// Safety boundary: this opens one short-lived chart WebSocket session, uses the
// unauthenticated TradingView token, records only response class/event shape,
// and closes the socket. It does not decrypt, recover source, or persist the
// encrypted artifact value.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit, stderr, stdout, version as nodeVersion } from "node:process";

const require = createRequire(import.meta.url);

const TV_WWW = "https://www.tradingview.com";
const PINE_FACADE = "https://pine-facade.tradingview.com";
const PINE_WIRE_ID = "Script@tv-scripting-101!";
const WS_BASE = "wss://prodata.tradingview.com/socket.io/websocket";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const args = parseArgs(argv.slice(2));
const startedAt = new Date();
const scriptId = String(args.id ?? args.scriptId ?? "");
const versionArg = args.version == null ? "last" : String(args.version);
const artifactName = String(args.artifact ?? "IL");
const symbol = String(args.symbol ?? "BINANCE:BTCUSDT");
const timeframe = String(args.timeframe ?? "60");
const bars = Number(args.bars ?? 200);
const timeoutMs = Number(args.timeoutMs ?? 25000);
const postCompleteMs = Number(args.postCompleteMs ?? 600);
const outDir = args.outDir ?? `probe-output/uoi-unauth-runtime-${stampForPath(startedAt)}`;

mkdirSync(outDir, { recursive: true });

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

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : String(value)).digest("hex");
}

function decodeB64(value) {
  return Buffer.from(String(value ?? ""), "base64");
}

function artifactSummary(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split("_");
  if (parts.length !== 3) return { format: "unknown", segmentCount: parts.length, tokenChars: token.length, tokenSha256: sha256(token) };
  const header = decodeB64(parts[0]);
  const iv = decodeB64(parts[1]);
  const ciphertext = decodeB64(parts[2]);
  return {
    format: "header_iv_ciphertext",
    tokenChars: token.length,
    tokenSha256: sha256(token),
    headerHex: header.toString("hex"),
    headerBytes: header.length,
    ivHex: iv.toString("hex"),
    ivBytes: iv.length,
    ciphertextBytes: ciphertext.length,
  };
}

function frameMessage(name, params) {
  const json = JSON.stringify({ m: name, p: params });
  const len = new TextEncoder().encode(json).length;
  return `~m~${len}~m~${json}`;
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

function redactStudyError(frame) {
  if (frame?.data?.m !== "study_error" && frame?.data?.m !== "critical_error") return null;
  return {
    name: frame.data.m,
    slot: frame.data.p?.[1],
    reason: String(frame.data.p?.[2] ?? "").slice(0, 200),
    detail: String(frame.data.p?.[3] ?? "").slice(0, 300),
  };
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
  throw new Error("runtime probe requires the repo-local ws dependency from pnpm install");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: TV_WWW,
      referer: `${TV_WWW}/`,
      "user-agent": USER_AGENT,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function fetchIndicatorMeta(id) {
  const version = versionArg === "last"
    ? (await fetchJson(`${PINE_FACADE}/pine-facade/versions/${encodeURIComponent(id)}/last`))[0]?.version
    : versionArg;
  const data = await fetchJson(`${PINE_FACADE}/pine-facade/translate/${encodeURIComponent(id)}/${encodeURIComponent(version)}`);
  const result = data?.result ?? data;
  const meta = result?.metaInfo ?? {};
  const artifact = artifactName === "ilTemplate" ? result.ilTemplate ?? result.IL : result.IL ?? result.ilTemplate;
  if (!artifact) throw new Error(`No ${artifactName} artifact returned for ${id}`);
  return {
    id,
    version: meta.pine?.version ?? String(version),
    metaSummary: {
      name: meta.description ?? meta.shortDescription ?? null,
      plots: Array.isArray(meta.plots) ? meta.plots.length : null,
      inputs: Array.isArray(meta.inputs) ? meta.inputs.length : null,
    },
    artifact,
    artifactSummary: artifactSummary(artifact),
  };
}

function buildWsUrl() {
  const date = new Date().toISOString().slice(0, 19);
  return `${WS_BASE}?from=chart%2F&date=${date}&type=chart&auth=sessionid`;
}

function runNoCookieStudy(meta) {
  const WS = loadWebSocket();
  const wsUrl = buildWsUrl();
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
      clearTimeout(timeout);
      if (completedTimer) clearTimeout(completedTimer);
      result.durationMs = Date.now() - startTime;
      result.sentMessages = sent;
      result.duRows = duRows;
      result.receivedEvents = Array.from(new Set(recvPayloads.flatMap((payload) => parseFrames(payload).map((frame) => frame.data?.m).filter(Boolean))));
      result.executionClass = result.studyCompleted
        ? duRows > 0
          ? "completed_with_output"
          : "completed_no_output"
        : result.outcome;
      result.wsUrlShape = `${WS_BASE}?from=chart%2F&date=<redacted>&type=chart&auth=sessionid`;
      try {
        ws.close();
      } catch {}
      resolve(result);
    };

    const ws = new WS(wsUrl, {
      headers: {
        Origin: TV_WWW,
        "User-Agent": USER_AGENT,
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
    });

    const timeout = setTimeout(() => {
      finish({ outcome: "timeout", studyCompleted: false, studyError: null }, ws);
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
          send("set_auth_token", ["unauthorized_user_token"]);
          send("set_locale", ["en", "US"]);
          send("chart_create_session", [csId, ""]);
          send("switch_timezone", [csId, "exchange"]);
          send("resolve_symbol", [csId, symbolId, `={"adjustment":"splits","symbol":"${symbol}"}`]);
          send("create_series", [csId, seriesId, "s1", symbolId, timeframe, bars, ""]);
          continue;
        }
        if (frame.type !== "event") continue;
        if (frame.data.m === "series_completed" && !studyDispatched) {
          studyDispatched = true;
          send("create_study", [
            csId,
            stId,
            "st1",
            seriesId,
            PINE_WIRE_ID,
            { text: meta.artifact, pineId: meta.id, pineVersion: meta.version },
          ]);
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
              finish({ outcome: "study_completed", studyCompleted: true, studyError: null }, ws);
            }, postCompleteMs);
            completedTimer.unref();
          }
          continue;
        }
        if (frame.data.m === "study_error" || frame.data.m === "critical_error") {
          finish({ outcome: frame.data.m, studyCompleted: false, studyError: redactStudyError(frame) }, ws);
        }
      }
    });

    ws.on("error", (err) => {
      finish({ outcome: "ws_error", studyCompleted: false, studyError: null, error: String(err?.message ?? err).slice(0, 300) }, ws);
    });

    ws.on("close", (code, reason) => {
      finish({
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
  if (!scriptId || !/^(PUB|USER);/.test(scriptId)) {
    stderr.write("Missing --id PUB;<hash> or USER;<id>.\n");
    exit(2);
  }
  const meta = await fetchIndicatorMeta(scriptId);
  const result = await runNoCookieStudy(meta);
  const evidence = {
    kind: "uoi-unauth-runtime-probe",
    generatedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    cwd: cwd(),
    commandArgv: ["node", "scripts/probes/uoi-unauth-runtime-probe.mjs", ...argv.slice(2)],
    nodeVersion,
    noRollbackReason:
      "One short-lived unauthenticated chart WebSocket session against an authorized UOI script; no persistent server-side state is intentionally mutated.",
    redaction:
      "No cookies, session ids, auth tokens, source text, IL, or ilTemplate values are written. The encrypted artifact is summarized by hash and segment metadata only.",
    target: {
      scriptId,
      artifact: artifactName,
      symbol,
      timeframe,
      bars,
      timeoutMs,
      postCompleteMs,
      version: meta.version,
      metaSummary: meta.metaSummary,
      artifactSummary: meta.artifactSummary,
    },
    result,
  };
  writeJson("evidence.json", evidence);
  stdout.write(`Evidence written to ${outDir}\n`);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((err) => {
  const evidence = {
    kind: "uoi-unauth-runtime-probe",
    generatedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    cwd: cwd(),
    commandArgv: ["node", "scripts/probes/uoi-unauth-runtime-probe.mjs", ...argv.slice(2)],
    nodeVersion,
    error: String(err?.stack ?? err),
  };
  writeJson("evidence-error.json", evidence);
  stderr.write(`${evidence.error}\n`);
  exit(1);
});
