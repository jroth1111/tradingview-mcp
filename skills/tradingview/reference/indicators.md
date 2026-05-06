# Indicators reference

Everything an LLM needs to enumerate, type, and run an indicator on TradingView.

## Namespaces

The `id` portion of `Script$<id>@<ns>!` (or `<id>@<ns>!` for legacy basicstudies) is namespaced:

| Namespace | Source | Example | Verifiable count |
| --- | --- | --- | --- |
| `STD;` | TradingView built-in (modern) | `STD;RSI`, `STD;EMA`, `STD;Supertrend Strategy`, `STD;CDL_DOJI` | 1,520 unique IDs (144 standard, 45 candlestick, 1,332 fundamental) |
| `PUB;` | Public script published to TradingView | `Script$PUB;edfaff05350f406092874780e934f06c@tv-scripting-101!` | unbounded |
| `USER;` | User's private Pine script | `Script$USER;<id>@tv-scripting-101!` | per user |
| `tv-basicstudies` | Legacy built-ins | `RSI@tv-basicstudies-241!` | superseded by `STD;` |

Within `STD;`:

| Distribution | Count | `extra.kind` |
| --- | --- | --- |
| `standard` filter | 144 | 120 study + 23 strategy + 1 library |
| `candlestick` filter | 45 | study (pattern recognition) |
| `fundamental` filter | 1,332 | study (per-symbol fundamental fields) |
| `saved` filter | per-user | study/strategy/library |

There is no category/tag taxonomy in the API. The TV indicator browser groups client-side by name + tag heuristics. Strategies are detected via `extra.kind === "strategy"`.

## Bulk hydrate

| Path | Status | Use |
| --- | --- | --- |
| `GET /pine-facade/list?filter={standard,candlestick,fundamental,saved}` | verified | Catalog browse. |
| `GET /pine-facade/translate/{id}/{ver}` | verified | Per-indicator metainfo. |
| `GET /chart-api/pro_hash` | bundle (legacy) | Cache key for bulk basicstudies. |
| `GET /chart-api/studies_metadata` | bundle (legacy) | Bulk `tv-basicstudies` metainfo (NOT `STD;`). |
| `GET /chart-api/studies_metadata_widget` | bundle (legacy) | Same, widget flavour. |

For modern `STD;` IDs there is no bulk metainfo path. Each indicator's metadata fetches via `/pine-facade/translate/{id}/{ver}`.

## Version pinning

`/pine-facade/versions/{id}/last` returns the latest version number; `/all` returns history. `Script$<id>@tv-scripting-101!` IDs use Pine compiler version 101. `<id>@tv-basicstudies-N!` pins to basicstudies build `N` (e.g., `tv-basicstudies-241`). The Worker should resolve `last` server-side per call; never hard-code a version.

## `metaInfo.inputs[]` schema

Returned by `/pine-facade/translate/{id}/{ver}.result.metaInfo.inputs`:

```json
{
  "id": "in_0",
  "name": "Length",
  "type": "integer",
  "defval": 14,
  "minval": 1,
  "maxval": 4999,
  "step": 1,
  "options": [],
  "group": "Inputs",
  "inline": null,
  "tooltip": "...",
  "isHidden": false,
  "internalID": "calc_bars_count"
}
```

Empty / null fields omit from the JSON. `internalID` is sometimes set for special inputs (`calc_bars_count`, `max_bars_back`, etc.).

## `StudyInputType` enum (13 values)

Wire-form value of `inputs[i].type` in metainfo. Exhaustive list (bundle `55548…js` module `62806`):

| Wire form | Verbose form (eval_pine_ex source) | Notes |
| --- | --- | --- |
| `integer` | `INPUT_INTEGER` | |
| `float` | `INPUT_FLOAT` | |
| `price` | `INPUT_PRICE` | Float that respects symbol's price scale. |
| `bool` | `INPUT_BOOL` | |
| `text` | `INPUT_STRING` | |
| `text_area` | `INPUT_STRING` (multiline) | |
| `symbol` | `INPUT_SYMBOL` | Wire encoding: `{type:"symbol", value:"NASDAQ:AAPL"}`. |
| `session` | `INPUT_SESSION` | `"0930-1600"`. |
| `source` | `INPUT_SOURCE` | Wire encoding: `<seriesId>$<plotName>` once bound; aliases `"close"`/`"open"`/etc. resolve to parent series. |
| `resolution` | `INPUT_RESOLUTION` ≡ `INPUT_TIMEFRAME` | `"60"`, `"1D"`, etc. |
| `time` | `INPUT_TIME` | Unix seconds. |
| `bar_time` | `INPUT_BAR_TIME` | Aligned to bar boundary. |
| `color` | `INPUT_COLOR` | `"#rrggbb"`. |

Inputs are positional in the wire dict (`in_0`, `in_1`, …) but the metainfo keys them by `id`. The Worker should accept friendly `params: {name: value}` and map name → id via metainfo before sending.

## Plot output

`metaInfo.plots[]` describes the columns of the `du` frame's `st[].v` array:

```json
{
  "id": "plot_0",
  "type": "line" | "histogram" | "shapes" | "circles" | "arrows" | "stepline" | "ohlc" | "candles" | "background" | "fill" | "no_series",
  "title": "RSI",
  "isHidden": false
}
```

`type:"no_series"` plots are non-series outputs (e.g., strategy report aggregates). They surface in `du.params[1].<slot>.ns` rather than `st`.

## Source-input wire encoding

```text
parent series:        "sds_1$close"          ← seriesId from create_series + plot name
study-on-study:       "st2$plot_0"           ← parent study slot + plot id
fundamentals overlay: "sds_1$close"          ← still parent series; the overlay is the study itself
```

Friendly aliases the Worker should accept and rewrite:

```text
"close" → "sds_1$close"
"open"  → "sds_1$open"
"hl2"   → "sds_1$hl2"
…
```

## Strategy detection

Two ways to detect a strategy-flavoured study:

1. From metainfo: `metaInfo.is_hidden_study === false && metaInfo.is_strategy === true`.
2. From id: matches `^(Script\$)?STD;.+(Strategy|Backtest|System)$` heuristically; verify via metainfo before trusting.

Both `STD;Supertrend Strategy` and `Script$PUB;<hash>@tv-scripting-101!` strategies share the study slot (`st<n>`) — there are no dedicated strategy verbs. See `strategies.md` for property fields and the `du.ns` report payload.

## Fundamental indicators

The `fundamental` filter (1,332 entries) carries `STD;<FIELD>` IDs that map 1:1 to per-symbol fundamental fields (e.g., `STD;Earnings_Per_Share_Basic_Net`). Run them as normal `create_study` with `parent_series_id` = the symbol's `sds_<n>`. They emit one value per bar. There is no separate fundamentals API — these are studies.

## Worker mapping

| Skill route | Reads | Sends to upstream |
| --- | --- | --- |
| `GET /v1/indicators/builtin` | `/pine-facade/list?filter=…` (4 filters) | Aggregate, cache 1h. |
| `POST /v1/indicators/search` | merge `pubscripts-suggest-json` + builtin | |
| `POST /v1/indicators/meta` | `/pine-facade/translate/{id}/{ver}` | |
| `GET /v1/indicators/inputs/{id}` | metaInfo.inputs[] → typed shape | |
| `POST /v1/indicators/private` | `/pine-facade/list?filter=saved` | |
| `POST /v1/study` | chart WSS, see `wire-formats.md` | |

`/v1/study` accepts both raw `inputs:{in_0:…}` and friendly `params:{name:…}`. When both are sent, `params` wins after metainfo lookup; report which mapping was used.
