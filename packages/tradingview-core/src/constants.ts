export type TradingviewEndpoint = "data" | "prodata" | "widgetdata" | "charts-polygon";

export const TRADINGVIEW_WS_ENDPOINTS: Record<TradingviewEndpoint, string> = {
  data: "wss://data.tradingview.com/socket.io/websocket",
  prodata: "wss://prodata.tradingview.com/socket.io/websocket",
  widgetdata: "wss://widgetdata.tradingview.com/socket.io/websocket",
  "charts-polygon": "wss://charts-polygon.tradingview.com/socket.io/websocket",
};

// TradingView's WS endpoint requires a query string identifying the connection
// type for Pine-script studies (Script@tv-scripting-101!) to be permitted by the
// gateway's entitlement check. Without ?type=chart&auth=sessionid the gateway
// returns "Study not allowed in this connection" for any Pine create_study even
// with valid premium credentials. Built-in basicstudies still work on the bare
// URL but Pine scripts do not, so chart-session callers always need the suffix.
export const buildChartSessionWsUrl = (endpoint: TradingviewEndpoint): string => {
  const base = TRADINGVIEW_WS_ENDPOINTS[endpoint];
  const date = new Date().toISOString().slice(0, 19);
  return `${base}?from=chart%2F&date=${date}&type=chart&auth=sessionid`;
};

// Current TradingView built-in study definition pack. The browser's chart loader
// addresses bare-id studies (Volume, RSI, MACD, etc.) as `<id>@tv-basicstudies-265`
// as of 2026-05-07. Older versions (45, 118, 241) still respond for some studies
// but expose a different study-set per pack — 265 is the only pack that aligns
// with the current TV web client's catalog.
export const TRADINGVIEW_BASICSTUDIES_VERSION = "265";

// Wire ID emitted for any Pine script create_study (PUB; or USER;) AND for
// every TradingView built-in study that has been migrated to Pine under the
// hood (STD;EMA, STD;RSI, STD;Average_True_Range, …). Script identity moves
// into the inputs dict as { text, pineId, pineVersion } — the wireId is the
// framework slot, not the script reference.
export const TRADINGVIEW_PINE_SCRIPT_WIRE_ID = "Script@tv-scripting-101!";

// Wire ID for Pine STRATEGIES (built-in or user). Same identity envelope as
// the study wire (text/pineId/pineVersion), distinct framework slot. Verified
// 2026-05-07 against built-in STD;MACD%1Strategy and STD;Bollinger%1Bands%1Strategy.
export const TRADINGVIEW_PINE_STRATEGY_WIRE_ID = "StrategyScript@tv-scripting-101!";

// True for either Pine framework wireId — convenience for dispatchers that
// inject text/pineId/pineVersion regardless of study/strategy variant.
export const isPineFlowWireId = (wireId: string): boolean =>
  wireId === TRADINGVIEW_PINE_SCRIPT_WIRE_ID ||
  wireId === TRADINGVIEW_PINE_STRATEGY_WIRE_ID;

export const VALID_TIMEFRAMES = new Set([
  "1",
  "3",
  "5",
  "15",
  "30",
  "45",
  "60",
  "120",
  "180",
  "240",
  "1D",
  "1W",
  "1M",
  "1Q",
  "1Y",
]);

export const TIMEFRAME_MAP = new Map([
  ["1m", "1"],
  ["3m", "3"],
  ["5m", "5"],
  ["15m", "15"],
  ["30m", "30"],
  ["45m", "45"],
  ["1h", "60"],
  ["2h", "120"],
  ["3h", "180"],
  ["4h", "240"],
  ["1d", "1D"],
  ["d", "1D"],
  ["1w", "1W"],
  ["w", "1W"],
  ["1mth", "1M"],
  ["m", "1M"],
  ["1q", "1Q"],
  ["q", "1Q"],
  ["1y", "1Y"],
  ["y", "1Y"],
]);

const textEncoder = new TextEncoder();

export const frameTradingViewMessage = (name: string, params: any[]) => {
  const json = JSON.stringify({ m: name, p: params });
  const len = textEncoder.encode(json).length;
  return `~m~${len}~m~${json}`;
};

export const normalizeTradingViewPayload = (payload: string) => {
  if (!payload) return payload;
  if (payload.startsWith("42") && payload.includes("~m~")) return payload.slice(2);
  if (payload.startsWith("4") && payload.includes("~m~")) return payload.slice(1);
  return payload;
};
