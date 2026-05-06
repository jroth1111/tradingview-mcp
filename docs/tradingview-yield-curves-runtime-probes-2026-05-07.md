# TradingView Yield Curves Runtime Probes - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: public no-cookie direct probes, Chrome DevTools Protocol browser inspection, and temp-only bundle mining
- Task class: planned multi-item research checkpoint, documentation artifact only
- Source requirement: continue public rediscovery and classify route/parameter misses without downgrading the surface
- Direct probe command class: Node `fetch` against component-data variants; native Node `WebSocket` against `data.tradingview.com`
- Browser capture workspace: `/tmp/tv-yield-ui.PBfjO9/inspect.json` and earlier `/tmp/tv-yield-cdp.w6DQ4A/capture.json`
- Sensitive inputs: none used

## Direct Component-Data Probes

| Probe | URL shape | HTTP | Result | Classification |
| --- | --- | ---: | --- | --- |
| `default` | `/yield-curves/?component-data-only=1` | 200 | JSON keys `country_code`, `scan_data`, `available_countries`, `settings`; `country_code=us`; 13 rows; first symbol `TVC:US01MY`; 48 available countries | unauthenticated-achievable |
| `country_de_query` | `/yield-curves/?component-data-only=1&country=de` | 200 | identical default `country_code=us` payload | query ignored / not parameterized this way |
| `country_jp_query` | `/yield-curves/?component-data-only=1&country=jp` | 200 | identical default `country_code=us` payload | query ignored / not parameterized this way |
| `path_de` | `/yield-curves/de/?component-data-only=1` | 404 | HTML shell | route-discovery miss |
| `hash_de` | `/yield-curves/?component-data-only=1#country=de` | 200 | identical default `country_code=us` payload | fragment is client-only, not server parameter |

Follow-up schema inspection at `2026-05-06T22:47Z` showed the default payload contains only the active country rows:

- `scan_data.columns`: `pricescale`, `minmov`, `term-to-maturity`, `close`, `close_30_days_back`, `close_365_days_back`, `typespecs`, `name`, `time`, `country_code`, `first_bar_time_1d`
- `scan_data.data`: 13 rows
- unique `scan_data.data[*].d[country_code]`: `US`
- `available_countries`: 48 entries with each country's `terms` symbol map and `first_bar_time`
- sample available-country terms include `TVC:AU01Y`, `TVC:AU10Y`, `TVC:DE01Y`, `TVC:DE10Y`, `TVC:JP01Y`, and `TVC:JP10Y`

Counterexample shown: country changes are not proven by simply guessing `country=de`, path suffixes, fragments, or assuming the default component-data payload includes every country. Those probes either returned the default US payload or a 404 route miss. Do not downgrade non-US yield curves; the page exposes a 48-country symbol registry and uses a separate client runtime path for non-default countries.

## Direct Non-US Yield Quote Probe

Public no-cookie WebSocket probe:

- URL shape: `wss://data.tradingview.com/socket.io/websocket?from=yield-curves/&date=...&auth=sessionid`
- auth token frame: `set_auth_token` with `unauthorized_user_token`
- quote frames: `quote_create_session`, `quote_set_fields`, and `quote_add_symbols`
- requested symbols: `TVC:AU01Y`, `TVC:AU10Y`, `TVC:DE01Y`, `TVC:DE10Y`, `TVC:JP01Y`, `TVC:JP10Y`
- decisive returned frame names: `qsd`, `quote_completed`

All six requested non-US symbols returned status `ok` with public fields:

| Symbol | Country | Returned fields |
| --- | --- | --- |
| `TVC:AU01Y` | `AU` | `pro_name`, `lp`, `country_code`, `short_name`, `typespecs`, `description` |
| `TVC:AU10Y` | `AU` | `pro_name`, `lp`, `country_code`, `short_name`, `typespecs`, `description` |
| `TVC:DE01Y` | `DE` | `pro_name`, `lp`, `country_code`, `short_name`, `typespecs`, `description` |
| `TVC:DE10Y` | `DE` | `pro_name`, `lp`, `country_code`, `short_name`, `typespecs`, `description` |
| `TVC:JP01Y` | `JP` | `pro_name`, `lp`, `country_code`, `short_name`, `typespecs`, `description` |
| `TVC:JP10Y` | `JP` | `pro_name`, `lp`, `country_code`, `short_name`, `typespecs`, `description` |

This promotes non-US current yield quotes to unauthenticated-achievable through `available_countries[].terms` plus normal chart/quote WebSocket protocol. It does not yet prove the exact UI click sequence or persisted authenticated settings behavior.

## Browser Runtime Probe

A clean no-login browser load of `https://www.tradingview.com/yield-curves/` produced:

