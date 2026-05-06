# Apply study / drawing template

List, save, and apply saved indicator panels or drawing-tool styles.

## Study templates

1. **List**: `GET /v1/study-templates` returns three buckets: `custom` (full CRUD), `standard` (ids 1–6, R/O + favorite-only), `fundamentals` (ids 12–23, R/O + favorite-only).
2. **Load**: `GET /v1/study-templates/{id}` (custom) or `GET /v1/study-templates/{id}?standard=true` (standard/fundamentals). Returns `{id, name, content, meta_info, favorite_date}`. `content` is a JSON-stringified `panes[].sources[]` graph.
3. **Apply** (caller-side): parse `content`. For each `panes[i].sources[j]`:
   - `state.id` is the indicator id (e.g., `STD;RSI`).
   - `state.inputs` is the input dict (`{in_0:14, …}`).
   - Run `POST /v1/study` with these; chain study-on-study as needed.
   The Worker does not provide a server-side apply endpoint today (deferred — needs P9 stateful chart-session DO).
4. **Save**:
   ```json
   POST /v1/study-templates
   { "name":"My RSI panel",
     "content":"{\"panes\":[{\"sources\":[{\"type\":\"Study\",\"state\":{\"id\":\"STD;RSI\",\"inputs\":{\"in_0\":14}},\"zorder\":1}]}]}",
     "meta_info":{"indicators":[{"id":"STD;RSI","description":"RSI"}],"interval":"60"} }
   ```
5. **Update**: `PUT /v1/study-templates/{id}` body same as create.
6. **Rename**: `POST /v1/study-templates/{id}/rename` body `{name}`.
7. **Delete**: `DELETE /v1/study-templates/{id}`.
8. **Favorite**: `PUT /v1/study-templates/{id}/favorite` (custom) or `PUT /v1/study-templates/{id}/favorite?standard=true` (standard/fundamentals). `DELETE` to unfavorite.

## Drawing templates

1. **List** for a tool: `GET /v1/drawing-templates?tool=LineToolTrendLine` returns `[<name>, …]`.
2. **Load**: `GET /v1/drawing-templates/{tool}/{name}` returns `{content}` (parsed JSON).
3. **Save**: `POST /v1/drawing-templates` body `{tool, name, content:<object>}`. The Worker FormData-encodes upstream.
4. **Delete**: `DELETE /v1/drawing-templates/{tool}/{name}`. The Worker calls `/remove-drawing-template/` upstream as FormData POST.

`tool` is a primitive class name like `LineToolTrendLine`, `LineToolHorzLine`, `LineToolPath`, `LineToolFibSpeedResistanceFan`.

## Indicator favorites and recents

These are NOT templates — they live in TVSettings:
- `chart.favoriteLibraryIndicators` — star-marked indicators.
- `loadChartDialog.favorites` — saved chart favorites.
- `StudyTemplates.recent` — last-applied templates (capacity 5, dedup-on-add).

Read/write via `POST /v1/settings/save` (`{delta:{key:value,…}}`) and `GET /v1/settings/load` (deferred separate route family).

Caveats:
- There is no `apply_template` server envelope; the apply flow is fully client-side.
- Standard and fundamentals templates can be favorited but not edited.
- Drawing templates do not version; saving with the same `name` overwrites.

Reference: `reference/templates.md`.
