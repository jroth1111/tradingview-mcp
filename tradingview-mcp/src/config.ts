// Configuration management for TradingView MCP

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TVCredentials, TradingViewEndpoint } from "./tv/types.js";
import { logger } from "./utils/logger.js";

export interface MCPConfig {
  credentials?: TVCredentials;
  endpoint?: TradingViewEndpoint;
  timeoutMs?: number;
  debug?: boolean;
}

const CONFIG_DIR = join(homedir(), ".tradingview-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Load configuration from file or environment
 */
export function loadConfig(): MCPConfig {
  const config: MCPConfig = {};

  // Try loading from config file
  if (existsSync(CONFIG_FILE)) {
    try {
      // Check for insecure file permissions (readable by group/others)
      const stats = statSync(CONFIG_FILE);
      if ((stats.mode & 0o077) !== 0) {
        logger.warn(`Warning: Config file has insecure permissions. Run: chmod 600 ${CONFIG_FILE}`);
      }

      const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      if (data.sessionId) {
        config.credentials = {
          sessionId: data.sessionId,
          sessionSign: data.sessionSign,
          authToken: data.authToken,
        };
      }
      if (data.endpoint) config.endpoint = data.endpoint;
      if (data.timeoutMs) config.timeoutMs = data.timeoutMs;
      if (data.debug !== undefined) config.debug = data.debug;
    } catch {
      // Ignore parse errors
    }
  }

  // Environment variables override file config
  if (process.env.TV_SESSION_ID) {
    config.credentials = {
      sessionId: process.env.TV_SESSION_ID,
      sessionSign: process.env.TV_SESSION_SIGN,
      authToken: process.env.TV_AUTH_TOKEN,
    };
  }

  if (process.env.TV_ENDPOINT) {
    config.endpoint = process.env.TV_ENDPOINT as TradingViewEndpoint;
  }

  if (process.env.TV_TIMEOUT_MS) {
    config.timeoutMs = parseInt(process.env.TV_TIMEOUT_MS);
  }

  if (process.env.TV_DEBUG === "true") {
    config.debug = true;
  }

  return config;
}

/**
 * Save credentials to config file
 */
export function saveCredentials(credentials: TVCredentials): void {
  // Ensure config directory exists with secure permissions (user-only: 700)
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  // Load existing config
  let existing: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
      // Ignore
    }
  }

  // Merge credentials
  const config = {
    ...existing,
    sessionId: credentials.sessionId,
    sessionSign: credentials.sessionSign,
    authToken: credentials.authToken,
    updatedAt: new Date().toISOString(),
  };

  // Write config with secure permissions (user read/write only: 600)
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Get config file path for user reference
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}
