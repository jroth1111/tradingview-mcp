# Screen to idea

Find candidates with the screener, then drill down on the top hits.

1. Pick a market: `stocks`, `crypto`, `forex`, `futures`. Use `GET /v1/meta/markets` if unsure.
2. Run `POST /v1/scan` with a small `filter[]` (price, volume, market cap) and a tight `range`. Keep the result set under 100 to start.
3. For sector/industry breadth, `POST /v1/markets/sector-movers` or `industry-movers`. For a top-line snapshot, `POST /v1/markets/overview`.
4. For top gainers/losers in a specific market, `POST /v1/movers` with `type: "gainers"|"losers"`.
5. For each shortlisted symbol, run `analyze-stock.md` to triangulate fundamentals + TA + news.
6. Rank by the user's stated objective (momentum, value, breakout, dividend) and present the top 3–5.

Caveats: scanner data lags realtime by 15 min on Free; report the lag if relevant. `partial:true` cache responses on the symbol drilldowns mean incomplete coverage — surface that.

Reference: `reference/endpoints.md`.
