import { readFileSync } from "node:fs";

const constants = readFileSync("packages/tradingview-core/src/constants.ts", "utf8");
const types = readFileSync("packages/tradingview-core/src/types.ts", "utf8");
const strategyCore = readFileSync("packages/tradingview-core/src/strategy.ts", "utf8");
const clampBars = readFileSync("packages/tradingview-core/src/clamp-bars.ts", "utf8");
const coreIndex = readFileSync("packages/tradingview-core/src/index.ts", "utf8");
const skill = readFileSync("skills/tradingview/SKILL.md", "utf8");
const auth = readFileSync("skills/tradingview/auth.md", "utf8");
const rediscovery = readFileSync("skills/tradingview/surface-rediscovery.md", "utf8");
const workerTradingview = readFileSync("worker/src/tradingview.ts", "utf8");
const workerStrategy = readFileSync("worker/src/strategy.ts", "utf8");
const workerStudyChain = readFileSync("worker/src/study-chain.ts", "utf8");
const workerChartSession = readFileSync("worker/src/chart-session-do.ts", "utf8");

for (const required of ["TRADINGVIEW_WS_ENDPOINTS", "VALID_TIMEFRAMES", "TIMEFRAME_MAP"]) {
  if (!constants.includes(required)) {
    throw new Error(`core constants missing ${required}`);
  }
}

for (const required of [
  "STRATEGY_PROPERTY_KEYS",
  "STRATEGY_DEFAULT_QTY_TYPES",
  "STRATEGY_COMMISSION_TYPES",
  "isStudyStrategy",
  "isStudyStrategyStub",
]) {
  if (!strategyCore.includes(required)) {
    throw new Error(`core strategy.ts missing ${required}`);
  }
}

for (const required of [
  '"initial_capital"',
  '"currency"',
  '"default_qty_value"',
  '"default_qty_type"',
  '"pyramiding"',
  '"commission_value"',
  '"commission_type"',
  '"backtest_fill_limits_assumption"',
  '"slippage"',
  '"calc_on_order_fills"',
  '"calc_on_every_tick"',
  '"margin_long"',
  '"margin_short"',
  '"use_bar_magnifier"',
  '"process_orders_on_close"',
  '"fill_orders_on_standard_ohlc"',
]) {
  if (!strategyCore.includes(required)) {
    throw new Error(`core strategy.ts missing canonical property key ${required}`);
  }
}

for (const required of ['"fixed"', '"cash_per_order"', '"percent_of_equity"']) {
  if (!strategyCore.includes(required)) {
    throw new Error(`core strategy.ts missing canonical default_qty_type enum ${required}`);
  }
}

for (const required of ['"percent"', '"cash_per_contract"', '"cash_per_order"']) {
  if (!strategyCore.includes(required)) {
    throw new Error(`core strategy.ts missing canonical commission_type enum ${required}`);
  }
}

for (const required of ["clampBarCount", "BarLimitMode", "BarLimitPlan"]) {
  if (!clampBars.includes(required)) {
    throw new Error(`core clamp-bars.ts missing ${required}`);
  }
}

for (const required of ['"./strategy"', '"./clamp-bars"']) {
  if (!coreIndex.includes(required)) {
    throw new Error(`core index.ts must re-export ${required}`);
  }
}

for (const file of [
  ["worker/src/tradingview.ts", workerTradingview],
  ["worker/src/study-chain.ts", workerStudyChain],
  ["worker/src/chart-session-do.ts", workerChartSession],
]) {
  const [name, content] = file;
  if (/\bMAX_BATCH_SIZE\s*=\s*\d+/.test(content)) {
    throw new Error(`${name} must not redefine MAX_BATCH_SIZE locally; use clampBarCount from core`);
  }
  if (!/\bclampBarCount\b/.test(content)) {
    throw new Error(`${name} must use clampBarCount from packages/tradingview-core/src`);
  }
}

for (const required of ["STRATEGY_PROPERTY_KEYS", "STRATEGY_DEFAULT_QTY_TYPES", "STRATEGY_COMMISSION_TYPES"]) {
  if (!workerStrategy.includes(required)) {
    throw new Error(`worker/src/strategy.ts must import ${required} from packages/tradingview-core/src`);
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

if (!skill.includes("surface-rediscovery.md")) {
  throw new Error("skill missing surface rediscovery reference");
}

for (const required of [
  "unknown unknowns",
  "WebSocket frames",
  "Bundled JavaScript",
  "plan-gated",
  "lead only",
  "Do not downgrade",
  "Continue exploring until marginal discoveries flatten",
]) {
  if (!rediscovery.includes(required)) {
    throw new Error(`surface rediscovery reference missing requirement: ${required}`);
  }
}

for (const required of ["HMAC", "POST /admin/session", "stored Worker session is authoritative"]) {
  if (!auth.includes(required)) {
    throw new Error(`auth skill missing requirement: ${required}`);
  }
}

for (const required of ['retryable:true', 'category:"network"', "Network and upstream failures must not be treated as auth failures"]) {
  if (!auth.includes(required)) {
    throw new Error(`auth skill missing recovery requirement: ${required}`);
  }
}

for (const required of ["retry with backoff", "Do not rotate credentials", "category:\"auth\""]) {
  if (!skill.includes(required)) {
    throw new Error(`skill missing retry/auth routing requirement: ${required}`);
  }
}

for (const required of ["partial:true", "authSource", "fails closed"]) {
  if (!skill.includes(required)) {
    throw new Error(`skill missing response semantics requirement: ${required}`);
  }
}

for (const required of ["epoch milliseconds", "5-minute skew window", "/admin", "/cache"]) {
  if (!auth.includes(required)) {
    throw new Error(`auth skill missing HMAC scope/timestamp requirement: ${required}`);
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
