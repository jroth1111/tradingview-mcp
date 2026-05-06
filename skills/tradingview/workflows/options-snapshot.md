# Options snapshot

Capture an option chain via quote-batched calls.

1. Resolve underlying with `POST /v1/search` (e.g., `AAPL` → `NASDAQ:AAPL`).
2. Build option symbols: `EXCHANGE:UNDERLYING<YYMMDD><C|P><STRIKE-padded>`. Worker `/v1/quotes` accepts these natively when batched.
3. `POST /v1/quotes` with the option symbols `[]` and a tight `fields` list (`bid`, `ask`, `last`, `volume`, `open_interest`, `iv`, `delta`, `gamma`, `theta`, `vega`).
4. For multi-expiry chains, batch one expiry at a time to keep request size bounded; expect `category:"rate_limit"` if you fan out aggressively.
5. Summarise: ATM strike + IV, top-volume strikes, max-pain estimate, skew if both wings sampled.

Caveats: TradingView option data quality varies by exchange. US equity options are reliable; FX and futures options are sparse. Report the data window if `last` is stale.

Reference: `reference/endpoints.md`.
