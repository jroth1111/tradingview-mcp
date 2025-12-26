import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MCPConfig } from "../config.js";
import type { TradingViewClient, TVRestClient } from "../tv/index.js";
import type { TVCredentials } from "../tv/types.js";

export interface AuthResult {
  authenticated: boolean;
  error?: string;
  username?: string;
  plan?: string;
}

export interface SessionStatus {
  authenticated: boolean;
  sessionValid: boolean;
  sessionId: string | null;
  username?: string;
  plan?: string;
  browserLoginAvailable: boolean;
  configPath: string;
  hint?: string;
}

export interface ToolContext {
  server: McpServer;
  wsClient: TradingViewClient;
  restClient: TVRestClient;
  config: MCPConfig;
  ensureAuthenticated: () => Promise<AuthResult>;
  getSessionStatus: () => Promise<SessionStatus>;
  setCredentials: (credentials: TVCredentials) => void;
}
