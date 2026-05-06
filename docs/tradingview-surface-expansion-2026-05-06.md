# TradingView Surface Expansion Delta - 2026-05-06

## Status

- Bead: `tradingview-ca7`
- Parent context: `docs/tradingview-surface-rediscovery-2026-05-06.md`
- Evidence timestamp: `2026-05-06T20:40Z`
- Scope: unauthenticated product-page and bundle expansion pass
- Target pages: heatmaps, calendars, yield curves, macro maps, options, widget docs, Pine screener, CEX screener, DEX screener, bond screener, ETF screener, portfolio route, paper-trading route

This pass expands the first public sample from homepage/chart/markets into product-specific pages. It still does not replace authenticated browser runtime capture.

## Probe Record

| Probe | Command / source | Result |
| --- | --- | --- |
| Product page fetch | `curl -L --compressed` over 17 TradingView product URLs | 15 returned HTTP 200; `/portfolio/` and `/paper-trading/` returned HTTP 404 pages |
| Product JS inventory | `rg -o "https://static.tradingview.com/static/bundles/...js"` over fetched HTML | 110 unique JS bundle URLs |
| Product JS download | `curl -L --compressed` for all 110 JS URLs | 110 JS assets downloaded to temp, 6.9 MB |
| Host/path extraction | `rg -o -a "[A-Za-z0-9_.-]+\\.tradingview\\.com..."` over pages and bundles | 764 host/path strings |
| API/path extraction | `rg -o -a "(/[A-Za-z0-9_-]+){2,}..."` filtered by product/API terms | 447 path leads |
| Product keyword search | `rg -n -a "calendar|economic|yield|macro|heatmap|options|..."` | 879 keyword hit lines |
| Representative endpoint probes | `curl -L --compressed` for selected service paths | mixed 403 and 404 responses, no network outage |

Counterexample shown: the first report's three-page sample did not name several product-specific bundles and path families now visible here. A completeness claim based only on homepage/chart/markets would miss product-specific public code paths.

## Product Page Fetch Results

| URL | HTTP result | Classification |
| --- | --- | --- |
| `https://www.tradingview.com/heatmap/stock/` | 200 | public product page |
| `https://www.tradingview.com/heatmap/etf/` | 200 | public product page |
| `https://www.tradingview.com/heatmap/crypto/` | 200 | public product page |
| `https://www.tradingview.com/economic-calendar/` | 200 | public product page |
| `https://www.tradingview.com/earnings-calendar/` | 200 | public product page |
| `https://www.tradingview.com/dividend-calendar/` | 200 | public product page |
| `https://www.tradingview.com/yield-curves/` | 200 | public product page |
| `https://www.tradingview.com/macro-maps/` | 200 | public product page |
| `https://www.tradingview.com/options/` | 200 | public product page |
| `https://www.tradingview.com/widget-docs/` | 200 | public product page |
| `https://www.tradingview.com/pine-screener/` | 200 | public product page |
| `https://www.tradingview.com/cex-screener/` | 200 | public product page |
| `https://www.tradingview.com/dex-screener/` | 200 | public product page |
| `https://www.tradingview.com/bond-screener/` | 200 | public product page |
| `https://www.tradingview.com/etf-screener/` | 200 | public product page |
| `https://www.tradingview.com/portfolio/` | 404 | site route returns a 404 shell; service host still appears in bundles/config |
| `https://www.tradingview.com/paper-trading/` | 404 | site route returns a 404 shell; support and trading service evidence still exists |

## New Or Sharpened Bundle Leads

The expanded pages exposed product-specific bundle entrypoints:

- `calendar_page.9ff6e9f3c2ff835699c0.js`
- `market_heatmap.3a2360980393bc0c845e.js`
- `macro_maps_page.380e07d970da8e41f900.js`
- `yield_curves_page.68ebc3d2828589204723.js`
- `options_product.20091d9aabd1f621df65.js`
- `pine_screener.b1eeba1335cd6ad2fc90.js`
- `new_standalone_screener.14ba97e50eaef4a5c12e.js`
- `search-charts-category.8cc75d5c2b45f8a62e7b.js`

These are concrete product entrypoints for follow-up bundle decompilation/beautification.

## API And Route Delta

New or sharpened path leads not emphasized in the first report:

- `/calendar/render`
- `/api/v2/screens`
- `/pine_scanner_http/scan`
- `/symbol_search/v3`
- `/news-flow/v2/news`
- `/options/chain`
- `/options/strategies`
- `/options/strategies/handbook`
- `/options/strategy-finder`
- `/options/volatility`
- `/v1/strategies-chart`
- `/v1/volatility-chart`
- `/v1/news`
- `/v2/news`
- `/v2/headlines/symbol-list`
- `/v2/view/headlines/symbol`
- `/view/v1/symbol`
- `/portfolio/v1`
- `/support/solutions/43000516466-paper-trading-main-functionality`
- `/api/v1/symbols_list/colored`
- `/api/v1/symbols_list/colored/bulk_remove`
- `/api/v1/symbols_list/shared`

