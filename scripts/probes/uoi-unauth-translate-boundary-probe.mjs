#!/usr/bin/env node
// Compare unauthenticated and authenticated pine-facade access for authorized
// HAR-designated UOI indicators.
//
// Safety boundary: read-only endpoint checks only. The probe does not request
// arbitrary scripts, decrypt artifacts, or persist response bodies, source
// text, cookies, session ids, or auth tokens.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit, stderr, stdout, version as nodeVersion } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const PINE_FACADE = "https://pine-facade.tradingview.com";
const DEFAULT_UOI_JSON = "probe-output/har-indicator-analysis-2026-05-07T10-57-45-960Z/uoi-indicators.json";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const args = parseArgs(argv.slice(2));
const startedAt = new Date();
const outDir = args.outDir ?? `probe-output/uoi-unauth-translate-boundary-${stampForPath(startedAt)}`;
const uoiJson = args.uoiJson ?? DEFAULT_UOI_JSON;
const devVarsPath = args.devVars ?? "worker/.dev.vars";
const limit = Number(args.limit ?? 10);
const pauseMs = Number(args.pauseMs ?? 800);
const access = args.access == null ? null : Number(args.access);
const onlyHaveAccess = Boolean(args.onlyHaveAccess);
const author = args.author ?? "uoi2020";

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
  if (parts.length !== 3) {
    return {
      format: "unknown",
      segmentCount: parts.length,
      tokenChars: token.length,
      tokenSha256: sha256(token),
    };
  }
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
      "user-agent": USER_AGENT,
      ...(cookie ? { cookie } : {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    text,
  };
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sourceLikeLength(json) {
  if (!json || typeof json !== "object") return null;
  for (const key of ["source", "scriptSource", "text", "pineSource"]) {
    if (typeof json[key] === "string") return Buffer.byteLength(json[key], "utf8");
  }
  if (json.result && typeof json.result === "object") return sourceLikeLength(json.result);
  return null;
}

function endpointSummary(resp, endpointName) {
  const json = tryJson(resp.text);
  const result = json?.result ?? json;
  const base = {
    status: resp.status,
    ok: resp.ok,
    contentType: resp.contentType,
    bodySha256: sha256(resp.text),
    bodyBytes: Buffer.byteLength(resp.text, "utf8"),
    jsonKind: Array.isArray(json) ? "array" : json && typeof json === "object" ? "object" : typeof json,
  };

  if (endpointName === "versions") {
    const versions = Array.isArray(json)
      ? json.map((item) => item?.version).filter((item) => item != null)
      : [];
    return { ...base, versions };
  }

  if (endpointName === "isAuthToGet") return { ...base, body: resp.text.trim().slice(0, 50) };

  if (endpointName === "getScriptInfo") {
    return {
      ...base,
      keys: result && typeof result === "object" ? Object.keys(result).sort() : [],
      summary: result && typeof result === "object"
        ? { userId: result.userId, userName: result.userName, chartImageUrl: result.chartImageUrl }
        : null,
    };
  }

  if (endpointName === "getSource") {
    return {
      ...base,
      keys: result && typeof result === "object" ? Object.keys(result).sort() : [],
      success: json?.success ?? null,
      reason: typeof json?.reason === "string" ? json.reason.slice(0, 200) : null,
      sourceLikeLength: sourceLikeLength(json),
    };
  }

  if (endpointName === "translate") {
    const meta = result?.metaInfo ?? {};
    return {
      ...base,
      success: json?.success ?? null,
      keys: result && typeof result === "object" ? Object.keys(result).sort() : [],
      reason: typeof json?.reason === "string" ? json.reason.slice(0, 200) : null,
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
    };
  }

  return base;
}

async function fetchEndpointSet(row, cookie, version) {
  const encoded = encodeURIComponent(row.scriptIdPart);
  const urls = {
    versions: `${PINE_FACADE}/pine-facade/versions/${encoded}/last`,
    isAuthToGet: `${PINE_FACADE}/pine-facade/is_auth_to_get/${encoded}/${encodeURIComponent(version)}`,
    getScriptInfo: `${PINE_FACADE}/pine-facade/get_script_info/?pine_id=${encoded}`,
    getSource: `${PINE_FACADE}/pine-facade/get/${encoded}/last`,
    translate: `${PINE_FACADE}/pine-facade/translate/${encoded}/${encodeURIComponent(version)}`,
  };
  const out = {};
  for (const [name, url] of Object.entries(urls)) out[name] = endpointSummary(await fetchText(url, cookie), name);
  return out;
}

async function resolveVersion(row, cookie) {
  const encoded = encodeURIComponent(row.scriptIdPart);
  const resp = await fetchText(`${PINE_FACADE}/pine-facade/versions/${encoded}/last`, cookie);
  const json = tryJson(resp.text);
  return Array.isArray(json) ? json[0]?.version ?? row.version : row.version;
}

function comparableTranslate(left, right) {
  return {
    bodyHashEqual: left?.bodySha256 === right?.bodySha256,
    ilTokenHashEqual: left?.IL?.tokenSha256 === right?.IL?.tokenSha256,
    ilTemplateTokenHashEqual: left?.ilTemplate?.tokenSha256 === right?.ilTemplate?.tokenSha256,
    ilBytesEqual: left?.IL?.ciphertextBytes === right?.IL?.ciphertextBytes,
    ilTemplateBytesEqual: left?.ilTemplate?.ciphertextBytes === right?.ilTemplate?.ciphertextBytes,
    metaDescriptionEqual: left?.metaInfo?.description === right?.metaInfo?.description,
  };
}

function usage(code) {
  const text = `
Usage:
  node scripts/probes/uoi-unauth-translate-boundary-probe.mjs --limit 10 --access 3 --only-have-access
`.trim();
  (code === 0 ? stdout : stderr).write(`${text}\n`);
  exit(code);
}

if (args.help || args.h) usage(0);
if (!existsSync(uoiJson)) {
  stderr.write(`Missing UOI inventory: ${uoiJson}\n`);
  usage(2);
}

mkdirSync(outDir, { recursive: true });

const sessionEnv = loadDevVars(devVarsPath);
const authenticatedCookie = cookieHeader(sessionEnv);
let rows = JSON.parse(readFileSync(uoiJson, "utf8"));
if (author) rows = rows.filter((row) => row.author?.username === author);
if (access != null) rows = rows.filter((row) => Number(row.access) === access);
if (onlyHaveAccess) rows = rows.filter((row) => row.userHaveAccess === true);
rows = rows.slice(0, limit);

const records = [];
for (const [index, row] of rows.entries()) {
  stdout.write(`[${index + 1}/${rows.length}] ${row.scriptIdPart} ${row.title}\n`);
  const unauthVersion = await resolveVersion(row, null);
  const authVersion = authenticatedCookie ? await resolveVersion(row, authenticatedCookie) : null;
  const probeVersion = authVersion ?? unauthVersion ?? row.version;
  const unauth = await fetchEndpointSet(row, null, probeVersion);
  const auth = authenticatedCookie ? await fetchEndpointSet(row, authenticatedCookie, probeVersion) : null;
  records.push({
    pineId: row.scriptIdPart,
    title: row.title,
    access: row.access,
    userHaveAccess: row.userHaveAccess ?? null,
    author: row.author?.username ?? null,
    harVersion: row.version,
    unauthVersion,
    authVersion,
    probeVersion,
    contexts: { unauth, authenticated: auth },
    comparison: auth
      ? {
          translate: comparableTranslate(unauth.translate, auth.translate),
          isAuthToGetBodyEqual: unauth.isAuthToGet.body === auth.isAuthToGet.body,
          getSourceStatusEqual: unauth.getSource.status === auth.getSource.status,
          getScriptInfoBodyHashEqual: unauth.getScriptInfo.bodySha256 === auth.getScriptInfo.bodySha256,
        }
      : null,
  });
  await delay(pauseMs);
}

const counts = {
  requested: records.length,
  authContextPresent: Boolean(authenticatedCookie),
  unauthTranslateSuccess: records.filter((r) => r.contexts.unauth.translate.success === true).length,
  authTranslateSuccess: records.filter((r) => r.contexts.authenticated?.translate.success === true).length,
  unauthIlPresent: records.filter((r) => Boolean(r.contexts.unauth.translate.IL)).length,
  authIlPresent: records.filter((r) => Boolean(r.contexts.authenticated?.translate.IL)).length,
  unauthIsAuthTrue: records.filter((r) => r.contexts.unauth.isAuthToGet.body === "true").length,
  authIsAuthTrue: records.filter((r) => r.contexts.authenticated?.isAuthToGet.body === "true").length,
  unauthGetSourceSourceLikePresent: records.filter((r) => r.contexts.unauth.getSource.sourceLikeLength != null).length,
  authGetSourceSourceLikePresent: records.filter((r) => r.contexts.authenticated?.getSource.sourceLikeLength != null).length,
  translateBodyHashEqualAcrossContexts: records.filter((r) => r.comparison?.translate.bodyHashEqual).length,
  translateIlBytesEqualAcrossContexts: records.filter((r) => r.comparison?.translate.ilBytesEqual).length,
};

const summary = {
  kind: "uoi-unauth-translate-boundary-probe",
  generatedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  cwd: cwd(),
  commandArgv: ["node", "scripts/probes/uoi-unauth-translate-boundary-probe.mjs", ...argv.slice(2)],
  nodeVersion,
  sourceInventory: uoiJson,
  filters: { author, access, onlyHaveAccess, limit },
  sessionPresent: Boolean(authenticatedCookie),
  noRollbackReason:
    "Read-only GET requests to TradingView pine-facade endpoints for HAR-designated authorized UOI indicators only; no server-side state is intentionally mutated.",
  redaction:
    "No cookies, session ids, auth tokens, full response bodies, source text, IL, or ilTemplate values are written. Responses are represented by status, hashes, selected metadata, and encrypted-artifact segment summaries.",
  counts,
  records,
};

writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(
  join(outDir, "table.tsv"),
  [
    "pineId\ttitle\tversion\tunauthTranslate\tunauthILBytes\tauthTranslate\tauthILBytes\tunauthIsAuth\tauthIsAuth\tunauthGetStatus\tauthGetStatus\tbodyHashEqual\tilBytesEqual",
    ...records.map((record) => [
      record.pineId,
      record.title,
      record.probeVersion,
      record.contexts.unauth.translate.status,
      record.contexts.unauth.translate.IL?.ciphertextBytes ?? "",
      record.contexts.authenticated?.translate.status ?? "",
      record.contexts.authenticated?.translate.IL?.ciphertextBytes ?? "",
      record.contexts.unauth.isAuthToGet.body,
      record.contexts.authenticated?.isAuthToGet.body ?? "",
      record.contexts.unauth.getSource.status,
      record.contexts.authenticated?.getSource.status ?? "",
      record.comparison?.translate.bodyHashEqual ?? "",
      record.comparison?.translate.ilBytesEqual ?? "",
    ].join("\t")),
  ].join("\n") + "\n",
);

stdout.write(`Evidence written to ${outDir}\n`);
stdout.write(`${JSON.stringify(counts, null, 2)}\n`);
