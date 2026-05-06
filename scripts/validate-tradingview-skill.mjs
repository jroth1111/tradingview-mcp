import { readFileSync } from "node:fs";

const constants = readFileSync("packages/tradingview-core/src/constants.ts", "utf8");
const skill = readFileSync("skills/tradingview/SKILL.md", "utf8");
const auth = readFileSync("skills/tradingview/auth.md", "utf8");

for (const required of ["TRADINGVIEW_WS_ENDPOINTS", "VALID_TIMEFRAMES", "TIMEFRAME_MAP"]) {
  if (!constants.includes(required)) {
    throw new Error(`core constants missing ${required}`);
  }
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

console.log("tradingview skill validation passed");
