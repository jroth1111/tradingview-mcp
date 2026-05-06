# TradingView Indicator Surface Rediscovery — Unified Report

Date: 2026-05-07. Scope: per `skills/tradingview/surface-rediscovery.md`. Authority order:
authenticated HAR `<HAR-PATH>` (gold) →
Camoufox runtime capture `/tmp/tv-recon/out/raw.json` (silver) → mined JS bundles in
`/tmp/tv-recon/bundles/` (150 files, 16 MB) → repo source `worker/`,
`packages/tradingview-core/`, `skills/tradingview/`.

This report is review-only. No code mutations were applied; numbered roadmap items
include the implementation diff but are not yet committed.

## Headline findings

1. **`/v1/study` is structurally broken end-to-end.** `runStudy` (`worker/src/tradingview.ts:811`)
   sends a 3-arg `create_study` collapsing `parent_series_id` and `inputs` into a
   single `JSON.stringify({script, inputs})` blob; the verified UI wire format is
   6 args `[chart_session, study_slot_id, turnaround, parent_series_id, indicator_id, inputs]`
   (bundle `60483.ccb82e4a2eb649a0da07.js` encoder `P`). Worker also skips
   `create_series` entirely, so the study has no parent series. Even if the
   encoding were fixed, the framing layer never decodes `du` frames — the only
   place plot output actually arrives — so `study_completed.params[1]` is
   inspected and is empty. `/v1/study` cannot return real plot data today.
   Source/agents: 12, 14, 16.

2. **Compile/run loop promised by `pinescript-iterate.md` is not wired.** The
   worker only proxies `pine-facade/list` (search) and `translate/{id}/{ver}`
   (metainfo). Compilation goes through `eval_pine_ex` (input expression
   resolution) plus `translate_source/{ver}` (full IL build); both are absent
   from the worker. Agents 03, 12, 14.

3. **Indicator inputs are not typed.** Worker exposes `metaInfo.inputs` raw via
   `getIndicatorMeta` but offers no typed contract and accepts no overrides on
   `/v1/study`. The canonical wire types
   (`integer`, `float`, `price`, `bool`, `text`, `symbol`, `session`, `source`,
   `resolution`, `time`, `bar_time`, `color`, `text_area`) come from
   `StudyInputType` in bundle `55548…js` module `62806`. `INPUT_*` is the verbose
   form used inside `eval_pine_ex` source bodies; `INPUT_TIMEFRAME` aliases
   `INPUT_RESOLUTION`. `source` inputs require runtime binding to
   `<seriesId>$<plotName>`. Agent 14.

4. **Pubscripts surface is small but the worker only wires 1 of 6.** Worker has
   `searchIndicators` calling `pubscripts-suggest-json` and merging in built-ins
   from three filters. Missing: library browse (`top|trending|editors-picks`,
   type filter, paging), batch hydrate (`/pubscripts-get/`), editors-picks list,
   personal-access (paid scripts), `/api/v1/script_packages/store/`. There is no
   rating/like/comment/by-author/by-tag endpoint — those literals are absent
   from every captured bundle. Sub-categories (oscillator/trend/volume) are
   *not* API filters; only `type` ∈ {1=indicator, 2=strategy, 3=library, all}.
   Agent 13.

5. **Indicator-driven alerts are completely uncovered.** Worker has zero alert
   routes. `pricealerts.tradingview.com` is a pure-REST cookie-authed surface
   with `/create_alert`, `/modify_restart_alert` (covers both modify and
   restart — there is no separate `/modify_alert`), `/list_alerts`,
   `/get_alerts`, `/list_fires`, `/get_offline_fires`,
   `/get_offline_fire_controls`, `/clone_alerts`, `/delete_alerts`,
   `/stop_alerts`, `/restart_alerts`, `/delete_fires{,_by_filter,_all}`,
   `/clear_offline_fires`, `/clear_offline_fire_controls`, `/is_alive`.
   Live-fire delivery uses the user's private pushstream channel:
   `wss://pushstream.tradingview.com/message-pipe-ws/private_<TOKEN>` carries
   `alerts_created/updated/deleted`, `alert_fired`, `fires_deleted` events —
   no per-topic subscribe. Pine v5 `alert()` has a two-phase flow:
   `pine-facade/gen_alert/` then `pricealerts/create_alert`. Pine
   `alertcondition()` surfaces as `"alert_cond$<id>"` operator on the same
   `/create_alert`. Webhook templating supports 31+ tokens. Worker should NOT
   proxy outbound webhooks — TV edge delivers `web_hook.url` directly;
   interposing breaks IP allowlists and doubles round-trips. Agents 06, 18.

6. **`STD;` namespace has 1,520 unique IDs.** Distribution: `standard` 144
   (120 study + 23 strategy + 1 library), `candlestick` 45, `fundamental` 1,332.
   No category/tag taxonomy in API — TV's indicator browser groups client-side
   by name/tag heuristics. Strategies are gated by `extra.kind==="strategy"`;
   23 built-in strategies exist. Bulk hydrate path exists at
   `/chart-api/{pro_hash, studies_metadata, studies_metadata_widget}` but is
   for legacy `tv-basicstudies` namespace, NOT `STD;`. Per-`STD;` metainfo is
   on-demand via `pine-facade/translate`. Agent 11.

