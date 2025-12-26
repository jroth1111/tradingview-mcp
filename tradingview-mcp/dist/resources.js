// MCP Resource Definitions
// All TradingView MCP resources are defined here
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfigPath } from "./config.js";
import { symbolSchema, symbolWithExchangeSchema, timeframeSchema, positiveIntSchema, normalizeTimeframe, } from "./utils/validators.js";
import { resourceJson, getTemplateVariable, parseWithSchema, } from "./server-helpers.js";
/**
 * Register all MCP resources
 * Resources are static data endpoints accessible via MCP
 */
export function registerResources(ctx) {
    const { server, restClient, config, getSessionStatus } = ctx;
    server.resource("config", "tradingview://config", {
        description: "Current TradingView MCP config (sanitized).",
        mimeType: "application/json",
    }, async (uri) => resourceJson(uri, {
        endpoint: config.endpoint ?? "prodata",
        timeoutMs: config.timeoutMs ?? 15000,
        debug: !!config.debug,
        credentials: {
            present: !!config.credentials?.sessionId,
            sessionIdPrefix: config.credentials?.sessionId
                ? `${config.credentials.sessionId.slice(0, 8)}...`
                : null,
            sessionSignPresent: !!config.credentials?.sessionSign,
        },
        configPath: getConfigPath(),
    }));
    server.resource("status", "tradingview://status", {
        description: "Authentication status and session validity.",
        mimeType: "application/json",
    }, async (uri) => resourceJson(uri, await getSessionStatus()));
    server.resource("workflows", "tradingview://workflows", {
        description: "Available workflow recipes (concise steps).",
        mimeType: "application/json",
    }, async (uri) => resourceJson(uri, {
        "analyze-stock": {
            description: "Balanced fundamentals + TA + news snapshot.",
            steps: [
                "If symbol is ambiguous, run symbol_search to pick exchange-prefixed symbol.",
                "Fetch fundamentals_get (limit fields if needed).",
                "Fetch market_ta + market_candles (count ~200).",
                "Fetch market_news with a small limit (e.g., 5-10).",
                "Summarize and ask if deeper analysis is needed.",
            ],
        },
        "backtest-strategy": {
            description: "Validate and backtest a PineScript strategy.",
            steps: [
                "Run pinescript_draft_compile to get errors with line/column.",
                "If errors, fix at line/column and repeat until valid.",
                "Run strategy_backtest with chosen symbol/timeframe.",
                "Summarize key metrics and risks.",
                "Ask before running additional tests or longer ranges.",
            ],
        },
        "screen-to-idea": {
            description: "Screen, shortlist, and quick TA on top ideas.",
            steps: [
                "Run screener_scan with basic filters and limit (use scanner_filters + scanner_enum_values if you need valid fields/enums).",
                "Select top 3-5 symbols for follow-up.",
                "Run market_ta + market_candles (count ~100) for each.",
                "Return shortlist and ask if deeper analysis/news is needed.",
            ],
        },
        "options-snapshot": {
            description: "Quick IV term structure + smile snapshot.",
            steps: [
                "Resolve symbol (symbol_search if needed).",
                "Run options_in_time_iv for term structure.",
                "Ask for expiration if missing; then run options_volatility_chart.",
                "Summarize skew/term structure and ask for deeper dive.",
            ],
        },
        "indicator-evaluate": {
            description: "Find, inspect, and run an indicator study (public or private).",
            steps: [
                "Run indicator_search to find an ID (searches STD; built-ins, PUB; community scripts, and USER; private scripts if authenticated).",
                "Use indicator_meta only if inputs/plots are needed (input ids map to study_execute.inputs).",
                "Run study_execute with a small count (<=200); inputs are plain overrides by id.",
                "Summarize last values and ask if more history is needed.",
            ],
        },
        "find-private-indicators": {
            description: "List all private/saved indicators for authenticated user.",
            steps: [
                "Ensure user is authenticated (auth_status or auth_login if needed).",
                "Run indicator_search with a broad query to find USER; prefixed IDs.",
                "Private indicators have author '@USER@' and access 'closed_source'.",
                "Use indicator_meta to get inputs/plots for a specific private indicator.",
                "Note: Private indicator source code is not accessible via API (by design).",
            ],
        },
        "pinescript-iterate": {
            description: "Fast compile/run loop for a new PineScript study.",
            steps: [
                "Run pinescript_draft_compile to surface errors fast.",
                "Iterate until compile success (reuseDraft=true).",
                "Run pinescript_draft_compile_and_run (or study_execute with script).",
                "Adjust inputs and rerun as needed.",
            ],
        },
        "indicator-to-strategy": {
            description: "Convert an indicator (public or private) into a backtestable strategy.",
            steps: [
                "Run indicator_search to identify a suitable indicator ID (STD;, PUB;, or USER; if authenticated).",
                "Use indicator_meta to get inputs/plots needed to replicate the logic.",
                "Clarify entry/exit rules and risk rules (stop/TP/position sizing).",
                "Implement strategy() in PineScript; use pinescript_draft_compile → fix errors at line/column → repeat.",
                "Run strategy_backtest and summarize key metrics.",
                "Note: For USER; private indicators, source code must be copied manually from TradingView Pine Editor.",
            ],
        },
    }));
    server.resource("symbol-ta", new ResourceTemplate("tradingview://symbol/{symbol}/ta", { list: undefined }), {
        description: "Technical analysis summary. Optional query: ?timeframe=1D",
        mimeType: "application/json",
    }, async (uri, variables) => {
        const symbolInput = getTemplateVariable(variables, "symbol");
        const symbol = parseWithSchema(symbolSchema, symbolInput, "symbol");
        const timeframeInput = uri.searchParams.get("timeframe") ?? "1D";
        const timeframe = parseWithSchema(timeframeSchema, timeframeInput, "timeframe");
        const summary = await restClient.ta.summary(symbol, normalizeTimeframe(timeframe));
        return resourceJson(uri, { symbol, timeframe, summary });
    });
    server.resource("symbol-fundamentals", new ResourceTemplate("tradingview://symbol/{symbol}/fundamentals", { list: undefined }), {
        description: "Fundamental fields. Optional query: ?fields=field1,field2",
        mimeType: "application/json",
    }, async (uri, variables) => {
        const symbolInput = getTemplateVariable(variables, "symbol");
        const symbol = parseWithSchema(symbolWithExchangeSchema, symbolInput, "symbol");
        const fieldsParam = uri.searchParams.get("fields");
        const fields = fieldsParam
            ? fieldsParam.split(",").map((field) => field.trim()).filter(Boolean)
            : undefined;
        const data = await restClient.fundamentals.get(symbol, fields?.length ? fields : undefined);
        return resourceJson(uri, data);
    });
    server.resource("symbol-news", new ResourceTemplate("tradingview://symbol/{symbol}/news", { list: undefined }), {
        description: "News headlines. Optional query: ?limit=10",
        mimeType: "application/json",
    }, async (uri, variables) => {
        const symbolInput = getTemplateVariable(variables, "symbol");
        const symbol = parseWithSchema(symbolSchema, symbolInput, "symbol");
        const limitParam = uri.searchParams.get("limit");
        const limit = limitParam
            ? parseWithSchema(positiveIntSchema.max(100, "Limit cannot exceed 100"), Number(limitParam), "limit")
            : 10;
        const news = await restClient.news.getBySymbol(symbol, { limit });
        return resourceJson(uri, { symbol, limit, news });
    });
}
//# sourceMappingURL=resources.js.map