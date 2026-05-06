# Templates reference

Two distinct verified surfaces, both unimplemented in the Worker today:

- **Study templates** — saved indicator panels (custom + standard + fundamentals).
- **Drawing templates** — saved drawing-tool styling (per tool class).

Indicator favorites and recents are NOT a template surface — they persist via TVSettings (`/savesettings/`, `/loadsettings/`) and would need a separate `/v1/settings/{save,load}` route family.

## Study templates

Authority: `www.tradingview.com/api/v1/study-templates`. Cookie-auth.

### List shape

`GET /api/v1/study-templates` returns three buckets:

```json
{
  "custom": [ { "id": 12345, "name": "My RSI panel", "meta_info": {"indicators":[...], "interval":"60"}, "favorite_date": null }, ... ],
  "standard": [ { "id": 1, "name": "Volume Profile", "meta_info": {...}, "favorite_date": null }, ... ],   // ids 1–6, R/O + favorite-only
  "fundamentals": [ { "id": 12, "name": "Earnings", "meta_info": {...}, "favorite_date": null }, ... ]    // ids 12–23, R/O + favorite-only
}
```

`standard` and `fundamentals` are read-only — no save/rename/delete; only favorite/unfavorite.

### Item shape (by-id)

`GET /api/v1/study-templates/{id}` (or `/standard/{id}`):

```json
{
  "id": 12345,
  "name": "My RSI panel",
  "content": "{\"panes\":[{\"sources\":[{\"type\":\"Study\",\"state\":{\"id\":\"STD;RSI\",\"inputs\":{\"in_0\":14,\"in_1\":\"close\"}},\"zorder\":1}]}]}",
  "meta_info": { "indicators": [{"id":"STD;RSI","description":"Relative Strength Index"}], "interval": "60" },
  "favorite_date": null
}
```

`content` is a JSON-stringified `panes` graph mirroring charts-storage `payload`. Each `panes[].sources[]` is one indicator instance with `{type, state, zorder}` where `state` carries the indicator id and inputs.

### CRUD

| Verb | Path | Body | Use |
| --- | --- | --- | --- |
| GET | `/api/v1/study-templates` | — | List all buckets. |
| POST | `/api/v1/study-templates` | `{name, content, meta_info?}` | Create custom. |
| GET | `/api/v1/study-templates/{id}` | — | Load one. |
| GET | `/api/v1/study-templates/standard/{id}` | — | Load standard or fundamentals. |
| PUT | `/api/v1/study-templates/{id}` | `{name, content, meta_info}` | Update custom. |
| POST | `/api/v1/study-templates/{id}/rename/` | `{name}` | Rename custom. |
| DELETE | `/api/v1/study-templates/{id}` | — | Delete custom. |
| POST | `/api/v1/study-templates/{id}/favorite` | — | Mark custom favorite. |
| DELETE | `/api/v1/study-templates/{id}/favorite` | — | Unfavorite custom. |
| POST | `/api/v1/study-templates/standard/{id}/favorite` | — | Favorite standard or fundamentals. |
| DELETE | `/api/v1/study-templates/standard/{id}/favorite` | — | |

### Apply flow (client-side only)

There is no `apply_template` WebSocket envelope. The flow is:

1. GET `content`.
2. JSON.parse to get `panes[]`.
3. For each `panes[i].sources[j]`, run a `create_study` with the source's `state.id` and `state.inputs`.
4. Drop `mainSeries` sources unless they match the chart's existing main series.
5. Drop non-mainSeries line tools.

`model.applyStudyTemplate` (bundle `42910`) wraps this as an undo macro. The Worker can either:
- Return `content` raw and let the caller orchestrate.
- Provide `/v1/study-templates/{id}/apply?session=<chartSessionDOId>` that drives the create_study sequence on a stateful chart-session DO (deferred — needs P9, bead `tradingview-2v6`).

The skill default is "return raw + caller decides"; the apply route is a deferred convenience.

### Worker route mapping

| Worker route | Upstream |
| --- | --- |
| `GET /v1/study-templates` | `/api/v1/study-templates` |
| `POST /v1/study-templates` | `/api/v1/study-templates` (JSON) |
| `GET /v1/study-templates/{id}?standard=bool` | `/api/v1/study-templates/{id}` or `/standard/{id}` |
| `PUT /v1/study-templates/{id}` | `/api/v1/study-templates/{id}` |
| `DELETE /v1/study-templates/{id}` | `/api/v1/study-templates/{id}` |
| `POST /v1/study-templates/{id}/rename` | `/api/v1/study-templates/{id}/rename/` |
| `PUT /v1/study-templates/{id}/favorite?standard=bool` | `/api/v1/study-templates/{id}/favorite` or `/standard/{id}/favorite` |
| `DELETE /v1/study-templates/{id}/favorite?standard=bool` | same DELETE |

