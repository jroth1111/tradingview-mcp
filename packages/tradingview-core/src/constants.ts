export type TradingviewEndpoint = "data" | "prodata" | "widgetdata" | "charts-polygon";

export const TRADINGVIEW_WS_ENDPOINTS: Record<TradingviewEndpoint, string> = {
  data: "wss://data.tradingview.com/socket.io/websocket",
  prodata: "wss://prodata.tradingview.com/socket.io/websocket",
  widgetdata: "wss://widgetdata.tradingview.com/socket.io/websocket",
  "charts-polygon": "wss://charts-polygon.tradingview.com/socket.io/websocket",
};

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
