# TradingView Unauthenticated Browser Runtime Capture - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Capture mode: fresh Playwright Chromium context with no saved storage state
- Evidence timestamp: `2026-05-07T06:48:22+10:00`
- Scope: passive first-load browser runtime calls for selected public product pages
- Pages: `/options/`, `/pine-screener/`, `/heatmap/stock/`, `/economic-calendar/`

This artifact distinguishes surfaces that can be reached by an unauthenticated browser page load from surfaces that were only observed in the authenticated HAR. It does not prove the authenticated surfaces are impossible unauthenticated; it records what has been proven so far.

## Probe

Command shape:

```bash
python3 - <<'PY'
# Playwright Chromium, storage_state=None.
# Captured document/xhr/fetch/websocket/eventsource responses.
# Excluded static assets and non-TradingView hosts.
PY
```

Result: exit code 0 from `/Users/gwizz/CascadeProjects/Trading/tradingview`.

Counterexample shown: if the unauthenticated browser path were assumed to need account cookies for all product data, this probe would fail that assumption by loading options, heatmap, calendar, scanner, and symbol-search product endpoints with status 200 in a clean browser context.

## Runtime-Proven Unauthenticated Product Calls

| Page | Method | Host | Path | Status | Runtime evidence |
| --- | --- | --- | --- | --- | --- |
| `/options/` | `POST` | `scanner.tradingview.com` | `/global/scan2` | 200 | `label-product=options-builder` |
| `/options/` | `POST` | `scanner.tradingview.com` | `/options/scan2` | 200 | `label-product=options-builder` |
| `/options/` | `GET` | `symbol-search.tradingview.com` | `/symbol_search/v3/` | 200 | `only_has_options=true`, `domain=production` |
| `/heatmap/stock/` | `POST` | `scanner.tradingview.com` | `/america/scan` | 200 | `label-product=heatmap-stock` |
| `/economic-calendar/` | `GET` | `economic-calendar.tradingview.com` | `/events` | 200 | `from`, `to`, `countries` query |
| `/economic-calendar/` | `POST` | `scanner.tradingview.com` | `/global/scan` | 200 | `label-product=calendar-dividends`, `calendar-earnings` |

Common public shell calls also loaded unauthenticated:

- `GET www.tradingview.com/api/v1/offers/`
- `POST www.tradingview.com/check_language/`
- public page documents for `/options/`, `/pine-screener/`, `/heatmap/stock/`, and `/economic-calendar/`

## Auth Classification Delta

Move these surfaces from `auth-status-unknown` or `authenticated-observed-only` to `unauthenticated-achievable`:

- Options chain initial scanner data: `scanner.tradingview.com/options/scan2`
- Options builder global scanner bootstrap: `scanner.tradingview.com/global/scan2`
- Options symbol search: `symbol-search.tradingview.com/symbol_search/v3/?only_has_options=true`
- Stock heatmap scanner feed: `scanner.tradingview.com/america/scan?label-product=heatmap-stock`
- Economic calendar events: `economic-calendar.tradingview.com/events`
- Dividend and earnings calendar scanner feeds: `scanner.tradingview.com/global/scan?label-product=calendar-dividends|calendar-earnings`

Keep these as authenticated-required-or-observed until separately disproven:

- Chart-storage user/layout sources with JWT query parameters
- Pricealerts list/offline-fire endpoints
- Watchlist list/read endpoints under `/api/v1/symbols_list/*`
- Pine facade eval/list/translate/script-info calls observed with cookies
- Study templates, script package store, personal script access
- Chats/support unread state, broker trading panel metadata

## Negative And Positive Holes

Negative-probe hole: this capture used a clean browser context, but it did not try authenticated-only URLs directly without cookies. Some HAR-authenticated endpoints may also have unauthenticated read shapes that were not exercised.

Positive-probe hole: passive first load is not the full product surface. Pine Screener loaded only its document and offers call in this pass; options interactions such as changing underlying, expiry, strategy, or volatility chart were not exercised. Portfolio, paper trading, alerts mutations, watchlist/layout mutations, replay, and deep backtesting remain open discovery surfaces.
