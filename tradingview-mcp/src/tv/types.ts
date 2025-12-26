// TradingView protocol types

export type TradingViewEndpoint = "data" | "prodata" | "widgetdata" | "charts-polygon";

export const ENDPOINTS: Record<TradingViewEndpoint, string> = {
  data: "wss://data.tradingview.com/socket.io/websocket",
  prodata: "wss://prodata.tradingview.com/socket.io/websocket",
  widgetdata: "wss://widgetdata.tradingview.com/socket.io/websocket",
  "charts-polygon": "wss://charts-polygon.tradingview.com/socket.io/websocket",
};

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  lp?: number;       // last price
  ch?: number;       // change
  chp?: number;      // change percent
  volume?: number;
  bid?: number;
  ask?: number;
  high_price?: number;
  low_price?: number;
  open_price?: number;
  prev_close_price?: number;
  lp_time?: number;
  currency_code?: string;
  exchange?: string;
  pro_name?: string;
}

export interface SymbolInfo {
  symbol: string;
  exchange: string;
  type: string;
  pricescale: number;
  minmov: number;
  timezone: string;
  session: string;
  description: string;
}

export interface StudyError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
}

export interface StudyPlot {
  id: string;
  title: string;
  type: string;
}

export interface StudyResult {
  valid: boolean;
  errors: StudyError[];
  warnings: StudyError[];
  plots?: StudyPlot[];
  data?: Record<string, number[]>;
}

export interface StrategyMetrics {
  netProfit: number;
  netProfitPercent: number;
  grossProfit: number;
  grossLoss: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgTrade: number;
  avgWinningTrade: number;
  avgLosingTrade: number;
}

export interface Trade {
  entryTime: number;
  exitTime: number;
  type: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  profit: number;
  profitPercent: number;
}

export interface BacktestResult extends StrategyMetrics {
  trades: Trade[];
}

export interface TVCredentials {
  sessionId: string;
  sessionSign?: string;
  authToken?: string;
}

// Re-export TVEvent from connection module
export type { TVEvent } from "./connection.js";

// TradingView WebSocket message data types

/**
 * Error data from a study compilation or execution.
 * Extracted from TVEvent params.
 */
export interface TVStudyErrorData {
  line?: number;
  column?: number;
  message: string;
  severity?: "error" | "warning";
}

export interface IndicatorMeta {
  id: string;
  version: string;
  name: string;
  description?: string;
  shortDescription?: string;
  inputs: IndicatorInput[];
  plots: IndicatorPlot[];
  script?: string;
}

export interface IndicatorInput {
  name: string;
  type: string;
  defval: unknown;
  options?: string[];
  minval?: number;
  maxval?: number;
}

export interface IndicatorPlot {
  id: string;
  title: string;
  type: string;
}

export interface IndicatorSearchResult {
  id: string;
  version: string;
  name: string;
  author: { username: string };
  access: "open_source" | "closed_source" | "invite_only" | "other";
  type: "study" | "strategy" | "other";
}

export interface OptionsVolatilityChartPlot {
  optionSeriesId: string;
  plot: {
    y: number[];
  };
}

export interface OptionsVolatilityChart {
  x: number[];
  plots: OptionsVolatilityChartPlot[];
}

export interface OptionsVolatilityChartResponse {
  xAxis: OptionsVolatilityChart;
}

export interface OptionsIvSpan {
  value: number;
  unit: "d" | "w" | "m" | "y";
}

export interface OptionsIvEntry {
  span: OptionsIvSpan;
  value: number;
}

export interface OptionsInTimeIV {
  symbol: string;
  realIvs: OptionsIvEntry[];
  standardIvs: OptionsIvEntry[];
}

export const VALID_TIMEFRAMES = new Set([
  "1", "3", "5", "15", "30", "45", "60",
  "120", "180", "240",
  "1D", "1W", "1M", "1Q", "1Y",
]);

export const TIMEFRAME_MAP = new Map<string, string>([
  ["1m", "1"], ["3m", "3"], ["5m", "5"], ["15m", "15"],
  ["30m", "30"], ["45m", "45"], ["1h", "60"], ["2h", "120"],
  ["3h", "180"], ["4h", "240"], ["1d", "1D"], ["d", "1D"],
  ["1w", "1W"], ["w", "1W"], ["1mth", "1M"], ["m", "1M"],
  ["1q", "1Q"], ["q", "1Q"], ["1y", "1Y"], ["y", "1Y"],
]);