7. **Chart session's indicator verbs are mostly absent from the worker.** Of
   ~30 indicator-relevant verbs (`modify_study`, `remove_study`, `notify_study`,
   `request_studies_metadata`, `request_data_problems`, `set_data_quality`,
   `switch_timezone`, `set_future_tickmarks_mode`, `request_more_tickmarks`,
   `series_timeframe`, `create_pointset`/`modify_pointset`/`remove_pointset`,
   `replay_set_resolution`/`replay_step`/`replay_get_depth`/`replay_data_end`)
   only a subset of the basic create+series flow is wired. Live param updates
   to a study (slider drags) use debounced `modify_study` — worker has no
   route for this. Server-pushed `tickmark_update`, `index_update`, `clear_data`,
   `studies_metadata`, `protocol_error`, `protocol_switched`, `critical_error`
   are also discarded. Agents 1, 16.

8. **Strategies share the study slot — no dedicated verbs.** `create_study`
   with a strategy-flavoured indicator (`Script$<id>@tv-scripting-101!` plus
   `pineId`/`pineVersion`) emits a normal `study_completed`/`du` cycle; the
   strategy report is reconstructed client-side from `du` plot output arrays
   (no `report_data` frame). 16 verifiable property fields (`initial_capital`,
   `default_qty_value/type`, `commission_value/type`, `slippage`,
   `pyramiding`, `calc_on_*`, `margin_long/short`, `use_bar_magnifier`,
   `process_orders_on_close`, `fill_orders_on_standard_ohlc`,
   `backtest_fill_limits_assumption`) plus 27 report fields (`net_profit`,
   `profit_factor`, `max_drawdown[_percent]`, `sharpe_ratio`, `sortino_ratio`,
   `total/winning/losing/even_trades`, `win_rate`, `avg_*_trade`,
   `largest_*_trade`, `buy_hold_return`, `alpha`, `beta`,
   `ratio_avg_win_avg_loss`). Closed-source backtest is possible via
   `is_auth_to_get/{id}/{ver}` truthy + `pineId`/`pineVersion` reference;
   falsy path requires a thin receiver strategy + plot-echo. Agent 15.

9. **Study-templates and drawing-templates are two distinct verified surfaces;
   indicator favorites are not.** `/api/v1/study-templates` has full CRUD
   plus rename and favorite/unfavorite, with three buckets (`custom`,
   `standard` ids 1-6, `fundamentals` ids 12-23 — last two R/O + favorite-only).
   Apply is fully client-side (`model.applyStudyTemplate`); no
   `apply_template` envelope. Drawing-templates live at
   `/drawing-templates/${tool}/` (FormData) — distinct from line-tools-storage
   (which is realtime sync). Indicator favorites and recents persist via
   TVSettings (`/savesettings/`, `/loadsettings/`) keyed
   `chart.favoriteLibraryIndicators`, `loadChartDialog.favorites`,
   `StudyTemplates.recent` — no dedicated favorite endpoint. Agent 17.

## Surface inventory (indicator-relevant)

### A. pine-facade.tradingview.com (cookie-auth on writes; reads tolerate unauth for built-ins)

| Method | Path | Status | Worker | Agent |
|---|---|---|---|---|
| GET | `/pine-facade/list?filter={standard,candlestick,fundamental,saved}` | verified | partial (`searchIndicators`, `getPrivateIndicators`) | 03, 11 |
| GET | `/pine-facade/get_script_info/?pine_id=…` | verified | absent | 03 |
| GET | `/pine-facade/versions/{id}/last` | verified | absent | 03 |
| GET | `/pine-facade/versions/{id}/all` | lead | absent | 03 |
| GET | `/pine-facade/is_auth_to_get/{id}/{ver}` | verified | absent | 03 |
| GET | `/pine-facade/is_auth_to_write/{id}/{ver}` | bundle (lead) | absent | 02 |
| GET | `/pine-facade/translate/{id}/{ver}` | verified | partial (`getIndicatorMeta`) | 03, 11 |
| POST | `/pine-facade/translate_source/{ver}?is_pine_ex=true` body `{source, inputs}` | bundle | absent | 12 |
| POST | `/pine-facade/translate_light/?pine_id=…` body `{source}` | bundle | absent (legacy alert editor) | 03, 12 |
| POST | `/pine-facade/eval_pine_ex/` body `username, source, inputs` | verified | absent | 03, 12, 14 |
| POST | `/pine-facade/save/new` params `{name,allow_overwrite?}` body `{source}` | bundle | absent | 12 |
| POST | `/pine-facade/save/new_draft` params `{allow_use_existing_draft}` body `{source}` | bundle | absent | 12 |
| POST | `/pine-facade/save/next/{id}` params `{allow_create_new,name?}` body `{source}` | bundle | absent | 12 |
| POST | `/pine-facade/save/next_draft/{id}` params `{allow_create_new}` body `{source}` | bundle | absent | 12 |
| POST | `/pine-facade/publish/new/?access=…` body `{source, extra}` | bundle | absent | 12 |
| POST | `/pine-facade/publish/next/{id}` body `{source, extra}` | bundle | absent | 12 |
| POST | `/pine-facade/delete/{id}` | bundle | absent | 12 |
| POST | `/pine-facade/rename/{id}` params `{name,force?}` | bundle | absent | 12 |
| PUT | `/pine-facade/name/{id}/{ver}` params `{name}` | bundle | absent | 12 |
| POST | `/pine-facade/parse_title` body `{source}` | bundle | absent | 12 |
| POST | `/pine-facade/convert` body `{source, version_to}` | bundle | absent | 12 |
| GET | `/pine-facade/get/{id}/{ver}` params `{no_4xx?}` | bundle | absent | 12 |
| POST | `/pine-facade/gen_alert/` body `{alert_info}` | bundle | absent | 18 |

### B. www.tradingview.com (chart-api & pubscripts)

