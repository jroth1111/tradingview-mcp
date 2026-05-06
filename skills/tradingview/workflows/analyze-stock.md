# Analyze Stock

Use for a balanced fundamentals, technicals, candles, and news snapshot.

1. Resolve ambiguous input to `EXCHANGE:SYMBOL` with `POST /v1/search`.
2. Fetch fundamentals with `POST /v1/fundamentals`.
3. Fetch technical summary with `POST /v1/ta` or `POST /v1/ta/summary`.
4. Fetch candles through `GET /cache/:symbol/:tf` or `POST /v1/candles`.
5. Fetch recent news with `POST /v1/news`.
6. Summarize valuation, technical stance, price action, and news catalysts. Keep correlation and trading conclusions qualified.
