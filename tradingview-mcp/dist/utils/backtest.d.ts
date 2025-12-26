/**
 * Backtest utilities for indicator-based trading strategies
 */
export interface BacktestBar {
    time: number;
    timeStr?: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    indicator?: number | null;
}
export interface IndicatorValue {
    time: number;
    timeStr?: string;
    value: number | null;
}
export type TradeSignal = "BUY" | "SELL" | "HOLD";
export interface Trade {
    entryTime: number;
    entryPrice: number;
    exitTime?: number;
    exitPrice?: number;
    direction: "long" | "short";
    pnl?: number;
    pnlPercent?: number;
    exitReason?: "stop_loss" | "take_profit" | "signal_reverse" | "end_of_data";
}
export interface BacktestConfig {
    entryThreshold?: number;
    exitThreshold?: number;
    stopLossPercent?: number;
    takeProfitPercent?: number;
    positionSize?: number;
    initialCapital?: number;
}
export interface BacktestResult {
    trades: Trade[];
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnl: number;
    totalPnlPercent: number;
    averageWin: number;
    averageLoss: number;
    profitFactor: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    sharpeRatio?: number;
    averageTradeDuration?: number;
}
/**
 * Generate trading signals from indicator values using threshold-based logic
 * BUY when indicator drops below entryThreshold
 * SELL when indicator rises above exitThreshold
 */
export declare function generateSignals(data: Array<{
    time: number;
    value: number | null;
    close?: number;
}>, config?: BacktestConfig): TradeSignal[];
/**
 * Run backtest simulation with given price data, signals, and configuration
 */
export declare function runBacktest(bars: BacktestBar[], signals: TradeSignal[], config?: BacktestConfig): BacktestResult;
/**
 * Format backtest results as a human-readable summary
 */
export declare function formatBacktestResult(result: BacktestResult): string;
//# sourceMappingURL=backtest.d.ts.map