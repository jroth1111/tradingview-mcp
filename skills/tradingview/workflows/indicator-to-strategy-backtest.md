# Indicator → strategy backtest

Convert an indicator the user likes into a strategy and backtest it.

1. Pick the indicator (built-in or public) via `list-indicators.md`. Read its inputs with `POST /v1/indicators/meta`.
2. Author a thin Pine v5 strategy that wraps the indicator's plot output:
   ```pine
   //@version=5
   strategy("Wrapper", overlay=true, initial_capital=100000)
   src = input.source(close, "Source")
   length = input.int(14, "Length")
   sig = ta.rsi(src, length)
   if ta.crossover(sig, 30)
       strategy.entry("Long", strategy.long)
   if ta.crossunder(sig, 70)
       strategy.close("Long")
   ```
3. Compile with `POST /v1/pine/compile` (`mode:"full"`). Fix any errors.
4. Backtest with `POST /v1/strategy/run` passing `source` (instead of `scriptId`):
   ```json
   { "source": "<pine>", "symbol": "...", "timeframe": "...", "bars": 2000,
     "properties": {...}, "inputs": {"in_0": "close", "in_1": 14} }
   ```
5. Report as in `backtest-strategy.md`.
6. (Optional) Save the working strategy via `save-pine-script.md` for re-use.

Tips:
- For closed-source indicators (no source available), use `backtest-closed-source.md` instead — it uses `is_auth_to_get` plus `pineId`/`pineVersion` reference.
- Keep the wrapper minimal; the goal is a backtestable signal, not a polished script.

Reference: `reference/strategies.md`, `reference/pinescript.md`.
