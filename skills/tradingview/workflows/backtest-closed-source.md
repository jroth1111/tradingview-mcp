# Backtest Closed Source

Use when the strategy depends on a closed-source or private TradingView indicator.

1. Confirm the indicator can be accessed by the stored Worker session.
2. Inspect indicator metadata and plots with `POST /v1/indicators/meta`.
3. If source is unavailable, use plot outputs or user-provided rules; do not claim source-level replication.
4. Build a receiver strategy around explicit plot/signal rules.
5. Backtest and report that results depend on observed outputs and available history.
