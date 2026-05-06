# TradingView wire formats

What the Worker speaks to TradingView upstream. Read this before debugging a `/v1/study`, `/v1/pine/run`, `/v1/strategy/run`, or pushstream issue.

## WebSocket framer

`data.tradingview.com`, `prodata.tradingview.com`, `widgetdata.tradingview.com`, `charts-polygon.tradingview.com` all speak the same socket.io-style framer:

```
~m~<byte_length>~m~<json_payload>
```

Multiple frames concatenate. Heartbeat: server emits `~m~<n>~m~~h~<seq>`; client echoes the same. JSON payload schema:

```json
{ "m": "<verb>", "p": [<arg0>, <arg1>, ...] }
```

`packages/tradingview-core/src/protocol.ts` is the canonical encoder/decoder.

## Auth handshake

After WSS upgrade, the first frame the client sends is:

```json
{ "m": "set_auth_token", "p": ["unauthorized_user_token" | "<auth_token-jwt>"] }
```

The auth_token JWT is minted server-side from the user's `sessionid` cookie via TradingView's chart-token endpoint. The Worker handles this in `runStudy` / `getCandles` via `connect()`.

## Chart session lifecycle

```
client → server                            server → client
chart_create_session [cs1, ""]
                                            (no ack)
resolve_symbol [cs1, sds_sym_1, "=" + JSON]
                                            symbol_resolved [cs1, sds_sym_1, {…symbolInfo}]
create_series [cs1, sds_1, s1, sds_sym_1, tf, count, ""]
                                            series_loading [s1]
                                            timescale_update [cs1, {sds_1:{s:[…bars…]}}]
                                            series_completed [s1, "streaming"]
create_study [cs1, st1, "", sds_1, "<id>@<ns>!", inputs]
                                            study_loading [st1, ""]
                                            du [cs1, {st1:{t:"", st:[…rows…]}}]   ← plot output lives here
                                            study_completed [st1, ""]
chart_delete_session [cs1]
```

`du` (data_update) is the only frame that carries plot output for a study. `study_completed` carries `[slot, turnaround]` only — empty params, no values. A worker that reads `study_completed.params[1]` for plot data will always return empty arrays.

## `create_study` (6 args, verified)

`create_study(e, t, s, n, i, o)` is encoded as `[e, t, s||"", n, i].concat(o)`:

| Idx | Name | Description |
| --- | --- | --- |
| 0 | `chart_session_id` | `cs_…` from `chart_create_session` |
| 1 | `study_slot_id` | `st<n>` minted by `makeNextStudyId` |
| 2 | `turnaround` | Versioned cookie per study; bumped on every `modify_study` |
| 3 | `parent_series_id` | `sds_<n>` for normal/overlay studies; parent **study slot** (`st<m>`) for study-on-study |
| 4 | `indicator_id_with_version` | `STD;RSI@tv-basicstudies-241!`, `Script$PUB;<hash>@tv-scripting-101!`, `Script$STD;EMA@tv-scripting-101!` |
| 5… | `inputs` | `{in_0: v, in_1: v, …}` open dict; `__fast_calc`, `__profile` reserved; symbol-typed wrap as `{type:"symbol", value:"NASDAQ:AAPL"}`; source-typed encode as `<seriesId>$<plotName>`; `extra_metainfo` for fundamentals/Pine merges into the same dict. |

Wrong shape (3-arg) currently used by the Worker:

```ts
connection.send("create_study", [
  chartSession,
  req.studyId,                              // wrong slot
  JSON.stringify({ script, inputs }),       // wrong: not a JSON blob
]);
```

Correct shape:

```ts
connection.send("chart_create_session", [chartSession, ""]);
connection.send("resolve_symbol", [
  chartSession, "sds_sym_1",
  "=" + JSON.stringify({ symbol: req.symbol, adjustment: "splits" }),
]);
connection.send("create_series", [
  chartSession, "sds_1", "s1", "sds_sym_1",
  timeframe, bars, "",
]);
connection.send("create_study", [
  chartSession,
  "st1",                                  // study_slot_id
  "",                                     // turnaround
  "sds_1",                                // parent_series_id
  `${indicatorId}@${namespace}!`,         // e.g. STD;RSI@tv-basicstudies-241!
  resolvedInputs,                         // {in_0: …, in_1: …}
]);
```

