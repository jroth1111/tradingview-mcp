# TradingView Seasonals And Forward Curve Runtime Capture - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: clean no-login Chrome DevTools Protocol browser capture plus public route probes
- Task class: planned multi-item research checkpoint, documentation artifact only
- Source requirement: continue public rediscovery for seasonals and forward curves without treating route misses as capability absence
- Sensitive inputs: none used

## Route Probes

| Probe | HTTP | Result | Classification |
| --- | ---: | --- | --- |
| `/symbols/NASDAQ-AAPL/seasonals/` | 200 | title `AAPL Seasonals Chart`; loads `symbol_page_tab_seasonals` and `seasonals-chart` bundles | unauthenticated-achievable page |
| `/symbols/NASDAQ-AAPL/forward-curve/` | 404 | stock symbol has locale links but page-not-found content | route/product mismatch for stocks |
| `/symbols/CME_MINI-ES1!/forward-curve/` | 200 | title `E-mini S&P 500 Futures Forward Curve: ES1!`; loads `symbol_page_tab_forward_curve` | unauthenticated-achievable futures page |
| `/symbols/NYMEX-CL1!/forward-curve/` | 200 | title `Crude Oil Futures Forward Curve: CL1!`; loads `symbol_page_tab_forward_curve` | unauthenticated-achievable futures page |

Counterexample shown: a 404 from `NASDAQ:AAPL` forward-curve does not mean the forward-curve product is absent. The route is futures-specific in the probed set; continuous futures symbols returned 200.

## Seasonals Runtime

Clean no-login browser load:

- URL: `https://www.tradingview.com/symbols/NASDAQ-AAPL/seasonals/`
- visible page title: `AAPL Seasonals Chart`
- visible section: `Historical seasonal performance`
- visible tab content QA id: `symbol-page-tab-seasonals-id-content`
- visible chart controls: `Chart view`, `Table view`, `Take a snapshot`
- scripts: `symbol_page_tab_seasonals.*.js`, `seasonals-chart.*.js`, `lightweight-minichart-study-data-source.*.js`
- WebSocket: `wss://data.tradingview.com/socket.io/websocket?from=symbols%2FNASDAQ-AAPL%2Fseasonals%2F&date=...&auth=sessionid`
- side channel: `wss://pushstream.tradingview.com/message-pipe-ws/public` opened

Observed TradingView WebSocket frames:

- `set_data_quality` with `low`
- `set_auth_token` with `unauthorized_user_token`
- `set_locale` with `en`, `US`
- `quote_create_session`
- `quote_add_symbols` for `NASDAQ:AAPL`
- `chart_create_session`
- `switch_timezone` to `Etc/UTC`
- `resolve_symbol` for `INTERNAL:SEASONALS`
- `create_series` for the internal seasonal source: interval `1D`, count `300`, secondary interval `12M`
- `set_future_tickmarks_mode` with `full_single_session`
- `resolve_symbol` for `NASDAQ:AAPL`
- `quote_fast_symbols` for `NASDAQ:AAPL`
- `create_study` for `Seasonals@tv-basicstudies-238!` with config `{"ticker":"NASDAQ:AAPL","years":{"start":2021,"end":2026}}`
- returned frames included `series_loading`, `qsd`, `study_loading`, and `du`

The `du` payload carried the seasonal study output in compressed study data. This promotes the seasonals tab from static lead to unauthenticated browser-runtime surface backed by chart WebSocket plus a TradingView basic study.

## Seasonals Study Output Schema

Direct no-cookie reproduction of the same chart-study flow returned:

- frame names: `series_loading`, `qsd`, `symbol_resolved`, `series_timeframe`, `timescale_update`, `series_completed`, `study_loading`, `du`, `study_completed`
- `du.p[1].st1` keys: `node`, `st`, `ns`, `t`
- `du.p[1].st1.ns.d`: JSON string with key `dataCompressed`
- `dataCompressed`: base64 ZIP payload
- ZIP content: one JSON document, 19,923 bytes in the AAPL probe