| Method | Path | Status | Worker | Agent |
|---|---|---|---|---|
| GET | `/chart-api/pro_hash` | bundle | absent | 11 |
| GET | `/chart-api/studies_metadata` | bundle | absent | 11 |
| GET | `/chart-api/studies_metadata_widget` | bundle | absent | 11 |
| GET | `/pubscripts-library/?offset,count,sort,is_paid?,type?` | verified | absent | 13 |
| GET | `/pubscripts-library/editors-picks/?type?` | verified | absent | 13 |
| POST | `/pubscripts-get/` form `scriptIdPart=…&show_hidden=…` | verified | absent | 13 |
| GET | `/pubscripts-get/personal-access/` | verified | absent | 13 |
| GET | `/pubscripts-suggest-json/?search=…` | verified | partial (`searchIndicators`) | 13 |
| GET | `/api/v1/script_packages/store/` | verified | absent | 13 |
| GET | `/api/v1/study-templates` | verified (HAR) | absent | 02, 17 |
| POST | `/api/v1/study-templates` body `{name,content,meta_info?}` | bundle | absent | 17 |
| GET | `/api/v1/study-templates/{id}` | bundle | absent | 02, 17 |
| GET | `/api/v1/study-templates/standard/{id}` | bundle | absent | 17 |
| PUT | `/api/v1/study-templates/{id}` body `{name,content,meta_info}` | bundle | absent | 17 |
| POST | `/api/v1/study-templates/{id}/rename/` body `{name}` | bundle | absent | 02, 17 |
| DELETE | `/api/v1/study-templates/{id}` | bundle | absent | 17 |
| POST/DELETE | `/api/v1/study-templates/{id}/favorite` | bundle | absent | 02, 17 |
| POST/DELETE | `/api/v1/study-templates/standard/{id}/favorite` | bundle | absent | 17 |
| GET | `/drawing-templates/{tool}/` | bundle | absent | 17 |
| GET | `/drawing-template/{tool}/?templateName={name}` | bundle | absent | 17 |
| POST | `/save-drawing-template/` FormData `{tool,name,content}` | bundle | absent | 17 |
| POST | `/remove-drawing-template/` FormData `{tool,name}` | bundle | absent | 17 |
| POST | `/savesettings/` FormData `delta=JSON({k:v})` | bundle | absent | 17 |
| GET | `/loadsettings/` | bundle | absent | 17 |

### C. pricealerts.tradingview.com (cookie-auth, no chart_session prereq)

All POST routes take `{"payload":<obj>}` body and append `log_username` +
`maintenance_unset_reason` (+ `build_time` on POST, `user_id` on the lone GET)
query string. Response envelope is `{s:"ok"|"error", id, r}`. There is **no**
`/modify_alert` or singular `/delete_alert` — modify and restart go through
`/modify_restart_alert`; deletes always plural with one-element arrays.
Agents 06, 18.

| Method | Path | Body | Status | Worker | Agent |
|---|---|---|---|---|---|
| GET | `/list_alerts?user_id=<id>` | - | verified | absent | 06, 18 |
| POST | `/get_alerts` | `{alerts:number[]}` | bundle | absent | 06 |
| POST | `/create_alert` | full Alert (sec.E) | verified | absent | 06, 18 |
| POST | `/modify_restart_alert` | Alert with `alert_id` | bundle | absent | 06 |
| POST | `/delete_alerts` | `{alerts:number[]}` | bundle | absent | 06, 18 |
| POST | `/stop_alerts` | `{alerts:number[]}` | bundle | absent | 06, 18 |
| POST | `/restart_alerts` | `{alerts:number[]}` | bundle | absent | 06, 18 |
| POST | `/clone_alerts` | `{alerts:number[]}` | bundle | absent | 06, 18 |
| POST | `/list_fires` | `{limit, alert_id?, before_time?}` | bundle | absent | 06, 18 |
| POST | `/delete_fires` | `{fires:number[]}` | bundle | absent | 06 |
| POST | `/delete_all_fires` | `{}` | bundle | absent | 06 |
| POST | `/delete_fires_by_filter` | `{alert_id?, before_time?}` | bundle | absent | 06 |
| POST | `/get_offline_fires` | `{limit}` (default 2000) | verified | absent | 06, 18 |
| POST | `/get_offline_fire_controls` | `{}` | verified (HAR) | absent | 06 |
| POST | `/clear_offline_fires` | `{payloads:ClearPayload[]}` | bundle | absent | 06 |
| POST | `/clear_offline_fire_controls` | `{payloads}` | bundle | absent | 06 |
| GET | `/is_alive` | - | bundle | absent | 06, 18 |

### D. pushstream.tradingview.com (alert delivery, WSS)

`wss://pushstream.tradingview.com/message-pipe-ws/<channels-joined-by-/>`
(SSE fallback `…/message-pipe-es`). User channel = `private_${user.private_channel}`.
**No per-topic subscribe verb** — alerts ride the user's private channel.
Frame: `{id:number, channel:string, text:string}`; `id<=-2` = channel removed,
`id>0` = payload; `text` JSON-decodes to `{m:event, p:data}`. Events:
`alerts_created`, `alerts_updated`, `alerts_deleted`, `alert_fired`,
`fires_deleted`. On reconnect, drain `/get_offline_fires` +
`/get_offline_fire_controls` first, then pushstream takes over. Agent 06.

`alerts.tradingview.com/alerts/health/` is legacy healthcheck only — NOT a
delivery surface. Agent 06.

### E. Alert object schema (verified, n=497, agents 06, 18)

Top-level keys: `alert_id, name, type, complexity, kinds, symbol, pro_symbol,
resolution, active, auto_deactivate, create_time, last_fire_time,
last_fire_bar_time, last_stop_reason, last_error, expiration,
expiration_policy, condition, conditions, cross_interval, message, email,
sms_over_email, mobile_push, popup, sound_file, sound_duration, web_hook,
presentation_data`.

