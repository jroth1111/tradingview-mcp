# TradingView Pine Screener And Macro Maps Decompilation - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Probe class: temp-only JavaScript bundle inspection plus one safe no-cookie read-style POST probe
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`
- Sensitive source: `/Users/gwizz/Downloads/www.tradingview.com.har`

No TradingView cookies, JWTs, account identifiers, or HAR secrets were sent. Downloaded TradingView bundles were kept in `/tmp/tv-decompile.*` and are not committed.

## Probe Contract

Source requirement: continue rediscovering unknown unknowns without downgrading surfaces on network, invocation, auth, or plan-gated failures.

Positive probe: inspect static bundle request builders for the remaining public/static gaps, then send only a non-mutating no-cookie request where the body shape can be derived from public bundle and public Pine facade data.

Negative probe: do not classify a failure as network, absent service, or unsupported surface when the returned error proves a narrower auth/header gate or when the failure came from harness invocation.

Counterexample shown: a zsh loop variable named `path` shadowed zsh's `$path`/`$PATH` binding and caused `curl`, `basename`, and `rg` to appear missing in that shell. The rerun with `bundle_path` succeeded, so that failure is classified as harness/invocation, not network or missing toolchain.

## Pine Screener Bundle Findings

Bundle inspected:

- `https://static.tradingview.com/static/bundles/pine_screener.b1eeba1335cd6ad2fc90.js`

Transport path:

- Host: `PINE_SCREENER_HOST` from init data, falling back to `https://pine-screener.tradingview.com`
- Path: `/pine_scanner_http/scan`
- Method: `POST`
- Body: `JSON.stringify(request)`
- Headers: `Accept: application/json`
- Credentials: `include`
- Response format: newline-delimited JSON stream parsed from the response body

The body builder has two request shapes:

| Trigger | Body keys | Notes |
| --- | --- | --- |
| Initial symbol resolution | `columns`, `sort`, `watchlist`, `options` | Built by the symbol-resolution path before an indicator scan. |
| Indicator scan | `columns`, `sort`, `scripts`, `script_columns`, `watchlist`, `options`, `script_filter` when filters exist, `request_id` | Built when a selected Pine indicator, selected watchlist, resolution, inputs, filters, and sort are available. |

Indicator scan details:

- `columns` starts with ticker support fields and includes `pricescale`, `minmov`, `fractional`, `minmove2`, `volume_precision`, and `formatter`.
- `sort.sortBy` is derived from the selected column's scanner sort column.
- `scripts[0].id` is the Pine `scriptIdPart`.
- `scripts[0].resolution` is the scanner time resolution derived from the UI resolution.
- `scripts[0].inputs` maps each supported Pine input id to `{ f, v, t }`, where `f` is whether the input is fake, `v` is the selected/default value, and `t` is the input type. Color inputs are converted to integers for RGB scripts.
- `scripts[0].inputs.text` carries the Pine IL template.
- `script_columns` uses `<scriptIdPart>@<plotId>` entries for output plots.
- `script_filter` is present only when filter operands are valid; filter expressions use `<scriptIdPart>@<plotId>` left/right fields and scanner filter operations.

## Pine Screener No-Cookie Probe

A no-cookie POST was generated from public data:

- Public source for script metadata: `GET pine-facade.tradingview.com/pine-facade/translate/STD%3BSMA/last`
- Target: `POST https://pine-screener.tradingview.com/pine_scanner_http/scan`
- Payload class: structurally valid Pine Screener scan body for the built-in `STD;SMA` script, with public Pine metadata and no account/session material.

Result:

| Endpoint | No-cookie result | Classification |
| --- | --- | --- |
| `pine-screener.tradingview.com/pine_scanner_http/scan` | HTTP 401, NDJSON body `s=error`, `reason=missing_or_invalid_auth_headers` | authenticated/header-required for structurally valid scan shape |

Classification delta:

- Pine Screener is no longer an unknown-body surface.
- It should move from `body still unknown` to `authenticated/header-required for derived valid scan shape`.
- This does not prove plan entitlement behavior after authentication; the bundle gates UI access on both `window.is_authenticated` and feature flag `PINE_SCREENER`.

