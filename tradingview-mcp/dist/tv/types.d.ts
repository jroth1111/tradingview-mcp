export type TradingViewEndpoint = "data" | "prodata" | "widgetdata" | "charts-polygon";
export declare const ENDPOINTS: Record<TradingViewEndpoint, string>;
export interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}
export interface Quote {
    lp?: number;
    ch?: number;
    chp?: number;
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
export type { TVEvent } from "./connection.js";
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
    author: {
        username: string;
    };
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
export declare const VALID_TIMEFRAMES: Set<string>;
export declare const TIMEFRAME_MAP: Map<string, string>;
export declare const FUNDAMENTAL_FIELDS: string[];
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
export declare const EARNINGS_FIELDS: string[];
export declare const DIVIDEND_FIELDS: string[];
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
export * from './types-pinescript.js';
//# sourceMappingURL=types.d.ts.map