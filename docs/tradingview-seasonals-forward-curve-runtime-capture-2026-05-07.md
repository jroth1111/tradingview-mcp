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
| CDP script process stayed open after writing the artifact | harness lifecycle bug | Exact Chrome/Node PIDs were terminated and temp profile removed; captured runtime evidence remains valid |
| Pushstream opened but no channel messages were needed for these views | observed-open-idle | Keep pushstream trigger behavior open elsewhere |

No auth, rate-limit, DNS, or network outage was observed.

## Worker Gap Update

Seasonals and forward curves are not first-class Worker surfaces today.

Potential modeling paths:

- Seasonals: expose a chart-session-backed helper that resolves `INTERNAL:SEASONALS`, creates the internal yearly series, and applies `Seasonals@tv-basicstudies-*` with a ticker/year-range config.
- Forward curves: expose a futures forward-curve helper that requests `scanner.tradingview.com/futures/scan?label-product=futures-forward-curve`, derives the contract chain, then subscribes to contract quotes over `data.tradingview.com`.

## Remaining Gaps

1. Decode or reproduce the seasonals `du` compressed study output into a stable response schema.
2. Probe seasonals year-range/table-view interactions.
3. Probe additional forward-curve roots and interaction variants.

## Completion Decision

Seasonals and forward curves are now public browser-runtime surfaces, not merely static leads. Forward-curve scanner schema is verified for representative `CME_MINI:ES` and `NYMEX:CL` roots. The full TradingView rediscovery objective remains incomplete because authenticated surfaces, mutation probes, replay/deep-backtesting, Pine Screener auth behavior, macro-map remaining UI interactions, widget controlled interactions, mobile/desktop traffic, and broader account-gated flows remain open.
