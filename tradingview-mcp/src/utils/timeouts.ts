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

export const DEFAULT_TIMEOUTS = {
  /** Real-time quote fetch (fast) */
  quote: 10000,
  /** OHLCV candle fetch */
  candles: 15000,
  /** Extended historical candles with pagination */
  deepCandles: 120000,
  /** PineScript validation/compilation */
  validation: 20000,
  /** PineScript study execution */
  study: 20000,
  /** Strategy backtest (slow) */
  backtest: 60000,
  /** Indicator metadata fetch */
  indicator: 10000,
  /** Symbol search */
  search: 10000,
  /** Scanner/screener operations */
  scanner: 30000,
} as const;

export type TimeoutOperation = keyof typeof DEFAULT_TIMEOUTS;

/**
 * Get the default timeout for an operation type.
 *
 * @param operation - The operation type
 * @returns Timeout in milliseconds
 */
export function getTimeout(operation: TimeoutOperation): number {
  return DEFAULT_TIMEOUTS[operation];
}

/**
 * Get a timeout with a custom multiplier.
 * Useful for scaling timeouts based on data size.
 *
 * @param operation - The operation type
 * @param multiplier - Multiplier for the base timeout
 * @returns Adjusted timeout in milliseconds
 */
export function getTimeoutScaled(operation: TimeoutOperation, multiplier: number): number {
  return Math.floor(DEFAULT_TIMEOUTS[operation] * multiplier);
}
