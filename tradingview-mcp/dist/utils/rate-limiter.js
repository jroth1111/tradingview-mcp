/**
 * Rate limiter using token bucket algorithm.
 *
 * Prevents hitting TradingView's rate limits by throttling requests.
 * Supports dynamic rate adjustment based on 429 responses.
 */
/**
 * Token bucket rate limiter.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter({ maxTokens: 60, refillRate: 1 });
 * await limiter.acquire(); // Wait if rate limited
 * ```
 */
export class RateLimiter {
    tokens;
    maxTokens;
    refillRatePerMs;
    lastRefill;
    retryAfterUntil = 0;
    constructor(options = {}) {
        this.maxTokens = options.maxTokens ?? 60;
        this.refillRatePerMs = (options.refillRate ?? 1) / 1000;
        this.tokens = options.initialTokens ?? this.maxTokens;
        this.lastRefill = Date.now();
    }
    /**
     * Acquire tokens, waiting if necessary.
     *
     * @param tokens - Number of tokens to acquire (default: 1)
     * @returns Promise that resolves when tokens are available
     */
    async acquire(tokens = 1) {
        // If we're in a backoff period, wait until it's over
        const backoffRemaining = this.retryAfterUntil - Date.now();
        if (backoffRemaining > 0) {
            await this.sleep(backoffRemaining);
        }
        this.refill();
        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return;
        }
        // Not enough tokens, wait for refill
        const tokensNeeded = tokens - this.tokens;
        const waitMs = Math.ceil(tokensNeeded / this.refillRatePerMs);
        await this.sleep(waitMs);
        this.refill();
        this.tokens -= tokens;
    }
    /**
     * Check if a request would be allowed without waiting.
     */
    tryAcquire(tokens = 1) {
        this.refill();
        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return true;
        }
        return false;
    }
    /**
     * Get the number of available tokens.
     */
    getAvailableTokens() {
        this.refill();
        return this.tokens;
    }
    /**
     * Get the estimated wait time for acquiring tokens.
     */
    getWaitTime(tokens = 1) {
        this.refill();
        if (this.tokens >= tokens)
            return 0;
        const tokensNeeded = tokens - this.tokens;
        return Math.ceil(tokensNeeded / this.refillRatePerMs);
    }
    /**
     * Record a 429 (rate limit) response and enter backoff period.
     *
     * @param retryAfterMs - Suggested retry delay from server
     */
    record429(retryAfterMs) {
        // Use server's suggested delay, or default to 1 second
        const backoff = retryAfterMs ?? 1000;
        this.retryAfterUntil = Date.now() + backoff;
    }
    /**
     * Reset the rate limiter (clear backoff and restore tokens).
     */
    reset() {
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();
        this.retryAfterUntil = 0;
    }
    /**
     * Update the refill rate dynamically.
     */
    setRefillRate(ratePerSecond) {
        this.refillRatePerMs = ratePerSecond / 1000;
    }
    // Private methods
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const tokensToAdd = elapsed * this.refillRatePerMs;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
/**
 * Rate limiter for WebSocket connections.
 *
 * More lenient since WebSocket traffic has different limits.
 */
export const wsRateLimiter = new RateLimiter({
    maxTokens: 120,
    refillRate: 2,
});
/**
 * Rate limiter for REST API calls.
 *
 * Stricter limits for HTTP endpoints.
 */
export const restRateLimiter = new RateLimiter({
    maxTokens: 60,
    refillRate: 1,
});
/**
 * Rate limiter for PineScript compilation.
 *
 * More restrictive for CPU-intensive operations.
 */
export const compileRateLimiter = new RateLimiter({
    maxTokens: 10,
    refillRate: 0.5, // 1 request every 2 seconds
});
//# sourceMappingURL=rate-limiter.js.map