## Drawing templates

Authority: `www.tradingview.com`. Cookie-auth. Distinct from `line-tools-storage` (which is realtime drawing sync, not templates).

### Surface

| Method | Path | Body | Use |
| --- | --- | --- | --- |
| GET | `/drawing-templates/{tool}/` | — | List template names for a tool. |
| GET | `/drawing-template/{tool}/?templateName={name}` | — | Load one (returns `{content}`). |
| POST | `/save-drawing-template/` | FormData `{tool, name, content}` | Save (overwrites by name). |
| POST | `/remove-drawing-template/` | FormData `{tool, name}` | Delete. |

`tool` is a primitive class name like `LineToolTrendLine`, `LineToolHorzLine`, `LineToolPath`, `LineToolFibSpeedResistanceFan`. The full enum lives in bundle `chart-canvas-engine`.

`content` is a JSON-serialized state object specific to the tool. Worker accepts JSON over the wire and FormData-encodes upstream.

### Worker route mapping

| Worker route | Upstream | Encoding |
| --- | --- | --- |
| `GET /v1/drawing-templates?tool=<tool>` | `/drawing-templates/{tool}/` | passthrough |
| `GET /v1/drawing-templates/{tool}/{name}` | `/drawing-template/{tool}/?templateName={name}` | passthrough; parse `content` |
| `POST /v1/drawing-templates` | `/save-drawing-template/` | JSON in → FormData out |
| `DELETE /v1/drawing-templates/{tool}/{name}` | `/remove-drawing-template/` | DELETE in → FormData POST out |

## Indicator favorites and recents (NOT templates)

TVSettings keys watched by the chart:

| Key | Meaning |
| --- | --- |
| `chart.favoriteLibraryIndicators` | Star-marked indicators in the panel. |
| `chart.favoriteDrawings` | Drawing tool favorites. |
| `chart.favoriteDrawingsPosition` | Position of favorites toolbar. |
| `loadChartDialog.favorites` | Saved chart favorites. |
| `StudyTemplates.recent` | Last-applied study templates (capacity 5, dedup-on-add). |

Surface:

- Anonymous: `TVLocalStorage` — browser-local only, not portable.
- Authenticated: batched `POST /savesettings/` FormData `delta=JSON.stringify({k:v})`, fired via `sendBeacon` on unload. Read via `GET /loadsettings/`.

Out of scope for `/v1/study-templates`. Would need a `/v1/settings/{save,load}` route family.

## Out of scope

- No share / import endpoint observed. Templates are per-user; cross-user sharing is via copy/paste of `content` JSON.
- No template tagging or category in API.
- No bulk export (callers can call list + by-id N times).

## Diagnostic probes

```bash
# List all templates
curl -s -b "$COOKIE" https://www.tradingview.com/api/v1/study-templates | jq 'keys, .standard|length'
# Expect: ["custom","fundamentals","standard"], standard=6.

# Round-trip create / rename / favorite / delete
curl -s -b "$COOKIE" -H 'Content-Type: application/json' -X POST \
  -d '{"name":"probe","content":"{\"panes\":[]}","meta_info":{"indicators":[]}}' \
  https://www.tradingview.com/api/v1/study-templates | tee /tmp/tpl.json
ID=$(jq -r '.r.id // .id' /tmp/tpl.json)
curl -s -b "$COOKIE" -H 'Content-Type: application/json' -X POST \
  -d '{"name":"probe2"}' "https://www.tradingview.com/api/v1/study-templates/${ID}/rename/"
curl -s -b "$COOKIE" -X POST  "https://www.tradingview.com/api/v1/study-templates/${ID}/favorite"
curl -s -b "$COOKIE" -X DELETE "https://www.tradingview.com/api/v1/study-templates/${ID}"

# Drawing templates list
curl -s -b "$COOKIE" https://www.tradingview.com/drawing-templates/LineToolTrendLine/
curl -s -b "$COOKIE" "https://www.tradingview.com/drawing-template/LineToolTrendLine/?templateName=Default"
```