- `type` ∈ `price | indicator | strategy`.
- `complexity` ∈ `primitive | complex`.
- `kinds` ∈ `regular | watchlist`.
- `expiration_policy.policy` ∈ `fixed_date | open_ended`; top-level `expiration`
  legacy-mirrors `expiration_policy.time`.
- `condition` legacy-mirrors `conditions[0]` — must send both. Multi-condition
  is gated by `ALERTS_MULTICONDITIONS` flag (none observed).
- Condition types: `cross, cross_up, cross_down, greater, less, moving_up,
  moving_down, moving_up_percents, moving_down_percents, enter_channel,
  exit_channel, inside_channel, outside_channel, enter_shape, exit_shape,
  inside_shape, outside_shape, strategy, alert_cond, pine_alert,
  pine_alert_cond`.
- `series[*].type` ∈ `barset, value, study, line, shape, financial, pine`.
- Frequencies: `only_once, once_per_minute, once_per_bar, once_per_bar_close,
  on_bar_close, on_first_fire`.
- Webhook body = `message` after template substitution (`{{ticker}},
  {{exchange}}, {{interval}}, {{open|high|low|close|volume}}, {{time}},
  {{strategy.order.action}}, {{plot("name")}}, {{syminfo.X}}`); `text/plain`
  unless message parses as JSON.

### F. data.tradingview.com (chart-session WebSocket; ~/socket.io/websocket)

Indicator-related verbs (client→server):

| Verb | Status | Worker | Agent |
|---|---|---|---|
| `set_auth_token` | verified | yes | 1, 16 |
| `chart_create_session` | verified | yes | 1, 16 |
| `chart_delete_session` | verified | absent | 1, 16 |
| `resolve_symbol` | verified | yes | 1, 16 |
| `create_series` | verified | yes (in `getCandles` path; **absent in `runStudy`**) | 1, 16 |
| `modify_series` | verified | absent | 1, 16 |
| `remove_series` | verified | absent | 1, 16 |
| `series_timeframe` | verified | absent | 1, 16 |
| `request_more_data` | verified | yes | 1, 16 |
| `request_more_tickmarks` | verified | absent | 1, 16 |
| `request_studies_metadata` | verified | absent | 1, 11, 16 |
| `request_data_problems` | verified | absent | 1, 16 |
| `create_study` | verified (6-arg) | **broken (3-arg)** | 12, 14, 16 |
| `create_child_study` (alias) | verified | absent | 16 |
| `modify_study` (debounced 500ms) | verified | absent | 16 |
| `notify_study` | verified | absent | 16 |
| `remove_study` | verified | absent | 16 |
| `set_data_quality` (`low`/`high`) | verified | absent | 1, 16 |
| `switch_timezone` | verified | absent | 1, 16 |
| `set_future_tickmarks_mode` | verified | absent | 1, 16 |
| `set_broker` | verified | absent | 1, 16 |
| `replay_create_session` | verified | yes | 1, 16 |
| `replay_add_series` | verified | yes | 1, 16 |
| `replay_remove_series` | verified | absent | 1, 16 |
| `replay_reset` | verified | yes | 1, 16 |
| `replay_start`/`stop`/`step` | verified | absent | 1, 16 |
| `replay_set_resolution` | verified | absent | 1, 16 |
| `replay_get_depth` | verified | absent | 1, 16 |
| `replay_delete_session` | verified | absent | 1, 16 |
| `create_pointset`/`modify_pointset`/`remove_pointset` | verified | absent | 1, 16 |
| `get_first_bar_time` | verified | absent | 16 |

Server→client decoded by worker: `timescale_update`, `series_completed`,
`symbol_error`, `qsd`, `quote_completed`, `study_completed`, `study_error`,
`symbol_resolved`, `replay_*` subset. Server→client **NOT** decoded:
`du` / `data_update` (study output frames!), `study_loading`, `tickmark_update`,
`index_update`, `clear_data`, `series_loading`, `series_error`, `studies_metadata`,
`protocol_error`, `protocol_switched`, `critical_error`, `replay_data_end`,
`replay_depth`, `replay_resolutions`, `replay_instance_id`, `replay_point`.

## `create_study` wire schema (6 args, verified)

`create_study(e,t,s,n,i,o)` encodes as `[e, t, s||"", n, i].concat(o)`:

| Idx | Name | Description |
|---|---|---|
| 0 | `chart_session_id` | `cs_…` from `chart_create_session` |
| 1 | `study_slot_id` | `st<n>` from `makeNextStudyId` |
| 2 | `turnaround` | versioned cookie per study; bumped per `modify_study` |
| 3 | `parent_series_id` | `sds_<n>` for normal/overlay; parent **study slot** for study-on-study |
| 4 | `indicator_id_with_version` | e.g. `STD;RSI@tv-basicstudies-241!`, `Script$PUB;<hash>@tv-scripting-101!`, `Script$STD;EMA@tv-scripting-101!` |
| 5… | `inputs` | `{in_0: v, in_1: v, …}` open dict; `__fast_calc`, `__profile` reserved; symbol-typed wrap as `{type:"symbol", value:"NASDAQ:AAPL"}`; source-typed encode as `<seriesId>$<plotName>`; `extra_metainfo` for fundamentals/Pine merges into the same dict |

`modify_study` schema is `[cs, st, turnaround, indicator_id_with_version, inputs]`
(5 args). Debounce 500ms client-side; server accepts unbatched.

## Worker gap mapping (file/line)