- 210 captured TradingView/static requests.
- HTTP 200 document for `/yield-curves/`.
- Visible rendered table with `USA`, `Current: May 7, 2026`, `1 month ago: Apr 7, 2026`, and `1 year ago: May 7, 2025`.
- Tenor columns: `1M`, `3M`, `6M`, `1Y`, `2Y`, `3Y`, `5Y`, `7Y`, `10Y`, `20Y`, `30Y`.
- Toolbar buttons including `Settings`, `Download and share`, date rows, `Clone`, `Delete`, and `Add`.
- No yield-related localStorage keys in the clean initial profile.

No WebSocket was needed for the first-load default table. The public component-data payload already carries the rendered scan rows for default US yield curves.

## Runtime Shape

Default component-data shape:

- `country_code`: `us`
- `available_countries`: 48 entries
- `scan_data.columns`: yield-curve field list
- `scan_data.data`: 13 rows
- row shape: `s` symbol plus `d` data vector
- default first row family: `TVC:US01MY`
- `settings`: present; deeper settings values should be summarized in the next parameter pass

Bundle-derived runtime shape from the page chunks:

- `getYieldCurvesPageProps` fetches only `/yield-curves/?component-data-only=1`; no country query parameter is appended.
- `available_countries` provides country metadata and term-to-symbol maps.
- default rows are built by filtering `scan_data` by `country_code`.
- non-default/current country additions call a helper that reads the selected country's `terms` map and snapshots the term symbols through chart-data runtime.
- table country rows use `data-qa-id="country-checkbox"`.
- Add Country uses `data-qa-id="add-country-button"`, opens `openMarketDialog`, and is wrapped in `runOrSigninWithFeature` with `feature:"yieldCurvesTool"` and `source:"Country button"`.
- Settings menu uses `data-qa-id="yield-curves-settings-button"` and items `key-tenors-button`, `tenor-scale-item`, `linear-scale-item`, and `heatmap-mode`.
- Settings storage key is `YieldCurves`; deprecated key is `yield-curves`.
- settings persistence is guarded by `window.is_authenticated`; guest interactions are local component state unless the sign-in wrapper blocks the operation.
- reducer actions include `addSeries`, `modifySeriesDate`, `toggleSeries`, `cloneSeries`, and `removeSeries`.
- Clone is also wrapped in `runOrSigninWithFeature` with `feature:"yieldCurvesTool"` and `source:"Clone series button"`.
- Delete dispatches `removeSeries` locally; settings persistence still depends on authenticated storage.

## Failure Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| `country=de` and `country=jp` returned US data | parameter mismatch | Keep non-US countries open; do not mark unsupported |
| `/yield-curves/de/` returned 404 | route-discovery miss | Use UI/bundle state instead of path guessing |
| `#country=de` returned US data | client fragment ignored server-side | Use browser interaction or decompiled state writer |
| No WebSocket on initial load | normal first-load architecture | Component-data endpoint is sufficient for default table |
| Non-US AU/DE/JP quote symbols returned `qsd` `ok` over `data.tradingview.com` with `unauthorized_user_token` | unauthenticated-achievable data path | Model non-US current yields from `available_countries[].terms` plus quote/chart WebSocket protocol |
| Add Country and Clone are wrapped in `runOrSigninWithFeature` | auth/feature gate may apply to guest UI actions | Keep UI-click and authenticated persistence behavior open |

No auth, rate-limit, DNS, or network outage was observed.

## Worker Gap Update

Yield curves can begin as a public read endpoint for the default component-data payload, but a complete product model still needs:

- country metadata and term symbol registry from `available_countries`
- current yield quote snapshots for non-default countries via `data.tradingview.com` quote WebSocket
- settings fields and date row behavior
- `Add`, `Clone`, and `Delete` guest-vs-authenticated semantics, including whether feature gates block guest UI operations or only prevent persistence
- historical/date-specific non-US snapshots through the bundle-derived chart snapshoter path

## Remaining Yield-Curves Gaps

1. Browser-click the Add Country selector and confirm the exact guest UI outcome: dialog opens, sign-in prompt, or gated denial.
2. Capture Settings changes and whether they affect component-data requests or local state only in an unauthenticated browser.
3. Capture authenticated settings persistence for `YieldCurves` / deprecated `yield-curves`.
4. Probe date-specific non-US snapshots through the bundle-derived chart snapshoter path, not only current quotes.

## Completion Decision

Yield curves are stronger than before: default public component-data and initial browser rendering are verified; naive non-US parameter guesses are classified as route/parameter misses; non-US current yield symbols for AU/DE/JP are verified public through quote WebSocket; and bundle mining identifies the Add Country, settings, clone, delete, and authenticated-storage paths. The full TradingView rediscovery objective remains incomplete because yield UI-click confirmation/authenticated persistence, authenticated surfaces, mutation probes, replay/deep-backtesting, Pine Screener auth behavior, widget controlled interactions, mobile/desktop traffic, and broader account-gated flows remain open.
