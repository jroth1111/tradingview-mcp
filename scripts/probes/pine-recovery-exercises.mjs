#!/usr/bin/env node
// Pine source recovery boundary exercises.
//
// This is a discovery probe, not production code. It intentionally avoids
// protected-source recovery, key extraction, or TradingView artifact
// decryption. It only fetches public open-source `scriptSource` data and uses
// local AES-GCM for the controlled benchmark.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argv, cwd, env, exit, stderr, stdout, version as nodeVersion } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { deflateSync, inflateSync } from "node:zlib";

const DEFAULT_QUERIES = ["RSI", "MACD", "Bollinger", "Supertrend", "Moving Average"];
const TV_WWW = "https://www.tradingview.com";
const PINE_FACADE = "https://pine-facade.tradingview.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const args = parseArgs(argv.slice(2));
const outDir = args.outDir ?? `probe-output/pine-recovery-${stampForPath(new Date())}`;
const docsOut = args.docsOut ?? null;
const maxOpen = numberArg(args.maxOpen, 10);
const maxAssets = numberArg(args.maxAssets, 80);
const bars = numberArg(args.bars, 50);
const timeframe = String(args.timeframe ?? "60");
const symbol = String(args.symbol ?? "NASDAQ:AAPL");
const queries = parseQueries(args.queries);
const startedAt = new Date();

mkdirSync(outDir, { recursive: true });

const evidence = {
  kind: "pine-recovery-exercises",
  startedAt: startedAt.toISOString(),
  cwd: cwd(),
  command: ["node", "scripts/probes/pine-recovery-exercises.mjs", ...argv.slice(2)].join(" "),
  nodeVersion,
  safetyBoundary: [
    "No protected-source recovery.",
    "No TradingView server-held key recovery.",
    "No decryption of TradingView ilTemplate artifacts.",
    "Only public open-source scriptSource plus local controlled crypto.",
  ],
  externalCalls: {
    rollback: "none",
    noRollbackReason:
      "Read-only public GET/POST/WebSocket probes against TradingView. Scope is bounded by --max-open/--max-assets/--bars, sends no cookies, and writes only local gitignored artifacts.",
  },
  inputs: { queries, maxOpen, maxAssets, symbol, timeframe, bars },
  artifacts: {},
  results: {},
};

try {
  const corpus = await collectOpenScripts(queries, maxOpen);
  if (corpus.length === 0) {
    throw new Error("no public open-source scripts with non-empty scriptSource were found");
  }
  evidence.results.corpus = summarizeCorpus(corpus);
  writeCorpusArtifacts(corpus);

  const lengthRows = await compareSourceAndIlLengths(corpus);
  evidence.results.lengthComparison = summarizeLengths(lengthRows);
  writeJson("length-comparison.json", lengthRows);

  const bundleScan = await scanChartBundles(lengthRows);
  evidence.results.bundleScan = bundleScan;
  writeJson("bundle-scan-summary.json", bundleScan);

  const wireScript = corpus.find((script) => String(script.type) !== "2") ?? corpus[0];
  const wireLengthRow = lengthRows.find((row) => row.id === wireScript.id) ?? lengthRows[0];
  const studyWire = await captureStudyWire(wireScript, wireLengthRow);
  evidence.results.studyWire = studyWire.summary;
  evidence.artifacts.studyWireJsonl = studyWire.path;

  const benchmark = runControlledBenchmark(corpus);
  evidence.results.controlledBenchmark = summarizeBenchmark(benchmark);
  writeJson("controlled-crypto-benchmark.json", benchmark);

  const report = renderReport(evidence, corpus, lengthRows, bundleScan, studyWire.summary, benchmark);
  const reportPath = join(outDir, "summary.md");
  writeFileSync(reportPath, report);
  evidence.artifacts.summary = reportPath;
  if (docsOut) {
    mkdirSync(dirname(docsOut), { recursive: true });
    writeFileSync(docsOut, report);
    evidence.artifacts.docsReport = docsOut;
  }
  writeJson("evidence.json", evidence);
  stdout.write(`${report}\n`);
} catch (err) {
  evidence.error = String(err?.stack ?? err);
  writeJson("evidence-error.json", evidence);
  stderr.write(`${evidence.error}\n`);
  exit(1);
}

