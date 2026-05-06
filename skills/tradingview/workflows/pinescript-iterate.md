# Pinescript iterate

Author Pine, compile, run, refine.

1. Receive the Pine source from the user.
2. **Compile**: `POST /v1/pine/compile` with `{source, mode:"full"}`. Inspect `errors[]` and `warnings[]` — each error has `start.line`/`start.column`. Fix and recompile.
3. **Resolve defaults** (optional): `POST /v1/pine/compile` with `{source, mode:"eval", inputs:{<defaults>}}` to confirm `rootValues` resolution.
4. **Run**: `POST /v1/pine/run`:
   ```json
   {
     "source": "<pine v5 or v6 source>",
     "symbol": "NASDAQ:AAPL",
     "timeframe": "1D",
     "bars": 300,
     "inputs": { "in_0": 14, "in_1": "close" }
   }
   ```
   Returns `{indicator, plots:[{plotName, type, data:[{ts, value}]}], nonseries?}`. Strategy scripts return `{report, trades, equity}` — see `backtest-strategy.md`.
5. Iterate: edit source, recompile, rerun. Keep `bars` low (200–500) until the script is correct; widen for the final run.
6. Report: compile status, runtime warnings, plot summary, and any source/plan caveats.

Tips:
- `mode:"light"` (`translate_light`) returns metaInfo only — useful for fast syntactic checks of an existing `pine_id`.
- `category:"validation"` with `details.errors[]` means Pine compile error. Surface verbatim with line/column; do not paraphrase.
- `category:"upstream"` with `details.upstreamReason:"plan_required"` means a Pine feature (e.g., `request.security` deep history) needs a higher TV plan.
- To save the working version, run `save-pine-script.md`.

Reference: `reference/pinescript.md`, `reference/wire-formats.md`.
