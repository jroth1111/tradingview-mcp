#!/usr/bin/env node
// Offline TradingView encrypted-artifact classifier and collision audit.
//
// This script does not call TradingView or attempt decryption. It classifies
// local artifacts as:
// - header_iv_ciphertext: base64_header_base64_iv_base64_ciphertext
// - prefix_payload: base64_prefix_base64_payload
// - joined_header_iv_ciphertext: binary header || IV || ciphertext
// - header_iv_only: binary header || IV companion file

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { argv, cwd, exit, stderr, stdout, version as nodeVersion } from "node:process";

const args = parseArgs(argv.slice(2));
const startedAt = new Date();
const outDir = args.outDir ?? `probe-output/iltemplate-artifact-audit-${stampForPath(startedAt)}`;
const files = args._;
const KNOWN_HEADER_HEX = "6e623d2ace3a";

mkdirSync(outDir, { recursive: true });

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

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function decodeB64(segment) {
  return Buffer.from(segment, "base64");
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

function summarizeBytes(buf, prefix = "bytes") {
  return {
    [`${prefix}Bytes`]: buf.length,
    [`${prefix}Sha256`]: sha256(buf),
    [`${prefix}EntropyBitsPerByte`]: Number(entropy(buf).toFixed(6)),
    [`${prefix}HeadHex`]: buf.subarray(0, 16).toString("hex"),
    [`${prefix}TailHex`]: buf.subarray(Math.max(0, buf.length - 16)).toString("hex"),
  };
}

function classifyTextToken(text) {
  const trimmed = text.trim();
  const parts = trimmed.split("_");
  if (parts.length === 3) {
    const header = decodeB64(parts[0]);
    const iv = decodeB64(parts[1]);
    const ciphertext = decodeB64(parts[2]);
    return {
      format: "header_iv_ciphertext",
      collisionEligible: ciphertext.length > 0,
      segmentCount: 3,
      tokenChars: trimmed.length,
      tokenSha256: sha256(Buffer.from(trimmed)),
      headerB64: parts[0],
      headerHex: header.toString("hex"),
      headerBytes: header.length,
      ivB64: parts[1],
      ivHex: iv.toString("hex"),
      ivBytes: iv.length,
      ciphertextB64Chars: parts[2].length,
      ciphertextMultiple16: ciphertext.length % 16 === 0,
      ...summarizeBytes(ciphertext, "ciphertext"),
      collisionGroup: `header:${header.toString("hex")}:iv:${iv.toString("hex")}`,
    };
  }
  if (parts.length === 2) {
    const prefix = decodeB64(parts[0]);
    const payload = decodeB64(parts[1]);
    return {
      format: "prefix_payload",
      collisionEligible: payload.length > 0,
      segmentCount: 2,
      tokenChars: trimmed.length,
      tokenSha256: sha256(Buffer.from(trimmed)),
      prefixB64: parts[0],
      prefixHex: prefix.toString("hex"),
      prefixBytes: prefix.length,
      payloadB64Chars: parts[1].length,
      payloadMultiple16: payload.length % 16 === 0,
      ...summarizeBytes(payload, "payload"),
      collisionGroup: `prefix:${prefix.toString("hex")}`,
    };
  }
  return null;
}

function classifyBinary(buf) {
  const header = buf.subarray(0, 6);
  const iv = buf.subarray(6, 22);
  if (header.toString("hex") === KNOWN_HEADER_HEX && buf.length >= 22) {
    const ciphertext = buf.subarray(22);
    return {
      format: ciphertext.length > 0 ? "joined_header_iv_ciphertext" : "header_iv_only",
      collisionEligible: ciphertext.length > 0,
      fileBytes: buf.length,
      fileSha256: sha256(buf),
      headerHex: header.toString("hex"),
      headerBytes: header.length,
      ivHex: iv.toString("hex"),
      ivBytes: iv.length,
      ciphertextMultiple16: ciphertext.length % 16 === 0,
      ...summarizeBytes(ciphertext, "ciphertext"),
      collisionGroup: `header:${header.toString("hex")}:iv:${iv.toString("hex")}`,
    };
  }
  return {
    format: "unclassified_binary",
    fileBytes: buf.length,
    fileSha256: sha256(buf),
    headHex: buf.subarray(0, 32).toString("hex"),
  };
}

function classifyFile(path) {
  const buf = readFileSync(path);
  const text = buf.toString("utf8");
  const textToken = /^[A-Za-z0-9+/=_-]+$/.test(text.trim()) && text.includes("_")
    ? classifyTextToken(text)
    : null;
  return {
    path,
    basename: basename(path),
    exists: true,
    detectedAs: textToken?.format ?? classifyBinary(buf).format,
    ...(textToken ?? classifyBinary(buf)),
  };
}

if (!files.length || args.help || args.h) {
  const usage = `
Usage:
  node scripts/probes/iltemplate-artifact-audit.mjs <artifact-file> [artifact-file ...]

Example:
  node scripts/probes/iltemplate-artifact-audit.mjs \\
    /Users/gwizz/Downloads/PUB_edfaff05350f406092874780e934f06c.pine \\
    /Users/gwizz/Downloads/PUB_edfaff05350f406092874780e934f06c.decoded_joined
`.trim();
  (args.help || args.h ? stdout : stderr).write(`${usage}\n`);
  exit(args.help || args.h ? 0 : 2);
}

const artifacts = [];
for (const file of files) {
  if (!existsSync(file)) {
    artifacts.push({ path: file, exists: false, error: "file not found" });
    continue;
  }
  try {
    artifacts.push(classifyFile(file));
  } catch (err) {
    artifacts.push({ path: file, exists: true, error: String(err?.message ?? err) });
  }
}

const groups = new Map();
for (const artifact of artifacts) {
  if (!artifact.collisionGroup || !artifact.collisionEligible) continue;
  if (!groups.has(artifact.collisionGroup)) groups.set(artifact.collisionGroup, []);
  groups.get(artifact.collisionGroup).push(artifact.path);
}

const collisionGroups = Array.from(groups.entries())
  .filter(([, paths]) => paths.length > 1)
  .map(([group, paths]) => ({ group, paths }));

const evidence = {
  kind: "offline-iltemplate-artifact-audit",
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  cwd: cwd(),
  command: ["node", "scripts/probes/iltemplate-artifact-audit.mjs", ...argv.slice(2)].join(" "),
  commandArgv: ["node", "scripts/probes/iltemplate-artifact-audit.mjs", ...argv.slice(2)],
  nodeVersion,
  safetyBoundary: [
    "Offline only.",
    "No decryption, key recovery, source recovery, or network access.",
    "Reports decoded segment boundaries, entropy, lengths, and header/IV collision groups.",
  ],
  artifactCount: artifacts.length,
  collisionGroupCount: collisionGroups.length,
  collisionGroups,
  artifacts,
};

writeFileSync(join(outDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);

stdout.write("=== Offline ilTemplate Artifact Audit ===\n\n");
for (const artifact of artifacts) {
  if (!artifact.exists) {
    stdout.write(`${artifact.path}: missing\n`);
    continue;
  }
  if (artifact.error) {
    stdout.write(`${artifact.path}: error=${artifact.error}\n`);
    continue;
  }
  stdout.write(`${artifact.path}: ${artifact.detectedAs}`);
  if (artifact.headerHex) stdout.write(` header=${artifact.headerHex}`);
  if (artifact.ivHex) stdout.write(` iv=${artifact.ivHex}`);
  if (artifact.ciphertextBytes != null) stdout.write(` ciphertext=${artifact.ciphertextBytes}B`);
  if (artifact.prefixHex) stdout.write(` prefix=${artifact.prefixHex}`);
  if (artifact.payloadBytes != null) stdout.write(` payload=${artifact.payloadBytes}B`);
  stdout.write("\n");
}

if (collisionGroups.length) {
  stdout.write("\nRepeated segment groups among full artifacts:\n");
  for (const group of collisionGroups) {
    stdout.write(`  ${group.group}\n`);
    for (const path of group.paths) stdout.write(`    ${path}\n`);
  }
} else {
  stdout.write("\nNo repeated header/IV groups found among parsed full artifacts.\n");
}

stdout.write(`\nEvidence written to ${outDir}\n`);
