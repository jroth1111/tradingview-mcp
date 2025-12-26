# TradingView MCP Server

**An MCP (Model Context Protocol) server that connects AI coding assistants (like Claude Code) to TradingView.** It enables you to develop, test, and backtest PineScript strategies, fetch market data, run technical indicators, and screen stocks—all through natural language prompts.

---

## What This Does

This server acts as a bridge between an AI coding assistant and TradingView's platform. It provides:

- **PineScript Development**: Write, compile, validate, and save PineScript indicators and strategies
- **Strategy Backtesting**: Run trading strategies and get detailed performance metrics (returns, drawdown, Sharpe ratio, etc.)
- **Market Data**: Fetch historical price data, real-time quotes, technical analysis, and news
- **Indicator Execution**: Run any TradingView indicator (RSI, MACD, custom scripts) and get computed values
- **Stock Screener**: Filter stocks by any criteria with full TradingView filter support
- **Fundamental Analysis**: Access 60+ financial fields (EPS, P/E ratios, margins, debt ratios, etc.)
- **Market Movers**: Get top gainers, losers, and volume leaders
- **Calendars**: View upcoming earnings and dividend dates

---

## Quick Start

### Prerequisites

- Node.js 18 or higher
- pnpm (recommended) or npm
- A TradingView account (free account works; some features may be limited)

### Installation

```bash
# 1. Clone and navigate to the project
cd tradingview-mcp

# 2. Install dependencies
pnpm install

# 3. Build the project
pnpm run build
```

### Adding to Claude Code

Add this MCP server to your Claude Code configuration at `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/absolute/path/to/tradingview-mcp/dist/index.js"]
    }
  }
}
```

**Replace `/absolute/path/to/tradingview-mcp/dist/index.js` with your actual path.**

Restart Claude Code after adding this configuration.

---

## Authentication

### How It Works

1. **First Use**: When you ask Claude to do something that requires authentication (like backtesting), the MCP detects no credentials
2. **Auto-Login**: A browser window automatically opens to TradingView's login page
3. **You Login**: Log in normally using your email, Google account, etc.
4. **Session Saved**: The browser closes and your credentials are saved to `~/.tradingview-mcp/config.json`
5. **Persisted**: Your session persists across restarts (typically lasts several weeks)

No manual configuration is required—everything is handled automatically.

### Manual Login (Optional)

If auto-login doesn't work, you can log in manually:

```bash
# Browser-based login (recommended)
node dist/index.js login --browser

# Manual cookie entry (advanced)
node dist/index.js login --session YOUR_SESSION_ID --sign YOUR_SESSION_SIGN
```

### Check Session Status

```bash
node dist/index.js status
```

---

## Common Use Cases

### 1. "I want to write and test a PineScript indicator"

**Flow:**
1. Write PineScript code in your editor
2. Ask Claude: "Compile this PineScript and check for errors"
3. Claude uses `pinescript_draft_compile` → you get specific line/column errors if any
4. Fix errors and repeat
5. Ask Claude: "Run this indicator and show me the output values"
6. Claude uses `pinescript_draft_compile_and_run` → you see actual computed values (e.g., RSI = 65.2)
7. Satisfied? Ask Claude: "Save this to my TradingView account" → `pinescript_create_and_save`

### 2. "I want to backtest a trading strategy"

**Flow:**
1. Write a PineScript strategy with `strategy()`, `strategy.entry()`, and `strategy.close()`
2. Ask Claude: "Compile and backtest this strategy"
3. Claude validates code and runs `strategy_backtest`
4. You get performance metrics: total return, max drawdown, win rate, Sharpe ratio, etc.
5. Adjust parameters or logic and retest
6. Happy with results? Ask Claude: "Save this strategy to TradingView"

### 3. "I want to run RSI on AAPL"

**Flow:**
1. Ask Claude: "Get RSI values for AAPL"
2. Claude searches for the RSI indicator → finds it
3. Claude runs it with default parameters → you get RSI values for recent bars

### 4. "I want to find tech stocks with P/E under 20 and earnings next week"

**Flow:**
1. Ask Claude: "Screen for tech stocks with P/E ratio under 20 and earnings in the next 7 days"
2. Claude uses `screener_scan` with appropriate filters
3. You get a list of matching stocks with relevant data

### 5. "I want to backtest a closed-source indicator"

