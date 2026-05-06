# TradingView Macro Maps Browser Runtime Capture - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: public unauthenticated browser runtime capture through Chrome DevTools Protocol
- Task class: planned multi-item research checkpoint, documentation artifact only
- Source requirement: continue the unknown-unknown rediscovery frontier and prove macro maps populated ChartApi/WebSocket behavior instead of relying on shell page data
- Capture workspace: `/tmp/tv-macro-cdp.led7gP/capture.json`
- Sensitive inputs: none used; no cookies, JWTs, session IDs, or account-specific values were supplied or committed

This pass promotes macro maps from "component-data shell plus decompiled ChartApi lead" to "public browser runtime WebSocket frames observed." A clean no-login browser load produced populated economic quote frames over `data.tradingview.com`.

## Probe Record

| Probe | Command / source | Result | Evidence level |
| --- | --- | --- | --- |
| Headless Chrome CDP launch | `Google Chrome --headless=new --remote-debugging-port=9225 --user-data-dir=/tmp/tv-macro-cdp.led7gP/profile` | Chrome launched with temporary profile | local browser runtime |
| CDP network capture | Node script using Chrome `/json/new`, `Network.enable`, `Page.navigate`, `Network.webSocket*` events against `https://www.tradingview.com/macro-maps/` | 220 relevant requests and two WebSocket connections captured | browser runtime |
| Interaction | safe scroll after first load | no login or mutation; additional runtime opportunity only | browser runtime |
| Cleanup | `kill -TERM 59878; sleep 2; pgrep -laf 'remote-debugging-port=9225|tv-macro-cdp.led7gP'` | no Chrome process remained for the temp profile | local cleanup |
| Direct macro quote probe | Node `WebSocket` to `wss://data.tradingview.com/socket.io/websocket?from=macro-maps/&date=...&auth=sessionid` with `unauthorized_user_token`, `quote_create_session`, full macro `quote_set_fields`, and `quote_add_symbols` for `ECONOMICS:US{IRYY,GDP,UR,INTR,GDG}` | HTTP/WebSocket connection opened and returned populated public `qsd` frames for all five symbols | direct public WebSocket probe |
| Direct macro series probe | Node `WebSocket` to the same public macro-map socket with `chart_create_session`, `resolve_symbol` for `ECONOMICS:USGDP`, and `create_series` interval `12M` | returned `series_loading`, `symbol_resolved`, `timescale_update`, and `series_completed` frames | direct public WebSocket probe |

Counterexample shown: if macro maps were treated as unavailable because `component-data-only=1` returned null active data for a guest, this capture disproves that. The browser still opened chart data and received populated `ECONOMICS:*IRYY` quote frames with no logged-in session.

## Runtime Summary

Observed hosts:

| Host | Count | Role |
| --- | ---: | --- |
| `www.tradingview.com` | 3 | page shell and component data |
| `static.tradingview.com` | 187 | application bundles |
| `data.tradingview.com` | 2 | chart data WebSocket plus related network events |
| `s3-symbol-logo.tradingview.com` | 19 | country/logo assets |
| `telemetry.tradingview.com` | 1 | telemetry |
| `snowplow-pixel.tradingview.com` | 4 | telemetry |
| Google analytics / recaptcha hosts | 4 | analytics/anti-abuse supporting traffic |

Observed WebSockets:

| URL | Sent frames | Received frames | Classification |
| --- | ---: | ---: | --- |
| `wss://data.tradingview.com/socket.io/websocket?from=macro-maps/&date=...&auth=sessionid` | 274 | 21 | public macro-map chart-data session using unauthorized token |
| `wss://pushstream.tradingview.com/message-pipe-ws/public` | 0 | 0 | public open-idle stream |

The `auth=sessionid` query parameter is part of TradingView's generated browser URL shape; the capture used a clean temporary profile and sent `unauthorized_user_token`.

## Frame Shapes

Initial sent frame methods:

- `set_data_quality` with `low`
- `set_auth_token` with `unauthorized_user_token`
- `set_locale`
- `quote_create_session` with a session name shaped like `qs_snapshoter_macro-maps-page_*`

Received frame classes:

- session metadata with `release`, `studies_metadata_hash`, `auth_scheme_vsn`, and `protocol`
- `qsd` quote snapshots for macro-map economic symbols
- `quote_completed`
- heartbeat

Representative symbol family:

- `ECONOMICS:<country-code>IRYY`

Representative country-code examples observed in returned frames:

- errors for unavailable symbols such as `ECONOMICS:UMIRYY`, `ECONOMICS:TVIRYY`, `ECONOMICS:TKIRYY`
- successful availability fields for symbols such as `ECONOMICS:MMIRYY`, `ECONOMICS:PLIRYY`, `ECONOMICS:FIIRYY`
- successful latest-value fields for symbols such as `ECONOMICS:KYIRYY`, `ECONOMICS:MRIRYY`

Representative returned value fields:

- `available_data_range_end_date`
- `available_data_range_begin_date`
- `lp`

### Direct Non-Default Indicator Quote Probe

A direct no-cookie macro-map WebSocket probe used the same public `data.tradingview.com` socket family and `unauthorized_user_token`, then sent:

- `set_data_quality` with `low`
- `set_auth_token` with `unauthorized_user_token`
- `set_locale` with `en`, `US`
- `quote_create_session` with a macro-map-shaped quote session name
- `quote_set_fields` with `pro_name`, `short_name`, `last_price`, `country_code`, `available_data_range_end_date`, `available_data_range_begin_date`, `short_description`, `data_frequency`, `unit_id`, `value_unit_id`, `currency_code`, `measure`, and `lp`
- `quote_add_symbols` for `ECONOMICS:USIRYY`, `ECONOMICS:USGDP`, `ECONOMICS:USUR`, `ECONOMICS:USINTR`, and `ECONOMICS:USGDG`

