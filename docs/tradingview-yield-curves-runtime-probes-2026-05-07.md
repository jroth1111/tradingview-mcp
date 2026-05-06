# TradingView Yield Curves Runtime Probes - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Mode: public no-cookie direct probes plus Chrome DevTools Protocol browser inspection
- Task class: planned multi-item research checkpoint, documentation artifact only
- Source requirement: continue public rediscovery and classify route/parameter misses without downgrading the surface
- Direct probe command class: Node `fetch` against component-data variants
- Browser capture workspace: `/tmp/tv-yield-cdp.w6DQ4A/capture.json`
- Sensitive inputs: none used

## Direct Component-Data Probes

| Probe | URL shape | HTTP | Result | Classification |
| --- | --- | ---: | --- | --- |
| `default` | `/yield-curves/?component-data-only=1` | 200 | JSON keys `country_code`, `scan_data`, `available_countries`, `settings`; `country_code=us`; 13 rows; first symbol `TVC:US01MY`; 48 available countries | unauthenticated-achievable |
| `country_de_query` | `/yield-curves/?component-data-only=1&country=de` | 200 | identical default `country_code=us` payload | query ignored / not parameterized this way |
| `country_jp_query` | `/yield-curves/?component-data-only=1&country=jp` | 200 | identical default `country_code=us` payload | query ignored / not parameterized this way |
| `path_de` | `/yield-curves/de/?component-data-only=1` | 404 | HTML shell | route-discovery miss |
| `hash_de` | `/yield-curves/?component-data-only=1#country=de` | 200 | identical default `country_code=us` payload | fragment is client-only, not server parameter |

Counterexample shown: country changes are not proven by simply guessing `country=de`, path suffixes, or fragments. Those probes either returned the default US payload or a 404 route miss. Do not downgrade non-US yield curves; the page still exposes 48 available countries and likely changes country through client-side state/UI.

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

## Failure Classification

| Observation | Classification | Handling |
| --- | --- | --- |
| `country=de` and `country=jp` returned US data | parameter mismatch | Keep non-US countries open; do not mark unsupported |
| `/yield-curves/de/` returned 404 | route-discovery miss | Use UI/bundle state instead of path guessing |
| `#country=de` returned US data | client fragment ignored server-side | Use browser interaction or decompiled state writer |
| No WebSocket on initial load | normal first-load architecture | Component-data endpoint is sufficient for default table |

No auth, rate-limit, DNS, or network outage was observed.

## Worker Gap Update

Yield curves can begin as a public read endpoint for the default component-data payload, but a complete product model still needs:

- country-switch trigger and request/state mechanism
- settings fields and date row behavior
- `Add`, `Clone`, and `Delete` semantics, including whether they are local-only or persisted
- response schema for all countries, not just default US

## Remaining Yield-Curves Gaps

1. Browser-click the country selector and capture the country-switch request/state path.
2. Capture Settings changes and whether they affect component-data requests or local state only.
3. Determine whether `Add`, `Clone`, and `Delete` are local-only table-row operations or persisted settings.
4. Probe a non-US country through the actual UI-derived mechanism and record the resulting symbol family.

## Completion Decision

Yield curves are stronger than before: default public component-data and initial browser rendering are verified, and naive non-US parameter guesses are classified as route/parameter misses. The full TradingView rediscovery objective remains incomplete because non-default yield interactions, authenticated surfaces, mutation probes, replay/deep-backtesting, Pine Screener auth behavior, widget controlled interactions, mobile/desktop traffic, and broader account-gated flows remain open.
