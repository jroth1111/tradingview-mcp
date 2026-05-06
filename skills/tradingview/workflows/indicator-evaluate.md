# Indicator Evaluate

Use when the user wants to find, inspect, and run a TradingView indicator.

1. Resolve the symbol if needed.
2. Search indicators with `POST /v1/indicators/search`.
3. Inspect the selected indicator with `POST /v1/indicators/meta`.
4. Run it with `POST /v1/study` using a bounded count.
5. Summarize recent output values, parameters used, and whether the indicator requires private/session access.