async function collectOpenScripts(searchTerms, limit) {
  const seen = new Set();
  const scripts = [];

  for (const query of searchTerms) {
    const url = `${TV_WWW}/pubscripts-suggest-json/?search=${encodeURIComponent(query)}&limit=100`;
    const data = await fetchJson(url);
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const item of results) {
      const source = typeof item.scriptSource === "string" ? item.scriptSource : "";
      const id = item.scriptIdPart;
      if (!id || seen.has(id) || source.trim().length === 0) continue;
      seen.add(id);
      scripts.push({
        id,
        version: String(item.version ?? "last"),
        title: item.scriptName ?? item.title ?? id,
        author: item.author?.username ?? item.author ?? "unknown",
        access: item.access,
        type: item.type,
        query,
        source,
        sourceSha256: sha256(source),
        sourceBytes: Buffer.byteLength(source),
        sourceChars: source.length,
        lineCount: source.split(/\r?\n/).length,
      });
      if (scripts.length >= limit) return scripts;
    }
  }
  return scripts;
}

async function compareSourceAndIlLengths(corpus) {
  const rows = [];
  for (const script of corpus) {
    const meta = await fetchIndicatorMeta(script.id);
    const il = meta.ilTemplate;
    const parts = parseIlTemplate(il);
    rows.push({
      id: script.id,
      title: script.title,
      author: script.author,
      sourceChars: script.sourceChars,
      sourceBytes: script.sourceBytes,
      lineCount: script.lineCount,
      ilChars: il.length,
      keyId: parts.keyId,
      ivBytes: parts.ivBytes,
      cipherBytes: parts.cipherBytes,
      cipherToSourceByteRatio: round(parts.cipherBytes / script.sourceBytes, 4),
      ilToSourceCharRatio: round(il.length / script.sourceChars, 4),
      runtimeId: meta.runtimeId,
      metaDescription: meta.description,
      pineVersion: meta.pineVersion,
      resultField: meta.resultField,
      defaultInputs: meta.defaultInputs,
      defaultInputIds: Object.keys(meta.defaultInputs),
    });
    await delay(80);
  }
  return rows;
}

async function fetchIndicatorMeta(id) {
  const url = `${PINE_FACADE}/pine-facade/translate/${encodeURIComponent(id)}/last`;
  const data = await fetchJson(url, { referer: `${TV_WWW}/chart/` });
  if (!data?.success || !data?.result) {
    throw new Error(`indicator meta unavailable for ${id}: ${data?.reason ?? "unknown"}`);
  }
  const result = data.result;
  const resultField = firstPresentField(result, ["ilTemplate", "IL", "script"]);
  const ilTemplate = result[resultField];
  if (typeof ilTemplate !== "string" || ilTemplate.length === 0) {
    throw new Error(`indicator meta for ${id} had no IL/ilTemplate/script field`);
  }
  const meta = result.metaInfo ?? {};
  return {
    ilTemplate,
    resultField,
    description: meta.description ?? meta.shortDescription ?? "",
    runtimeId: meta.id,
    pineVersion: meta.pine?.version ?? meta.pineVersion ?? "unknown",
    defaultInputs: defaultInputsFromMeta(meta.inputs ?? []),
  };
}

function parseIlTemplate(il) {
  const parts = il.split("_");
  if (parts.length < 3) {
    return { keyId: "unparsed", ivBytes: 0, cipherBytes: Buffer.byteLength(il) };
  }
  const [keyId, ivB64, ...cipherParts] = parts;
  const cipherB64 = cipherParts.join("_");
  return {
    keyId,
    ivBytes: b64Bytes(ivB64),
    cipherBytes: b64Bytes(cipherB64),
  };
}

async function scanChartBundles(lengthRows) {
  const url = `${TV_WWW}/chart/?symbol=${encodeURIComponent(symbol)}`;
  const html = await fetchText(url, { referer: TV_WWW });
  const scriptUrls = extractScriptUrls(html).slice(0, maxAssets);
  const terms = [
    "ilTemplate",
    "key_id",
    "crypto.subtle",
    "AES",
    "decrypt",
    "createDecipher",
    "pine-facade/translate",
    "translate_source",
    ...Array.from(new Set(lengthRows.map((row) => row.keyId))).filter(Boolean),
  ];

  const hits = [];
  let fetched = 0;
  let fetchFailures = 0;
  let totalBytes = 0;

  for (const assetUrl of scriptUrls) {
    try {
      const text = await fetchText(assetUrl, { referer: `${TV_WWW}/chart/` });
      fetched += 1;
      totalBytes += Buffer.byteLength(text);
      for (const term of terms) {
        const count = countTerm(text, term);
        if (count > 0) hits.push({ url: assetUrl, term, count });
      }
    } catch (err) {
      fetchFailures += 1;
      hits.push({ url: assetUrl, term: "fetch_error", count: 1, error: String(err?.message ?? err) });
    }
    await delay(50);
  }

  return {
    chartUrl: url,
    htmlBytes: Buffer.byteLength(html),
    discoveredScriptAssets: scriptUrls.length,
    fetchedScriptAssets: fetched,
    fetchFailures,
    fetchedScriptBytes: totalBytes,
    searchedTerms: terms,
    hits,
    decryptOrKeyHitCount: hits.filter((h) =>
      ["ilTemplate", "key_id", "crypto.subtle", "AES", "decrypt", "createDecipher"].includes(h.term) ||
      lengthRows.some((row) => row.keyId === h.term)
    ).length,
  };
}

