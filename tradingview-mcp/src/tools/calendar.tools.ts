import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { daysAheadSchema, daysBackSchema } from "../utils/validators.js";
import type { ToolContext } from "./context.js";

export function registerCalendarTools(ctx: ToolContext): void {
  const { server, restClient } = ctx;

  server.tool(
    "calendar_earnings",
    `Get upcoming earnings releases. Returns all earnings for the date range.

Note: Returns market-wide data. To check specific symbols, filter the response by symbol field, or use fundamentals_get for individual stocks.

Keep date window small (default 7 days ahead, 3 back).`,
    {
      daysAhead: daysAheadSchema.default(7).describe("Days ahead to look"),
      daysBack: daysBackSchema.default(3).describe("Days back to include"),
      markets: z.array(z.string()).optional().describe("Filter by markets (e.g., [\"america\"])"),
    },
    withErrorHandling(async ({ daysAhead, daysBack, markets }) => {
      if (daysAhead + daysBack > 365) {
        throw McpError.invalidParams("Date range too large (daysAhead + daysBack must be <= 365)", {
          daysAhead,
          daysBack,
        });
      }

      try {
        const earnings = await restClient.calendar.getEarnings({ daysAhead, daysBack, markets });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              dateRange: {
                from: new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0],
                to: new Date(Date.now() + daysAhead * 86400000).toISOString().split("T")[0],
              },
              count: earnings.length,
              earnings,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching earnings calendar", err);
      }
    })
  );

  server.tool(
    "calendar_dividends",
    "Get upcoming dividend ex-dates and payment dates. Keep the date window small.",
    {
      daysAhead: daysAheadSchema.default(7).describe("Days ahead to look"),
      daysBack: daysBackSchema.default(3).describe("Days back to include"),
      markets: z.array(z.string()).optional().describe("Filter by markets (e.g., [\"america\"])"),
    },
    withErrorHandling(async ({ daysAhead, daysBack, markets }) => {
      if (daysAhead + daysBack > 365) {
        throw McpError.invalidParams("Date range too large (daysAhead + daysBack must be <= 365)", {
          daysAhead,
          daysBack,
        });
      }

      try {
        const dividends = await restClient.calendar.getDividends({ daysAhead, daysBack, markets });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              dateRange: {
                from: new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0],
                to: new Date(Date.now() + daysAhead * 86400000).toISOString().split("T")[0],
              },
              count: dividends.length,
              dividends,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching dividend calendar", err);
      }
    })
  );
}
