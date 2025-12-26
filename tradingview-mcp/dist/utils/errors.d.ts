/**
 * MCP Error code mapping for structured error responses.
 *
 * These errors help the LLM understand failure modes and take appropriate action.
 * Using standard JSON-RPC error codes from the MCP specification.
 */
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
export type ErrorCodeValue = ErrorCode;
/**
 * Structured MCP error that can be returned to the client.
 * Includes actionable information for the LLM.
 */
export declare class McpError extends Error {
    readonly code: ErrorCodeValue;
    readonly data?: Record<string, unknown>;
    constructor(code: ErrorCodeValue, message: string, data?: Record<string, unknown>);
    /**
     * Validation failed - invalid parameters
     */
    static invalidParams(message: string, data?: Record<string, unknown>): McpError;
    /**
     * Zod validation error - extract user-friendly message
     */
    static fromZodError(error: z.ZodError): McpError;
    /**
     * Invalid request
     */
    static invalidRequest(message: string, data?: Record<string, unknown>): McpError;
    /**
     * Authentication required
     */
    static authRequired(message?: string, data?: Record<string, unknown>): McpError;
    /**
     * Session expired or invalid
     */
    static sessionExpired(data?: Record<string, unknown>): McpError;
    /**
     * Rate limit exceeded
     */
    static rateLimited(retryAfterMs?: number): McpError;
    /**
     * Resource not found (symbol, indicator, etc.)
     */
    static notFound(resource: string, identifier: string): McpError;
    /**
     * Connection failed (WebSocket, API, etc.)
     */
    static connectionFailed(target: string, cause?: string): McpError;
    /**
     * Operation timed out
     */
    static timeout(operation: string, timeoutMs: number): McpError;
    /**
     * Internal server error - generic fallback
     */
    static internal(message: string, cause?: unknown, data?: Record<string, unknown>): McpError;
    /**
     * Convert to MCP tool error response format
     */
    toToolResponse(): {
        content: Array<{
            type: "text";
            text: string;
        }>;
        isError: true;
    };
}
/**
 * Wrap a tool handler with error handling
 */
export declare function withErrorHandling<T extends unknown[], R>(handler: (...args: T) => Promise<R>): (...args: T) => Promise<R | ReturnType<McpError["toToolResponse"]>>;
//# sourceMappingURL=errors.d.ts.map