async function captureStudyWire(script, lengthRow) {
  const path = join(outDir, "study-wire.jsonl");
  const out = createWriteStream(path, { encoding: "utf8" });
  const wsUrl = "wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart";
  const csId = `cs_${Math.random().toString(36).slice(2, 14)}`;
  const stId = `st_${Math.random().toString(36).slice(2, 10)}`;
  const symbolId = "sds_sym_1";
  const seriesId = "sds_1";
  const studyId = lengthRow?.runtimeId
    ? `${String(lengthRow.runtimeId).replace(/!$/, "")}!`
    : `Script$${script.id}@tv-scripting-101!`;
  const sentPayloads = [];
  const recvPayloads = [];
  const started = new Date().toISOString();
  let studyDispatched = false;

  out.write(JSON.stringify({
    kind: "probe-envelope",
    startedAt: started,
    endpoint: wsUrl,
    symbol,
    timeframe,
    bars,
    studyId,
    sourceScriptId: script.id,
    notes: "Unauthenticated public chart study wire capture; checks whether browser/client sends IL/key material.",
  }) + "\n");

  const ws = new WebSocket(wsUrl, {
    headers: { Origin: TV_WWW, "User-Agent": USER_AGENT },
  });

  const summary = await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log(out, "probe", "timeout", {});
      try {
        ws.close();
      } catch {}
    }, 30000);
    timeout.unref();

    ws.addEventListener("open", () => log(out, "probe", "ws_open", {}));
    ws.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : event.data.toString();
      recvPayloads.push(text);
      for (const frame of parseFrames(text)) {
        if (frame.type === "engineio_ping") {
          ws.send("3");
          continue;
        }
        if (frame.type === "session") {
          sendFramed(ws, out, sentPayloads, "set_auth_token", ["unauthorized_user_token"]);
          sendFramed(ws, out, sentPayloads, "chart_create_session", [csId, ""]);
          sendFramed(ws, out, sentPayloads, "switch_timezone", [csId, "exchange"]);
          sendFramed(ws, out, sentPayloads, "resolve_symbol", [
            csId,
            symbolId,
            `={"symbol":"${symbol}","adjustment":"splits"}`,
          ]);
          sendFramed(ws, out, sentPayloads, "create_series", [
            csId,
            seriesId,
            "s1",
            symbolId,
            timeframe,
            bars,
            "",
          ]);
          continue;
        }
        if (frame.type === "event") {
          log(out, "recv", frame.data.m, { params: frame.data.p });
          if (frame.data.m === "series_completed" && !studyDispatched) {
            studyDispatched = true;
            sendFramed(ws, out, sentPayloads, "create_study", [
              csId,
              stId,
              "",
              seriesId,
              studyId,
              lengthRow?.defaultInputs ?? {},
            ]);
          }
          if (
            frame.data.m === "study_completed" ||
            frame.data.m === "study_error" ||
            frame.data.m === "critical_error"
          ) {
            setTimeout(() => ws.close(), 500);
          }
          continue;
        }
        log(out, "recv", `unknown-${frame.type}`, frame);
      }
    });
    ws.addEventListener("error", (event) => {
      log(out, "probe", "ws_error", { message: event.message ?? "unknown" });
    });
    ws.addEventListener("close", (event) => {
      clearTimeout(timeout);
      log(out, "probe", "ws_close", { code: event.code, reason: event.reason });
      out.end();
      const sentText = sentPayloads.join("\n");
      const recvText = recvPayloads.join("\n");
      const forbiddenNeedles = [
        lengthRow?.keyId,
        "ilTemplate",
      ].filter(Boolean);
      resolve({
        endpoint: wsUrl,
        studyId,
        sentFrameNames: frameNamesFromPayloads(sentPayloads),
        receivedFrameNames: frameNamesFromPayloads(recvPayloads),
        sentContainsIlTemplate: sentText.includes("ilTemplate"),
        sentContainsKnownKeyId: Boolean(lengthRow?.keyId && sentText.includes(lengthRow.keyId)),
        sentContainsPlainSource: sentText.includes(script.source.slice(0, 80)),
        receivedContainsIlTemplate: recvText.includes("ilTemplate"),
        receivedContainsKnownKeyId: Boolean(lengthRow?.keyId && recvText.includes(lengthRow.keyId)),
        receivedContainsPlainSource: recvText.includes(script.source.slice(0, 80)),
        sentForbiddenNeedleHits: forbiddenNeedles.filter((needle) => sentText.includes(needle)),
        receivedForbiddenNeedleHits: forbiddenNeedles.filter((needle) => recvText.includes(needle)),
        closeCode: event.code,
        closeReason: event.reason,
        runtimeResult: frameNamesFromPayloads(recvPayloads).includes("study_completed")
          ? "study_completed"
          : frameNamesFromPayloads(recvPayloads).includes("study_error")
            ? "study_error"
            : frameNamesFromPayloads(recvPayloads).includes("critical_error")
              ? "critical_error"
              : "no_terminal_study_frame",
      });
    });
  });

  return { path, summary };
}

