// TradingView WebSocket connection pool for efficient connection reuse

import { connect, type TVConnection, type ConnectOptions } from "./connection.js";
import type { TradingViewEndpoint } from "./types.js";
import { logger } from "../utils/logger.js";

export interface PoolOptions {
  /** Maximum milliseconds to keep an idle connection alive (default: 30000) */
  keepAliveMs?: number;
  /** Maximum connections per endpoint (default: 5) */
  maxConnections?: number;
  /** How often to check for stale connections (default: 10000ms) */
  cleanupIntervalMs?: number;
}

interface PooledConnection {
  connection: TVConnection;
  refCount: number;
  lastUsed: number;
  endpoint: TradingViewEndpoint;
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
export class ConnectionPool {
  private connections: Map<string, PooledConnection> = new Map();
  private pending: Map<string, Promise<TVConnection>> = new Map();
  private keepAliveMs: number;
  private maxConnections: number;
  private cleanupTimer?: NodeJS.Timeout;
  private closed = false;

  private credentials?: ConnectOptions["credentials"];
  private timeoutMs?: number;
  private debug?: boolean;

  constructor(
    private options: PoolOptions & ConnectOptions = {}
  ) {
    this.keepAliveMs = options.keepAliveMs ?? 30000;
    this.maxConnections = options.maxConnections ?? 5;
    this.credentials = options.credentials;
    this.timeoutMs = options.timeoutMs;
    this.debug = options.debug;

    // Start periodic cleanup
    this.startCleanup();

    // Graceful shutdown on process exit
    this.setupShutdownHooks();
  }

  /**
   * Get a connection from the pool or create a new one.
   *
   * @param endpoint - Preferred endpoint (default: from options)
   * @returns A connection that must be released via `release()`
   */
  async acquire(endpoint?: TradingViewEndpoint): Promise<TVConnection> {
    if (this.closed) {
      throw new Error("Connection pool is closed");
    }

    const ep = endpoint ?? this.options.endpoint ?? "prodata";
    const key = this.makeKey(ep);

    // Check for existing connection
    const existing = this.connections.get(key);
    if (existing && existing.connection.isConnected()) {
      existing.refCount++;
      existing.lastUsed = Date.now();
      if (this.debug) {
        logger.debug("Pool: reusing connection", { endpoint: ep, refCount: existing.refCount });
      }
      return existing.connection;
    }

    // Check if connection is already being created
    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }

    // Check max connections
    const count = this.countConnectionsForEndpoint(ep);
    if (count >= this.maxConnections) {
      // Evict oldest idle connection for this endpoint
      this.evictOldest(ep);
    }

    // Create new connection
    const connPromise = this.createConnection(ep);
    this.pending.set(key, connPromise);

    try {
      const connection = await connPromise;
      this.connections.set(key, {
        connection,
        refCount: 1,
        lastUsed: Date.now(),
        endpoint: ep,
      });
      this.pending.delete(key);
      if (this.debug) {
        logger.debug("Pool: created new connection", { endpoint: ep });
      }
      return connection;
    } catch (err) {
      this.pending.delete(key);
      throw err;
    }
  }

  /**
   * Return a connection to the pool for reuse.
   *
   * Connections are not immediately closed - they remain available
   * for reuse until the idle timeout expires.
   *
   * @param endpoint - The endpoint of the connection to release
   */
  release(endpoint: TradingViewEndpoint = this.options.endpoint ?? "prodata"): void {
    const key = this.makeKey(endpoint);
    const pooled = this.connections.get(key);
    if (pooled) {
      pooled.refCount--;
      pooled.lastUsed = Date.now();
      if (this.debug) {
        logger.debug("Pool: released connection", { endpoint, refCount: pooled.refCount });
      }
    }
  }

  /**
   * Close all connections in the pool.
   */
  async closeAll(): Promise<void> {
    if (this.closed) return;

    this.closed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    const closePromises: Promise<void>[] = [];
    for (const { connection } of this.connections.values()) {
      closePromises.push(connection.close());
    }

    this.connections.clear();
    this.pending.clear();

    await Promise.allSettled(closePromises);
  }

  /**
   * Get pool statistics for monitoring.
   */
  getStats(): {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    pendingConnections: number;
    connectionsByEndpoint: Record<string, number>;
  } {
    let active = 0;
    const byEndpoint: Record<string, number> = {};

    for (const { refCount, endpoint } of this.connections.values()) {
      if (refCount > 0) active++;
      byEndpoint[endpoint] = (byEndpoint[endpoint] || 0) + 1;
    }

    return {
      totalConnections: this.connections.size,
      activeConnections: active,
      idleConnections: this.connections.size - active,
      pendingConnections: this.pending.size,
      connectionsByEndpoint: byEndpoint,
    };
  }

  /**
   * Update credentials for new connections.
   * Existing connections remain unaffected.
   */
  setCredentials(credentials: NonNullable<ConnectOptions["credentials"]>): void {
    this.credentials = credentials;
  }

  // Private methods

  private makeKey(endpoint: TradingViewEndpoint): string {
    return endpoint;
  }

  private countConnectionsForEndpoint(endpoint: TradingViewEndpoint): number {
    let count = 0;
    for (const { endpoint: ep } of this.connections.values()) {
      if (ep === endpoint) count++;
    }
    return count;
  }

  private evictOldest(endpoint: TradingViewEndpoint): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, conn] of this.connections.entries()) {
      if (conn.endpoint === endpoint && conn.refCount === 0) {
        if (conn.lastUsed < oldestTime) {
          oldestTime = conn.lastUsed;
          oldestKey = key;
        }
      }
    }

    if (oldestKey) {
      const pooled = this.connections.get(oldestKey);
      if (pooled) {
        pooled.connection.close().catch(() => {});
        this.connections.delete(oldestKey);
        if (this.debug) {
          logger.debug("Pool: evicted idle connection", { endpoint });
        }
      }
    }
  }

  private async createConnection(endpoint: TradingViewEndpoint): Promise<TVConnection> {
    return connect({
      credentials: this.credentials,
      endpoint,
      timeoutMs: this.timeoutMs,
      debug: this.debug,
    });
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupIntervalMs ?? 10000);
  }

  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, conn] of this.connections.entries()) {
      const idle = now - conn.lastUsed;
      const isStale = idle > this.keepAliveMs;
      const isDisconnected = !conn.connection.isConnected();

      if ((isStale || isDisconnected) && conn.refCount === 0) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      const pooled = this.connections.get(key);
      if (pooled) {
        pooled.connection.close().catch(() => {});
        this.connections.delete(key);
        if (this.debug) {
          logger.debug("Pool: cleaned up stale connection", { endpoint: pooled.endpoint });
        }
      }
    }
  }

  private setupShutdownHooks(): void {
    const cleanup = () => {
      this.closeAll().catch(() => {});
    };

    // Node.js exit events
    process.on("beforeexit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }
}
