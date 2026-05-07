#!/usr/bin/env node
// Batch-check UOI indicator authorization, encrypted translate availability,
// script-info shape, and optional live create_study baseline.
//
// Safety boundary: this probe never asks for plaintext source. It records only
// endpoint status, metadata summaries, artifact segment summaries, and runtime
// response classes. Cookie/session values are loaded from worker/.dev.vars when
// present but are not written to artifacts.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit, stderr, stdout, version as nodeVersion } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const args = parseArgs(argv.slice(2));
const startedAt = new Date();
const outDir = args.outDir ?? `probe-output/uoi-boundary-probe-${stampForPath(startedAt)}`;
const uoiJson = args.uoiJson ?? "probe-output/har-indicator-analysis-2026-05-07T10-57-45-960Z/uoi-indicators.json";
const devVarsPath = args.devVars ?? "worker/.dev.vars";
const liveBaseline = Boolean(args.liveBaseline);
const limit = Number(args.limit ?? 10);
const pauseMs = Number(args.pauseMs ?? 800);
const livePauseMs = Number(args.livePauseMs ?? 1500);
const timeoutMs = Number(args.timeoutMs ?? 30000);
const postCompleteMs = Number(args.postCompleteMs ?? 600);
const access = args.access == null ? null : Number(args.access);
const onlyHaveAccess = Boolean(args.onlyHaveAccess);

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
  return createHash("sha256").update(String(value)).digest("hex");
}

function decodeB64(value) {
  return Buffer.from(String(value ?? ""), "base64");
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
  return Number(total.toFixed(6));
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
    headerB64: parts[0],
    headerHex: header.toString("hex"),
    headerBytes: header.length,
    ivB64: parts[1],
    ivHex: iv.toString("hex"),
    ivBytes: iv.length,
    ciphertextB64Chars: parts[2].length,
    ciphertextBytes: ciphertext.length,
    ciphertextMultiple16: ciphertext.length % 16 === 0,
    ciphertextEntropyBitsPerByte: entropy(ciphertext),
  };
}

function loadDevVars(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function cookieHeader(sessionEnv) {
  if (sessionEnv.TRADINGVIEW_COOKIE) return sessionEnv.TRADINGVIEW_COOKIE;
  if (!sessionEnv.TRADINGVIEW_SESSION_ID) return null;
  const parts = [`sessionid=${sessionEnv.TRADINGVIEW_SESSION_ID}`];
  if (sessionEnv.TRADINGVIEW_SESSION_SIGN) parts.push(`sessionid_sign=${sessionEnv.TRADINGVIEW_SESSION_SIGN}`);
  return parts.join("; ");
}

async function fetchText(url, cookie) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: "https://www.tradingview.com",
      referer: "https://www.tradingview.com/",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      ...(cookie ? { cookie } : {}),
    },
  });
  const text = await response.text();
  return { status: response.status, ok: response.ok, text };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function inspectOne(row, cookie) {
  const pineId = row.scriptIdPart;
  const encoded = encodeURIComponent(pineId);
  const versionUrl = `https://pine-facade.tradingview.com/pine-facade/versions/${encoded}/last`;
  const versionResp = await fetchText(versionUrl, cookie);
  const versionJson = tryJson(versionResp.text);
  const version = Array.isArray(versionJson) ? versionJson[0]?.version : row.version;

  const authUrl = `https://pine-facade.tradingview.com/pine-facade/is_auth_to_get/${encoded}/${encodeURIComponent(version ?? row.version)}`;
  const authResp = await fetchText(authUrl, cookie);

  const infoUrl = `https://pine-facade.tradingview.com/pine-facade/get_script_info/?pine_id=${encoded}`;
  const infoResp = await fetchText(infoUrl, cookie);
  const infoJson = tryJson(infoResp.text);

  const translateUrl = `https://pine-facade.tradingview.com/pine-facade/translate/${encoded}/${encodeURIComponent(version ?? row.version)}`;
  const translateResp = await fetchText(translateUrl, cookie);
  const translateJson = tryJson(translateResp.text);
  const result = translateJson?.result ?? translateJson;
  const meta = result?.metaInfo ?? {};

  return {
    pineId,
    title: row.title,
    access: row.access,
    userHaveAccess: row.userHaveAccess ?? null,
    harVersion: row.version,
    resolvedVersion: version ?? null,
    sourceInputsCount: row.extra?.sourceInputsCount ?? null,
    endpoints: {
      versions: { status: versionResp.status, bodySha256: sha256(versionResp.text), json: versionJson },
      isAuthToGet: { status: authResp.status, body: authResp.text.trim().slice(0, 50) },
      getScriptInfo: {
        status: infoResp.status,
        bodySha256: sha256(infoResp.text),
        keys: infoJson && typeof infoJson === "object" ? Object.keys(infoJson).sort() : [],
        summary: infoJson && typeof infoJson === "object"
          ? {
              userId: infoJson.userId,
              userName: infoJson.userName,
              chartImageUrl: infoJson.chartImageUrl,
            }
          : null,
      },
      translate: {
        status: translateResp.status,
        bodySha256: sha256(translateResp.text),
        success: translateJson?.success ?? null,
        keys: result && typeof result === "object" ? Object.keys(result).sort() : [],
        IL: artifactSummary(result?.IL),
        ilTemplate: artifactSummary(result?.ilTemplate),
        metaInfo: {
          id: meta.id ?? null,
          description: meta.description ?? null,
          shortDescription: meta.shortDescription ?? null,
          pine: meta.pine ?? null,
          plots: Array.isArray(meta.plots) ? meta.plots.length : null,
          inputs: Array.isArray(meta.inputs) ? meta.inputs.length : null,
          stats: meta.stats ?? null,
        },
      },
    },
  };
}

