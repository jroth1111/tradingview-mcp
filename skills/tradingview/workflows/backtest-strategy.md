# Backtest Strategy

Use when the user has PineScript `strategy()` code and wants validation plus performance metrics.

1. Resolve the target symbol with `POST /v1/search` if it lacks an exchange prefix.
2. Compile the PineScript through the Worker Pine endpoint when available.
3. Fix compile errors by line and column, then recompile.
4. Run the strategy backtest endpoint with symbol and timeframe.
5. Report net profit, max drawdown, win rate, profit factor, assumptions, and visible limitations.