Decoded JSON top-level keys:

- `performance`
- `seasonals`

`performance` shape:

- object keyed by year, e.g. `2021` through `2026`
- each year has `months` and `summary`
- `months` is a 12-item array
- completed months are two-number arrays, e.g. January 2021 `[-1.5600000000000023, -1.1683642899940099]`
- unavailable future months are `null`; the 2026 probe had 7 null future months
- `summary` is a two-number array, e.g. 2021 `[44.04999999999998, 32.99131216297182]`

`seasonals` shape:

- object keyed by year, e.g. `2021` through `2026`
- each year is an array of `[dayOfYear, price]` points
- AAPL sample counts: 2021 had 252 points and 2022 had 251 points
- AAPL 2021 first point: `[3, 133.52]`
- AAPL 2021 last point: `[365, 177.57]`

This closes the first-pass decoded seasonals response-schema gap. Remaining seasonals work is interaction coverage: year-range changes, table view, and broader symbol classes.

## Seasonals Table View Interaction

Clean no-login browser interaction on `https://www.tradingview.com/symbols/NASDAQ-AAPL/seasonals/`:

- initial controls: `Chart view` radio checked `true`, `Table view` radio checked `false`
- clicking `Table view` switched `Table view` radio to checked `true` and `Chart view` to checked `false`
- no additional TradingView chart/study WebSocket messages were emitted after the initial seasonals study flow
- no new scanner or chart-data HTTP API request was needed; only analytics and `data.tradingview.com/ping` appeared after the local toggle
- rendered table columns: `Date`, January through December, and `Year`
- rendered rows: 2026 through 2021 plus `Rises and falls`
- visible table values match the decoded `performance` percentages, e.g. 2026 row `-4.55%`, `1.81%`, `-3.93%`, `6.92%`, `5.96%`, then future-month dashes, and yearly `5.76%`
- table header also exposed `Average` and `Percent` controls

This confirms Table view is a local rendering mode over the existing decoded study payload, not a separate backend surface in the observed no-login path.

## Seasonals Average / Percent Controls

Follow-up clean no-login browser interaction started from the Table view state and inspected the `Average` and `Percent` controls:

- `Percent` is a `role="combobox"` button.
- clicking `Percent` opened a local option menu with `Percent` checked.
- clicking `Average` was accepted by the harness but did not introduce a new TradingView backend surface in the observed run.
- no additional scanner, chart-data REST, or chart/study WebSocket request was needed for these controls.
- the only TradingView backend request after the UI interactions was `https://data.tradingview.com/ping`; the remaining post-click requests were analytics.
- observed WebSocket send names across the whole run were the initial seasonals study lifecycle: `set_data_quality`, `set_auth_token`, `set_locale`, `quote_create_session`, `quote_add_symbols`, `chart_create_session`, `switch_timezone`, `resolve_symbol`, `create_series`, `set_future_tickmarks_mode`, `quote_fast_symbols`, `create_study`, followed by teardown `remove_study`, `remove_series`, and `chart_delete_session`.

This narrows the public controls gap: Table view and the visible Average/Percent display controls are local presentation variants over the decoded study payload. Year-range changes remain the public seasonals interaction likely to alter the `Seasonals@tv-basicstudies` config or trigger a study refresh.

## Seasonals Year-Range Interaction

Follow-up clean no-login browser interaction dragged the visible `Start year` slider thumb from `2021` to `2002` while keeping `End year` at `2026`.

Observed DOM state:

- before drag: `Start year` slider text `2021`; `End year` slider text `2026`
- after drag: `Start year` slider text `2002`; `End year` slider text `2026`
- the visible tick range remained `1980`, `1991`, `2002`, `2013`, `2026`

Observed TradingView WebSocket behavior after the drag:

