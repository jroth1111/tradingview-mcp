/**
 * Rate limiter using token bucket algorithm.
 *
 * Prevents hitting TradingView's rate limits by throttling requests.
 * Supports dynamic rate adjustment based on 429 responses.
 */
export interface RateLimiterOptions {
    /** Maximum tokens (requests) allowed (default: 60) */
    maxTokens?: number;
    /** Refill rate in tokens per second (default: 1) */
    refillRate?: number;
    /** Initial tokens (default: maxTokens) */
    initialTokens?: number;
}
/**
 * Token bucket rate limiter.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ maxTokens: 60, refillRate: 1 });
 * await limiter.acquire(); // Wait if rate limited
 * ```
 */
export declare class RateLimiter {
    private tokens;
    private maxTokens;
    private refillRatePerMs;
    private lastRefill;
    private retryAfterUntil;
    constructor(options?: RateLimiterOptions);
    /**
     * Acquire tokens, waiting if necessary.
     *
     * @param tokens - Number of tokens to acquire (default: 1)
     * @returns Promise that resolves when tokens are available
     */
    acquire(tokens?: number): Promise<void>;
    /**
     * Check if a request would be allowed without waiting.
     */
    tryAcquire(tokens?: number): boolean;
    /**
     * Get the number of available tokens.
     */
    getAvailableTokens(): number;
    /**
     * Get the estimated wait time for acquiring tokens.
     */
    getWaitTime(tokens?: number): number;
    /**
     * Record a 429 (rate limit) response and enter backoff period.
     *
     * @param retryAfterMs - Suggested retry delay from server
     */
    record429(retryAfterMs?: number): void;
    /**
     * Reset the rate limiter (clear backoff and restore tokens).
     */
    reset(): void;
    /**
     * Update the refill rate dynamically.
     */
    setRefillRate(ratePerSecond: number): void;
    private refill;
    private sleep;
}
/**
 * Rate limiter for WebSocket connections.
 *
 * More lenient since WebSocket traffic has different limits.
 */
export declare const wsRateLimiter: RateLimiter;
/**
 * Rate limiter for REST API calls.
 *
 * Stricter limits for HTTP endpoints.
 */
export declare const restRateLimiter: RateLimiter;
/**
 * Rate limiter for PineScript compilation.
 *
 * More restrictive for CPU-intensive operations.
 */
export declare const compileRateLimiter: RateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map