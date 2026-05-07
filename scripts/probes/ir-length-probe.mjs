#!/usr/bin/env node
// IR Length Structural Analysis Probe
//
// Compiles controlled Pine source variants through the public translate_source
// endpoint and records ciphertext lengths to infer IR format properties.
//
// Safety boundary: this script only calls the public unauthenticated translate
// endpoint with no cookies or credentials. It does not attempt key recovery,
// source recovery, or decryption of TradingView artifacts. It reads only
// metadata (base64 segment lengths, key_id) from the JSON response.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, cwd, exit, stderr, stdout, version as nodeVersion } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const PINE_FACADE = "https://pine-facade.tradingview.com";
const TRANSLATE_URL = `${PINE_FACADE}/pine-facade/translate_source/v5?is_pine_ex=true`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const args = parseArgs(argv.slice(2));
const outDir = args.outDir ?? `probe-output/ir-length-probe-${stampForPath(new Date())}`;
const startedAt = new Date();

mkdirSync(outDir, { recursive: true });

function parseArgs(raw) {
  const out = {};
  for (const arg of raw) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function stampForPath(d) {
  return d.toISOString().replace(/[:.]/g, "-");
}

function b64DecodeLen(b64str) {
  // Use Buffer.from for exact byte length (avoids manual base64 arithmetic errors)
  return Buffer.from(b64str, "base64").length;
}

function parseIlField(ilStr) {
  // Format: keyId_iv_ciphertext (underscore-separated base64 segments)
  const parts = ilStr.split("_");
  if (parts.length !== 3) return null;
  const keyId = parts[0]; // base64, 6 bytes decoded (e.g. bmI9Ks46)
  const iv = parts[1];    // base64, 16 bytes decoded
  const ciphertext = parts[2]; // base64, variable length
  return {
    keyId,
    keyIdBytes: b64DecodeLen(keyId),
    ivBytes: b64DecodeLen(iv),
    cipherB64Len: ciphertext.length,
    cipherBytes: b64DecodeLen(ciphertext),
    totalBytes: b64DecodeLen(keyId) + b64DecodeLen(iv) + b64DecodeLen(ciphertext),
  };
}

async function compilePine(source, label) {
  const body = `source=${encodeURIComponent(source)}`;
  const res = await fetch(TRANSLATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      "Accept": "*/*",
      "Origin": "https://www.tradingview.com",
      "Referer": "https://www.tradingview.com/",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    stderr.write(`  HTTP ${res.status} for ${label}: ${text.slice(0, 200)}\n`);
    return null;
  }

  const data = await res.json();

  if (!data.success) {
    const reason = data.reason || JSON.stringify(data.reason2?.errors?.[0]?.message || "unknown");
    stderr.write(`  Compile error for ${label}: ${reason.slice(0, 150)}\n`);
    return { label, error: reason };
  }

  const il = parseIlField(data.result?.IL || "");
  const ilTpl = parseIlField(data.result?.ilTemplate || "");

  if (!il || !ilTpl) {
    stderr.write(`  Could not parse IL/ilTemplate for ${label}\n`);
    return null;
  }

  const metaInfo = data.result?.metaInfo || {};

  return {
    label,
    sourceLength: Buffer.byteLength(source, "utf-8"),
    sourceLines: source.split("\n").length,
    // IL field
    ilCipherBytes: il.cipherBytes,
    ilIvBytes: il.ivBytes,
    ilKeyId: il.keyId,
    ilTotalBytes: il.totalBytes,
    // ilTemplate field
    tplCipherBytes: tplCipherBytes(ilTpl),
    tplIvBytes: ilTpl.ivBytes,
    tplKeyId: ilTpl.keyId,
    tplTotalBytes: ilTpl.totalBytes,
    // metaInfo
    plots: metaInfo.plots?.length ?? 0,
    stats: metaInfo.stats ?? {},
    pineDigest: metaInfo.pine?.digest ?? null,
  };
}

function tplCipherBytes(tpl) {
  return tpl.cipherBytes;
}

// ── Group 1: Add one variable at a time ──────────────────────────────────────

function buildGroup1() {
  const cases = [];
  // Base: just indicator + plot (no extra vars)
  const varNames = ["x", "y", "z", "a", "b", "c", "d", "e", "f", "g"];
  const values = ["close", "open", "high", "low", "volume", "hl2", "hlc3", "ohlc4", "close[1]", "open[1]"];

  for (let i = 0; i <= 10; i++) {
    const vars = [];
    for (let j = 0; j < i; j++) {
      vars.push(`${varNames[j]} = ${values[j]}`);
    }
    const lines = ["//@version=5", 'indicator("t1")', ...vars, "plot(close)"];
    cases.push({ source: lines.join("\n"), label: `g1-${i}vars` });
  }
  return cases;
}

// ── Group 2: Variable name length ────────────────────────────────────────────

function buildGroup2() {
  const cases = [];
  const nameLengths = [1, 5, 10, 20, 30, 50];
  for (const len of nameLengths) {
    const name = "v".repeat(len);
    const source = [
      "//@version=5",
      'indicator("t1")',
      `${name} = close`,
      `plot(${name})`,
    ].join("\n");
    cases.push({ source, label: `g2-name-${len}char` });
  }
  return cases;
}

// ── Group 3: Different types ─────────────────────────────────────────────────

function buildGroup3() {
  return [
    {
      source: ["//@version=5", 'indicator("t1")', "x = close", "plot(x)"].join("\n"),
      label: "g3-float",
    },
    {
      source: ["//@version=5", 'indicator("t1")', "x = close > open", "plot(x ? 1 : 0)"].join("\n"),
      label: "g3-bool",
    },
    {
      source: ["//@version=5", 'indicator("t1")', 'x = str.tostring(close)', "label.new(bar_index, high, text=x)"].join("\n"),
      label: "g3-string",
    },
    {
      source: ["//@version=5", 'indicator("t1")', "x = ta.sma(close, 14)", "plot(x)"].join("\n"),
      label: "g3-ta-call",
    },
    {
      source: ["//@version=5", 'indicator("t1")', "x = input.int(14)", "plot(x)"].join("\n"),
      label: "g3-input-int",
    },
    {
      source: ["//@version=5", 'indicator("t1")', "x = input.float(1.5)", "plot(x)"].join("\n"),
      label: "g3-input-float",
    },
    {
      source: ["//@version=5", 'indicator("t1")', 'x = input.string("hello")', "label.new(bar_index, high, text=x)"].join("\n"),
      label: "g3-input-string",
    },
  ];
}

// ── Group 4: String constants of varying length ──────────────────────────────

function buildGroup4() {
  const cases = [];
  const lengths = [0, 1, 2, 3, 5, 10, 20, 40, 60, 80, 100, 150, 200];
  for (const len of lengths) {
    const s = "a".repeat(len);
    const source = [
      "//@version=5",
      'indicator("t1")',
      `l1 = label.new(bar_index, high, text="${s}")`,
    ].join("\n");
    cases.push({ source, label: `g4-str-${len}` });
  }
  return cases;
}

// ── Group 5: Repeated plot() calls ───────────────────────────────────────────

function buildGroup5() {
  const cases = [];
  for (let n = 1; n <= 10; n++) {
    const lines = ["//@version=5", 'indicator("t1")'];
    for (let i = 0; i < n; i++) {
      lines.push(`plot(close)`);
    }
    cases.push({ source: lines.join("\n"), label: `g5-plots-${n}` });
  }
  return cases;
}

// ── Group 6 (bonus): Numeric constants of varying magnitude ──────────────────

function buildGroup6() {
  const cases = [];
  const nums = [
    "0", "1", "1.5", "3.14159", "1000000",
    "0.0000001", "999999999999", "-1", "-3.14",
  ];
  for (const num of nums) {
    const source = [
      "//@version=5",
      'indicator("t1")',
      `x = ${num}`,
      "plot(x)",
    ].join("\n");
    cases.push({ source, label: `g6-num-${num.replace(".", "p").replace("-", "n")}` });
  }
  return cases;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allGroups = [
    { name: "Group 1: Incremental variables", cases: buildGroup1() },
    { name: "Group 2: Variable name length", cases: buildGroup2() },
    { name: "Group 3: Different types", cases: buildGroup3() },
    { name: "Group 4: String constant length", cases: buildGroup4() },
    { name: "Group 5: Repeated plot() calls", cases: buildGroup5() },
    { name: "Group 6: Numeric constants", cases: buildGroup6() },
  ];

  const allResults = [];
  const groupResults = {};

  for (const group of allGroups) {
    stdout.write(`\n── ${group.name} (${group.cases.length} cases) ──\n`);
    const rows = [];

    for (const { source, label } of group.cases) {
      stdout.write(`  ${label}...`);
      try {
        const result = await compilePine(source, label);
        if (result && !result.error) {
          rows.push(result);
          allResults.push(result);
          stdout.write(` IL=${result.ilCipherBytes}B tpl=${result.tplCipherBytes}B src=${result.sourceLength}B\n`);
        } else if (result?.error) {
          rows.push({ label, sourceLength: Buffer.byteLength(source, "utf-8"), error: result.error });
          stdout.write(` ERROR: ${result.error.slice(0, 80)}\n`);
        } else {
          stdout.write(" FAILED\n");
        }
      } catch (err) {
        stdout.write(` ERR: ${err.message}\n`);
      }
      await delay(350);
    }

    // Compute deltas within group (skip errored rows)
    const validRows = rows.filter(r => !r.error);
    for (let i = 1; i < validRows.length; i++) {
      validRows[i].ilDelta = validRows[i].ilCipherBytes - validRows[i - 1].ilCipherBytes;
      validRows[i].tplDelta = validRows[i].tplCipherBytes - validRows[i - 1].tplCipherBytes;
      validRows[i].srcDelta = validRows[i].sourceLength - validRows[i - 1].sourceLength;
    }

    groupResults[group.name] = rows;
  }

  // Write artifacts
  const evidence = {
    kind: "ir-length-structural-probe",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    cwd: cwd(),
    command: ["node", "scripts/probes/ir-length-probe.mjs", ...argv.slice(2)].join(" "),
    nodeVersion,
    safetyBoundary: [
      "No protected-source recovery.",
      "No TradingView server-held key recovery.",
      "No decryption of TradingView ilTemplate artifacts.",
      "Only public unauthenticated translate_source endpoint with controlled Pine source.",
    ],
    endpoint: TRANSLATE_URL,
    totalCases: allResults.length,
  };

  writeFileSync(join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  writeFileSync(join(outDir, "all-results.json"), JSON.stringify(allResults, null, 2));

  for (const [groupName, rows] of Object.entries(groupResults)) {
    const safeName = groupName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    writeFileSync(join(outDir, `${safeName}.json`), JSON.stringify(rows, null, 2));
  }

  // ── Print summary table ───────────────────────────────────────────────────

  stdout.write("\n\n");
  stdout.write("=".repeat(120) + "\n");
  stdout.write("IR LENGTH STRUCTURAL ANALYSIS RESULTS\n");
  stdout.write("=".repeat(120) + "\n\n");

  for (const [groupName, rows] of Object.entries(groupResults)) {
    stdout.write(`-- ${groupName} --\n\n`);
    stdout.write(
      padR("Label", 24) +
      padR("Src B", 8) +
      padR("IL B", 8) +
      padR("IL d", 8) +
      padR("Tpl B", 8) +
      padR("Tpl d", 8) +
      padR("IL/Src", 8) +
      "Key ID\n"
    );
    stdout.write("-".repeat(120) + "\n");
    for (const row of rows) {
      if (row.error) {
        stdout.write(padR(row.label, 24) + ` ERROR: ${row.error.slice(0, 80)}\n`);
        continue;
      }
      const ratio = (row.ilCipherBytes / row.sourceLength).toFixed(3);
      stdout.write(
        padR(row.label, 24) +
        padR(String(row.sourceLength), 8) +
        padR(String(row.ilCipherBytes), 8) +
        padR(row.ilDelta != null ? String(row.ilDelta) : "-", 8) +
        padR(String(row.tplCipherBytes), 8) +
        padR(row.tplDelta != null ? String(row.tplDelta) : "-", 8) +
        padR(ratio, 8) +
        row.ilKeyId + "\n"
      );
    }
    stdout.write("\n");
  }

  // ── Analysis ───────────────────────────────────────────────────────────────

  stdout.write("\n" + "=".repeat(120) + "\n");
  stdout.write("STRUCTURAL ANALYSIS\n");
  stdout.write("=".repeat(120) + "\n\n");

  // Group 1: per-variable overhead
  const g1 = (groupResults["Group 1: Incremental variables"] ?? []).filter(r => !r.error);
  if (g1.length >= 2) {
    const deltas = g1.slice(1).map(r => r.ilDelta).filter(d => d != null);
    const tplDeltas = g1.slice(1).map(r => r.tplDelta).filter(d => d != null);
    if (deltas.length > 0) {
      stdout.write("Group 1 - Per-variable IR overhead:\n");
      stdout.write(`  IL ciphertext delta per variable: [${deltas.join(", ")}]\n`);
      stdout.write(`  IL avg: ${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1)} bytes\n`);
      stdout.write(`  IL range: ${Math.min(...deltas)} - ${Math.max(...deltas)}\n`);
      stdout.write(`  IL constant: ${deltas.every(d => d === deltas[0])}\n`);
      if (tplDeltas.length > 0) {
        stdout.write(`  Template delta per variable: [${tplDeltas.join(", ")}]\n`);
        stdout.write(`  Template avg: ${(tplDeltas.reduce((a, b) => a + b, 0) / tplDeltas.length).toFixed(1)} bytes\n`);
        stdout.write(`  Template range: ${Math.min(...tplDeltas)} - ${Math.max(...tplDeltas)}\n`);
        stdout.write(`  Template constant: ${tplDeltas.every(d => d === tplDeltas[0])}\n`);
      }
      stdout.write("\n");
    }
  }

  // Group 2: name length effect
  const g2 = (groupResults["Group 2: Variable name length"] ?? []).filter(r => !r.error);
  if (g2.length >= 2) {
    stdout.write("Group 2 - Variable name length effect:\n");
    for (const row of g2) {
      stdout.write(`  ${row.label}: src=${row.sourceLength}B IL=${row.ilCipherBytes}B tpl=${row.tplCipherBytes}B\n`);
    }
    const ilDeltas = g2.slice(1).map((r, i) => ({
      fromLen: [1, 5, 10, 20, 30, 50][i],
      toLen: [1, 5, 10, 20, 30, 50][i + 1],
      ilDelta: r.ilDelta,
      tplDelta: r.tplDelta,
      srcDelta: r.srcDelta,
    })).filter(d => d.ilDelta != null);
    if (ilDeltas.length > 0) {
      stdout.write("  Deltas:\n");
      for (const d of ilDeltas) {
        stdout.write(`    ${d.fromLen}->${d.toLen} chars: IL +${d.ilDelta}B, tpl +${d.tplDelta}B, src +${d.srcDelta}B\n`);
      }
      // Does IL grow proportionally with name length?
      const totalIlGrowth = g2[g2.length - 1].ilCipherBytes - g2[0].ilCipherBytes;
      const totalNameGrowth = 50 - 1;
      stdout.write(`  Total IL growth (1->50 char names): ${totalIlGrowth} bytes for ${totalNameGrowth} extra name chars\n`);
      stdout.write(`  Ratio: ${(totalIlGrowth / totalNameGrowth).toFixed(2)} IL bytes per name char\n`);
    }
    stdout.write("\n");
  }

  // Group 3: type effect
  const g3 = (groupResults["Group 3: Different types"] ?? []).filter(r => !r.error);
  if (g3.length > 0) {
    stdout.write("Group 3 - Type effect:\n");
    for (const row of g3) {
      stdout.write(`  ${row.label}: src=${row.sourceLength}B IL=${row.ilCipherBytes}B tpl=${row.tplCipherBytes}B\n`);
    }
    stdout.write("\n");
  }

  // Group 4: string constant
  const g4 = (groupResults["Group 4: String constant length"] ?? []).filter(r => !r.error);
  if (g4.length >= 2) {
    stdout.write("Group 4 - String constant length:\n");
    for (const row of g4) {
      stdout.write(`  ${row.label}: src=${row.sourceLength}B IL=${row.ilCipherBytes}B tpl=${row.tplCipherBytes}B IL_delta=${row.ilDelta ?? "-"}\n`);
    }
    // Linear regression check
    const pairs = g4.map(r => {
      const m = r.label.match(/str-(\d+)/);
      return [m ? parseInt(m[1]) : 0, r.ilCipherBytes];
    });
    const n = pairs.length;
    const sumX = pairs.reduce((s, p) => s + p[0], 0);
    const sumY = pairs.reduce((s, p) => s + p[1], 0);
    const sumXY = pairs.reduce((s, p) => s + p[0] * p[1], 0);
    const sumX2 = pairs.reduce((s, p) => s + p[0] * p[0], 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    stdout.write(`  Linear fit: IL_bytes = ${slope.toFixed(2)} * str_len + ${intercept.toFixed(1)}\n`);
    stdout.write(`  Per-character IR overhead: ~${slope.toFixed(2)} bytes per string character\n`);
    stdout.write("\n");
  }

  // Group 5: repeated plots
  const g5 = (groupResults["Group 5: Repeated plot() calls"] ?? []).filter(r => !r.error);
  if (g5.length >= 2) {
    stdout.write("Group 5 - Repeated plot() calls:\n");
    const deltas = g5.slice(1).map(r => r.ilDelta).filter(d => d != null);
    const tplDeltas = g5.slice(1).map(r => r.tplDelta).filter(d => d != null);
    if (deltas.length > 0) {
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      stdout.write(`  IL delta per additional plot(): [${deltas.join(", ")}]\n`);
      stdout.write(`  IL avg: ${avg.toFixed(1)} bytes\n`);
      stdout.write(`  IL constant: ${deltas.every(d => d === deltas[0])}\n`);
      if (tplDeltas.length > 0) {
        const avgTpl = tplDeltas.reduce((a, b) => a + b, 0) / tplDeltas.length;
        stdout.write(`  Template delta per additional plot(): [${tplDeltas.join(", ")}]\n`);
        stdout.write(`  Template avg: ${avgTpl.toFixed(1)} bytes\n`);
        stdout.write(`  Template constant: ${tplDeltas.every(d => d === tplDeltas[0])}\n`);
      }
    }
    stdout.write("\n");
  }

  // Group 6: numeric constants
  const g6 = (groupResults["Group 6: Numeric constants"] ?? []).filter(r => !r.error);
  if (g6.length > 0) {
    stdout.write("Group 6 - Numeric constants:\n");
    for (const row of g6) {
      stdout.write(`  ${row.label}: src=${row.sourceLength}B IL=${row.ilCipherBytes}B tpl=${row.tplCipherBytes}B\n`);
    }
    stdout.write("\n");
  }

  // ── Key findings summary ───────────────────────────────────────────────────

  stdout.write("KEY FINDINGS:\n");
  if (g1.length >= 2) {
    const base = g1[0].ilCipherBytes;
    stdout.write(`  - Base indicator (no user vars): IL=${base}B\n`);
    const deltas = g1.slice(1).map(r => r.ilDelta).filter(d => d != null);
    if (deltas.length > 0) {
      stdout.write(`  - Per additional variable assignment: ~${(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(0)}B IL\n`);
    }
  }
  if (g2.length >= 2) {
    const ilGrowth = g2[g2.length - 1].ilCipherBytes - g2[0].ilCipherBytes;
    const nameGrowth = 50 - 1;
    stdout.write(`  - Variable names: ${ilGrowth}B IL growth for ${nameGrowth} extra chars (${(ilGrowth / nameGrowth).toFixed(2)} B/char)\n`);
    stdout.write(`    → ${ilGrowth > 0 ? "Variable names ARE stored in IR" : "Variable names NOT stored in IR (or optimized out)"}\n`);
  }
  if (g4.length >= 4) {
    const shortStr = g4.find(r => r.label === "g4-str-1");
    const longStr = g4[g4.length - 1];
    if (shortStr && longStr) {
      const strGrowth = longStr.ilCipherBytes - shortStr.ilCipherBytes;
      const longLen = parseInt(longStr.label.match(/str-(\d+)/)[1]);
      const shortLen = 1;
      const charGrowth = longLen - shortLen;
      stdout.write(`  - String constants: ${strGrowth}B IL growth for ${charGrowth} extra chars (${(strGrowth / charGrowth).toFixed(2)} B/char)\n`);
      stdout.write(`    → ${strGrowth / charGrowth >= 0.8 ? "Strings stored VERBATIM (or near-verbatim) in IR" : "Strings stored COMPRESSED/INTERNED in IR"}\n`);
    }
  }

  stdout.write(`\nArtifacts: ${outDir}\n`);
  stdout.write(`Total compiled: ${allResults.length}\n`);
}

function padR(s, len) {
  const str = String(s);
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

main().catch((err) => {
  stderr.write(`Fatal: ${err.message}\n${err.stack}\n`);
  exit(1);
});