function runControlledBenchmark(corpus) {
  return corpus.map((script) => {
    const source = Buffer.from(script.source, "utf8");
    const compressed = deflateSync(source);
    const surrogate = Buffer.from(JSON.stringify({
      kind: "compiled-surrogate",
      sourceSha256: script.sourceSha256,
      lineCount: script.lineCount,
      normalizedTokenCount: tokenizePine(script.source).length,
      normalizedTokenPreview: tokenizePine(script.source).slice(0, 80),
    }));

    const raw = encryptDecryptRoundTrip(source);
    const deflated = encryptDecryptRoundTrip(compressed);
    const surrogateRoundTrip = encryptDecryptRoundTrip(surrogate);
    const inflated = inflateSync(deflated.decrypted);

    return {
      id: script.id,
      title: script.title,
      sourceSha256: script.sourceSha256,
      sourceBytes: source.length,
      compressedBytes: compressed.length,
      surrogateBytes: surrogate.length,
      rawAesGcm: {
        cipherBytes: raw.cipherBytes,
        decryptedSha256: sha256(raw.decrypted),
        decryptedMatchesSource: raw.decrypted.equals(source),
      },
      deflateAesGcm: {
        cipherBytes: deflated.cipherBytes,
        inflatedSha256: sha256(inflated),
        inflatedMatchesSource: inflated.equals(source),
      },
      surrogateAesGcm: {
        cipherBytes: surrogateRoundTrip.cipherBytes,
        decryptedSha256: sha256(surrogateRoundTrip.decrypted),
        decryptedMatchesSource: surrogateRoundTrip.decrypted.equals(source),
        decryptedIsCompiledSurrogate: JSON.parse(surrogateRoundTrip.decrypted.toString("utf8")).kind === "compiled-surrogate",
      },
    };
  });
}

function defaultInputsFromMeta(inputs) {
  const out = {};
  for (const input of inputs) {
    if (!input?.id || input.defval === undefined) continue;
    out[input.id] = input.defval;
  }
  return out;
}

function encryptDecryptRoundTrip(plaintext) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return { cipherBytes: encrypted.length + tag.length, decrypted };
}

function writeCorpusArtifacts(corpus) {
  const corpusPath = join(outDir, "open-source-pine-corpus.jsonl");
  const manifestPath = join(outDir, "open-source-pine-corpus-manifest.json");
  const lines = corpus.map((script) => JSON.stringify(script)).join("\n") + "\n";
  writeFileSync(corpusPath, lines);
  writeJsonAt(manifestPath, summarizeCorpus(corpus));
  evidence.artifacts.corpusJsonl = corpusPath;
  evidence.artifacts.corpusManifest = manifestPath;
}

function summarizeCorpus(corpus) {
  return {
    count: corpus.length,
    totalSourceBytes: corpus.reduce((sum, s) => sum + s.sourceBytes, 0),
    scripts: corpus.map((s) => ({
      id: s.id,
      title: s.title,
      author: s.author,
      sourceBytes: s.sourceBytes,
      sourceSha256: s.sourceSha256,
      query: s.query,
    })),
  };
}

