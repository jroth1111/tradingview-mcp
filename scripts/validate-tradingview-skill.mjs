import { readFileSync } from "node:fs";

const constants = readFileSync("packages/tradingview-core/src/constants.ts", "utf8");
const types = readFileSync("packages/tradingview-core/src/types.ts", "utf8");
const skill = readFileSync("skills/tradingview/SKILL.md", "utf8");
const auth = readFileSync("skills/tradingview/auth.md", "utf8");
const workerTradingview = readFileSync("worker/src/tradingview.ts", "utf8");

for (const required of ["TRADINGVIEW_WS_ENDPOINTS", "VALID_TIMEFRAMES", "TIMEFRAME_MAP"]) {
  if (!constants.includes(required)) {
    throw new Error(`core constants missing ${required}`);
  }
}

if (!/export\s+interface\s+Candle\b/.test(types)) {
  throw new Error("core types missing exported Candle interface");
}

for (const required of ["Runtime Authority", "packages/tradingview-core", "worker/openapi.yaml"]) {
  if (!skill.includes(required)) {
    throw new Error(`skill missing authority reference: ${required}`);
  }
}

for (const required of ["HMAC", "POST /admin/session", "stored Worker session is authoritative"]) {
  if (!auth.includes(required)) {
    throw new Error(`auth skill missing requirement: ${required}`);
  }
}

const coreImportRegex = /from\s+["']\.\.\/\.\.\/packages\/tradingview-core\/src["']/;
if (!coreImportRegex.test(workerTradingview)) {
  throw new Error("worker/src/tradingview.ts must import from packages/tradingview-core/src");
}

for (const required of ["TRADINGVIEW_WS_ENDPOINTS", "VALID_TIMEFRAMES", "TIMEFRAME_MAP"]) {
  const importPattern = new RegExp(`\\b${required}\\b[\\s\\S]{0,400}?from\\s+["']\\.\\.\/\\.\\.\/packages\/tradingview-core\/src["']`);
  if (!importPattern.test(workerTradingview)) {
    throw new Error(`worker/src/tradingview.ts must import ${required} from packages/tradingview-core/src`);
  }
}

const forbiddenLocalDefinitions = [
  /\bconst\s+TRADINGVIEW_WS_ENDPOINTS\s*=/,
  /\bconst\s+VALID_TIMEFRAMES\s*=/,
  /\bconst\s+TIMEFRAME_MAP\s*=/,
  /\binterface\s+Candle\s*\{/,
];
for (const pattern of forbiddenLocalDefinitions) {
  if (pattern.test(workerTradingview)) {
    throw new Error(`worker/src/tradingview.ts must not redefine ${pattern} locally; source from core`);
  }
}

if (/wss:\/\/[^"'\s]*tradingview/i.test(workerTradingview)) {
  throw new Error("worker/src/tradingview.ts must not contain hardcoded wss://*tradingview* URLs; source from core");
}

console.log("tradingview skill validation passed");
