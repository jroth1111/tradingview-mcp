#!/usr/bin/env node
// Compare TradingView encrypted-artifact tamper evidence files.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { argv, cwd, exit, stderr, stdout, version as nodeVersion } from "node:process";

const args = parseArgs(argv.slice(2));
const files = args._;
const startedAt = new Date();
const outDir = args.outDir ?? `probe-output/iltemplate-tamper-comparison-${stampForPath(startedAt)}`;

function parseArgs(items) {
  const out = { _: [] };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item.startsWith("--")) {
      out._.push(item);
      continue;
    }
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

function usage(code) {
  const text = `
Usage:
  node scripts/probes/compare-iltemplate-tamper-results.mjs <evidence.json> <evidence.json> [...]
`.trim();
  (code === 0 ? stdout : stderr).write(`${text}\n`);
  exit(code);
}

if (args.help || args.h) usage(0);
if (files.length < 2) usage(2);

mkdirSync(outDir, { recursive: true });

const runs = files.map((file) => {
  const evidence = JSON.parse(readFileSync(file, "utf8"));
  const target = evidence.target ?? {};
  const results = evidence.results ?? [];
  return {
    file,
    name: target.metaSummary?.name ?? target.scriptId ?? basename(file),
    scriptId: target.scriptId,
    pineVersion: target.pineVersion,
    artifact: {
      headerHex: target.artifactSummary?.headerHex,
      ivHex: target.artifactSummary?.ivHex,
      ciphertextBytes: target.artifactSummary?.ciphertextBytes,
      tokenChars: target.artifactSummary?.tokenChars,
    },
    results: Object.fromEntries(
      results.map((result) => [
        result.label,
        {
          mutation: result.mutation,
          outcome: result.outcome,
          executionClass: result.executionClass ?? inferExecutionClass(result),
          duRows: result.duRows,
          detail: result.studyError?.detail ?? null,
          durationMs: result.durationMs,
          events: result.receivedEvents ?? [],
        },
      ]),
    ),
  };
});

function inferExecutionClass(result) {
  if (result.studyCompleted) return result.duRows > 0 ? "completed_with_output" : "completed_no_output";
  return result.outcome;
}

const labels = Array.from(new Set(runs.flatMap((run) => Object.keys(run.results))));
const rows = labels.map((label) => ({
  label,
  runs: runs.map((run) => ({
    scriptId: run.scriptId,
    name: run.name,
    ...(run.results[label] ?? { outcome: "missing", executionClass: "missing", duRows: null, detail: null }),
  })),
}));

const divergences = rows.filter((row) => {
  const classes = new Set(row.runs.map((run) => run.executionClass));
  const details = new Set(row.runs.map((run) => run.detail ?? ""));
  return classes.size > 1 || details.size > 1;
});

const comparison = {
  kind: "iltemplate-tamper-comparison",
  generatedAt: startedAt.toISOString(),
  cwd: cwd(),
  commandArgv: ["node", "scripts/probes/compare-iltemplate-tamper-results.mjs", ...argv.slice(2)],
  nodeVersion,
  runs,
  labels,
  rows,
  divergences,
};

const md = [
  "# TradingView encrypted-artifact tamper comparison",
  "",
  `Generated: ${startedAt.toISOString()}`,
  "",
  "## Runs",
  "",
  ...runs.flatMap((run) => [
    `- ${run.scriptId}: ${run.name}`,
    `  - evidence: ${run.file}`,
    `  - ciphertext bytes: ${run.artifact.ciphertextBytes}`,
  ]),
  "",
  "## Matrix",
  "",
  `| Mutation | ${runs.map((run) => run.name.replaceAll("|", "\\|")).join(" | ")} |`,
  `|---|${runs.map(() => "---").join("|")}|`,
  ...rows.map((row) => {
    const cells = row.runs.map((run) => {
      const detail = run.detail ? `; ${run.detail}` : "";
      const du = run.duRows != null ? `; du=${run.duRows}` : "";
      return `${run.executionClass}${detail}${du}`;
    });
    return `| ${row.label} | ${cells.join(" | ")} |`;
  }),
  "",
  "## Divergences",
  "",
  divergences.length
    ? divergences.map((row) => `- ${row.label}`).join("\n")
    : "No class/detail divergences across compared runs.",
  "",
].join("\n");

writeFileSync(join(outDir, "comparison.json"), `${JSON.stringify(comparison, null, 2)}\n`);
writeFileSync(join(outDir, "report.md"), md);

stdout.write(`Comparison written to ${outDir}\n`);
stdout.write(`${divergences.length} divergent mutation rows\n`);