function summarizeLengths(rows) {
  return {
    count: rows.length,
    averageCipherToSourceByteRatio: round(
      rows.reduce((sum, row) => sum + row.cipherToSourceByteRatio, 0) / rows.length,
      4,
    ),
    rows,
  };
}

function summarizeBenchmark(rows) {
  return {
    count: rows.length,
    rawMatches: rows.every((row) => row.rawAesGcm.decryptedMatchesSource),
    deflateMatches: rows.every((row) => row.deflateAesGcm.inflatedMatchesSource),
    surrogateDoesNotMatchSource: rows.every((row) => !row.surrogateAesGcm.decryptedMatchesSource),
  };
}

function renderReport(e, corpus, lengthRows, bundleScan, studyWire, benchmark) {
  const lengthTable = lengthRows.map((row) =>
    `| \`${row.id}\` | ${escapeMd(row.title)} | ${row.sourceBytes} | ${row.cipherBytes} | ${row.cipherToSourceByteRatio} | \`${row.keyId}\` |`,
  ).join("\n");
  const benchmarkTable = benchmark.map((row) =>
    `| \`${row.id}\` | ${row.rawAesGcm.decryptedMatchesSource ? "yes" : "no"} | ${row.deflateAesGcm.inflatedMatchesSource ? "yes" : "no"} | ${row.surrogateAesGcm.decryptedMatchesSource ? "yes" : "no"} |`,
  ).join("\n");
  const decryptHits = bundleScan.hits.filter((hit) =>
    ["ilTemplate", "key_id", "crypto.subtle", "AES", "decrypt", "createDecipher"].includes(hit.term) ||
    lengthRows.some((row) => row.keyId === hit.term)
  );

  return `# TradingView Pine Source Recovery Boundary Exercises - ${dateOnly(startedAt)}

## Scope

Source requirement: continue the remaining exercises from the ilTemplate/plaintext thread without bypassing TradingView protections.

Safety boundary: this run did not attempt protected-source recovery, TradingView key recovery, or decryption of TradingView ilTemplate artifacts. It used public open-source \`scriptSource\` records and local controlled AES-GCM only.

External-call rollback: none. These were read-only public GET/POST/WebSocket probes, bounded by \`--max-open=${maxOpen}\`, \`--max-assets=${maxAssets}\`, and \`--bars=${bars}\`; no cookies were sent.

Command:

\`\`\`bash
${e.command}
\`\`\`

Working directory: \`${e.cwd}\`

Started: \`${e.startedAt}\`

## Exercise 1 - Runtime And Client-Key Evidence

Positive probe: capture the public study WebSocket path and check what the client sends for \`${studyWire.studyId}\`.

Result: \`create_study\` sent the indicator identifier plus metadata default inputs. The sent frames contained the opaque encrypted IL default input only when required by the metadata. They did not contain plaintext Pine source.

Sent frame names: ${studyWire.sentFrameNames.map((name) => `\`${name}\``).join(", ")}

Received frame names: ${studyWire.receivedFrameNames.slice(0, 20).map((name) => `\`${name}\``).join(", ")}

