import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { symbolSchema, studyIdSchema, timeframeSchema, positiveIntSchema } from "../utils/validators.js";
export function registerIndicatorTools(ctx) {
    const { server, restClient, wsClient, ensureAuthenticated } = ctx;
    server.tool("indicator_search", `Search for built-in and community indicators by name.

USE THIS WHEN: User wants RSI, MACD, Bollinger, or other published indicators.
DO NOT USE FOR: User's own saved scripts (use pinescript_list instead).

RETURNS: STD;RSI (built-in) or PUB;abc123 (community) IDs.
NEXT: indicator_meta → study_execute`, {
        query: z.string().describe("Search by name (e.g., RSI, MACD, Bollinger)"),
    }, withErrorHandling(async ({ query }) => {
        try {
            const results = await restClient.indicators.search(query);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(results.slice(0, 20), null, 2),
                    }],
            };
        }
        catch (err) {
            throw McpError.internal("Error searching indicators", err);
        }
    }));
    server.tool("indicator_meta", `Get indicator's configurable inputs and plot definitions.

USE THIS WHEN: You have an indicator ID and need to know what inputs/outputs it has.

RETURNS:
- inputs: Array of {id, name, type, defval} - configurable parameters
- plots: Array of {id, title, type} - output values (plot_0, plot_1, etc.)

FOR study_execute: Use input IDs to override defaults.
FOR strategy_backtest_chained: Use plot indices to map receiver inputs.

IDENTIFYING SIGNAL PLOTS:
- Look at plot titles (e.g., "Buy Signal", "Sell Signal")
- Or run study_execute to see actual values and identify patterns`, {
        id: studyIdSchema.describe("Indicator ID (e.g., STD;RSI, PUB;abc123, USER;xyz789)"),
        version: z.string().default("last").describe("Version (default: last)"),
    }, withErrorHandling(async ({ id, version }) => {
        try {
            const meta = await restClient.indicators.getMeta(id, version);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(meta, null, 2),
                    }],
            };
        }
        catch (err) {
            throw McpError.internal("Error fetching indicator meta", err);
        }
    }));
    server.tool("study_execute", `Run an indicator and get computed values.

USE THIS WHEN:
- Running any saved indicator by ID (built-in, community, or private)
- Analyzing a closed-source indicator's output to understand its logic

DO NOT USE FOR: Testing raw PineScript code (use pinescript_draft_compile_and_run instead).

INDICATOR ID TYPES:
- STD;RSI = built-in (from indicator_search)
- PUB;abc123 = community/closed-source (from indicator_search)
- USER;xyz789 = user's saved script (from pinescript_list)

RETURNS: Array of {timestamp, plot values}.`, {
        symbol: symbolSchema.describe("Symbol (e.g., NASDAQ:AAPL)"),
        studyId: studyIdSchema.describe("Indicator ID (STD;RSI, PUB;abc123, or USER;xyz789)"),
        timeframe: timeframeSchema.default("1D").describe("Timeframe (1, 5, 15, 60, 240, 1D, 1W)"),
        inputs: z.record(z.any()).optional()
            .describe("Input overrides by id from indicator_meta (e.g., {\"in_0\": 21})"),
        count: positiveIntSchema.max(5000, "Count cannot exceed 5000").default(50)
            .describe("Data points to compute. Response shows last 20."),
    }, withErrorHandling(async ({ symbol, studyId, timeframe, inputs, count }) => {
        const auth = await ensureAuthenticated();
        if (!auth.authenticated) {
            throw McpError.authRequired("Authentication required for study execution", {
                details: auth.error,
            });
        }
        try {
            const result = await wsClient.runStudy({
                symbol,
                studyId,
                timeframe,
                inputs,
                count,
            });
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            symbol: result.symbol,
                            studyId: result.studyId,
                            timeframe,
                            count: result.data.length,
                            data: result.data.slice(-20),
                            note: result.data.length > 20
                                ? `Showing last 20 of ${result.data.length} data points`
                                : undefined,
                        }, null, 2),
                    }],
            };
        }
        catch (err) {
            throw McpError.internal("Error running study", err);
        }
    }));
}
//# sourceMappingURL=indicators.tools.js.map