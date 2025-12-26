import { type TVConnection, type ConnectOptions } from "./connection.js";
import type { TradingViewEndpoint } from "./types.js";
export interface PoolOptions {
    /** Maximum milliseconds to keep an idle connection alive (default: 30000) */
    keepAliveMs?: number;
    /** Maximum connections per endpoint (default: 5) */
    maxConnections?: number;
    /** How often to check for stale connections (default: 10000ms) */
    cleanupIntervalMs?: number;
}
/**
 * Connection pool for TradingView WebSocket connections.
 *
 * Reduces connection overhead by reusing connections across multiple requests.
 * Connections are kept alive for a configurable idle period.
 *
 * @example
 * ```ts
 * const pool = new ConnectionPool({ credentials });
 * const conn = await pool.acquire();
 * try {
 *   // Use connection
 * } finally {
 *   pool.release(conn);
 * }
 * ```
 */
export declare class ConnectionPool {
    private options;
    private connections;
    private pending;
    private keepAliveMs;
    private maxConnections;
    private cleanupTimer?;
    private closed;
    private credentials?;
    private timeoutMs?;
    private debug?;
    constructor(options?: PoolOptions & ConnectOptions);
    /**
     * Get a connection from the pool or create a new one.
     *
     * @param endpoint - Preferred endpoint (default: from options)
     * @returns A connection that must be released via `release()`
     */
    acquire(endpoint?: TradingViewEndpoint): Promise<TVConnection>;
    /**
     * Return a connection to the pool for reuse.
     *
     * Connections are not immediately closed - they remain available
     * for reuse until the idle timeout expires.
     *
     * @param endpoint - The endpoint of the connection to release
     */
    release(endpoint?: TradingViewEndpoint): void;
    /**
     * Close all connections in the pool.
     */
    closeAll(): Promise<void>;
    /**
     * Get pool statistics for monitoring.
     */
    getStats(): {
        totalConnections: number;
        activeConnections: number;
        idleConnections: number;
        pendingConnections: number;
        connectionsByEndpoint: Record<string, number>;
    };
    /**
     * Update credentials for new connections.
     * Existing connections remain unaffected.
     */
    setCredentials(credentials: NonNullable<ConnectOptions["credentials"]>): void;
    private makeKey;
    private countConnectionsForEndpoint;
    private evictOldest;
    private createConnection;
    private startCleanup;
    private cleanup;
    private setupShutdownHooks;
}
//# sourceMappingURL=pool.d.ts.map