**Flow:**
1. Ask Claude: "Help me backtest the signals from this indicator"
2. Claude uses `study_execute` to get indicator output values
3. Claude writes a "Receiver Strategy" that chains to the indicator's plots
4. Claude runs `strategy_backtest_chained` to backtest the signals

---

## Available Tools

### Authentication Tools
| Tool | Description |
|------|-------------|
| `auth_login` | Opens browser popup for login (automatic on first use) |
| `auth_configure` | Manually set session credentials |
| `auth_status` | Check if you're logged in and session validity |

### PineScript Tools
| Tool | Description |
|------|-------------|
| `pinescript_draft_compile` | Check code for errors (shows exact line/column) |
| `pinescript_draft_compile_and_run` | Test indicator and see computed values |
| `pinescript_create_and_save` | Save a new script to your TradingView account |
| `pinescript_save_version` | Update an existing script with new code |
| `pinescript_load` | Load source code of a saved script |
| `pinescript_list` | List all your saved scripts (to find IDs) |
| `pinescript_library_list` | See functions available in a Pine library |

### Strategy Tools
| Tool | Description |
|------|-------------|
| `strategy_backtest` | Backtest a trading strategy and get performance metrics |
| `strategy_backtest_chained` | Backtest using signals from another indicator (for closed-source indicators) |

### Market Data Tools
| Tool | Description |
|------|-------------|
| `market_candles` | OHLCV candlestick data (open, high, low, close, volume) |
| `market_candles_deep` | Extended historical data (40k+ bars) |
| `market_quote` | Real-time quote for a symbol |
| `market_ta` | Technical analysis summary |
| `market_news` | News headlines for a symbol |
| `market_movers` | Top gainers, losers, and volume leaders |
| `market_overview` | Top stocks by market cap, volume, etc. |

### Screener Tools
| Tool | Description |
|------|-------------|
| `screener_scan` | Custom stock screener with full filter support |
| `scanner_filters` | List available filter fields (e.g., market_cap, pe_ratio) |
| `scanner_enum_values` | Get valid values for enum filters (e.g., sectors, countries) |
| `sector_movers` | Top movers within a specific sector |

### Fundamental Data Tools
| Tool | Description |
|------|-------------|
| `fundamentals_get` | Get 60+ financial fields (revenue, EPS, P/E, margins, debt, etc.) |

### Indicator Tools
| Tool | Description |
|------|-------------|
| `indicator_search` | Find built-in or community indicators (RSI, MACD, etc.) |
| `indicator_meta` | See what inputs an indicator accepts (length, source, etc.) |
| `study_execute` | Run an indicator and get computed values |

### Calendar Tools
| Tool | Description |
|------|-------------|
| `calendar_earnings` | Upcoming earnings releases |
| `calendar_dividends` | Upcoming dividend payment dates |

### Symbol Tools
| Tool | Description |
|------|-------------|
| `symbol_search` | Find a stock's TradingView symbol ID (e.g., AAPL → NASDAQ:AAPL) |

---

## Workflow Prompts (for Complex Tasks)

For complex multi-step tasks, the MCP includes guided workflow prompts:

- `backtest-strategy`: Validate and backtest a PineScript strategy
- `analyze-stock`: Full stock analysis (fundamentals + technicals + news)
- `screen-to-idea`: Screen for stocks, then analyze top picks
- `indicator-evaluate`: Search, inspect, and run a technical indicator
- `pinescript-iterate`: Fast compile/run loop for rapid development

---

## Error Handling

When PineScript has errors, you get specific feedback:

```json
{
  "success": false,
  "errors": [{
    "message": "Could not find function 'plotshape'",
    "start": { "line": 19, "column": 1 },
    "end": { "line": 19, "column": 14 }
  }]
}
```

This tells you exactly what's wrong and where to fix it.

---

## Project Structure

```
tradingview-mcp/
├── dist/              # Compiled JavaScript output (built from src/)
├── src/               # TypeScript source code
│   ├── index.ts       # CLI entry point and MCP server
│   ├── server.ts      # MCP server with tool definitions
│   ├── config.ts      # Configuration management
│   ├── tools/         # Tool implementations (auth, market, screener, etc.)
│   ├── tv/            # TradingView protocol client
│   └── utils/         # Utilities (login, validation, etc.)
├── data/              # Cached scanner data (filters, enums, metadata)
├── scripts/           # Utility scripts (refresh scanner cache, etc.)
├── package.json       # Project configuration
├── tsconfig.json      # TypeScript configuration
└── vitest.config.ts   # Test configuration
```

