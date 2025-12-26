import { z } from "zod";
import { browserLogin, isBrowserLoginAvailable } from "../utils/browser-login.js";
import { getConfigPath } from "../config.js";
import { McpError, withErrorHandling } from "../utils/errors.js";
import type { ToolContext } from "./context.js";

export function registerAuthTools(ctx: ToolContext): void {
  const { server, getSessionStatus, setCredentials } = ctx;

  server.tool(
    "auth_configure",
    "Configure TradingView session credentials for premium data access. Follow with auth_status to verify.",
    {
      sessionId: z.string().min(1, "Session ID cannot be empty").describe("TradingView sessionid cookie value"),
      sessionSign: z.string().optional().describe("TradingView sessionid_sign cookie (optional)"),
    },
    withErrorHandling(async ({ sessionId, sessionSign }) => {
      const credentials = { sessionId, sessionSign };
      setCredentials(credentials);

      return {
        content: [{
          type: "text",
          text: `Credentials configured and saved to ${getConfigPath()}`,
        }],
      };
    })
  );

  server.tool(
    "auth_status",
    "Check current authentication status. Use after auth_login or auth_configure.",
    {},
    withErrorHandling(async () => {
      const status = await getSessionStatus();
      return {
        content: [{
          type: "text",
          text: JSON.stringify(status, null, 2),
        }],
      };
    })
  );

  server.tool(
    "auth_login",
    "Open browser popup for TradingView login. Use this when authentication is required.",
    {},
    withErrorHandling(async () => {
      const browserAvailable = await isBrowserLoginAvailable();

      if (!browserAvailable) {
        throw McpError.invalidRequest("Browser login not available. Install playwright first.", {
          instructions: [
            "Run in terminal: npm install playwright",
            "Then: npx playwright install chromium",
            "Or manually configure: tradingview-mcp login --session YOUR_SESSION",
          ],
        });
      }

      const result = await browserLogin();

      if (!result.success || !result.credentials) {
        throw McpError.authRequired("Browser login failed", {
          error: result.error,
          fallback: "Use auth_configure tool with session cookie from browser DevTools",
        });
      }

      setCredentials(result.credentials);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            username: result.username,
            plan: result.plan,
            message: "Successfully logged in to TradingView",
          }, null, 2),
        }],
      };
    })
  );
}
