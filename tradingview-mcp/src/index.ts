#!/usr/bin/env node

// CLI for TradingView MCP configuration

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { browserLogin, isBrowserLoginAvailable } from "./utils/browser-login.js";
import { cli, logger } from "./utils/logger.js";

const CONFIG_DIR = join(homedir(), ".tradingview-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function validateSession(sessionId: string, sessionSign?: string): Promise<{ valid: boolean; username?: string; plan?: string }> {
  try {
    const cookies = sessionSign
      ? `sessionid=${sessionId}; sessionid_sign=${sessionSign}`
      : `sessionid=${sessionId}`;

    const resp = await fetch("https://www.tradingview.com/", {
      headers: { Cookie: cookies },
      redirect: "manual",
    });
    const text = await resp.text();

    if (!text.includes("auth_token")) {
      return { valid: false };
    }

    const username = text.match(/"username":"(.*?)"/)?.[1];
    const plan = text.match(/"pro_plan":"(.*?)"/)?.[1] || "free";

    return { valid: true, username, plan };
  } catch {
    return { valid: false };
  }
}

async function configure() {
  cli.info("\n🔧 TradingView MCP Configuration\n");
  cli.info("This will configure your TradingView session for the MCP server.\n");

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Load existing config
  let existing: Record<string, unknown> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
      if (existing.sessionId) {
        cli.info(`Current session: ${(existing.sessionId as string).slice(0, 8)}...`);
        const keepExisting = await prompt("Keep existing session? (y/n): ");
        if (keepExisting.toLowerCase() === "y") {
          cli.info("✓ Keeping existing configuration.\n");
          return;
        }
      }
    } catch {
      // Ignore
    }
  }

  // Check if browser login is available
  const browserAvailable = await isBrowserLoginAvailable();

  if (browserAvailable) {
    cli.info("🌐 Browser login is available (recommended)\n");
    const useBrowser = await prompt("Login via browser? (Y/n): ");

    if (useBrowser.toLowerCase() !== "n") {
      // Use browser login
      const result = await browserLogin(cli);

      if (result.success && result.credentials) {
        // Save config
        const config = {
          ...existing,
          sessionId: result.credentials.sessionId,
          sessionSign: result.credentials.sessionSign,
          username: result.username,
          plan: result.plan,
          updatedAt: new Date().toISOString(),
        };

        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        cli.info(`\n✓ Configuration saved to ${CONFIG_FILE}\n`);
        printClaudeCodeConfig();
        return;
      } else {
        cli.info(`\n❌ ${result.error}\n`);
        const tryManual = await prompt("Try manual cookie entry instead? (y/n): ");
        if (tryManual.toLowerCase() !== "y") {
          process.exit(1);
        }
      }
    }
  } else {
    cli.info("ℹ Browser login not available (playwright not installed)");
    cli.info("  To enable: npm install playwright && npx playwright install chromium\n");
  }

  // Manual cookie entry (fallback)
  await manualConfigure(existing);
}

async function manualConfigure(existing: Record<string, unknown>) {
  cli.info("\n📋 Manual Session Configuration\n");
  cli.info("How to get your TradingView session:\n");
  cli.info("1. Log in to TradingView in your browser");
  cli.info("2. Open Developer Tools (F12 or Cmd+Option+I)");
  cli.info("3. Go to Application → Cookies → tradingview.com");
  cli.info("4. Copy the 'sessionid' value\n");

  const sessionId = await prompt("Enter sessionid: ");
  if (!sessionId) {
    cli.info("❌ No session ID provided. Exiting.\n");
    process.exit(1);
  }

  const sessionSign = await prompt("Enter sessionid_sign (optional, press Enter to skip): ");

  cli.info("\n🔍 Validating session...");
  const validation = await validateSession(sessionId, sessionSign || undefined);

  if (!validation.valid) {
    cli.info("❌ Invalid or expired session. Please try again.\n");
    process.exit(1);
  }

  cli.info(`✓ Valid session for user: ${validation.username || "unknown"}`);
  cli.info(`  Plan: ${validation.plan}\n`);

  // Save config
  const config = {
    ...existing,
    sessionId,
    sessionSign: sessionSign || undefined,
    username: validation.username,
    plan: validation.plan,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  cli.info(`✓ Configuration saved to ${CONFIG_FILE}\n`);
  printClaudeCodeConfig();
}

function printClaudeCodeConfig() {
  cli.info("🚀 You can now use the TradingView MCP server!\n");
  cli.info("Add to your Claude Code settings (~/.claude/settings.json):\n");
  cli.info(`{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["${join(process.cwd(), "dist/index.js")}"]
    }
  }
}\n`);
}

async function status() {
  cli.info("\n📊 TradingView MCP Status\n");

  if (!existsSync(CONFIG_FILE)) {
    cli.info("❌ No configuration found.");
    cli.info(`   Run: npx tradingview-mcp configure\n`);
    return;
  }

  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));

    cli.info(`Config file: ${CONFIG_FILE}`);
    cli.info(`Session ID: ${config.sessionId?.slice(0, 8)}...`);
    cli.info(`Username: ${config.username || "unknown"}`);
    cli.info(`Plan: ${config.plan || "unknown"}`);
    cli.info(`Updated: ${config.updatedAt || "unknown"}\n`);

    if (config.sessionId) {
      cli.info("🔍 Validating session...");
      const validation = await validateSession(config.sessionId, config.sessionSign);
      if (validation.valid) {
        cli.info(`✓ Session is valid (${validation.username}, ${validation.plan})\n`);
      } else {
        cli.info("❌ Session is invalid or expired.");
        cli.info(`   Run: npx tradingview-mcp configure\n`);
      }
    }
  } catch (err) {
    cli.info(`❌ Error reading config: ${err}\n`);
  }
}