---

## Development

```bash
# Install dependencies
pnpm install

# Development mode with auto-reload on file changes
pnpm run dev

# Build the project
pnpm run build

# Run tests
pnpm test

# Refresh local scanner cache (filters/enums from TradingView)
pnpm run refresh:scanner-cache

# Start the MCP server (for Claude Code)
pnpm start
```

---

## Session Persistence

Your TradingView session is stored at `~/.tradingview-mcp/config.json`:

```json
{
  "sessionId": "your_session_id",
  "sessionSign": "your_session_sign",
  "username": "your_username",
  "plan": "pro_premium",
  "updatedAt": "2024-12-24T00:00:00.000Z"
}
```

Sessions typically last several weeks. When expired, just use any tool that requires authentication and the browser will open again.

---

## MCP Server Integration

This is a standard **MCP (Model Context Protocol)** server. MCP is a protocol that enables AI assistants to connect to external tools and data sources.

### What is MCP?

**MCP (Model Context Protocol)** is an open standard that allows AI coding assistants to:
- Connect to external tools and APIs
- Access data sources securely
- Execute commands and tasks
- Interact with services through a standardized protocol

### Using with Claude Code

This MCP server works natively with **Claude Code** (Anthropic's agentic coding tool).

#### Option 1: Configuration File (Recommended)

Add the MCP server to your Claude Code configuration file at `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/absolute/path/to/tradingview-mcp/dist/index.js"]
    }
  }
}
```

**Replace `/absolute/path/to/tradingview-mcp/dist/index.js` with the actual path to the built server.**

#### Option 2: Using the Claude Code `/plugin` Command

1. Run Claude Code in your project directory
2. Use the `/plugin` command to search for and install MCP servers
3. Search for "tradingview" or add the server configuration manually

#### Verification

After configuration, restart Claude Code or run `/plugin list` to verify the server is loaded. You should see `tradingview` listed with all available tools.

### Using with Other AI Assistants

Any AI assistant that implements the MCP client protocol can use this server, including:

- **Factory Droid CLI**: Can import and use this MCP server as an external tool
- **Continue.dev**: Supports MCP for tool integration
- **Cursor**: Has MCP support for connecting to external services
- **Cline (Claude Dev)**: MCP-compatible AI coding assistant

### Using with Factory Custom Droids

Factory Droids can import and use Claude Code agents and their configured MCP tools:

1. **Import Claude Code agents to Factory**: Factory's `/droids` menu can import agents from `~/.claude/agents/` or project-specific `.claude/agents/` directories
2. **Auto-configuration**: When you import agents that use MCP tools, Factory automatically validates and maps the tools
3. **Tool validation**: Factory warns about any tools that don't have Factory equivalents, allowing you to adjust the droid configuration

For more information about Factory Droids, see [Factory Custom Droids Documentation](https://docs.factory.ai/cli/configuration/custom-droids).

### Available MCP Resources

To learn more about MCP and discover other servers:
- **[MCP Specification](https://modelcontextprotocol.io/)** - Official protocol documentation
- **[MCP Server Registry](https://registry.modelcontextprotocol.io/)** - Browse available MCP servers
- **[MCP Servers Repo](https://github.com/modelcontextprotocol/servers)** - Reference implementations and community servers

---

## FAQ

**Do I need a paid TradingView account?**
No, a free account works. Some features may have limits (like backtesting duration or data frequency).

**What data can I access without logging in?**
Some tools work without login (market movers, news, symbol search, screener with public filters). Tools requiring your account (backtesting, saving scripts, running indicators) will trigger auto-login.

**Can I use this with other AI assistants?**
Yes! This is an MCP server, which is an open protocol. Works with Claude Code natively, and any MCP-compatible assistant (Factory, Continue, Cursor, Cline, etc.).

**What's the difference between a draft and a saved script?**
- **Draft**: Compiled and tested in memory, not saved to your TradingView account
- **Saved**: Stored in your TradingView account and accessible from the TradingView website

**How do I know the MCP server is working?**
After configuration, run `/plugin list` in Claude Code. You should see `tradingview` in the MCP servers list with all available tools (auth_login, market_candles, pinescript_draft_compile, etc.).

---

## License

MIT
