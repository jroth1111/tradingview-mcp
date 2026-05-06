# Screen To Idea

Use when the user asks for candidates matching market/filter criteria.

1. Use `POST /v1/scan` with the requested market, filters, columns, and limit.
2. If filters are ambiguous, inspect metadata fields with `GET /v1/meta/fundamentals` and scanner docs before guessing.
3. Shortlist the strongest candidates by the user's requested ranking, volume, or change.
4. For each shortlisted symbol, fetch TA and candles.
5. Return a concise watchlist with why each candidate survived the screen and what would invalidate it.