## `modify_study` (5 args)

`[chart_session_id, study_slot_id, turnaround, indicator_id_with_version, inputs]`. Bump `turnaround` each call. Client debounces 500ms before sending; the server accepts unbatched.

## `du` accumulator

The `du` frame:

```json
{ "m": "du", "p": [
  "cs1",
  {
    "st1": {
      "t": "<turnaround>",
      "st": [
        { "i": <bar_index>, "v": [<v0>, <v1>, …] },
        …
      ],
      "ns": { "ks": [...non-series outputs...] }   // optional, used for strategy reports
    }
  }
] }
```

`st[].v` is positional matching `metaInfo.plots[]` order. Map index → plot name from metainfo. For strategies, `ns` carries the report payload (equity arrays, summary fields).

## Source-typed input encoding

When `metaInfo.inputs[i].type === "source"`, the wire form is `<seriesId>$<plotName>` once a series is bound. Friendly aliases (`"close"`, `"open"`, `"high"`, `"low"`, `"hl2"`, `"hlc3"`, `"ohlc4"`, `"volume"`) refer to the parent series. The Worker resolves friendly aliases to `<sds_1>$<plot>` before sending. For study-on-study (`parent` is another study slot), bind to `<stN>$<plotName>` from the parent's metainfo.

## Symbol-typed input encoding

`{type: "symbol", value: "NASDAQ:AAPL"}` (object form on the wire). String "NASDAQ:AAPL" is rejected by some indicator versions. The Worker normalizes to the object form.

## Resolution / timeframe codes

`1`, `5`, `15`, `60` (minutes), `1D`, `1W`, `1M` (calendar), `1S`, `5S`, `30S` (seconds; plan-gated). Aliases `INPUT_TIMEFRAME` ≡ `INPUT_RESOLUTION` in pine-facade source descriptors.

## Pushstream framer

`wss://pushstream.tradingview.com/message-pipe-ws/private_<TOKEN>` — alert delivery WebSocket. Frame:

```json
{ "id": <number>, "channel": "<channel>", "text": "<json-string>" }
```

- `id <= -2` — channel removed.
- `id > 0` — payload follows. Decode `text` as JSON to get `{m: "<event>", p: <data>}`.

Events: `alerts_created`, `alerts_updated`, `alerts_deleted`, `alert_fired`, `fires_deleted`. Reconnect = drain `/get_offline_fires` + `/get_offline_fire_controls`, then resume the WSS.

`alerts.tradingview.com/alerts/health/` is a legacy healthcheck only — it does not deliver fires.

## Frame catalog (server → client)

Decoded by the Worker today: `timescale_update`, `series_completed`, `series_loading`, `symbol_resolved`, `symbol_error`, `qsd`, `quote_completed`, `study_completed`, `study_error`, `replay_*` subset.

Should be decoded but currently ignored: `du` / `data_update`, `study_loading`, `tickmark_update`, `index_update`, `clear_data`, `series_error`, `studies_metadata`, `protocol_error`, `protocol_switched`, `critical_error`, `replay_data_end`, `replay_depth`, `replay_resolutions`, `replay_instance_id`, `replay_point`.

## Studied verbs that the Worker should but does not send

`modify_series`, `remove_series`, `series_timeframe`, `request_more_tickmarks`, `request_studies_metadata`, `request_data_problems`, `modify_study`, `notify_study`, `remove_study`, `set_data_quality`, `switch_timezone`, `set_future_tickmarks_mode`, `set_broker`, `replay_remove_series`, `replay_start`/`stop`/`step`/`set_resolution`/`get_depth`/`delete_session`, `create_pointset`/`modify_pointset`/`remove_pointset`, `get_first_bar_time`.

Per-verb wire formats are documented in the `recon/INDICATOR-RECON-2026-05-07.md` archive.
