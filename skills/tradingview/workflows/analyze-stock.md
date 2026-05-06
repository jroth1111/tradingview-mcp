# Analyze stock

Single-symbol research: search → candles → quotes → TA → news/fundamentals.

1. Resolve to `EXCHANGE:SYMBOL` via `POST /v1/search`. If the user wrote a bare ticker, take the first equity result that matches the exchange they implied.
2. Fetch fundamentals with `POST /v1/fundamentals` (P/E, EPS, market cap, sector).
3. Fetch TA snapshot via `POST /v1/ta`. For a single-line summary, `POST /v1/ta/summary`.
4. Fetch recent candles. Prefer `GET /cache/{symbol}/{tf}` if cached; otherwise `POST /v1/candles` with `bars: 200, timeframe: "1D"` for context.
5. Fetch live quote via `POST /v1/quotes`.
6. Pull recent news via `POST /v1/news` (limit 5–10) and optionally hydrate one with `POST /v1/news/content`.
7. Pull next earnings/dividend dates via `POST /v1/calendar/earnings` and `POST /v1/calendar/dividends`.
8. Summarise valuation, technical stance, price action, and catalysts. Qualify any forward-looking claim. Preserve `authSource` if the deep history step required it.

Reference: `reference/endpoints.md`. For deeper TA, jump to `indicator-evaluate.md`.
