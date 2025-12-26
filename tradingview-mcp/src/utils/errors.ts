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
export class McpError extends Error {
  public readonly code: ErrorCodeValue;
  public readonly data?: Record<string, unknown>;

  constructor(code: ErrorCodeValue, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }

  /**
   * Validation failed - invalid parameters
   */
  static invalidParams(message: string, data?: Record<string, unknown>): McpError {
    return new McpError(ErrorCode.InvalidParams, message, data);
  }

  /**
   * Zod validation error - extract user-friendly message
   */
  static fromZodError(error: z.ZodError): McpError {
    const issues = error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const message = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    return new McpError(ErrorCode.InvalidParams, `Validation failed: ${message}`, { issues });
  }

  /**
   * Invalid request
   */
  static invalidRequest(message: string, data?: Record<string, unknown>): McpError {
    return new McpError(ErrorCode.InvalidRequest, message, data);
  }

  /**
   * Authentication required
   */
  static authRequired(message = "Authentication required", data?: Record<string, unknown>): McpError {
    return new McpError(ErrorCode.InvalidRequest, message, {
      requiresAuth: true,
      action: "Use auth_login tool to authenticate via browser popup",
      ...data,
    });
  }

  /**
   * Session expired or invalid
   */
  static sessionExpired(data?: Record<string, unknown>): McpError {
    return new McpError(
      ErrorCode.InvalidRequest,
      "Session expired or invalid",
      {
        requiresAuth: true,
        action: "Use auth_login tool to re-authenticate",
        ...data,
      }
    );
  }

  /**
   * Rate limit exceeded
   */
  static rateLimited(retryAfterMs?: number): McpError {
    return new McpError(
      ErrorCode.InvalidRequest,
      "Rate limit exceeded. Please wait before retrying.",
      { retryAfterMs }
    );
  }

  /**
   * Resource not found (symbol, indicator, etc.)
   */
  static notFound(resource: string, identifier: string): McpError {
    return new McpError(
      ErrorCode.InvalidParams,
      `${resource} not found: ${identifier}`,
      { resource, identifier }
    );
  }

  /**
   * Connection failed (WebSocket, API, etc.)
   */
  static connectionFailed(target: string, cause?: string): McpError {
    return new McpError(
      ErrorCode.ConnectionClosed,
      `Failed to connect to ${target}${cause ? `: ${cause}` : ""}`,
      { target, cause }
    );
  }

  /**
   * Operation timed out
   */
  static timeout(operation: string, timeoutMs: number): McpError {
    return new McpError(
      ErrorCode.RequestTimeout,
      `${operation} timed out after ${timeoutMs}ms`,
      { operation, timeoutMs }
    );
  }

  /**
   * Internal server error - generic fallback
   */
  static internal(
    message: string,
    cause?: unknown,
    data?: Record<string, unknown>
  ): McpError {
    const details: Record<string, unknown> = { ...(data ?? {}) };

    // Sanitize cause to avoid leaking sensitive info
    const sanitizedCause =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : undefined;
    if (sanitizedCause) {
      details.cause = sanitizedCause;
    }

    return new McpError(
      ErrorCode.InternalError,
      message,
      Object.keys(details).length ? details : undefined
    );
  }

  /**
   * Convert to MCP tool error response format
   */
  toToolResponse(): { content: Array<{ type: "text"; text: string }>; isError: true } {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: this.message,
              code: this.code,
              ...(this.data ? { details: this.data } : {}),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Wrap a tool handler with error handling
 */
export function withErrorHandling<T extends unknown[], R>(
  handler: (...args: T) => Promise<R>
): (...args: T) => Promise<R | ReturnType<McpError["toToolResponse"]>> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof McpError) {
        return error.toToolResponse();
      }
      if (error instanceof z.ZodError) {
        return McpError.fromZodError(error).toToolResponse();
      }
      // Generic error - don't expose internals
      const message = error instanceof Error ? error.message : "Unknown error";
      return McpError.internal(message).toToolResponse();
    }
  };
}