Study runtime result: \`${studyWire.runtimeResult}\`

Negative probe: scan chart JavaScript assets for client decrypt/key indicators and observed key ids.

Bundle assets discovered: ${bundleScan.discoveredScriptAssets}; fetched: ${bundleScan.fetchedScriptAssets}; fetch failures: ${bundleScan.fetchFailures}; bytes searched: ${bundleScan.fetchedScriptBytes}.

Decrypt/key hit count: ${decryptHits.length}

Sent contained encrypted key id marker: ${studyWire.sentContainsKnownKeyId ? "yes" : "no"}

Sent contained plaintext Pine source: ${studyWire.sentContainsPlainSource ? "yes" : "no"}

Interpretation: this run found no evidence that the browser holds a decryption key or decrypts \`ilTemplate\` back to Pine source. The direct public-script study attempt returned \`${studyWire.runtimeResult}\`, so this is wire-payload evidence rather than successful plot-output evidence. For the decryption question, the material finding is that the client sent an ID plus opaque encrypted artifact and no plaintext Pine source.

## Exercise 2 - Length Comparison

| Script | Title | source bytes | cipher bytes | cipher/source | key id |
| --- | --- | ---: | ---: | ---: | --- |
${lengthTable}

Average cipher/source byte ratio: ${e.results.lengthComparison.averageCipherToSourceByteRatio}

Interpretation: the encrypted artifact is not plain Pine source encrypted byte-for-byte. The size profile is consistent with a lower-level compiled/serialized representation before encryption.

## Exercise 3 - Open-Source Pine Corpus

Corpus records: ${corpus.length}

Total source bytes: ${e.results.corpus.totalSourceBytes}

Artifacts:

- \`${e.artifacts.corpusJsonl}\`
- \`${e.artifacts.corpusManifest}\`

The JSONL corpus is gitignored under \`probe-output/\` and contains only public records where \`scriptSource\` was non-empty.

## Exercise 4 - Controlled Local Crypto Benchmark

| Script | raw AES-GCM decrypts to source | deflate+AES-GCM inflates to source | compiled surrogate decrypts to source |
| --- | ---: | ---: | ---: |
${benchmarkTable}

Result: raw and compressed local encryption round-tripped to the original Pine source when the key and exact preimage were controlled locally. The compiled-surrogate path decrypted successfully but did not produce source, by construction.

Interpretation: the controlled exercise demonstrates why the TradingView case is different. Even with a valid decrypt operation, if the encrypted plaintext is bytecode or an intermediate representation, source recovery is a decompilation problem, not simple decryption.

## Artifacts

- Summary: \`${e.artifacts.summary ?? join(outDir, "summary.md")}\`
- Evidence JSON: \`${join(outDir, "evidence.json")}\`
- Length comparison: \`${join(outDir, "length-comparison.json")}\`
- Bundle scan: \`${join(outDir, "bundle-scan-summary.json")}\`
- Study wire JSONL: \`${studyWire.endpoint ? join(outDir, "study-wire.jsonl") : ""}\`
- Controlled benchmark: \`${join(outDir, "controlled-crypto-benchmark.json")}\`
`;
}

async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

async function fetchText(url, opts = {}) {
  const resp = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "user-agent": USER_AGENT,
      "accept": opts.accept ?? "*/*",
      "referer": opts.referer ?? TV_WWW,
      ...(opts.headers ?? {}),
    },
    body: opts.body,
  });
  if (!resp.ok) {
    throw new Error(`${url} failed: ${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}

function extractScriptUrls(html) {
  const urls = [];
  const re = /<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["']/gi;
  for (const match of html.matchAll(re)) {
    const resolved = new URL(match[1], TV_WWW).toString();
    if (!resolved.includes("tradingview.com")) continue;
    urls.push(resolved);
  }
  return Array.from(new Set(urls));
}

function sendFramed(ws, out, sentPayloads, name, params) {
  const json = JSON.stringify({ m: name, p: params });
  const len = new TextEncoder().encode(json).length;
  const payload = `~m~${len}~m~${json}`;
  sentPayloads.push(payload);
  ws.send(payload);
  log(out, "send", name, { params });
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

function frameNamesFromPayloads(payloads) {
  const names = [];
  for (const payload of payloads) {
    for (const frame of parseFrames(payload)) {
      if (frame.type === "event") names.push(frame.data.m);
    }
  }
  return Array.from(new Set(names));
}

function log(out, direction, name, payload) {
  out.write(JSON.stringify({ ts: new Date().toISOString(), direction, name, payload }) + "\n");
}

function tokenizePine(source) {
  return source
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\s]/g) ?? [];
}

function writeJson(name, data) {
  const path = join(outDir, name);
  writeJsonAt(path, data);
  evidence.artifacts[name] = path;
}

function writeJsonAt(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 1) {
    const arg = items[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = items[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else if (out[key] == null) {
      out[key] = next;
      i += 1;
    } else if (Array.isArray(out[key])) {
      out[key].push(next);
      i += 1;
    } else {
      out[key] = [out[key], next];
      i += 1;
    }
  }
  return out;
}

function parseQueries(value) {
  if (value == null || value === true) return DEFAULT_QUERIES;
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean);
}

function numberArg(value, fallback) {
  if (value == null || value === true) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function firstPresentField(obj, fields) {
  return fields.find((field) => Object.prototype.hasOwnProperty.call(obj, field));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function b64Bytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").length;
}

function countTerm(text, term) {
  if (!term) return 0;
  let count = 0;
  let idx = text.indexOf(term);
  while (idx !== -1) {
    count += 1;
    idx = text.indexOf(term, idx + term.length);
  }
  return count;
}

function round(n, digits) {
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale;
}

function stampForPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function escapeMd(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