function latestTamperEvidence(outBefore) {
  const dirs = [...new Set(outBefore)].sort();
  return dirs[dirs.length - 1] ?? null;
}

function runLiveBaseline(row, sessionEnv) {
  const safeId = row.scriptIdPart.replace(/[^a-zA-Z0-9_-]/g, "_");
  const baselineDir = join(outDir, "live-baseline", safeId);
  mkdirSync(baselineDir, { recursive: true });
  const child = spawnSync(
    "node",
    [
      "scripts/probes/iltemplate-tamper-probe.mjs",
      "--id",
      row.scriptIdPart,
      "--authorized-target",
      "--artifact",
      "IL",
      "--max-tests",
      "1",
      "--timeout-ms",
      String(timeoutMs),
      "--pause-ms",
      String(livePauseMs),
      "--post-complete-ms",
      String(postCompleteMs),
      "--out-dir",
      baselineDir,
    ],
    {
      cwd: cwd(),
      env: { ...process.env, ...sessionEnv },
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  const evidencePath = join(baselineDir, child.status === 0 ? "evidence.json" : "evidence-error.json");
  let evidence = null;
  if (existsSync(evidencePath)) {
    evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  }
  const first = evidence?.results?.[0] ?? null;
  return {
    status: child.status,
    signal: child.signal,
    stdoutTail: child.stdout.split(/\r?\n/).filter(Boolean).slice(-8),
    stderrTail: child.stderr.split(/\r?\n/).filter(Boolean).slice(-8),
    evidencePath,
    result: first
      ? {
          outcome: first.outcome,
          executionClass: first.executionClass,
          duRows: first.duRows,
          durationMs: first.durationMs,
          detail: first.studyError?.detail ?? null,
        }
      : null,
  };
}

if (args.help || args.h) {
  stdout.write("Usage: node scripts/probes/har-uoi-boundary-probe.mjs --live-baseline --limit 10 --access 3 --only-have-access\n");
  exit(0);
}

if (!existsSync(uoiJson)) {
  stderr.write(`Missing UOI inventory: ${uoiJson}\n`);
  exit(2);
}

const sessionEnv = loadDevVars(devVarsPath);
const cookie = cookieHeader(sessionEnv);
const sessionPresent = Boolean(cookie);
let rows = JSON.parse(readFileSync(uoiJson, "utf8"));
if (access != null) rows = rows.filter((row) => Number(row.access) === access);
if (onlyHaveAccess) rows = rows.filter((row) => row.userHaveAccess === true);
rows = rows.slice(0, limit);

const records = [];
for (const [index, row] of rows.entries()) {
  stdout.write(`[${index + 1}/${rows.length}] ${row.scriptIdPart} ${row.title}\n`);
  const record = await inspectOne(row, cookie);
  if (liveBaseline) {
    record.liveBaseline = runLiveBaseline(row, sessionEnv);
  }
  records.push(record);
  await delay(pauseMs);
}

const summary = {
  kind: "uoi-indicator-boundary-probe",
  generatedAt: startedAt.toISOString(),
  cwd: cwd(),
  commandArgv: ["node", "scripts/probes/har-uoi-boundary-probe.mjs", ...argv.slice(2)],
  nodeVersion,
  sourceInventory: uoiJson,
  filters: { access, onlyHaveAccess, limit, liveBaseline },
  sessionPresent,
  redaction: "Cookie/session values omitted. Endpoint bodies are summarized by hashes, status, selected metadata, and artifact segment summaries.",
  counts: {
    requested: rows.length,
    translateSuccess: records.filter((r) => r.endpoints.translate.success === true).length,
    isAuthTrue: records.filter((r) => r.endpoints.isAuthToGet.body === "true").length,
    liveCompletedWithOutput: records.filter((r) => r.liveBaseline?.result?.executionClass === "completed_with_output").length,
    liveCompletedNoOutput: records.filter((r) => r.liveBaseline?.result?.executionClass === "completed_no_output").length,
    liveErrors: records.filter((r) => r.liveBaseline && r.liveBaseline.result?.executionClass !== "completed_with_output").length,
  },
  records,
};

writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(
  join(outDir, "table.tsv"),
  [
    "pineId\ttitle\tversion\tisAuthToGet\ttranslateStatus\tILBytes\tbaselineClass\tbaselineDuRows\tbaselineDetail",
    ...records.map((r) => [
      r.pineId,
      r.title,
      r.resolvedVersion,
      r.endpoints.isAuthToGet.body,
      r.endpoints.translate.status,
      r.endpoints.translate.IL?.ciphertextBytes ?? "",
      r.liveBaseline?.result?.executionClass ?? "",
      r.liveBaseline?.result?.duRows ?? "",
      r.liveBaseline?.result?.detail ?? "",
    ].join("\t")),
  ].join("\n") + "\n",
);

stdout.write(`Evidence written to ${outDir}\n`);
stdout.write(`${JSON.stringify(summary.counts, null, 2)}\n`);