`worker/src/tradingview.ts`:
- L613 `searchIndicators`: covers only suggest-json + 3 list filters.
- L681 `getIndicatorMeta`: only `translate/{id}/{ver}`; exposes raw `metaInfo`.
- L723 `getPrivateIndicators`: only `pine-facade/list?filter=saved`.
- L811-885 `runStudy`: **broken**. 3-arg `create_study`, missing `create_series`,
  doesn't accumulate `du`. `study_completed.params[1]` is empty for any non-trivial
  study.

`worker/src/index.ts:970-1004`: `/v1/study` route — wraps the broken `runStudy`.

`worker/src/tradingview.ts` overall: zero references to
`charts-storage`, `pricealerts`, `*_alert`, `symbols_list`, `study-templates`,
`line-tools-storage`, `screener-facade`, `scanner-backend`, `chart-token`,
`options-charting`, `support-middleware`, `telemetry`, `my-charts`, `publishchart`,
`drawing-template`, `save_pine`, `publish_pine`, `delete_pine` (verified by
`/tmp/tv-recon/check_worker.sh` script — agent 02).

`packages/tradingview-core/src/pine/types.ts` is **ahead of the worker**:
already types `save/new`, `save/next`, `get_lib_export_data`, `translate_light`,
`parse_title` — the runtime never hits them.

Skill workflow promises that today's worker cannot deliver, with concrete
unblockers from the roadmap below:
- `pinescript-iterate.md`: needs compile + run loop. Unblocked by P1 + P2.
- `indicator-evaluate.md`: step 4 ("run with `POST /v1/study`") fails because
  the route is broken. Unblocked by P0 + P3.
- `indicator-to-strategy-backtest.md`: needs strategy compile + backtest run.
  Unblocked by P1 + P0 + P8 (since strategies share the study slot, P8 is
  mostly typed-input + report-shape work on top of fixed P0).
- `backtest-strategy.md`: needs a worker Pine endpoint and a strategy backtest
  endpoint. Unblocked by P1 + P8.
- `backtest-closed-source.md`: needs `is_auth_to_get` gate + working
  `runStudy` to read closed-source plot output. Unblocked by P0 + P8 (no
  separate compile needed because the script runs server-side via reference;
  worker only needs to gate on `is_auth_to_get`).

## Roadmap (prioritized, reviewable commits)

Each item has a defined verification probe; where a probe requires a live TV
session, it uses the worker admin session store (no caller-supplied session).

### P0 — Repair `/v1/study` (correctness of existing surface)

Closes the `studyId@parentless` bug and the empty-result bug. Changes
`runStudy`:
1. Mint `study_slot_id` (`st1`) and `series_id` (`sds_1`) explicitly.
2. Send `chart_create_session`, `resolve_symbol`, `create_series` (6 args:
   `[cs, sds_1, s1, sds_sym_1, tf, count, ""]`), then `create_study`
   with the verified 6-arg shape: `[cs, st_slot, "", sds_1, "<id>@<ns>!", inputs]`
   where `<id>@<ns>` is `STD;<x>@tv-basicstudies-N` for built-ins,
   `Script$PUB;<x>@tv-scripting-101` for pubscripts.
3. Add `du` decoder in the existing event loop (subscribe to
   `event.name === "du"`); accumulate `params[1][study_slot_id].st` rows
   keyed by series index. Resolve on `study_completed` (or first `du` if
   `study_completed` is racey for built-ins).
4. Surface `study_error.params[2..3]` (reason + Pine compile diagnostics)
   on rejection.

Verification probe: `curl -X POST /v1/study -d '{"symbol":"NASDAQ:AAPL","studyId":"STD;RSI","inputs":{"in_0":21,"in_1":"close"}}'`
must return ≥250 numeric RSI values keyed by timestamp; sending
`{"in_0":-1}` (out-of-range) must return `{error:"study_error", reason:"runtime_error",...}`.

### P1 — Pine compile route (`POST /v1/pine/compile`)

Body `{source, inputs?, version?, mode?: "light"|"full"|"eval"}`. Modes:
- `eval` → `POST pine-facade/eval_pine_ex/` (input expression resolution).
- `full` → `POST pine-facade/translate_source/{ver}?is_pine_ex=true` (build IL).
- `light` → `POST pine-facade/translate_light/?pine_id=…` (metaInfo only).

Returns `{success, metaInfo?, ilTemplate?, rootValues?, errors:[{message,start:{line,column}}], warnings}`
normalized from TV's `reason`/`reason2` envelope.

### P2 — Pine run route (`POST /v1/pine/run`)

Composes P1+P0. Body `{source?, pineId?, version?, inputs, symbol, timeframe, bars?}`.
Worker compiles (`translate_source`), evaluates defaults (`eval_pine_ex`),
opens chart WS, sends `create_study` with `Script$<pineId>@tv-scripting-101!`,
streams `du` until `study_completed`. Response shape:
`{indicator, plots:[{plotName, type, data:[{ts, value}]}], nonseries?}`.

### P3 — Typed inputs surface (`GET /v1/indicators/inputs/{id}` + override-aware `/v1/study`)

- Derive typed inputs from `metaInfo.inputs` translating `INPUT_*` → short-form
  StudyInputType. Expose `{id, name, type, defval, minval?, maxval?, step?, options?, group?, inline?, tooltip?, isHidden?}`.
- Accept `params: {[name]: any}` on `/v1/study` and `/v1/pine/run`; map to
  `inputs.in_N` via name→id index from metaInfo. Validate type and `options[]`.
- Source-typed params accept `"close"|"open"|...` and worker resolves to
  `<seriesId>$<plot>` after series creation. Symbol-typed wrap with
  `{type:"symbol", value}`.

### P4 — Built-in catalog (`GET /v1/indicators/builtin`)