Returned public `qsd` frames:

| Symbol | Indicator | Returned fields |
| --- | --- | --- |
| `ECONOMICS:USIRYY` | Inflation Rate YoY | availability begin/end, `pro_name`, `lp`, `data_frequency`, `value_unit_id`, `measure`, `country_code`, `short_description`, `short_name` |
| `ECONOMICS:USGDP` | GDP | availability begin/end, `pro_name`, `lp`, `currency_code`, `data_frequency`, `measure`, `country_code`, `short_description`, `short_name` |
| `ECONOMICS:USUR` | Unemployment Rate | availability begin/end, `pro_name`, `lp`, `data_frequency`, `value_unit_id`, `measure`, `country_code`, `short_description`, `short_name` |
| `ECONOMICS:USINTR` | Interest Rate | availability begin/end, `pro_name`, `lp`, `data_frequency`, `value_unit_id`, `measure`, `country_code`, `short_description`, `short_name` |
| `ECONOMICS:USGDG` | Government Debt To GDP | availability begin/end, `pro_name`, `lp`, `data_frequency`, `value_unit_id`, `measure`, `country_code`, `short_description`, `short_name` |

This proves the decompiled default/favorite indicator candidates are not only static bundle leads. At least `IRYY`, `GDP`, `UR`, `INTR`, and `GDG` are public unauthenticated economic-symbol quote snapshots when the request shape is correct.

### Direct Historical Series Probe

A second direct no-cookie macro-map WebSocket probe created a chart session and requested a historical annual GDP series:

- `chart_create_session` with a macro-map probe chart session
- `resolve_symbol` for `={"symbol":"ECONOMICS:USGDP","adjustment":"splits"}`
- `create_series` with interval `12M`, count `60`

Returned frames:

- `series_loading`
- `symbol_resolved`, including economic category `gdp`, provider/source metadata, `data_frequency:"12M"`, `currency_code:"USD"`, `country:"US"`, `measure:"currency"`, and World Bank source metadata
- `timescale_update` with annual GDP bars; each bar carried timestamp plus repeated OHLC-style values for the economic series
- `series_completed` with streaming metadata

This gives a public protocol shape for the historical/slider data path: macro maps can use normal chart `resolve_symbol` plus `create_series` frames for economic symbols, not only quote snapshots.

This confirms the decompiled model from `docs/tradingview-pine-screener-macro-decompilation-2026-05-07.md`: populated macro maps are chart-data-backed economic-symbol quote flows, not a simple REST scanner endpoint.

## Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| `component-data-only=1` public response had shell/null active data in prior pass | shell-only page data | Not absence; browser runtime still populates via chart data |
| Clean browser used `unauthorized_user_token` and still received `qsd` frames | unauthenticated-achievable for default indicator quote snapshots | Worker can model a public default macro-map quote path |
| Direct no-cookie probe returned `qsd` for `USGDP`, `USUR`, `USINTR`, and `USGDG` | unauthenticated-achievable for non-default indicator quote snapshots | Treat indicator switch as an economic-symbol suffix change when the UI does not add extra filters |
| Direct no-cookie probe returned `timescale_update` and `series_completed` for `ECONOMICS:USGDP` | unauthenticated-achievable for historical economic series | Model historical slider snapshots through chart `resolve_symbol`/`create_series` flow |
| Some `ECONOMICS:*IRYY` symbols returned `no_such_symbol` | partial availability / symbol coverage | Keep per-country availability/errors in schema rather than failing whole map |
| Public pushstream opened but stayed idle | observed-open-idle | Needs trigger or ignore for macro-map data modeling |

No auth, rate-limit, DNS, or network outage was observed.

## Worker Gap Update

Current Worker chart-data primitives can likely support macro maps, but there is no first-class product model that composes:

- indicator id, defaulting to `IRYY` for the observed first-load run
- country-code list
- economic symbol construction `ECONOMICS:<country><indicator>`
- quote session field set for availability/latest values
- partial per-symbol `ok` vs `no_such_symbol` results
- optional historical series snapshots for slider/timestamp interactions
- runtime-accepted macro quote fields: `pro_name`, `short_name`, `last_price`, `country_code`, `available_data_range_end_date`, `available_data_range_begin_date`, `short_description`, `data_frequency`, `unit_id`, `value_unit_id`, `currency_code`, `measure`, and `lp`

## Remaining Macro Maps Gaps

- Capture UI-specific indicator switch frames for filter-only indicators; direct protocol probes already prove public quote snapshots for `INTR`, `GDP`, `UR`, and `GDG`.
- Capture country group switch behavior and exact country-code list changes.
- Capture UI-specific historical slider event sequencing; direct protocol probes already prove the underlying public `resolve_symbol`/`create_series` series-snapshot path for `ECONOMICS:USGDP`.
- Decide Worker design: first-class `/v1/macro-maps` composed product route vs lower-level economic quote/series helpers.

## Completion Decision

Macro maps is materially upgraded: the default no-login browser path now has populated chart-data WebSocket evidence, direct public probes cover non-default economic indicator quote snapshots, and a direct public historical economic series path is proven. The broader full TradingView rediscovery objective remains incomplete because authenticated surfaces, mutation probes, replay/deep-backtesting, Pine Screener auth/entitlement, widget controlled interactions, mobile/desktop traffic, and macro-map UI-specific country/filter interactions remain open.
