import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import {
  symbolSchema,
  symbolWithExchangeSchema,
  timeframeSchema,
  marketSchema,
  positiveIntSchema,
  candleCountSchema,
  normalizeTimeframe,
} from "../utils/validators.js";
import type { ToolContext } from "./context.js";

export function registerMarketTools(ctx: ToolContext): void {
  const { server, wsClient, restClient, ensureAuthenticated } = ctx;

  server.tool(
    "market_candles",
    "Fetch OHLCV candlestick data for a symbol. Returns the most recent 50 candles; use market_candles_deep for longer history.",
    {
      symbol: symbolSchema.describe("Symbol (e.g., NASDAQ:AAPL, BINANCE:BTCUSDT)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe (1, 5, 15, 60, 1D, 1W, etc.)"),
      count: candleCountSchema.describe("Number of candles to fetch (max 20000). Response includes last 50."),
    },
    withErrorHandling(async ({ symbol, timeframe, count }) => {
      await ensureAuthenticated();

      try {
        const candles = await wsClient.getCandles({
          symbol,
          timeframe,
          amount: Math.min(count, 20000),
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              timeframe,
              count: candles.length,
              candles: candles.slice(-50),
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching candles", err);
      }
    })
  );

  server.tool(
    "market_quote",
    "Get a real-time quote snapshot for one or more symbols.",
    {
      symbols: z.array(symbolSchema).min(1).describe("Array of symbols (e.g., [\"NASDAQ:AAPL\", \"NASDAQ:TSLA\"])"),
    },
    withErrorHandling(async ({ symbols }) => {
      await ensureAuthenticated();

      try {
        const quotes = await wsClient.getQuotes(symbols);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(quotes, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching quotes", err);
      }
    })
  );

  server.tool(
    "market_ta",
    "Get TradingView technical analysis summary (buy/sell/neutral ratings). Pair with market_candles for context.",
    {
      symbol: symbolSchema.describe("Symbol (e.g., NASDAQ:AAPL)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for analysis"),
    },
    withErrorHandling(async ({ symbol, timeframe }) => {
      try {
        const summary = await restClient.ta.summary(symbol, normalizeTimeframe(timeframe));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              timeframe,
              summary,
              interpretation: interpretTA(summary),
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching TA", err);
      }
    })
  );

  server.tool(
    "symbol_search",
    `Search for trading symbols. Returns the top 20 matches with full EXCHANGE:SYMBOL format.

USE THIS WHEN: User provides ticker without exchange (e.g., "AAPL" instead of "NASDAQ:AAPL").
Many tools require EXCHANGE:SYMBOL format - this resolves the full identifier.

HOW TO TELL IF NEEDED: Symbol lacks ":" separator (AAPL needs search, NASDAQ:AAPL does not).`,
    {
      query: z.string().describe("Search query (e.g., AAPL, Bitcoin, EUR/USD)"),
      filter: z.enum(["stock", "futures", "forex", "cfd", "crypto", "index"]).optional()
        .describe("Filter by asset type"),
    },
    withErrorHandling(async ({ query, filter }) => {
      try {
        const results = await restClient.symbols.search(query, filter);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(results.slice(0, 20), null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error searching symbols", err);
      }
    })
  );

  server.tool(
    "market_news",
    "Get recent news headlines for a symbol. Use limit to control size; pair with market_ta for catalysts.",
    {
      symbol: symbolSchema.describe("Symbol (e.g., NASDAQ:AAPL)"),
      limit: positiveIntSchema.max(100, "Limit cannot exceed 100").default(10)
        .describe("Maximum number of headlines"),
    },
    withErrorHandling(async ({ symbol, limit }) => {
      try {
        const news = await restClient.news.getBySymbol(symbol, { limit });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(news, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching news", err);
      }
    })
  );

  server.tool(
    "market_movers",
    "Get top market movers (gainers, losers, or high volume stocks). Use limit to control size.",
    {
      market: marketSchema.default("america").describe("Market (america, crypto, forex, etc.)"),
      type: z.enum(["gainers", "losers", "volume"]).default("gainers").describe("Type of movers"),
      limit: positiveIntSchema.max(100, "Limit cannot exceed 100").default(10).describe("Number of results"),
    },
    withErrorHandling(async ({ market, type, limit }) => {
      try {
        const movers = await restClient.market.getMovers({ market, type, limit });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              market,
              type,
              movers,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching movers", err);
      }
    })
  );

  server.tool(
    "market_overview",
    "Get a market overview (top stocks by market cap, volume, change, price, or volatility).",
    {
      market: marketSchema.default("america").describe("Market (america, crypto, forex, etc.)"),
      sort: z.enum(["market_cap", "volume", "change", "price", "volatility"]).default("market_cap")
        .describe("Sort criteria"),
      limit: positiveIntSchema.max(100, "Limit cannot exceed 100").default(20).describe("Number of results"),
    },
    withErrorHandling(async ({ market, sort, limit }) => {
      try {
        const overview = await restClient.market.getOverview({ market, sort, limit });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              market,
              sortedBy: sort,
              stocks: overview,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching overview", err);
      }
    })
  );

  server.tool(
    "sector_movers",
    "Get top movers within a specific sector (Technology, Healthcare, Finance, etc.).",
    {
      sector: z.string().describe("Sector name (Technology, Healthcare, Finance, Energy, etc.)"),
      market: marketSchema.default("america").describe("Market"),
      type: z.enum(["gainers", "losers", "volume"]).default("gainers").describe("Type of movers"),
      limit: positiveIntSchema.max(100, "Limit cannot exceed 100").default(10).describe("Number of results"),
    },
    withErrorHandling(async ({ sector, market, type, limit }) => {
      try {
        const movers = await restClient.market.getSectorMovers({ market, sector, type, limit });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sector,
              market,
              type,
              movers,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching sector movers", err);
      }
    })
  );

  server.tool(
    "market_candles_deep",
    "Fetch extended historical candle data with pagination (up to 40k+ bars). Returns summary + last 20 candles only.",
    {
      symbol: symbolSchema.describe("Symbol (e.g., NASDAQ:AAPL)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe"),
      total: positiveIntSchema.max(40000, "Total cannot exceed 40000").default(5000)
        .describe("Desired total bars (max ~40000). Response includes summary + last 20."),
    },
    withErrorHandling(async ({ symbol, timeframe, total }) => {
      await ensureAuthenticated();

      try {
        const candles = await wsClient.getDeepCandles({
          symbol,
          timeframe,
          total: Math.min(total, 40000),
          delayMs: 100,
        });

        const closes = candles.map(c => c.close);
        const min = Math.min(...closes);
        const max = Math.max(...closes);
        const first = candles[0];
        const last = candles[candles.length - 1];

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              symbol,
              timeframe,
              totalBars: candles.length,
              dateRange: {
                from: first ? new Date(first.timestamp * 1000).toISOString() : null,
                to: last ? new Date(last.timestamp * 1000).toISOString() : null,
              },
              priceRange: { min, max },
              recentCandles: candles.slice(-20),
              note: `Fetched ${candles.length} candles. Full data available for analysis.`,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching deep candles", err);
      }
    })
  );

  server.tool(
    "symbol_details",
    "Get comprehensive symbol details panel (performance, fundamentals, options Greeks). Similar to TradingView's right-hand details panel.",
    {
      symbol: symbolWithExchangeSchema.describe("Symbol with exchange (e.g., NASDAQ:AAPL)"),
    },
    withErrorHandling(async ({ symbol }) => {
      try {
        const details = await restClient.fundamentals.getDetails(symbol);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(details, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error fetching symbol details", err);
      }
    })
  );
}

function interpretTA(summary: { All?: number; MA?: number; Other?: number }): string {
  const all = summary.All ?? 0;
  if (all >= 0.5) return "STRONG_BUY";
  if (all >= 0.1) return "BUY";
  if (all <= -0.5) return "STRONG_SELL";
  if (all <= -0.1) return "SELL";
  return "NEUTRAL";
}