- Aggregate `pine-facade/list?filter=` across the four observed filters.
- Expose query: `filter`, `kind` (`study|strategy|library`), `q`, `fundamentalCategory`.
- Cache TTL 1h (catalog changes rarely).

### P5 — Pubscripts library (`GET /v1/pubscripts/{library, batch, suggest, personal-access, packages/store}`)

Direct passthroughs of the 5 verified pubscripts paths plus `script_packages/store`.
Replace existing `searchIndicators` with `/v1/pubscripts/suggest`. The merged
"built-in + public" shape currently returned by `searchIndicators` should remain
under `/v1/indicators/search` for compat.

### P6 — Indicator-driven alerts

- `POST /v1/alerts/create-on-study` body `{symbol, resolution, study:{id,pineId,pineVersion,inputs,plotId}, condition:{type,threshold|bands,frequency}, expiration?, channels?, message?, web_hook?}`.
- `POST /v1/alerts/create-pine-alert` two-phase: `pine-facade/gen_alert/` then `pricealerts/create_alert` with `condition.type:"pine_alert"`.
- `GET /v1/alerts`, `POST /v1/alerts/{stop,restart,delete,clone}`, `GET /v1/fires`.

### P7 — `modify_study` + study-on-study

- `POST /v1/study/modify` body `{indicator_id_with_version, inputs}` (requires DO-owned chart session — see P9).
- `parentSeriesId` field on `/v1/study` and `/v1/pine/run` defaulting to `sds_1` but allowing `st<n>` for chained studies.

### P8 — Strategy & backtest

Strategies share the study slot — there are NO dedicated `strategy_create_session`,
`report_data`, `trades_data`, or `equity_curve` verbs. `isStudyStrategy`/
`isStudyStrategyStub` (bundle 14151) detects strategy-flavoured studies via
metainfo. The full report is computed client-side from `du` plot output arrays
of the strategy study (`StrategyOrdersPaneView` consumer). Field names below
are display-side, not wire-level. Agent 15.

Strategy property enum (verbatim, bundle 55548): `initial_capital, currency,
default_qty_value, default_qty_type, pyramiding, commission_value,
commission_type, backtest_fill_limits_assumption, slippage, calc_on_order_fills,
calc_on_every_tick, margin_long, margin_short, use_bar_magnifier,
process_orders_on_close, fill_orders_on_standard_ohlc`. `default_qty_type` ∈
`{fixed, cash_per_order, percent_of_equity}`. `max_bars_back` lives in
`inputs[]` (`internalID === "calc_bars_count" | "max_bars_back"`).

Report fields (snake_case literals confirmed across bundles): `max_drawdown,
max_drawdown_percent, max_runup, max_runup_percent, max_intraday_loss,
max_cons_loss_days, currency_rate, gross_profit, net_profit, profit_factor,
sharpe_ratio, sortino_ratio, total_trades, winning_trades, losing_trades,
even_trades, win_rate, avg_trade, avg_winning_trade, avg_losing_trade,
largest_winning_trade, largest_losing_trade, buy_hold_return, alpha, beta,
ratio_avg_win_avg_loss`.

Trade list per `du` plot row: `bar_index, time, signal, qty, price, profit,
profit_pct, cumulative_profit, type ∈ buy|sell|long|short, comment, drawdown,
runup`. Equity series: `equity[], drawdown[], runup[], buy_hold_equity[]`.
Deep history controls: `set_data_quality(["low"])` (only documented degradation
knob); bar count steered by `bars` arg on `create_series` plus repeated
`request_more_data`. No `deep_history` literal.

Closed-source backtest possible without source download via
`/pine-facade/is_auth_to_get/{scriptId}/{version}` — when true, instantiate by
metainfo+reference (`pineId`/`pineVersion` only in `Script$<id>@tv-scripting-101!`);
when false, fall back to plot-echo via a thin receiver strategy.

Proposed routes:
- `POST /v1/strategy/run` body `{symbol, timeframe, scriptId|source, properties,
  inputs, bars}` returning `{report, trades, equity}` after `study_completed`.
- `POST /v1/strategy/replay` SSE per-bar streamed equity/trades/drawdown reusing
  `du` frames.
- `POST /v1/strategy/optimize` parameter sweep — TV exposes no optimization
  verb; route fans out to `/v1/strategy/run` and aggregates.

WS sequence (verified):
```
> create_study cs1 st1 sessionId sds_1 Script$<id>@tv-scripting-101!
    {text:<pine>, pineId:.., pineVersion:.., in_0:{...inputs incl. properties...}}
< study_loading st1
< du {st1:{st:[...trade rows...], ns:{...equity arrays...}}}
< study_completed st1
```

Strategy properties land in `in_0` together with user inputs; the report is
reconstructed from the `du` plot output arrays of `st1` (no separate
`report_data` frame). Same Worker bug at `runStudy:861` blocks this entirely.

### P9 — Stateful chart-session DO

For `modify_study`, study-on-study, replay-driven per-bar streaming, and
multi-step Pine iterate. New Durable Object owning a single chart session,
exposing `/v1/chart-session/{create, study/create, study/modify, replay/step,
close}`.

### P10 — Study-templates and drawing-templates (Agent 17)

Two distinct surfaces, both verified, both unimplemented:

**Study-templates** — full CRUD on `/api/v1/study-templates` (cookie-auth, www).
Three buckets in list response: `custom` (CRUD), `standard` (ids 1-6, R/O +
favorite-only), `fundamentals` (ids 12-23, R/O + favorite-only). Item shape:
`{id, name, meta_info:{indicators:[{id,description}], interval}, favorite_date}`;
`content` field on by-id GETs is JSON-stringified panes/sources state with the
same shape as charts-storage `payload` (panes carry sources `{type,state,zorder}`).
Apply flow is fully client-side: GET content → JSON.parse → `model.applyStudyTemplate`
runs an undo macro that replays sources via direct model mutation. The
WebSocket only sees normal `create_study`/`modify_study` traffic as the model
hydrates — there is no `apply_template` envelope.

