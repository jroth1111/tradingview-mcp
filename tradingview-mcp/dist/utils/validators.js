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
export const VALID_TIMEFRAMES = new Set([
    // Minutes
    "1", "3", "5", "15", "30", "45",
    // Hours
    "60", "120", "180", "240",
    // Daily/Weekly/Monthly
    "1D", "1W", "1M", "1Q", "1Y",
    // Alternate formats
    "D", "W", "M", "Q", "Y",
]);
/**
 * Common exchange prefixes on TradingView
 */
export const COMMON_EXCHANGES = new Set([
    // US Stocks
    "NASDAQ", "NYSE", "AMEX", "OTC", "BATS",
    // Crypto
    "BINANCE", "COINBASE", "KRAKEN", "BITSTAMP", "BYBIT", "BITFINEX", "KUCOIN", "MEXC",
    // Forex
    "FX", "FX_IDC", "OANDA", "FXCM", "FOREXCOM",
    // Futures
    "CME", "NYMEX", "COMEX", "CBOT", "CME_MINI",
    // International
    "LSE", "TSX", "ASX", "NSE", "BSE", "HKEX", "SSE", "SZSE", "TYO", "XETR", "EURONEXT",
    // Indices
    "INDEX", "CAPITALCOM", "SP", "DJ", "FRED",
    // Options
    "OPRA",
]);
/**
 * Symbol format: EXCHANGE:TICKER or just TICKER
 * Examples: NASDAQ:AAPL, BINANCE:BTCUSDT, AAPL
 */
export const symbolSchema = z
    .string()
    .min(1, "Symbol cannot be empty")
    .max(50, "Symbol too long")
    .refine((s) => {
    // Allow simple tickers or EXCHANGE:TICKER format
    const parts = s.split(":");
    if (parts.length > 2)
        return false;
    if (parts.length === 2) {
        const [exchange, ticker] = parts;
        return exchange.length > 0 && ticker.length > 0;
    }
    return s.length > 0;
}, { message: "Invalid symbol format. Use EXCHANGE:TICKER (e.g., NASDAQ:AAPL) or just TICKER" })
    .describe("Trading symbol (e.g., NASDAQ:AAPL, BINANCE:BTCUSDT)");
export const symbolWithExchangeSchema = symbolSchema
    .refine((s) => s.includes(":"), { message: "Symbol must include exchange prefix (e.g., NASDAQ:AAPL)" })
    .describe("Trading symbol with exchange prefix (e.g., NASDAQ:AAPL)");
/**
 * Timeframe validator
 */
export const timeframeSchema = z
    .string()
    .refine((tf) => {
    const normalized = normalizeTimeframe(tf);
    return VALID_TIMEFRAMES.has(normalized) || VALID_TIMEFRAMES.has(normalized.toUpperCase());
}, {
    message: "Invalid timeframe. Valid: 1, 3, 5, 15, 30, 45, 60, 120, 180, 240, 1D, 1W, 1M, 1Q, 1Y",
})
    .describe("Timeframe (e.g., 1, 5, 15, 60, 1D, 1W)");
/**
 * Indicator/Study ID validator
 * Formats: STD;RSI, PUB;abc123, USER;def456
 */
export const studyIdSchema = z
    .string()
    .min(1, "Study ID cannot be empty")
    .refine((id) => {
    // Built-in indicators: STD;Name
    if (id.startsWith("STD;"))
        return id.length > 4;
    // Published indicators: PUB;hash
    if (id.startsWith("PUB;"))
        return id.length > 4;
    // User indicators: USER;hash
    if (id.startsWith("USER;"))
        return id.length > 5;
    // Script@tv-scripting prefix
    if (id.includes("@tv-scripting"))
        return true;
    // Allow other formats for flexibility
    return id.length > 0;
}, { message: "Invalid study ID format. Use STD;Name, PUB;hash, or indicator name" })
    .describe("Study/indicator ID (e.g., STD;RSI, STD;MACD, PUB;abc123)");
/**
 * Date string validator (YYYYMMDD format for options)
 */
export const expirationDateSchema = z
    .string()
    .regex(/^\d{8}$/, "Expiration must be in YYYYMMDD format (e.g., 20260123)")
    .refine((date) => {
    const year = parseInt(date.slice(0, 4));
    const month = parseInt(date.slice(4, 6));
    const day = parseInt(date.slice(6, 8));
    if (year < 2020 || year > 2100)
        return false;
    if (month < 1 || month > 12)
        return false;
    if (day < 1 || day > 31)
        return false;
    return true;
}, { message: "Invalid date. Use YYYYMMDD format with valid year (2020-2100), month (01-12), day (01-31)" })
    .describe("Expiration date in YYYYMMDD format");
/**
 * Market validator
 */
export const marketSchema = z
    .string()
    .min(1, "Market cannot be empty")
    .regex(/^[a-z0-9_-]+$/i, "Market must be a simple slug (e.g., america, crypto, forex)")
    .describe("Market type for screener queries");
/**
 * Positive integer validator (for counts, limits)
 */
export const positiveIntSchema = z
    .number()
    .int("Must be an integer")
    .positive("Must be positive")
    .describe("Positive integer");
/**
 * Candle count validator (with reasonable limits)
 */
export const candleCountSchema = z
    .number()
    .int()
    .min(1, "Count must be at least 1")
    .max(20000, "Count cannot exceed 20000")
    .default(100)
    .describe("Number of candles to fetch (1-20000)");
/**
 * Calendar window validators
 */
export const daysAheadSchema = z
    .number()
    .int("Must be an integer")
    .min(0, "Days ahead cannot be negative")
    .max(365, "Days ahead cannot exceed 365")
    .describe("Days ahead to include (0-365)");
export const daysBackSchema = z
    .number()
    .int("Must be an integer")
    .min(0, "Days back cannot be negative")
    .max(365, "Days back cannot exceed 365")
    .describe("Days back to include (0-365)");
/**
 * Validate and normalize a symbol
 */
export function normalizeSymbol(symbol) {
    const trimmed = symbol.trim().toUpperCase();
    // If no exchange prefix and looks like US stock, could add NASDAQ: prefix
    // But safer to leave as-is and let TradingView resolve
    return trimmed;
}
/**
 * Validate and normalize a timeframe
 */
export function normalizeTimeframe(tf) {
    const lower = tf.toLowerCase();
    // Map common aliases
    const aliases = {
        "1m": "1",
        "3m": "3",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "45m": "45",
        "1h": "60",
        "2h": "120",
        "3h": "180",
        "4h": "240",
        "1d": "1D",
        "d": "1D",
        "1w": "1W",
        "w": "1W",
        "1mth": "1M",
        "m": "1M",
        "1q": "1Q",
        "q": "1Q",
        "1y": "1Y",
        "y": "1Y",
    };
    return aliases[lower] || tf;
}
/**
 * Extract exchange from symbol
 */
export function extractExchange(symbol) {
    const parts = symbol.split(":");
    if (parts.length === 2) {
        return { exchange: parts[0], ticker: parts[1] };
    }
    return { ticker: symbol };
}
//# sourceMappingURL=validators.js.map