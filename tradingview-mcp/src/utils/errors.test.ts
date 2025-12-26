/**
 * Tests for error handling utilities
 */

import { describe, it, expect } from "vitest";
import { McpError } from "./errors.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

describe("McpError", () => {
  describe("static factory methods", () => {
    it("creates invalidParams error", () => {
      const err = McpError.invalidParams("Invalid symbol", { field: "symbol" });
      expect(err.code).toBe(ErrorCode.InvalidParams);
      expect(err.message).toBe("Invalid symbol");
      expect(err.data).toEqual({ field: "symbol" });
    });

    it("creates invalidRequest error", () => {
      const err = McpError.invalidRequest("Bad request");
      expect(err.code).toBe(ErrorCode.InvalidRequest);
      expect(err.message).toBe("Bad request");
    });

    it("creates authRequired error", () => {
      const err = McpError.authRequired();
      expect(err.code).toBe(ErrorCode.InvalidRequest);
      expect(err.message).toBe("Authentication required");
      expect(err.data?.requiresAuth).toBe(true);
      expect(err.data?.action).toBe("Use auth_login tool to authenticate via browser popup");
    });

    it("creates sessionExpired error", () => {
      const err = McpError.sessionExpired();
      expect(err.code).toBe(ErrorCode.InvalidRequest);
      expect(err.message).toBe("Session expired or invalid");
      expect(err.data?.requiresAuth).toBe(true);
      expect(err.data?.action).toBe("Use auth_login tool to re-authenticate");
    });

    it("creates rateLimited error with retry time", () => {
      const err = McpError.rateLimited(5000);
      expect(err.code).toBe(ErrorCode.InvalidRequest);
      expect(err.message).toBe("Rate limit exceeded. Please wait before retrying.");
      expect(err.data?.retryAfterMs).toBe(5000);
    });

    it("creates rateLimited error without retry time", () => {
      const err = McpError.rateLimited();
      expect(err.code).toBe(ErrorCode.InvalidRequest);
      expect(err.data?.retryAfterMs).toBeUndefined();
    });

    it("creates notFound error", () => {
      const err = McpError.notFound("Symbol", "NASDAQ:INVALID");
      expect(err.code).toBe(ErrorCode.InvalidParams);
      expect(err.message).toBe("Symbol not found: NASDAQ:INVALID");
      expect(err.data).toEqual({ resource: "Symbol", identifier: "NASDAQ:INVALID" });
    });

    it("creates connectionFailed error", () => {
      const err = McpError.connectionFailed("wss://prodata.tradingview.com", "timeout");
      expect(err.code).toBe(ErrorCode.ConnectionClosed);
      expect(err.message).toBe("Failed to connect to wss://prodata.tradingview.com: timeout");
      expect(err.data).toEqual({ target: "wss://prodata.tradingview.com", cause: "timeout" });
    });

    it("creates timeout error", () => {
      const err = McpError.timeout("fetch candles", 15000);
      expect(err.code).toBe(ErrorCode.RequestTimeout);
      expect(err.message).toBe("fetch candles timed out after 15000ms");
      expect(err.data).toEqual({ operation: "fetch candles", timeoutMs: 15000 });
    });

    it("creates internal error", () => {
      const err = McpError.internal("Something went wrong", new Error("cause"), { extra: "data" });
      expect(err.code).toBe(ErrorCode.InternalError);
      expect(err.message).toBe("Something went wrong");
      expect(err.data).toEqual({ cause: "cause", extra: "data" });
    });

    it("sanitizes internal error cause", () => {
      const err = McpError.internal("Error", { sensitive: "password" });
      expect(err.data?.cause).toBeUndefined(); // Objects are not included
    });

    it("includes string causes in internal errors", () => {
      const err = McpError.internal("Error", "string cause");
      expect(err.data?.cause).toBe("string cause");
    });
  });

  describe("toToolResponse", () => {
    it("converts error to tool response format", () => {
      const err = McpError.invalidParams("Bad input", { field: "test" });
      const response = err.toToolResponse();

      expect(response.isError).toBe(true);
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe("text");

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Bad input");
      expect(parsed.code).toBe(ErrorCode.InvalidParams);
      expect(parsed.details.field).toBe("test");
    });

    it("handles errors without details", () => {
      const err = McpError.internal("Server error");
      const response = err.toToolResponse();

      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.error).toBe("Server error");
      expect(parsed.details).toBeUndefined();
    });
  });
});
