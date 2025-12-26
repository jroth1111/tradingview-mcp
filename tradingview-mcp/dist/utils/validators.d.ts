/**
 * Semantic validators for TradingView MCP inputs.
 *
 * These validators go beyond type checking to ensure inputs
 * are semantically valid for TradingView operations.
 */
import { z } from "zod";
/**
 * Valid TradingView timeframes
 */
export declare const VALID_TIMEFRAMES: Set<string>;
/**
 * Common exchange prefixes on TradingView
 */
export declare const COMMON_EXCHANGES: Set<string>;
/**
 * Symbol format: EXCHANGE:TICKER or just TICKER
 * Examples: NASDAQ:AAPL, BINANCE:BTCUSDT, AAPL
 */
export declare const symbolSchema: z.ZodEffects<z.ZodString, string, string>;
export declare const symbolWithExchangeSchema: z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>;
/**
 * Timeframe validator
 */
export declare const timeframeSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Indicator/Study ID validator
 * Formats: STD;RSI, PUB;abc123, USER;def456
 */
export declare const studyIdSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Date string validator (YYYYMMDD format for options)
 */
export declare const expirationDateSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Market validator
 */
export declare const marketSchema: z.ZodString;
/**
 * Positive integer validator (for counts, limits)
 */
export declare const positiveIntSchema: z.ZodNumber;
/**
 * Candle count validator (with reasonable limits)
 */
export declare const candleCountSchema: z.ZodDefault<z.ZodNumber>;
/**
 * Calendar window validators
 */
export declare const daysAheadSchema: z.ZodNumber;
export declare const daysBackSchema: z.ZodNumber;
/**
 * Validate and normalize a symbol
 */
export declare function normalizeSymbol(symbol: string): string;
/**
 * Validate and normalize a timeframe
 */
export declare function normalizeTimeframe(tf: string): string;
/**
 * Extract exchange from symbol
 */
export declare function extractExchange(symbol: string): {
    exchange?: string;
    ticker: string;
};
//# sourceMappingURL=validators.d.ts.map