**Drawing-templates** — separate from line-tools-storage (which is realtime
sync only, agent 05). Lives on `www.tradingview.com` with FormData verbs:
`/drawing-templates/${tool}/` (GET list), `/drawing-template/${tool}/?templateName=`
(GET load), `/save-drawing-template/` (POST), `/remove-drawing-template/` (POST).
`tool` is a primitive class like `LineToolTrendLine`.

**Indicator favorites + recents** are NOT a dedicated endpoint — they persist
via TVSettings: anon → `TVLocalStorage`; auth → batched `POST /savesettings/`
FormData `delta=JSON.stringify({k:v})` (`sendBeacon` on unload). Watcher keys:
`chart.favoriteDrawings, chart.favoriteDrawingsPosition,
chart.favoriteLibraryIndicators, loadChartDialog.favorites`. Recents live in
`StudyTemplates.recent` key, capacity 5, dedup-on-add. Out of scope for v1
indicator routes; would require a `/v1/settings/{save,load}` route family.

Proposed Worker routes:
- `GET/POST /v1/study-templates` — list/create.
- `GET/PUT/DELETE /v1/study-templates/{id}?standard=bool` — CRUD.
- `POST /v1/study-templates/{id}/rename` body `{name}`.
- `PUT/DELETE /v1/study-templates/{id}/favorite` (also `/standard/{id}/favorite`).
- `GET /v1/drawing-templates?tool=` — list names.
- `GET /v1/drawing-templates/{tool}/{name}` — load `{content:object}` parsed.
- `POST /v1/drawing-templates` body `{tool,name,content:object}` (Worker FormData-encodes).
- `DELETE /v1/drawing-templates/{tool}/{name}` (Worker calls `/remove-drawing-template/`).

Out of scope: indicator favorites/recents (TVSettings, separate route family);
share/import (no endpoint observed).

## Probes (executable)

All probes use the Worker admin session store. Replace `${SESSION}`/`${SESSION_SIGN}`/`${USERNAME}` at runtime.

```bash
# P0 — broken /v1/study repro (current state, expect empty data)
curl -s -X POST $WORKER/v1/study \
  -H "$HMAC" -d '{"symbol":"NASDAQ:AAPL","studyId":"STD;RSI"}'
# After P0 fix:
curl -s -X POST $WORKER/v1/study -H "$HMAC" \
  -d '{"symbol":"NASDAQ:AAPL","studyId":"STD;RSI","inputs":{"in_0":21,"in_1":"close"}}' \
  | jq '{n:.data.plots[0].data|length, sample:.data.plots[0].data[-3:]}'
# Expect: n>=250; sample has numeric value field per ts.

# P1 — Pine compile (eval mode, HAR-verified)
curl -s -X POST https://pine-facade.tradingview.com/pine-facade/eval_pine_ex/ \
  -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  --data-urlencode "username=${USERNAME}" \
  --data-urlencode 'source=//@version=5
LineWidth=##input(defval=2,type='\''INPUT_INTEGER'\'',##id='\''in_5'\'')
##root(root_metainfo,rm_0,LineWidth,"input&&integer",plot,linewidth)' \
  --data-urlencode 'inputs={"in_5":7,"__fast_calc":false,"__profile":false}' \
  | jq .
# Expect: {"success":true,"result":{"rootValues":{"rm_0":7}}}

# P3 — Typed inputs from metainfo
ID=$(printf 'STD;RSI' | jq -sRr @uri)
VER=$(curl -s "https://pine-facade.tradingview.com/pine-facade/versions/${ID}/last" | jq -r '.[0].version')
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  "https://pine-facade.tradingview.com/pine-facade/translate/${ID}/${VER}" \
  | jq '.result.metaInfo.inputs[] | {id,name,type,defval}'
# Expect: array of typed input descriptors.

# P4 — Builtin catalog enumeration
for f in standard candlestick fundamental saved; do
  curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
    "https://pine-facade.tradingview.com/pine-facade/list?filter=${f}" \
    | jq "{filter:\"${f}\", n:length, kinds:([.[].extra.kind]|group_by(.)|map({k:.[0],n:length}))}"
done
# Expect: standard{144,study/strategy/library}, candlestick{45,study},
# fundamental{1332,study}, saved{N,study|strategy|library} per account.

# P5 — Pubscripts library + batch
curl -s 'https://www.tradingview.com/pubscripts-library/?offset=0&count=20&sort=top' \
  | jq '.results[0]|{scriptIdPart,scriptName,access,agreeCount}'
curl -s -X POST 'https://www.tradingview.com/pubscripts-get/' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'scriptIdPart=PUB;edfaff05350f406092874780e934f06c&show_hidden=false' \
  | jq '.[0]|{scriptIdPart,scriptName,extra:.extra.kind,access}'

# P6 — Alerts is_alive (cheapest probe)
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  https://pricealerts.tradingview.com/is_alive
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  "https://pricealerts.tradingview.com/list_alerts?log_username=${USERNAME}&user_id=${USER_ID}" \
  | jq '.r|length'

# P6 — Pushstream alert delivery (subscribes to user's private channel)
# wscat -c "wss://pushstream.tradingview.com/message-pipe-ws/private_${PRIVATE_CHANNEL}" \
#   -H "Origin: https://www.tradingview.com" \
#   -H "Cookie: sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}"
# Expect frames {"id":1,"channel":"private_<TOKEN>","text":"{\"m\":\"alert_fired\",\"p\":[…]}"}

# P8 — Strategy run via /v1/strategy/run (after worker route wired)
# curl -s -X POST $WORKER/v1/strategy/run -H "$HMAC" \
#   -d '{"symbol":"NASDAQ:AAPL","timeframe":"1D","scriptId":"STD;Supertrend Strategy",
#         "properties":{"initial_capital":100000,"default_qty_type":"percent_of_equity",
#                       "default_qty_value":10,"commission_type":"percent","commission_value":0.1},
#         "inputs":{"in_0":3,"in_1":10},"bars":2000}' \
#   | jq '.report | {net_profit,profit_factor,max_drawdown,total_trades,win_rate}'

# P10 — Study-templates list (verified GET)
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  https://www.tradingview.com/api/v1/study-templates | jq 'keys, .standard|length'
# Expect: keys ["custom","fundamentals","standard"], standard=6.

# P10 — Study-templates create+rename+delete cycle
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"name":"probe","content":"{\"panes\":[]}","meta_info":{"indicators":[]}}' \
  https://www.tradingview.com/api/v1/study-templates | tee /tmp/tpl.json
ID=$(jq -r '.r.id // .id' /tmp/tpl.json)
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  -H 'Content-Type: application/json' -X POST \
  -d '{"name":"probe2"}' "https://www.tradingview.com/api/v1/study-templates/${ID}/rename/"
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" -X POST \
  "https://www.tradingview.com/api/v1/study-templates/${ID}/favorite"
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" -X DELETE \
  "https://www.tradingview.com/api/v1/study-templates/${ID}"

# P10 — Drawing-templates (FormData POST/GET)
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  https://www.tradingview.com/drawing-templates/LineToolTrendLine/
curl -s -b "sessionid=${SESSION}; sessionid_sign=${SESSION_SIGN}" \
  "https://www.tradingview.com/drawing-template/LineToolTrendLine/?templateName=Default"

# P0 — WS create_study handshake (manual; replace tokens)
# wscat -c "wss://data.tradingview.com/socket.io/websocket?from=chart&date=...&type=&auth=${SESSION}"
# > ~m~36~m~{"m":"set_auth_token","p":["${AUTH_TOKEN}"]}
# > ~m~32~m~{"m":"chart_create_session","p":["cs1",""]}
# > ~m~99~m~{"m":"resolve_symbol","p":["cs1","sds_sym_1","={\"symbol\":\"NASDAQ:AAPL\",\"adjustment\":\"splits\"}"]}
# > ~m~50~m~{"m":"create_series","p":["cs1","sds_1","s1","sds_sym_1","60",300,""]}
# > ~m~80~m~{"m":"create_study","p":["cs1","st1","","sds_1","STD;RSI@tv-basicstudies-241!",{"in_0":21,"in_1":"close"}]}
# Expect: study_loading[st1,""], du[cs1,{st1:{t:"",st:[…RSI rows…]}}], study_completed[st1,""].
```

