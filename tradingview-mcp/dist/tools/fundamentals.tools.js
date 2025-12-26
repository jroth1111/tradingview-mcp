import { McpError, withErrorHandling } from "../utils/errors.js";
import { symbolWithExchangeSchema } from "../utils/validators.js";
import { z } from "zod";
export function registerFundamentalsTools(ctx) {
    const { server, restClient } = ctx;
    server.tool("fundamentals_get", `Get company financial data (valuation, growth, margins, debt).

Requires format EXCHANGE:SYMBOL (e.g., "NASDAQ:AAPL", "NYSE:WMT").
If you only have ticker, call symbol_search first to get exchange.

Common fields: price_earnings_ttm, revenue_growth, debt_to_equity, gross_margin, dividend_yield_recent.
Omit fields param to get all 60+ metrics.`, {
        symbol: symbolWithExchangeSchema.describe("EXCHANGE:SYMBOL format (e.g., NASDAQ:AAPL). Use symbol_search if exchange unknown."),
        fields: z.array(z.string()).optional().describe("Specific fields to fetch. Omit for all 60+ fields."),
    }, withErrorHandling(async ({ symbol, fields }) => {
        try {
            const data = await restClient.fundamentals.get(symbol, fields);
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify(data, null, 2),
                    }],
            };
        }
        catch (err) {
            throw McpError.internal("Error fetching fundamentals", err);
        }
    }));
}
//# sourceMappingURL=fundamentals.tools.js.map