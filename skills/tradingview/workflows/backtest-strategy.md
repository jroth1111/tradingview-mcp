# Backtest strategy

Run a strategy with custom properties and read the report.

1. Resolve the symbol with `POST /v1/search` if needed.
2. Pick the strategy:
   - Built-in: `STD;Supertrend Strategy`, `STD;<other>`. Find via `list-indicators.md` filtering on `extra.kind === "strategy"`.
   - Public: `Script$PUB;<hash>@tv-scripting-101!` from `pubscripts/library?type=2`.
   - Private: `USER;<id>` from `POST /v1/indicators/private`.
   - Author-supplied source: skip ahead to `indicator-to-strategy-backtest.md`.
3. Inspect inputs and properties via `POST /v1/indicators/meta`.
4. Run `POST /v1/strategy/run`:
   ```json
   {
     "symbol": "NASDAQ:AAPL",
     "timeframe": "1D",
     "bars": 2000,
     "scriptId": "STD;Supertrend Strategy",
     "properties": {
       "initial_capital": 100000,
       "default_qty_type": "percent_of_equity",
       "default_qty_value": 10,
       "commission_type": "percent",
       "commission_value": 0.1,
       "slippage": 0
     },
     "inputs": { "in_0": 3, "in_1": 10 }
   }
   ```
   Returns `{report, trades, equity, diagnostics}`. The full report and trade list live in the response — there is no separate fetch.
5. Report: `net_profit`, `profit_factor`, `max_drawdown[_percent]`, `sharpe_ratio`, `win_rate`, `total_trades`, plus assumptions (initial capital, commission, slippage). State the data window via `diagnostics.barsRequested` vs `barsReceived`.
6. For per-bar streaming, swap to `POST /v1/strategy/replay` (SSE).
7. For parameter sweeps, fan out via `POST /v1/strategy/optimize` with an `objective` and parameter grid; the Worker calls `/v1/strategy/run` per combo and aggregates.

Caveats:
- TradingView caps bars per plan; report `category:"upstream"` with `details.upstreamReason` for plan gates.
- The report is reconstructed client-side from `du.ns` arrays — the Worker does this for you. There is no `report_data` server frame.
- Strategies share the study slot; do not pretend there is a dedicated `strategy_create_session` verb.

Reference: `reference/strategies.md`, `reference/wire-formats.md`.