// Fundamentals - 60+ financial fields
export const FUNDAMENTAL_FIELDS = [
  "total_revenue",
  "revenue_per_share_ttm",
  "total_revenue_fy",
  "gross_profit",
  "gross_profit_fy",
  "operating_income",
  "operating_income_fy",
  "net_income",
  "net_income_fy",
  "EBITDA",
  "basic_eps_net_income",
  "earnings_per_share_basic_ttm",
  "earnings_per_share_diluted_ttm",
  "total_assets",
  "total_assets_fy",
  "cash_n_short_term_invest",
  "cash_n_short_term_invest_fy",
  "total_debt",
  "total_debt_fy",
  "stockholders_equity",
  "stockholders_equity_fy",
  "book_value_per_share_fq",
  "cash_f_operating_activities",
  "cash_f_operating_activities_fy",
  "cash_f_investing_activities",
  "cash_f_investing_activities_fy",
  "cash_f_financing_activities",
  "cash_f_financing_activities_fy",
  "free_cash_flow",
  "gross_margin",
  "gross_margin_percent_ttm",
  "operating_margin",
  "operating_margin_ttm",
  "pretax_margin_percent_ttm",
  "net_margin",
  "net_margin_percent_ttm",
  "EBITDA_margin",
  "return_on_equity",
  "return_on_equity_fq",
  "return_on_assets",
  "return_on_assets_fq",
  "return_on_investment_ttm",
  "current_ratio",
  "current_ratio_fq",
  "quick_ratio",
  "quick_ratio_fq",
  "debt_to_equity",
  "debt_to_equity_fq",
  "debt_to_assets",
  "market_cap_basic",
  "market_cap_calc",
  "market_cap_diluted_calc",
  "enterprise_value_fq",
  "price_earnings_ttm",
  "price_book_fq",
  "price_sales_ttm",
  "price_free_cash_flow_ttm",
  "dividends_yield",
  "dividends_per_share_fq",
  "dividend_payout_ratio_ttm",
];

// Scanner filter types
export interface ScanFilter {
  left: string;
  operation: string;
  right: unknown;
}

export interface ScanRequest {
  market?: string;
  symbols?: string[];
  filter?: ScanFilter[];
  columns?: string[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
}

export interface ScanResult {
  count: number;
  data: Array<Record<string, unknown>>;
}

export interface ScannerEnumItem {
  id: string;
  name: string;
  options?: Record<string, unknown>;
}

export type ScannerEnumOrderedResult = Record<string, ScannerEnumItem[]>;

export type ScannerMetainfoResult = Record<string, unknown>;

export interface ScannerCacheManifestEntry {
  markets: string[];
  metainfo: Record<string, string>;
  enumOrdered: string | null;
}

export type ScannerCacheManifest = Record<string, ScannerCacheManifestEntry>;

export interface ScannerManifestSummaryItem {
  labelProduct: string;
  markets: string[];
  metainfoMarkets: string[];
  hasEnumOrdered: boolean;
}

export interface ScannerManifestSummaryResult {
  manifestPath: string;
  items: ScannerManifestSummaryItem[];
  count: number;
}

export interface ScannerFiltersResultField {
  id: string;
  type?: string;
  range: unknown;
}

export interface ScannerFiltersResult {
  labelProduct: string;
  market: string;
  fields: ScannerFiltersResultField[];
  enumIds: string[];
  enums?: ScannerEnumOrderedResult | null;
  totalFields: number;
  matchedFields: number;
  returnedFields: number;
  truncated: boolean;
  missingFields?: string[];
  hint?: string;
  rawMetainfo?: ScannerMetainfoResult;
  sources: {
    manifestPath: string;
    metainfoPath: string;
    enumOrderedPath: string | null;
  };
}

export interface ScannerEnumValuesResultCount {
  total: number;
  matched: number;
  returned: number;
}

export interface ScannerEnumValuesResult {
  labelProduct: string;
  enumIds: string[];
  enums: ScannerEnumOrderedResult;
  counts: Record<string, ScannerEnumValuesResultCount>;
  sources: {
    manifestPath: string;
    enumOrderedPath: string;
  };
  hint?: string;
}

// Market movers types
export interface MoverResult {
  name: string;
  close: number;
  change: number;
  change_abs: number;
  volume: number;
  market_cap: number;
}

export interface MarketOverviewResult extends MoverResult {
  pe?: number;
  eps?: number;
  sector?: string;
  industry?: string;
  recommendation?: number;
}

// Calendar types
export const EARNINGS_FIELDS = [
  "earnings_release_next_date",
  "logoid",
  "name",
  "description",
  "earnings_per_share_fq",
  "earnings_per_share_forecast_next_fq",
  "eps_surprise_fq",
  "eps_surprise_percent_fq",
  "revenue_fq",
  "revenue_forecast_next_fq",
  "market_cap_basic",
  "earnings_release_time",
  "earnings_release_next_time",
  "earnings_per_share_forecast_fq",
  "revenue_forecast_fq",
  "fundamental_currency_code",
  "market",
  "earnings_publication_type_fq",
  "earnings_publication_type_next_fq",
  "revenue_surprise_fq",
  "revenue_surprise_percent_fq",
];

export const DIVIDEND_FIELDS = [
  "dividend_ex_date_recent",
  "dividend_ex_date_upcoming",
  "logoid",
  "name",
  "description",
  "dividends_yield",
  "dividend_payment_date_recent",
  "dividend_payment_date_upcoming",
  "dividend_amount_recent",
  "dividend_amount_upcoming",
  "fundamental_currency_code",
  "market",
];

export interface EarningsEvent {
  symbol: string;
  name?: string;
  date?: number;
  time?: string;
  eps_estimate?: number;
  eps_actual?: number;
  eps_surprise?: number;
  eps_surprise_percent?: number;
  revenue_estimate?: number;
  revenue_actual?: number;
  market_cap?: number;
}

export interface DividendEvent {
  symbol: string;
  name?: string;
  ex_date?: number;
  payment_date?: number;
  amount?: number;
  yield?: number;
}

// Pine Script API types - export from separate file
export * from './types-pinescript.js';
