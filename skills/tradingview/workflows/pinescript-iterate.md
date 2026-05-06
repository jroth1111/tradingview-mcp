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
6. **Persist** the working version (closes the iterate loop):
   - **Autosave draft** during iteration: `POST /v1/pine/save { "mode":"new_draft", "source":"..." }` first, then `POST /v1/pine/save { "mode":"next_draft", "id":"USER;<draftId>", "source":"..." }` on each subsequent edit.
   - **Promote draft to a saved script** when the run is correct: `POST /v1/pine/save { "mode":"new", "name":"...", "source":"..." }`. The response carries `scriptIdPart` (the `pineId`) and `version`.
   - **Bump versions** of an already-saved script: `POST /v1/pine/save { "mode":"next", "id":"USER;<id>", "source":"...", "allowCreateNew": true }`.
   - **Optional publish** once stable: `POST /v1/pine/publish { "mode":"new", "source":"...", "access":"open", "extra": {...} }`. See `save-pine-script.md`.
   - **Cleanup**: drop a stale draft with `POST /v1/pine/delete { "id":"USER;<draftId>" }`. Rename in place with `POST /v1/pine/rename { "id":"USER;<id>", "name":"..." }`.
7. Report: compile status, runtime warnings, plot summary, persisted `pineId` + `version`, and any source/plan caveats.

Tips:
- `mode:"light"` (`translate_light`) returns metaInfo only — useful for fast syntactic checks of an existing `pine_id`.
- `category:"validation"` with `details.errors[]` means Pine compile error. Surface verbatim with line/column; do not paraphrase. The Worker flattens TV's `{success:false, reason2:{errors:[{start:{line,column},message}]}}` envelope into `errors:[{message,line,column}]`.
- `category:"upstream"` with `details.upstreamReason:"plan_required"` means a Pine feature (e.g., `request.security` deep history) needs a higher TV plan.
- `POST /v1/pine/parse-title { "source": "..." }` returns `{title, shortTitle, scriptKind}` so you can sanity-check the script header without compiling.
- `POST /v1/pine/convert { "source": "...", "version_to": "6" }` upgrades v4→v5 / v5→v6. Use after a fresh write before the first compile if you need a newer dialect.
- To save the working version, run `save-pine-script.md`.

Reference: `reference/pinescript.md`, `reference/wire-formats.md`.
