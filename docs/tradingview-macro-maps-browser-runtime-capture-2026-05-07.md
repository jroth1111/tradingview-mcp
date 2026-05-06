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
| UI indicator switch | clean no-login Chrome CDP clicked `Interest Rate` radio after default `Inflation Rate` load | `Interest Rate` became checked; WebSocket sent one `quote_add_symbols` batch over `ECONOMICS:*INTR` plus many `quote_remove_symbols`; no new REST data endpoint | browser runtime |
| UI date slider drag | clean no-login Chrome CDP dragged `Select date` slider from latest toward early 2004 while `Interest Rate` was active | page list changed to historical `*INTR` observations; loaded `multi-group-series-snapshoter` bundle and sent chart sessions with `Overlay@tv-basicstudies` studies over economic symbols | browser runtime |
| UI country group switch | clean no-login Chrome CDP opened the `G20` menu and selected `World` | menu exposed group counts; visible list changed from G20 countries to World ranking; no new TradingView WebSocket data frames after selection | browser runtime |

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

## UI Interaction Capture

Clean no-login browser UI interaction added two runtime details beyond the direct probes.

### Indicator Switch

Clicking the `Interest Rate` radio changed the checked state from:

- `Inflation Rate`: `true`
- `Interest Rate`: `false`

to:

- `Inflation Rate`: `false`
- `Interest Rate`: `true`

The visible list changed from inflation symbols such as `ARIRYY`, `TRIRYY`, `RUIRYY`, `AUIRYY`, and `USIRYY` to interest-rate symbols such as `TRINTR`, `ARINTR`, `BRINTR`, `RUINTR`, and `USINTR`.

Post-click WebSocket send summary:

- one `quote_add_symbols` batch for `ECONOMICS:*INTR`
- 266 `quote_remove_symbols` messages for retiring prior or unavailable macro-map symbols
- no `resolve_symbol`, `create_series`, `create_study`, scanner REST, or separate macro REST data endpoint in the indicator-switch phase

This proves the UI-specific indicator switch is a quote-session symbol-family replacement. For filter-only/latest views, the indicator id maps directly into `ECONOMICS:<country><indicator>`.

### Historical Date Slider

Dragging the `Select date` slider while `Interest Rate` was active changed the visible date from latest values around `May 6, 2026` to a historical point shown as `Jan 10, 2004`. The ranked list changed to historical observations such as:

- `TRINTR 26% Dec 31, 2003`
- `BRINTR 16.5% Dec 31, 2003`
- `ZAINTR 8% Dec 31, 2003`
- `USINTR 1% Dec 31, 2003`
- `JPINTR 0% Dec 31, 2003`

Post-drag network/runtime behavior:

- loaded `multi-group-series-snapshoter.*.js`
- no scanner or separate macro REST data endpoint
- WebSocket sent two `chart_create_session` frames
- WebSocket sent two `resolve_symbol` frames, sample symbols `ECONOMICS:SRINTR` and `ECONOMICS:DZINTR`
- WebSocket sent two `create_series` frames with interval `D` and a `["bar_count", 1073692801, 1]` selector
- WebSocket sent 168 `create_study` frames for `Overlay@tv-basicstudies-164!`, with one overlay per economic symbol, e.g. `{"symbol":"ECONOMICS:TRINTR"}`, `{"symbol":"ECONOMICS:CAINTR"}`, `{"symbol":"ECONOMICS:GBINTR"}`
- teardown emitted 168 `remove_study` frames and two `chart_delete_session` frames

This closes the UI-specific historical slider sequencing gap: the slider uses a multi-group chart-series snapshoter path, not the quote-only latest snapshot path.

### Country Group Switch

Clicking the `G20` group button opened a menu with `role="menu"` and `role="menuitemcheckbox"` entries:

| Group | Count |
| --- | ---: |
| `G20` | 19 |
| `World` | 186 |
| `North America` | 10 |
| `Europe` | 46 |
| `Middle East / Africa` | 70 |
| `Mexico and South America` | 23 |
| `Asia / Pacific` | 37 |

Selecting `World` changed the visible group button from `G20` to `World` and replaced the visible list. The first visible G20 `IRYY` country codes were:

`AR`, `TR`, `RU`, `AU`, `MX`, `BR`, `IN`, `GB`, `US`, `ZA`, `DE`, `IT`, `KR`, `ID`, `CA`, `FR`, `SA`, `JP`, `CN`.

The first visible World `IRYY` country codes after selection were:

