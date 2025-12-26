import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { expirationDateSchema, symbolWithExchangeSchema, symbolSchema } from "../utils/validators.js";
import type { ToolContext } from "./context.js";

export function registerOptionsTools(ctx: ToolContext): void {
  const { server, restClient } = ctx;

  server.tool(
    "options_greeks",
    "Get options Greeks (iv, delta, gamma, theta, vega) for a symbol. Works for optionable stocks with active options chains.",
    {
      symbol: symbolWithExchangeSchema.describe("Symbol with exchange (e.g., NASDAQ:AAPL, BINANCE:BTCUSDT)"),
    },
    withErrorHandling(async ({ symbol }) => {
      try {
        const greeks = await restClient.options.getGreeks(symbol);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(greeks, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching options Greeks", err);
      }
    })
  );

  server.tool(
    "options_volatility_chart",
    `Get implied volatility by strike price for one expiration date (the "volatility smile").

Requires:
  - symbol: EXCHANGE:SYMBOL format (e.g., "NASDAQ:AAPL")
  - expiration: YYYYMMDD format (e.g., "20260117")

To find valid expiration dates: call options_in_time_iv first — response includes available expirations.`,
    {
      symbol: symbolWithExchangeSchema.describe("EXCHANGE:SYMBOL (e.g., NASDAQ:AAPL)"),
      expiration: expirationDateSchema.describe("YYYYMMDD format (e.g., 20260117). Get from options_in_time_iv."),
      root: z.string().optional().describe("Option root symbol (defaults to ticker)"),
      xAxis: z.string().default("strikes").describe("X-axis mode (default: strikes)"),
    },
    withErrorHandling(async ({ symbol, expiration, root, xAxis }) => {
      try {
        const chart = await restClient.options.getVolatilityChart({
          symbol,
          expiration,
          root,
          xAxis,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(chart, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching options volatility chart", err);
      }
    })
  );

  server.tool(
    "options_in_time_iv",
    `Get implied volatility term structure across expirations.

Returns IV levels at different expiration dates — use this to:
1. See IV term structure (contango/backwardation)
2. Get available expiration dates for options_volatility_chart`,
    {
      symbol: symbolWithExchangeSchema.describe("EXCHANGE:SYMBOL (e.g., NASDAQ:AAPL)"),
    },
    withErrorHandling(async ({ symbol }) => {
      try {
        const iv = await restClient.options.getInTimeIV(symbol);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(iv, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching in-time IV", err);
      }
    })
  );
}