Market and macro route families expanded materially:

- World economy: `/markets/world-economy`, `/markets/world-economy/countries`, `/markets/world-economy/indicators`, `/markets/world-economy/indicators-heatmap`, and specific country/indicator pages.
- News taxonomy: `/news/corporate-activity/*`, `/news/economic-category/*`, `/news/top-providers/*`.
- Options product: chain, strategies, strategy finder, volatility, and chart endpoints.
- Widget docs: Astro-generated widget documentation assets and regional market docs.

## Service Probe Results

| Probe URL | HTTP result | Classification |
| --- | --- | --- |
| `https://economic-calendar.tradingview.com/calendar/render` | 403 | gated or requires exact request context |
| `https://scanner.tradingview.com/pine_scanner_http/scan` | 404 | wrong host or method/shape for Pine scanner path |
| `https://symbol-search.tradingview.com/symbol_search/v3` | 403 | gated or requires query/origin/session context |
| `https://news-headlines.tradingview.com/news-flow/v2/news` | 404 | wrong host or method/shape for path |
| `https://options-charting.tradingview.com/options/chain` | 404 | wrong host or method/shape for path |
| `https://options-charting.tradingview.com/v1/strategies-chart` | 404 | wrong method/shape or path requires parameters |
| `https://options-charting.tradingview.com/v1/volatility-chart` | 404 | wrong method/shape or path requires parameters |
| `https://portfolio.tradingview.com/portfolio/v1` | 404 | root/version path not enough; service still exists as configured host |
| `https://pine-screener.tradingview.com/pine_scanner_http/scan` | 403 | gated or requires exact request context |

No service probe in this pass failed due to DNS or local network outage. The failures above are route/gate/context classifications.

## Repo Coverage Delta

| Surface | New evidence | Current Worker support |
| --- | --- | --- |
| Heatmaps | dedicated pages and `market_heatmap` bundle | absent |
| Economic calendar render | public page plus `/calendar/render` 403 | partial via dividend/earnings only; economic calendar absent |
| Yield curves | dedicated page and `yield_curves_page` bundle | absent |
| Macro maps/world economy | dedicated page, world-economy route family, `macro_maps_page` bundle | absent |
| Options product | dedicated page, options bundle, chain/strategy/volatility route leads | absent |
| Pine screener | dedicated page, `pine_screener` bundle, Pine scanner host/path | absent |
| CEX/DEX/Bond/ETF screeners | dedicated pages, `new_standalone_screener`, `/api/v2/screens` | generic scanner only; these product surfaces absent |
| News flow taxonomy | news-flow and provider/category route families | partial news headline/content only |
| Symbol search v3 | `/symbol_search/v3` 403 | partial symbol search exists; v3 endpoint shape unverified |
| Watchlist colored/shared lists | additional `/api/v1/symbols_list/*` paths | absent |
| Widget docs | Astro widget docs route family | absent as first-class surface |
| Portfolio/paper | 404 route pages plus service/support/feature evidence | absent |

## Next Concrete Probes

1. Beautify/decompile product bundles for `calendar_page`, `market_heatmap`, `macro_maps_page`, `yield_curves_page`, `options_product`, `pine_screener`, and `new_standalone_screener`; extract request builders, host selection, methods, query parameters, and payload schemas.
2. Use browser network capture against the same product pages to observe real request methods and parameters. Static root `GET` probes are insufficient for these endpoints.
3. For screeners, capture `/api/v2/screens` and `/pine_scanner_http/scan` request bodies from the UI rather than guessing.
4. For options, capture options page XHR before treating `/options/chain`, `/v1/strategies-chart`, or `/v1/volatility-chart` as absent; current 404s may be missing symbol/date/body parameters or wrong host.
5. For portfolio and paper trading, use authenticated UI capture; public `/portfolio/` and `/paper-trading/` route 404s are not service absence.

## Acceptance Holes

Negative-probe hole: this pass proves that expanded public product pages reveal more surfaces than the initial sample, but it still cannot prove absence for surfaces hidden until authenticated UI interaction or feature/plan enablement.

Positive-probe hole: many path leads are still static bundle evidence or naive root/GET probes. Exact HTTP methods, payloads, response shapes, CSRF/session requirements, and plan gates require browser network capture or bundle request-builder decompilation.