- `chart_create_session`
- `switch_timezone`
- `resolve_symbol` for `INTERNAL:SEASONALS`
- `create_series` for `1D`, count `300`, secondary interval `12M`
- `set_future_tickmarks_mode`
- `resolve_symbol` for `NASDAQ:AAPL`
- `modify_series`
- `create_study` for `Seasonals@tv-basicstudies-238!` with config `{"ticker":"NASDAQ:AAPL","years":{"start":2002,"end":2026}}`
- `modify_study` with the same config
- returned frames included `series_loading`, `study_loading`, and `du`

The returned `du` used the same compressed study-output shape:

- update key: `st2`
- `st2.ns.d`: JSON string with `dataCompressed`
- observed `st2.ns.d` string length: 49,349 bytes for the widened 2002-2026 probe

Non-study HTTP after the drag was telemetry/ping only: `snowplow-pixel`, `data.tradingview.com/ping`, and `telemetry.tradingview.com/free/report`. No scanner or separate REST data endpoint was introduced.

This closes the public year-range interaction gap. Seasonals remains a chart-session/basic-study surface: widening the range re-runs the study with a different `years` config and returns the same compressed `du` schema.

## Forward Curve Runtime

Clean no-login browser loads:

- `https://www.tradingview.com/symbols/CME_MINI-ES1!/forward-curve/`
- `https://www.tradingview.com/symbols/NYMEX-CL1!/forward-curve/`

Common page behavior:

- visible section: `Market expectations of prices`
- visible tab content QA id: `curve-chart-block-id-content`
- scripts: `symbol_page_tab_forward_curve.*.js`, `series-chart-base.*.js`, `curve-chart-content-utils.*.js`
- REST fetch: `https://scanner.tradingview.com/futures/scan?label-product=futures-forward-curve`
- WebSocket: `wss://data.tradingview.com/socket.io/websocket?from=symbols%2F...%2Fforward-curve%2F&date=...&auth=sessionid`
- side channel: `wss://pushstream.tradingview.com/message-pipe-ws/public` opened

Observed futures forward-curve WebSocket behavior:

- `set_data_quality` with `low`
- `set_auth_token` with `unauthorized_user_token`
- `set_locale` with `en`, `US`
- `quote_create_session`
- `quote_add_symbols` / `quote_fast_symbols` over the active continuous contract and forward contract chain
- returned frames included many `qsd` and `quote_completed` frames

Representative contract chain evidence:

| Page | Continuous symbol | Forward symbols observed |
| --- | --- | --- |
| `CME_MINI-ES1!` | `CME_MINI:ES1!` | `CME_MINI:ESM2026`, `CME_MINI:ESU2026`, `CME_MINI:ESZ2026`, `CME_MINI:ESH2027`, through longer-dated `ES*` contracts |
| `NYMEX-CL1!` | `NYMEX:CL1!` | `NYMEX:CLM2026`, `CLN2026`, `CLQ2026`, `CLU2026`, `CLV2026`, through longer-dated `CL*` contracts |

This promotes forward curves from static/bundle lead to unauthenticated browser-runtime surface. The data path is a futures scanner discovery request plus public quote WebSocket fan-out across the contract chain.

## Forward Curve Scanner Schema

The browser's scanner request was a public no-cookie `POST`:

```json
{
  "columns": ["pricescale", "minmov", "minmove2", "fractional", "expiration", "close", "name", "currency"],
  "filter": [
    {"left": "close", "operation": "nempty"},
    {"left": "expiration", "operation": "nempty"}
  ],
  "ignore_unknown_fields": false,
  "sort": {"sortBy": "expiration", "sortOrder": "asc"},
  "markets": ["futures"],
  "index_filters": [{"name": "root", "values": ["CME_MINI:ES"]}]
}
```

Observed response for `CME_MINI:ES`:

