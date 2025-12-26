// MCP Workflow Prompts
// All TradingView workflow prompts are defined here

import { z } from "zod";
import type { ToolContext } from "./context.js";
import {
  symbolSchema,
  timeframeSchema,
  positiveIntSchema,
  marketSchema,
} from "../utils/validators.js";

/**
 * Register all workflow prompts
 * Workflows are guided prompt templates for LLM execution
 */
export function registerWorkflowPrompts(ctx: ToolContext): void {
  const { server } = ctx;

  server.prompt(
    "backtest-strategy",
    "Validate and backtest a PineScript strategy",
    {
      script: z.string().describe("PineScript strategy source"),
      symbol: symbolSchema.describe("Symbol to backtest (exchange optional)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for backtest"),
    },
    ({ script, symbol, timeframe }) => ({
      description: "Validate and backtest a PineScript strategy.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Backtest this strategy on ${symbol} (${timeframe}).`,
              "",
              "1. pinescript_draft_compile(code) → get errors with line/column",
              "2. If errors → fix at line/column, repeat step 1",
              "3. If valid → strategy_backtest(script, symbol, timeframe)",
              "4. Report: net profit, max drawdown, win rate, profit factor",
              "",
              "PineScript:",
              script,
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "analyze-stock",
    "Full stock analysis: fundamentals + technicals + news",
    {
      symbol: symbolSchema.describe("Symbol to analyze (exchange optional)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for technical analysis"),
      newsLimit: positiveIntSchema
        .max(50, "Limit cannot exceed 50")
        .default(10)
        .describe("Number of news headlines to include"),
    },
    ({ symbol, timeframe, newsLimit }) => ({
      description: "Analyze a stock using TradingView fundamentals, TA, and news.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Analyze ${symbol} (${timeframe}).`,
              "",
              "1. If symbol lacks ':' (e.g., AAPL), call symbol_search to get EXCHANGE:SYMBOL format",
              "2. Fetch in parallel (all need EXCHANGE:SYMBOL):",
              "   - fundamentals_get(symbol) → valuation, margins, debt",
              "   - market_ta(symbol, timeframe) → buy/sell/neutral rating",
              "   - market_candles(symbol, timeframe, count=200) → price action",
              `   - market_news(symbol, limit=${newsLimit}) → headlines`,
              "3. Summarize: valuation, technical stance, key news. Stay concise.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "screen-to-idea",
    "Find trading ideas via screening, then analyze top picks",
    {
      market: marketSchema
        .default("america")
        .describe("Market to scan (e.g., america, crypto)"),
      limit: positiveIntSchema
        .max(50, "Limit cannot exceed 50")
        .default(10)
        .describe("Max candidates to scan"),
    },
    ({ market, limit }) => ({
      description: "Screen for stocks, then do quick TA on top ideas.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Find trading ideas in ${market} market.`,
              "",
              "1. If user gave filter criteria, use scanner_filters(pattern) to find exact field names",
              `2. screener_scan(market="${market}", filter=[...], limit=${limit})`,
              "   Example filter: [{left: 'change', operation: 'greater', right: 5}]",
              "3. Pick top 3 by volume or change",
              "4. For each (use EXCHANGE:SYMBOL from results):",
              "   - market_ta(symbol, timeframe)",
              "   - market_candles(symbol, timeframe, count=100)",
              "5. Summarize findings, ask if user wants deeper analysis",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "options-snapshot",
    "Get IV term structure and volatility smile for options",
    {
      symbol: symbolSchema.describe("Symbol to analyze (exchange optional)"),
      expiration: z
        .string()
        .optional()
        .describe("Expiration date (YYYYMMDD). If omitted, ask for one."),
    },
    ({ symbol, expiration }) => ({
      description: "Summarize IV term structure and smile for an options chain.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Options IV snapshot for ${symbol}.`,
              "",
              "1. If symbol lacks ':' (e.g., AAPL), call symbol_search first",
              "2. options_in_time_iv(symbol) → returns IV at each expiration + list of available dates",
              expiration
                ? `3. options_volatility_chart(symbol, expiration="${expiration}") → IV smile by strike`
                : "3. Ask user which expiration from the list, then options_volatility_chart(symbol, expiration)",
              "4. Summarize: term structure shape (contango/backwardation), skew direction (put/call)",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "indicator-evaluate",
    "Search, inspect, and run a technical indicator",
    {
      query: z.string().describe("Indicator search query (e.g., RSI, MACD)"),
      symbol: symbolSchema.describe("Symbol to analyze (exchange optional)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for study"),
      count: positiveIntSchema
        .max(200, "Count cannot exceed 200")
        .default(100)
        .describe("Number of data points (keep small for quick evaluation)"),
    },
    ({ query, symbol, timeframe, count }) => ({
      description: "Search, select, and run a TradingView indicator study.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Run "${query}" indicator on ${symbol} (${timeframe}).`,
              "",
              "1. If symbol lacks ':' (e.g., AAPL), call symbol_search first",
              `2. indicator_search("${query}") → returns [{id: 'STD;RSI', name: ...}, ...]`,
              "3. indicator_meta(id) → see inputs array (configurable params) and plots array (outputs)",
              `4. study_execute(studyId=id, symbol, timeframe, count=${count}, inputs={optional overrides})`,
              "5. Summarize last 20 values from data array, ask if tuning needed",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "indicator-to-strategy-backtest",
    "Turn an indicator into a backtestable strategy",
    {
      query: z.string().describe("Indicator search query (e.g., RSI, MACD)"),
      symbol: symbolSchema.describe("Symbol to backtest (exchange optional)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for backtest"),
      rules: z.string().optional().describe("Entry/exit rules (if omitted, ask first)"),
    },
    ({ query, symbol, timeframe, rules }) => ({
      description: "Turn an indicator into a backtestable PineScript strategy.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Create strategy from "${query}" indicator, backtest on ${symbol} (${timeframe}).`,
              "",
              "1. If symbol lacks ':' (e.g., AAPL), call symbol_search first",
              `2. indicator_search("${query}") → get indicator ID`,
              "3. indicator_meta(id) → understand inputs (params) and plots (outputs)",
              rules
                ? `4. Entry/exit rules: ${rules}`
                : "4. Ask user for entry/exit rules before coding",
              "5. Write PineScript strategy with strategy() + strategy.entry()/strategy.close()",
              "6. pinescript_draft_compile(code) → fix errors at line/column if any",
              `7. strategy_backtest(script, symbol="${symbol}", timeframe="${timeframe}") → report metrics`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "pinescript-iterate",
    "Fast compile/run loop for developing PineScript",
    {
      script: z.string().describe("PineScript source code"),
      symbol: symbolSchema
        .default("NASDAQ:AAPL")
        .describe("Symbol for execution"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for execution"),
    },
    ({ script, symbol, timeframe }) => ({
      description: "Compile quickly, fix errors, then execute a study inline.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Develop this PineScript on ${symbol} (${timeframe}).`,
              "",
              "1. pinescript_draft_compile → check for errors",
              "2. If errors, fix and repeat step 1",
              "3. pinescript_draft_compile_and_run → get plot data",
              "4. Iterate as needed, keep output concise",
              "",
              "PineScript:",
              script,
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "backtest-closed-source",
    "Backtest a closed-source/private indicator using a Receiver Strategy",
    {
      indicatorId: z.string().optional().describe("Indicator ID if known (STD;RSI, PUB;abc123, USER;xyz789)"),
      indicatorName: z.string().optional().describe("Indicator name to search for if ID unknown"),
      symbol: symbolSchema.describe("Symbol to analyze and backtest"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for analysis"),
    },
    ({ indicatorId, indicatorName, symbol, timeframe }) => ({
      description: "Backtest a closed-source indicator using a Receiver Strategy pattern.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "# Backtest Closed-Source Indicator",
              "",
              "## Context",
              `Symbol: ${symbol} | Timeframe: ${timeframe}`,
              indicatorId ? `Indicator ID: ${indicatorId}` : `Indicator to find: "${indicatorName}"`,
              "",
              "## Two Approaches",
              "",
              "### Approach A: Receiver Strategy (Recommended)",
              "Chain the indicator's plots directly to a strategy using input.source().",
              "The strategy 'listens' to the indicator's visual signals without needing its source code.",
              "",
              "### Approach B: Signal Replication",
              "Analyze the indicator's output values and write a strategy that generates",
              "equivalent buy/sell signals. Use when chaining isn't feasible.",
              "",
              "---",
              "",
              "## Approach A: Receiver Strategy",
              "",
              "### Step 1: Find the Indicator",
              indicatorId
                ? `ID provided: ${indicatorId}`
                : [
                    `- indicator_search("${indicatorName}") → find matching indicators`,
                    "- Or pinescript_list() if it's your saved script",
                    "- Note the ID format: STD;Name (built-in), PUB;hash (community), USER;hash (yours)",
                  ].join("\n"),
              "",
              "### Step 2: Get Plot Metadata",
              "```",
              "indicator_meta(id) → returns { inputs: [...], plots: [...] }",
              "```",
              "Look at plots array - each has {id, title, type}.",
              "Match plot titles to signals: 'Buy Signal' at index 0, 'Sell Signal' at index 1.",
              "If titles aren't clear, run study_execute and analyze the values.",
              "",
              "### Step 3: Write Receiver Strategy",
              "Input IDs are assigned in declaration order: first input.source() = in_0, second = in_1.",
              "```pine",
              "//@version=6",
              "strategy('Receiver Strategy', overlay=true, initial_capital=10000,",
              "         default_qty_type=strategy.percent_of_equity, default_qty_value=100)",
              "",
              "// Bridge inputs - TradingView assigns IDs in order",
              "longSource  = input.source(close, 'Long Signal Source')   // in_0",
              "shortSource = input.source(close, 'Short Signal Source')  // in_1",
              "",
              "// Signal detection (for indicators that plot value on signal, na otherwise)",
              "longTrigger  = not na(longSource) and longSource != 0",
              "shortTrigger = not na(shortSource) and shortSource != 0",
              "",
              "// Alternative: crossover mode (for continuous lines like MACD)",
              "// longTrigger  = ta.crossover(longSource, shortSource)",
              "// shortTrigger = ta.crossunder(longSource, shortSource)",
              "",
              "if longTrigger",
              "    strategy.entry('Long', strategy.long)",
              "if shortTrigger",
              "    strategy.close('Long')",
              "```",
              "",
              "### Step 4: Chain and Backtest",
              "```",
              "strategy_backtest_chained(",
              `  indicatorId="${indicatorId || 'PUB;abc123'}",`,
              "  receiverScript=<your receiver strategy code>,",
              "  inputMappings={ 'in_0': 0, 'in_1': 1 },  // Maps input.source() to plot indices",
              `  symbol="${symbol}",`,
              `  timeframe="${timeframe}"`,
              ")",
              "```",
              "The tool automatically chains the indicator to your receiver strategy.",
              "",
              "---",
              "",
              "## Approach B: Signal Replication",
              "",
              "### Step 1: Run Indicator and Capture Output",
              "```",
              `study_execute(studyId, symbol="${symbol}", timeframe="${timeframe}", count=200)`,
              "```",
              "Returns: {timestamp, plots: {plot_0: 65.2, plot_1: 30.1}}",
              "",
              "### Step 2: Analyze Signal Patterns",
              "Look at the plot values and identify the trading logic:",
              "- Thresholds: 'buy when value > 70'",
              "- Crossovers: 'buy when plot_0 crosses above plot_1'",
              "- Spikes: 'buy when value jumps from 0 to 1'",
              "",
              "### Step 3: Write Replicating Strategy",
              "```pine",
              "//@version=6",
              "strategy('Replicated Signals', overlay=true)",
              "// Replicate the indicator's calculation or use a proxy",
              "rsi_val = ta.rsi(close, 14)",
              "if ta.crossover(rsi_val, 30)",
              "    strategy.entry('Long', strategy.long)",
              "if ta.crossunder(rsi_val, 70)",
              "    strategy.close('Long')",
              "```",
              "",
              "### Step 4: Compile and Backtest",
              "```",
              "pinescript_draft_compile(code) → fix any errors",
              `strategy_backtest(script, symbol="${symbol}", timeframe="${timeframe}")`,
              "```",
              "",
              "### Step 5: Validate",
              "Compare backtest entry/exit times with original indicator signals.",
              "If they don't match, refine the signal logic and repeat.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