## Macro Maps Bundle Findings

Bundles inspected:

- `macro_maps_page.380e07d970da8e41f900.js`
- Runtime chunks referenced by `/macro-maps/`, including the chunk that exports `CoreEconomicTool`

Macro maps has two distinct data layers:

| Layer | Evidence | Classification |
| --- | --- | --- |
| Page hydration | `GET /macro-maps/?component-data-only=1` via the login-bound component-data helper | unauthenticated page-data shell |
| Populated map data | client-side `ChartApiInstance` quote and series snapshot flows | chart-data-backed runtime surface, not a separate discovered REST endpoint |

The populated map path constructs economic symbols for all country codes for an active indicator, requests quote snapshots with fields including `pro_name`, `short_name`, `last_price`, `country_code`, `available_data_range_end_date`, `available_data_range_begin_date`, `short_description`, `data_frequency`, `unit_id`, `value_unit_id`, `currency_code`, and `measure`, then requests historical series snapshots for selected timestamps.

Default/favorite indicator behavior:

- Default indicator candidates are `IRYY`, `INTR`, `GDP`, `UR`, and `GDG`.
- Filter-only indicators include `CRLPI`, `DRPI`, `FPI`, `CCPT`, `MPI`, `OPI`, `SPI`, `ENP`, and `ESTR`.
- Country-group and table preferences are stored in local storage keys such as `macroMaps.countryGroup`, `macroMaps.typeTable`, `macroMaps.mapExtrasVisible`, and `macroMaps.indicatorTimestamps`.
- News side panel uses the news mediator/private news-flow path with `market=economic` and, for English/India locales, `economic_category=<category>`.

Classification delta:

- Macro maps should not be treated as missing only because `/macro-maps/?component-data-only=1` returns null active data for a guest.
- The hidden runtime path is chart-data-backed and should be probed through browser ChartApi/WebSocket capture or the existing chart-data authority, not by guessing additional REST query parameters.
- Follow-up browser/direct runtime capture in `docs/tradingview-macro-maps-browser-runtime-capture-2026-05-07.md` proved that the default no-login page opens `data.tradingview.com` and receives populated `ECONOMICS:*IRYY` `qsd` frames with `unauthorized_user_token`. Direct public probes also returned populated non-default `US{GDP,UR,INTR,GDG}` quote snapshots and `ECONOMICS:USGDP` historical `resolve_symbol`/`create_series` frames.

## Failure Classification

- Harness/invocation: the first macro chunk download loop used `path` as a zsh variable name and temporarily broke command lookup inside that shell. Rerun with `bundle_path` succeeded.
- Auth/header gate: Pine Screener returned `missing_or_invalid_auth_headers` for a structurally valid no-cookie scan shape.
- No network, DNS, rate-limit, or upstream outage was observed in the corrected Pine Screener and macro bundle pass.

## Worker Gap

Current Worker has chart-data and scanner foundations, but no first-class:

- Pine Screener scan route with explicit authenticated/header-required handling and NDJSON stream parsing.
- Macro maps route that maps indicator ids plus countries to the required ChartApi quote/series data flow.

Implementation should preserve the discovered authority boundaries:

- Pine Screener is not a generic scanner endpoint; it is a Pine-specific authenticated stream endpoint with Pine metadata dependencies.
- Macro maps is not a simple REST scanner; it is an economic-symbol chart-data composition over quote snapshots and historical series.

## Remaining Gaps

1. Authenticated Pine Screener capture to distinguish login-only, `PINE_SCREENER` feature flag, and paid-plan entitlement failures.
2. Browser macro maps interaction capture for filter-only indicators, country group switch behavior, exact country-code list changes, and historical slider event sequencing. Default `IRYY`, non-default `GDP`/`UR`/`INTR`/`GDG` quote snapshots, and GDP historical series frames are now runtime-proven.
3. Worker design decision: expose macro maps as a composed product route, or expose lower-level economic-symbol quote/series helpers first.