- HTTP 200, JSON
- keys: `totalCount`, `data`
- `totalCount`: 21
- row shape: `{ "s": symbol, "d": [pricescale, minmov, minmove2, fractional, expiration, close, name, currency] }`
- first row: `CME_MINI:ESM2026` with expiration `20260618`, close `7379.25`, currency `USD`

Direct follow-up replay with the same body shape and `index_filters[0].values=["NYMEX:CL"]` returned:

- HTTP 200, JSON
- `totalCount`: 129
- first row: `NYMEX:CLM2026` with expiration `20260519`, close `96.11`, currency `USD`
- last row: `NYMEX:CLG2037` with expiration `20370120`, close `53.76`, currency `USD`

This closes the first-pass forward-curve scanner body/schema gap for representative index and energy futures roots. Broader root coverage remains a normal expansion task, not a blocker to classifying the surface as unauthenticated-achievable.

## Failure Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| Stock forward-curve route returned 404 | route/product mismatch | Use futures symbols for forward-curve runtime; do not downgrade futures forward curves |
| Forward-curve scanner POST for `CME_MINI:ES` returned `totalCount=21`; direct `NYMEX:CL` replay returned `totalCount=129` | unauthenticated-achievable scanner schema | Model contract discovery through `scanner.tradingview.com/futures/scan?label-product=futures-forward-curve` |
| Seasonals `du` compressed study output decoded to zipped JSON with `performance` and `seasonals` keys | unauthenticated-achievable decoded study schema | Model seasonals as chart-study output rather than REST |
| Seasonals Table view toggle emitted no new TradingView backend requests and rendered decoded performance table locally | local UI rendering over existing data | Do not model Table view as a separate upstream endpoint |
| Seasonals Average/Percent controls emitted no new scanner/chart REST or study-refresh WebSocket traffic in the observed no-login Table view run | local UI presentation controls | Do not model these controls as separate upstream endpoints unless future interactions prove a backend delta |
| Seasonals year-range drag from 2021 to 2002 emitted `create_study` and `modify_study` with `years.start=2002,end=2026`, then returned `du` compressed study output | unauthenticated-achievable study reconfiguration | Model year ranges as `Seasonals@tv-basicstudies-*` config, not a separate endpoint |
| CDP script process stayed open after writing the artifact | harness lifecycle bug | Exact Chrome/Node PIDs were terminated and temp profile removed; captured runtime evidence remains valid |
| Pushstream opened but no channel messages were needed for these views | observed-open-idle | Keep pushstream trigger behavior open elsewhere |

No auth, rate-limit, DNS, or network outage was observed.

## Worker Gap Update

Seasonals and forward curves are not first-class Worker surfaces today.

Potential modeling paths:

- Seasonals: expose a chart-session-backed helper that resolves `INTERNAL:SEASONALS`, creates the internal yearly series, and applies `Seasonals@tv-basicstudies-*` with a ticker/year-range config.
- Forward curves: expose a futures forward-curve helper that requests `scanner.tradingview.com/futures/scan?label-product=futures-forward-curve`, derives the contract chain, then subscribes to contract quotes over `data.tradingview.com`.

## Remaining Gaps

1. Probe additional forward-curve roots and interaction variants.
2. Probe broader seasonals symbol classes if Worker modeling needs non-stock coverage.

## Completion Decision

Seasonals and forward curves are now public browser-runtime surfaces, not merely static leads. Seasonals study output is decoded into a stable first-pass JSON schema, Table view plus Average/Percent display controls are local presentation variants, year-range changes are verified as `Seasonals@tv-basicstudies-*` config updates, and forward-curve scanner schema is verified for representative `CME_MINI:ES` and `NYMEX:CL` roots. The full TradingView rediscovery objective remains incomplete because authenticated surfaces, mutation probes, replay/deep-backtesting, Pine Screener auth behavior, macro-map remaining UI interactions, widget controlled interactions, mobile/desktop traffic, and broader account-gated flows remain open.
