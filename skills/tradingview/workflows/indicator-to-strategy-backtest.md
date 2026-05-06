# Indicator To Strategy Backtest

Use when converting indicator behavior into testable strategy rules.

1. Search and inspect the indicator.
2. Clarify entry, exit, stop, take-profit, sizing, and timeframe rules if not specified.
3. Write a PineScript `strategy()` that implements the clarified rules.
4. Compile and fix errors.
5. Run the backtest.
6. Report metrics and warn when private indicator source is unavailable or only plot outputs can be chained.