`VE`, `SS`, `SD`, `KP`, `IR`, `AR`, `TR`, `MM`, `MW`, `HT`, `LB`, `NG`, `BO`, `EG`, `CU`, `AO`, `LY`, `SY`, `KG`, `PK`, `BI`, `SR`, `KZ`, `SL`, `LA`, `RO`, `ET`, `ER`, `ST`, `BD`, `UA`, `RW`, `MN`, `PH`, `BG`, `UZ`, `ZM`, `XK`, `GM`, `AF`.

Post-selection behavior:

- no new TradingView WebSocket data frames were emitted after selecting `World`
- no scanner or macro REST request was emitted
- the only observed fetches were country flag SVGs under `s3-symbol-logo.tradingview.com/country/*.svg`

This closes the public country-group/list behavior gap for first-pass modeling. Country groups are UI filters over the already populated economic-symbol set for the active indicator, not separate data endpoints in the observed no-login latest-value path.

## Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| `component-data-only=1` public response had shell/null active data in prior pass | shell-only page data | Not absence; browser runtime still populates via chart data |
| Clean browser used `unauthorized_user_token` and still received `qsd` frames | unauthenticated-achievable for default indicator quote snapshots | Worker can model a public default macro-map quote path |
| Direct no-cookie probe returned `qsd` for `USGDP`, `USUR`, `USINTR`, and `USGDG` | unauthenticated-achievable for non-default indicator quote snapshots | Treat indicator switch as an economic-symbol suffix change when the UI does not add extra filters |
| Direct no-cookie probe returned `timescale_update` and `series_completed` for `ECONOMICS:USGDP` | unauthenticated-achievable for historical economic series | Model historical slider snapshots through chart `resolve_symbol`/`create_series` flow |
| UI Interest Rate switch emitted `quote_add_symbols` for `ECONOMICS:*INTR` and many `quote_remove_symbols`; page values changed to `*INTR` symbols | unauthenticated-achievable UI indicator switch | Model filter/latest indicator switching as quote session symbol-family replacement |
| UI date slider loaded `multi-group-series-snapshoter` and emitted chart sessions with `Overlay@tv-basicstudies-164!` for many `ECONOMICS:*INTR` symbols | unauthenticated-achievable historical UI slider | Model historical map snapshots as batched chart/overlay studies, not a REST endpoint |
| UI country group menu exposed group counts and selecting `World` changed the visible list with no new data WebSocket frames | local UI filtering over active macro quote set | Model country groups as filters/list projections; fetch flag assets separately if needed |
| Some `ECONOMICS:*IRYY` symbols returned `no_such_symbol` | partial availability / symbol coverage | Keep per-country availability/errors in schema rather than failing whole map |
| Public pushstream opened but stayed idle | observed-open-idle | Needs trigger or ignore for macro-map data modeling |

No auth, rate-limit, DNS, or network outage was observed.

## Worker Gap Update

Current Worker chart-data primitives can likely support macro maps, but there is no first-class product model that composes:

- indicator id, defaulting to `IRYY` for the observed first-load run
- country-code list
- country group definitions and counts: G20 19, World 186, North America 10, Europe 46, Middle East / Africa 70, Mexico and South America 23, Asia / Pacific 37
- economic symbol construction `ECONOMICS:<country><indicator>`
- quote session field set for availability/latest values
- partial per-symbol `ok` vs `no_such_symbol` results
- optional historical series snapshots for slider/timestamp interactions
- UI historical snapshoter behavior using `multi-group-series-snapshoter`, `create_series` with a `bar_count` timestamp selector, and many `Overlay@tv-basicstudies-*` studies over economic symbols
- runtime-accepted macro quote fields: `pro_name`, `short_name`, `last_price`, `country_code`, `available_data_range_end_date`, `available_data_range_begin_date`, `short_description`, `data_frequency`, `unit_id`, `value_unit_id`, `currency_code`, `measure`, and `lp`

## Remaining Macro Maps Gaps

- Decide Worker design: first-class `/v1/macro-maps` composed product route vs lower-level economic quote/series helpers.

## Completion Decision

Macro maps is materially upgraded: the default no-login browser path now has populated chart-data WebSocket evidence, direct public probes cover non-default economic indicator quote snapshots, direct public historical economic series path is proven, UI indicator switch behavior is captured, UI historical slider sequencing is captured, and UI country group/list behavior is captured. The broader full TradingView rediscovery objective remains incomplete because authenticated surfaces, mutation probes, replay/deep-backtesting, Pine Screener auth/entitlement, widget controlled interactions, mobile/desktop traffic, and Worker design decisions remain open.
