# TradingView Options Runtime Capture - 2026-05-07

## Status

- Bead: `tradingview-lsn`
- Capture mode: Playwright Chromium, clean context, no saved storage state
- Page: `https://www.tradingview.com/options/`
- Result: document HTTP 200; title `Options Chain - Put & Call Options Overview - TradingView`
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`

This capture promotes the public options product from static bundle/path lead to runtime-proven request shapes. It also corrects the earlier naive service probe: first-load options data did not call `options-charting.tradingview.com/options/chain`; it used scanner `scan2` endpoints with options-specific payloads.

## Runtime Requests

| Method | Host | Path | Query | Classification |
| --- | --- | --- | --- | --- |
| `GET` | `symbol-search.tradingview.com` | `/symbol_search/v3/` | `lang=en`, `only_has_options=true`, `domain=production`, `sort_by_country=US`, `promo=true` | unauthenticated-achievable |
| `POST` | `scanner.tradingview.com` | `/options/scan2` | `label-product=options-builder` | unauthenticated-achievable |
| `POST` | `scanner.tradingview.com` | `/global/scan2` | `label-product=options-builder` | unauthenticated-achievable |

## Request Shape Sketches

### `/options/scan2`

Top-level keys:

- `columns`
- `filter2`
- `ignore_unknown_fields`
- `index_filters`

Observed columns:

- `ask`
- `bid`
- `currency`
- `delta`
- `expiration`
- `gamma`
- `iv`
- `option-type`
- `pricescale`
- `rho`
- `root`
- `strike`
- `theoPrice`
- `theta`
- `vega`
- `bid_iv`
- `ask_iv`

Observed `filter2` shape:

- root operator: `and`
- operand 1: expression `type equal option`
- operand 2: `or` of per-expiry `and` operations
- each per-expiry operation combines:
  - `expiration equal <YYYYMMDD number>`
  - `root equal <root code>`

Observed `index_filters`:

- `name`: `underlying_symbol`
- `values`: array of TradingView symbols, for example `CME_MINI:ESM2026`

### `/global/scan2`

Top-level keys:

- `columns`
- `ignore_unknown_fields`
- `symbols`

Observed columns:

- `close`
- `pricescale`
- `logoid`
- `currency`
- `change`
- `change_abs`

Observed `symbols`:

- `tickers`: array of underlying symbols, for example `CME_MINI:ESM2026`

## Classification Delta

- First-load options chain data is public and scanner-backed.
- Static leads for `options-charting.tradingview.com/options/chain`, `/v1/strategies-chart`, and `/v1/volatility-chart` remain valid leads, but they are not the observed first-load options chain path.
- Worker support for an initial options snapshot can likely start from `scanner.tradingview.com/options/scan2` plus `/global/scan2`, while strategy/volatility endpoints require separate interaction capture.

## Failure Classification

- The earlier 404s for `options-charting.tradingview.com/options/chain`, `/v1/strategies-chart`, and `/v1/volatility-chart` are method/shape/context failures, not service absence.
- No network, DNS, auth, rate-limit, or upstream failures occurred in this capture.

## Remaining Options Gaps

1. Interactions for changing underlying, expiry, and option root.
2. Strategy builder and strategy finder requests.
3. Volatility chart requests.
4. Response schema inventory for `/options/scan2`, including nested option rows and missing-field behavior.
5. Authenticated/pro differences, if any, for options columns or delayed/realtime entitlement.
