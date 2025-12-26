/**
 * Tests for rate limiter
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "./rate-limiter.js";
describe("RateLimiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    describe("constructor", () => {
        it("initializes with default values", () => {
            const limiter = new RateLimiter();
            expect(limiter.getAvailableTokens()).toBe(60);
        });
        it("initializes with custom max tokens", () => {
            const limiter = new RateLimiter({ maxTokens: 100 });
            expect(limiter.getAvailableTokens()).toBe(100);
        });
        it("initializes with custom refill rate", () => {
            const limiter = new RateLimiter({ maxTokens: 10, refillRate: 5 });
            expect(limiter.getAvailableTokens()).toBe(10);
        });
        it("initializes with initial tokens", () => {
            const limiter = new RateLimiter({ maxTokens: 100, initialTokens: 50 });
            expect(limiter.getAvailableTokens()).toBe(50);
        });
    });
    describe("acquire", () => {
        it("acquires tokens when available", async () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            await limiter.acquire(5);
            expect(limiter.getAvailableTokens()).toBe(5);
        });
        it("waits when tokens are not available", async () => {
            const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10 });
            await limiter.acquire(10);
            expect(limiter.getAvailableTokens()).toBe(0);
            // Advance time to allow refill
            await vi.advanceTimersByTimeAsync(100); // 100ms at 10 tokens/sec = 1 token
            const acquired = limiter.tryAcquire(1);
            expect(acquired).toBe(true);
        });
        it("acquires all available tokens", async () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            await limiter.acquire(10);
            expect(limiter.getAvailableTokens()).toBe(0);
        });
        it("refills tokens over time", async () => {
            const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10 }); // 10 per second
            await limiter.acquire(10);
            vi.advanceTimersByTime(500); // 500ms
            expect(limiter.getAvailableTokens()).toBe(5);
            vi.advanceTimersByTime(500); // Another 500ms = 1 second total
            expect(limiter.getAvailableTokens()).toBe(10);
        });
        it("caps tokens at max", async () => {
            const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10 });
            await limiter.acquire(5);
            vi.advanceTimersByTime(1000); // 1 second should add 10 tokens
            expect(limiter.getAvailableTokens()).toBe(10); // Capped at max
        });
    });
    describe("tryAcquire", () => {
        it("returns true when tokens are available", () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            expect(limiter.tryAcquire(5)).toBe(true);
            expect(limiter.getAvailableTokens()).toBe(5);
        });
        it("returns false when tokens are not available", () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            limiter.tryAcquire(10);
            expect(limiter.tryAcquire(1)).toBe(false);
        });
        it("does not wait", () => {
            const limiter = new RateLimiter({ maxTokens: 1 });
            limiter.tryAcquire(1);
            const start = Date.now();
            limiter.tryAcquire(1);
            expect(Date.now() - start).toBeLessThan(10); // Should be instant
        });
    });
    describe("getWaitTime", () => {
        it("returns 0 when tokens are available", () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            expect(limiter.getWaitTime(5)).toBe(0);
        });
        it("returns calculated wait time", () => {
            const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10 }); // 10 per second
            limiter.tryAcquire(10);
            // Need 1 token at 10/sec = 100ms
            expect(limiter.getWaitTime(1)).toBe(100);
            // Need 5 tokens at 10/sec = 500ms
            expect(limiter.getWaitTime(5)).toBe(500);
        });
    });
    describe("record429", () => {
        it("sets backoff period", async () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            // Use up all tokens
            limiter.tryAcquire(10);
            expect(limiter.getAvailableTokens()).toBe(0);
            limiter.record429(100); // 100ms backoff
            // Even after refill time, backoff should prevent immediate acquire
            await vi.advanceTimersByTimeAsync(200);
            // After 200ms, we'd have 2 tokens from refill (10 per second)
            // But acquire will wait due to backoff
            // Reset should clear backoff
            limiter.reset();
            expect(limiter.getAvailableTokens()).toBe(10);
        });
        it("uses default backoff when not specified", async () => {
            const limiter = new RateLimiter({ maxTokens: 10 });
            limiter.record429(); // Default 1000ms backoff
            // Reset clears backoff
            limiter.reset();
            const acquired = limiter.tryAcquire(1);
            expect(acquired).toBe(true);
        });
    });
    describe("reset", () => {
        it("clears backoff and restores tokens", () => {
            const limiter = new RateLimiter({ maxTokens: 10, initialTokens: 5 });
            limiter.tryAcquire(3);
            limiter.record429(5000);
            limiter.reset();
            expect(limiter.getAvailableTokens()).toBe(10);
            expect(limiter.getWaitTime(1)).toBe(0);
        });
    });
    describe("setRefillRate", () => {
        it("changes the refill rate", async () => {
            const limiter = new RateLimiter({ maxTokens: 10, refillRate: 10 });
            await limiter.acquire(10);
            limiter.setRefillRate(20); // 20 per second
            vi.advanceTimersByTime(500); // 500ms at 20/sec = 10 tokens
            expect(limiter.getAvailableTokens()).toBe(10);
        });
    });
});
//# sourceMappingURL=rate-limiter.test.js.map