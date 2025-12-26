// TradingView MCP Server - Main orchestration
// This file creates and configures the MCP server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TradingViewClient, TVRestClient } from "./tv/index.js";
import { saveCredentials, getConfigPath } from "./config.js";
import { browserLogin, isBrowserLoginAvailable } from "./utils/browser-login.js";
import { logger } from "./utils/logger.js";
import { validateSession } from "./server-helpers.js";
import { registerResources } from "./resources.js";
import { registerWorkflowPrompts } from "./tools/workflows.tools.js";
import { registerAuthTools } from "./tools/auth.tools.js";
import { registerPineScriptTools } from "./tools/pinescript.tools.js";
import { registerMarketTools } from "./tools/market.tools.js";
import { registerIndicatorTools } from "./tools/indicators.tools.js";
import { registerOptionsTools } from "./tools/options.tools.js";
import { registerScreenerTools } from "./tools/screener.tools.js";
import { registerCalendarTools } from "./tools/calendar.tools.js";
import { registerFundamentalsTools } from "./tools/fundamentals.tools.js";
import { registerBondTools } from "./tools/bonds.tools.js";
import { registerChartDataTools } from "./tools/chart-data.tools.js";
/**
 * Creates and configures the TradingView MCP server
 * @param config - Optional server configuration
 * @returns Configured McpServer instance
 */
export function createServer(config = {}) {
    const server = new McpServer({
        name: "tradingview-mcp",
        version: "1.0.0",
    });
    if (config.debug && !process.env.TV_DEBUG) {
        process.env.TV_DEBUG = "true";
    }
    // Initialize clients
    const wsClient = new TradingViewClient({
        credentials: config.credentials,
        endpoint: config.endpoint,
        timeoutMs: config.timeoutMs ?? 15000,
        debug: config.debug,
    });
    const restClient = new TVRestClient(config.credentials);
    // Credentials management
    const setCredentials = (credentials) => {
        wsClient.setCredentials(credentials);
        restClient.setCredentials(credentials);
        saveCredentials(credentials);
        config.credentials = credentials;
    };
    // Session status helper
    async function getSessionStatus() {
        const hasCredentials = !!config.credentials?.sessionId;
        const browserAvailable = await isBrowserLoginAvailable();
        let sessionValid = false;
        let username;
        let plan;
        if (hasCredentials) {
            const validation = await validateSession(config.credentials);
            sessionValid = validation.valid;
            username = validation.username;
            plan = validation.plan;
        }
        return {
            authenticated: hasCredentials && sessionValid,
            sessionValid,
            sessionId: hasCredentials ? config.credentials.sessionId.slice(0, 8) + "..." : null,
            username,
            plan,
            browserLoginAvailable: browserAvailable,
            configPath: getConfigPath(),
            hint: !hasCredentials || !sessionValid
                ? "Use auth_login tool to authenticate via browser popup"
                : undefined,
        };
    }
    // Authentication helper
    async function ensureAuthenticated() {
        const validation = await validateSession(config.credentials);
        if (validation.valid) {
            return { authenticated: true, username: validation.username, plan: validation.plan };
        }
        const browserAvailable = await isBrowserLoginAvailable();
        if (!browserAvailable) {
            return {
                authenticated: false,
                error: "Not authenticated. Browser login not available. Please run: npm install playwright && npx playwright install chromium, then try again.",
            };
        }
        logger.warn("TradingView authentication required. Opening browser for login.");
        const result = await browserLogin(logger);
        if (!result.success || !result.credentials) {
            return {
                authenticated: false,
                error: result.error || "Browser login failed",
            };
        }
        setCredentials(result.credentials);
        return {
            authenticated: true,
            username: result.username,
            plan: result.plan,
        };
    }
    // Create tool context
    const toolContext = {
        server,
        wsClient,
        restClient,
        config,
        ensureAuthenticated,
        getSessionStatus,
        setCredentials,
    };
    // Register all components
    registerResources(toolContext);
    registerWorkflowPrompts(toolContext);
    registerAuthTools(toolContext);
    registerPineScriptTools(toolContext);
    registerMarketTools(toolContext);
    registerIndicatorTools(toolContext);
    registerOptionsTools(toolContext);
    registerFundamentalsTools(toolContext);
    registerScreenerTools(toolContext);
    registerCalendarTools(toolContext);
    registerBondTools(toolContext);
    registerChartDataTools(toolContext);
    return server;
}
//# sourceMappingURL=server.js.map