## Resolved by agents 06/15/17

- Live-fire alert delivery transport: `wss://pushstream.tradingview.com/message-pipe-ws/private_<TOKEN>`
  with `{m,p}` frames for `alerts_created/updated/deleted`, `alert_fired`,
  `fires_deleted`. No per-topic subscribe (agent 06).
- Strategy report wire format: there is **none** as a server frame — reports
  are computed client-side from `du` plot output arrays of the strategy study
  (agent 15). Report field names listed in §P8 are display-side, not wire.
- Study-template apply flow: fully client-side via `model.applyStudyTemplate`;
  no `apply_template` WebSocket envelope (agent 17).
- pricealerts modify path: there is no `/modify_alert` — `/modify_restart_alert`
  covers both modify and restart (agent 06).

## Explicit unknowns (still open)

- Pine save/publish/delete shapes are bundle-only (legacy `58404` for publish;
  modern `52174` for save/draft). HAR did not capture a write session; re-record
  with the Pine Editor save flow to confirm modern shapes.
- `eval_pine_ex` failure envelope (`reason | reason2 | error` shape) is
  bundle-only; HAR captured one successful POST. Negative probe recorded in
  agent 12 §10 but not yet executed.
- `is_pine_ex` query flag on `translate_source` semantics still undocumented;
  bundle references it as toggling `eval_pine_ex`-style preprocessing.
- Bulk legacy `tv-basicstudies` metainfo via `/chart-api/studies_metadata`
  was bundle-only; size/auth requirements unconfirmed (agent 11 suggests
  `pro_hash` cache key gates it).
- `ALERTS_MULTICONDITIONS` flag never observed enabled in capture — the
  multi-condition path inside `conditions[]` is bundle-only (agent 06).
- Strategy-side `is_auth_to_get` truthy path: closed-source backtest by
  `pineId`/`pineVersion` reference is plausible but not exercised in capture
  (agent 15) — needs a probe with a known accessible closed-source strategy.
- Whether `model.applyStudyTemplate` deduplicates against existing studies
  on the chart, or always appends — agent 17 describes "removes non-mainSeries
  line tools without target sig, replays sources" but not whether it skips
  identical-input studies. Matters for /v1/study-templates/{id}/apply
  semantics if we ever wire that route.

## Memory hygiene note

Per repo CLAUDE.md, every new route must funnel `sessionid`/`sessionid_sign`
from the Worker admin session store. Caller-supplied session must NOT take
precedence. Probes above use `${SESSION}`/`${SESSION_SIGN}` placeholders only
to test upstream behavior; production routes must read from
`CACHE_META`-backed admin store.
