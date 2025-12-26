import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { positiveIntSchema } from "../utils/validators.js";
import type { ToolContext } from "./context.js";
import type { ScanFilter } from "../tv/types.js";

export function registerBondTools(ctx: ToolContext): void {
  const { server, restClient } = ctx;

  server.tool(
    "bond_scan",
    "Scan bonds using TradingView's bond scanner. Note: Limited columns available (name, description, close, change).",
    {
      filter: z.array(z.object({
        left: z.string(),
        operation: z.enum(["greater", "less", "equal", "in_range", "not_equal"]),
        right: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
      })).optional().describe("Filter conditions for the bond scan"),
      columns: z.array(z.string()).optional().describe("Columns to return (valid: name, description, close, change)"),
      sortBy: z.string().optional().describe("Field to sort by (e.g., 'close', 'change')"),
      sortOrder: z.enum(["asc", "desc"]).default("desc").describe("Sort order"),
      limit: positiveIntSchema.max(500, "Limit cannot exceed 500").default(100)
        .describe("Maximum number of results"),
    },
    withErrorHandling(async ({ filter, columns, sortBy, sortOrder, limit }) => {
      try {
        const result = await restClient.bonds.scan({
          filter: filter as ScanFilter[],
          columns,
          sortBy,
          sortOrder,
          limit,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: result.count,
              bonds: result.data,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error scanning bonds", err);
      }
    })
  );

  server.tool(
    "bond_market_overview",
    "Get bond market overview - top bonds by price or change. Note: Limited sorting due to bond scanner constraints.",
    {
      sort: z.enum(["close", "change"]).default("close")
        .describe("Sort criteria (close or change)"),
      limit: positiveIntSchema.max(100, "Limit cannot exceed 100").default(20)
        .describe("Number of results"),
    },
    withErrorHandling(async ({ sort, limit }) => {
      try {
        const bonds = await restClient.bonds.getOverview({ sort, limit });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sortedBy: sort,
              bonds,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching bond market overview", err);
      }
    })
  );
}
