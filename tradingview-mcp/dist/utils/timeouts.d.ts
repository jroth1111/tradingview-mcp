/**
 * Default timeout values for different TradingView operations.
 *
 * Timeouts are chosen based on typical operation duration:
 * - Quotes: Fast, usually < 1 second
 * - Candles: Fast to medium, 1-15 seconds depending on amount
 * - Validation: Medium, 10-20 seconds for compilation
 * - Studies/Backtests: Slow, 30-120 seconds for complex analysis
 * - Deep fetches: Very slow, up to 2 minutes for 40k+ bars
 */
export declare const DEFAULT_TIMEOUTS: {
    /** Real-time quote fetch (fast) */
    readonly quote: 10000;
    /** OHLCV candle fetch */
    readonly candles: 15000;
    /** Extended historical candles with pagination */
    readonly deepCandles: 120000;
    /** PineScript validation/compilation */
    readonly validation: 20000;
    /** PineScript study execution */
    readonly study: 20000;
    /** Strategy backtest (slow) */
    readonly backtest: 60000;
    /** Indicator metadata fetch */
    readonly indicator: 10000;
    /** Symbol search */
    readonly search: 10000;
    /** Scanner/screener operations */
    readonly scanner: 30000;
};
export type TimeoutOperation = keyof typeof DEFAULT_TIMEOUTS;
/**
 * Get the default timeout for an operation type.
 *
 * @param operation - The operation type
 * @returns Timeout in milliseconds
 */
export declare function getTimeout(operation: TimeoutOperation): number;
/**
 * Get a timeout with a custom multiplier.
 * Useful for scaling timeouts based on data size.
 *
 * @param operation - The operation type
 * @param multiplier - Multiplier for the base timeout
 * @returns Adjusted timeout in milliseconds
 */
export declare function getTimeoutScaled(operation: TimeoutOperation, multiplier: number): number;
//# sourceMappingURL=timeouts.d.ts.map