# Indicator evaluate

Run a built-in or public indicator on a symbol and read its plot output.

1. Resolve the symbol with `POST /v1/search` if needed.
2. Find the indicator id (`STD;…` or `Script$PUB;…@tv-scripting-101!`) via `list-indicators.md`.
3. Inspect typed inputs with `GET /v1/indicators/inputs/{id}` (preferred) or `POST /v1/indicators/meta` for the raw metainfo.
4. Run with `POST /v1/study`:
   ```json
   {
     "symbol": "NASDAQ:AAPL",
     "studyId": "STD;RSI",
     "timeframe": "1D",
     "bars": 300,
     "params": { "Length": 14, "Source": "close" }
   }
   ```
   The Worker maps `params` to wire `in_*` slots via metainfo. `inputs` (raw `{in_0,…}`) is also accepted.
5. The response carries `result.plots[]` — each plot has `name`, `type`, and `data: [{ts, value}]`. Trim to the last few rows for a summary.
6. Report: indicator id + version, parameters used, recent values, any plan-gating (`category:"upstream"` with `details.upstreamReason:"plan_required"`), and the `authSource`.

Common pitfalls:
- A `source` input (`"close"`, `"open"`, etc.) needs the parent series. The Worker resolves these to `<seriesId>$<plotName>` after `create_series`.
- A `symbol` input must be sent as `{type:"symbol", value:"NASDAQ:AAPL"}` — the Worker normalises strings.
- `category:"validation"` with Pine error means the indicator failed to compile (rare for built-ins, common for public scripts).

Reference: `reference/indicators.md`, `reference/wire-formats.md`.