async function logout() {
  cli.info("\n🚪 Logging out from TradingView MCP\n");

  if (!existsSync(CONFIG_FILE)) {
    cli.info("ℹ No configuration found. Already logged out.\n");
    return;
  }

  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    cli.info(`Removing session for: ${config.username || "unknown"}...`);

    // Remove config file
    const { unlinkSync } = await import("node:fs");
    unlinkSync(CONFIG_FILE);

    cli.info("✓ Logged out successfully.");
    cli.info("  Session data removed from local system.\n");
    cli.info("To log in again: npx tradingview-mcp login\n");
  } catch (err) {
    cli.info(`❌ Error: ${err}\n`);
  }
}

async function quickConfigure(sessionId: string, sessionSign?: string) {
  cli.info("\n🔧 Quick Configuration\n");

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  cli.info("🔍 Validating session...");
  const validation = await validateSession(sessionId, sessionSign);

  if (!validation.valid) {
    cli.info("❌ Invalid or expired session.\n");
    process.exit(1);
  }

  cli.info(`✓ Valid session for user: ${validation.username || "unknown"}`);
  cli.info(`  Plan: ${validation.plan}\n`);

  // Save config
  const config = {
    sessionId,
    sessionSign: sessionSign || undefined,
    username: validation.username,
    plan: validation.plan,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  cli.info(`✓ Configuration saved to ${CONFIG_FILE}\n`);
}

async function quickBrowserLogin() {
  cli.info("\n🔧 Browser Login\n");

  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const result = await browserLogin(cli);

  if (!result.success || !result.credentials) {
    cli.info(`❌ ${result.error}\n`);
    process.exit(1);
  }

  // Save config
  const config = {
    sessionId: result.credentials.sessionId,
    sessionSign: result.credentials.sessionSign,
    username: result.username,
    plan: result.plan,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  cli.info(`\n✓ Configuration saved to ${CONFIG_FILE}\n`);
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "configure":
    case "config":
    case "login":
      // Check for --browser flag for direct browser login
      if (process.argv.includes("--browser")) {
        await quickBrowserLogin();
        break;
      }

      // Check for --session flag for quick config
      const sessionIdx = process.argv.indexOf("--session");
      if (sessionIdx !== -1 && process.argv[sessionIdx + 1]) {
        const sessionId = process.argv[sessionIdx + 1];
        const signIdx = process.argv.indexOf("--sign");
        const sessionSign = signIdx !== -1 ? process.argv[signIdx + 1] : undefined;
        await quickConfigure(sessionId, sessionSign);
      } else {
        await configure();
      }
      break;

    case "status":
      await status();
      break;

    case "logout":
    case "remove":
      await logout();
      break;

    case "help":
    case "--help":
    case "-h":
      cli.info(`
TradingView MCP CLI

Commands:
  login               Login to TradingView (browser popup)
  login --browser     Direct browser login (no prompts)
  login --session ID  Quick login with session cookie
  status              Check current session status
  logout              Remove stored credentials
  help                Show this help

Options:
  --browser           Open browser for login (recommended)
  --session <id>      Session cookie from browser DevTools
  --sign <sign>       Optional session signature

Examples:
  tradingview-mcp login                    # Interactive (browser if available)
  tradingview-mcp login --browser          # Direct browser popup
  tradingview-mcp login --session abc123   # Manual session cookie
  tradingview-mcp status                   # Verify session is valid
  tradingview-mcp logout                   # Remove stored credentials

Config: ~/.tradingview-mcp/config.json

Browser Login Setup:
  npm install playwright
  npx playwright install chromium
`);
      break;

    default:
      // If no command, run as MCP server
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
      const { createServer } = await import("./server.js");
      const { loadConfig } = await import("./config.js");

      const config = loadConfig();
      const server = createServer(config);
      const transport = new StdioServerTransport();
      await server.connect(transport);
  }
}

main().catch((err) => {
  if (process.argv[2]) {
    cli.error("Error:", err);
  } else {
    logger.error(
      "Error starting MCP server",
      err instanceof Error ? err.message : String(err)
    );
  }
  process.exit(1);
});
