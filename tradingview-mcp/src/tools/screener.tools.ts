import { z } from "zod";
import { getScannerEnumValuesFromCache, getScannerFiltersFromCache, getScannerManifestSummary } from "../tv/scanner-cache.js";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { marketSchema, positiveIntSchema } from "../utils/validators.js";
import type { ToolContext } from "./context.js";

export function registerScreenerTools(ctx: ToolContext): void {
  const { server, restClient } = ctx;

  server.tool(
    "scanner_enum_ordered",
    "Fetch ordered enum values for scanner filters (countries, sectors, exchanges, industries, ratings, etc.) from TradingView. For cached enums, use scanner_enum_values.",
    {
      ids: z.array(z.string()).min(1)
        .describe("Enum ids to fetch (e.g., [\"country\", \"exchange\", \"industry\", \"sector\"])"),
      lang: z.string().default("en").describe("Language code (default: en)"),
      labelProduct: z.string().default("screener-stock")
        .describe("Label product (default: screener-stock)"),
    },
    withErrorHandling(async ({ ids, lang, labelProduct }) => {
      try {
        const data = await restClient.scanner.getEnumOrdered({ ids, lang, labelProduct });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching scanner enums", err);
      }
    })
  );

  server.tool(
    "scanner_manifest",
    "List cached scanner label-products and markets available locally (fast, no network). Use to discover labelProduct/market combos for scanner_filters.",
    {
      manifestPath: z.string().optional()
        .describe("Override manifest path (default: data/scanner/manifest.json or SCANNER_CACHE_MANIFEST)"),
    },
    withErrorHandling(async ({ manifestPath }) => {
      try {
        const data = await getScannerManifestSummary({ manifestPath });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error reading scanner manifest cache", err);
      }
    })
  );

  server.tool(
    "scanner_filters",
    "List valid scanner filter fields from the local cache. Use pattern/fields to narrow results; use scanner_enum_values for enum items.",
    {
      labelProduct: z.string().default("screener-stock")
        .describe("Label product (e.g., screener-stock, screener-etf, screener-crypto-cex)"),
      market: marketSchema.optional().describe("Market to use (defaults to manifest first market)"),
      pattern: z.string().optional().describe("Substring match on field ids (case-insensitive)"),
      fields: z.array(z.string()).optional().describe("Exact field ids to return"),
      includeEnumValues: z.boolean().default(false).describe("Include enum values map (can be large)"),
      includeRaw: z.boolean().default(false).describe("Include raw metainfo payload"),
      summary: z.boolean().default(false).describe("Return counts only (no fields)"),
      limit: positiveIntSchema.max(5000, "Limit cannot exceed 5000").optional()
        .describe("Max fields to return (after filtering)"),
      offset: z.number().int().min(0).default(0).describe("Offset into matched fields"),
      manifestPath: z.string().optional()
        .describe("Override manifest path (default: data/scanner/manifest.json or SCANNER_CACHE_MANIFEST)"),
    },
    withErrorHandling(async ({
      labelProduct,
      market,
      pattern,
      fields,
      includeEnumValues,
      includeRaw,
      summary,
      limit,
      offset,
      manifestPath,
    }) => {
      try {
        const data = await getScannerFiltersFromCache({
          labelProduct,
          market,
          pattern,
          fields,
          includeEnumValues,
          includeRaw,
          summary,
          limit,
          offset,
          manifestPath,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error reading scanner filter cache", err);
      }
    })
  );

  server.tool(
    "scanner_enum_values",
    "Fetch enum values for scanner filters from the local cache. Use scanner_filters to discover enumIds.",
    {
      labelProduct: z.string().default("screener-stock")
        .describe("Label product (e.g., screener-stock, screener-etf, screener-crypto-cex)"),
      enumIds: z.array(z.string()).min(1).describe("Enum ids to fetch (from scanner_filters enumIds)"),
      pattern: z.string().optional().describe("Substring match on enum id/name (case-insensitive)"),
      limit: positiveIntSchema.max(5000, "Limit cannot exceed 5000").optional()
        .describe("Max values per enum to return"),
      offset: z.number().int().min(0).default(0).describe("Offset into matched enum values"),
      manifestPath: z.string().optional()
        .describe("Override manifest path (default: data/scanner/manifest.json or SCANNER_CACHE_MANIFEST)"),
    },
    withErrorHandling(async ({ labelProduct, enumIds, pattern, limit, offset, manifestPath }) => {
      try {
        const data = await getScannerEnumValuesFromCache({
          labelProduct,
          enumIds,
          pattern,
          limit,
          offset,
          manifestPath,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error reading scanner enum cache", err);
      }
    })
  );

  server.tool(
    "scanner_metainfo",
    "Fetch scanner metainfo for a market (field definitions and available columns) from TradingView. For cached fields, use scanner_filters.",
    {
      market: marketSchema.default("america").describe("Market (america, crypto, forex, etc.)"),
      labelProduct: z.string().default("screener-stock")
        .describe("Label product (default: screener-stock)"),
      payload: z.any().optional().describe("Optional POST body for metainfo"),
    },
    withErrorHandling(async ({ market, labelProduct, payload }) => {
      try {
        const data = await restClient.scanner.getMetainfo({ market, labelProduct, payload });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching scanner metainfo", err);
      }
    })
  );

  server.tool(
    "scanner_request",
    "Raw TradingView scanner request passthrough (no validation). Prefer screener_scan; responses can be large.",
    {
      path: z.string().default("america/scan")
        .describe("Path relative to https://scanner.tradingview.com (e.g., america/scan, global/scan, enum/ordered)"),
      method: z.enum(["GET", "POST"]).default("POST").describe("HTTP method"),
      query: z.record(z.any()).optional()
        .describe("Query params (e.g., { \"label-product\": \"screener-stock\" })"),
      payload: z.any().optional().describe("POST body for scanner endpoints (full raw payload, including filters/columns/sort/options)"),
    },
    withErrorHandling(async ({ path, method, query, payload }) => {
      try {
        const result = await restClient.scanner.request({
          path,
          method,
          query: query as Record<string, unknown> | undefined,
          payload,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error running scanner request", err);
      }
    })
  );

  server.tool(
    "screener_scan",
    `Find stocks matching criteria. Returns symbols + requested data columns.

Example: stocks up >5% today
  [{"left": "change", "operation": "greater", "right": 5}]

Example: price under $50 in tech sector
  [{"left": "close", "operation": "less", "right": 50},
   {"left": "sector", "operation": "equal", "right": "Technology"}]

Example: RSI oversold with high volume
  [{"left": "RSI", "operation": "less", "right": 30},
   {"left": "volume", "operation": "greater", "right": 1000000}]

Operations: greater, less, in_range (use [min,max]), equal, match.
Run scanner_filters to discover all field names.`,
    {
      market: marketSchema.default("america").describe("Market to scan (america, crypto, forex, etc.)"),
      filter: z.array(z.object({
        left: z.string().describe("Field name from scanner_filters (e.g., change, market_cap_basic, sector)"),
        operation: z.string().describe("greater, less, in_range, equal, match"),
        right: z.any().describe("Number, string, or [min, max] array for in_range"),
      })).optional().describe("Filter conditions"),
      columns: z.array(z.string()).optional().describe("Fields to return"),
      sortBy: z.string().optional().describe("Field to sort by"),
      sortOrder: z.enum(["asc", "desc"]).default("desc").describe("Sort order"),
      limit: positiveIntSchema.max(500, "Limit cannot exceed 500").default(25).describe("Max results to return"),
      labelProduct: z.string().optional().describe("Label product for schema customization (e.g., markets-earnings, calendar-ipo)"),
    },
    withErrorHandling(async ({ market, filter, columns, sortBy, sortOrder, limit, labelProduct }) => {
      try {
        const result = await restClient.scanner.scan({
          market,
          filter: filter as Array<{ left: string; operation: string; right: unknown }>,
          columns,
          sortBy,
          sortOrder,
          limit,
          labelProduct,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error running scan", err);
      }
    })
  );
}
