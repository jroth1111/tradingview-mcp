# TradingView Product Runtime Capture - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Capture mode: Playwright Chromium, clean context, no saved storage state
- Scope: public product pages that still had passive-runtime gaps after the first expansion pass
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`

This artifact records sanitized first-load XHR/fetch request shapes. Static assets and common shell calls such as offers/check-language were filtered out.

## Runtime-Proven Public Pages

| Page | Runtime endpoint | Status | Shape summary |
| --- | --- | --- | --- |
| `/heatmap/etf/` | `POST scanner.tradingview.com/america/scan?label-product=heatmap-etf` | 200 | `columns`, `filter`, `markets`, `options`, `sort`; market `america`; sort `aum desc`; filters include ETF/ETN typespecs, primary listing, non-empty AUM |
| `/heatmap/crypto/` | `POST scanner.tradingview.com/coin/scan?label-product=heatmap-coin` | 200 | `columns`, `filter`, `markets`, `options`, `sort`; market `coin`; sort `market_cap_calc desc`; filters exclude legacy names and require non-empty market cap |
| `/cex-screener/` | `POST scanner.tradingview.com/crypto/scan?label-product=screener-crypto-cex` | 200 | `columns`, `filter2`, `range`, `sort`; market `crypto`; `centralization equal cex`; sort `24h_vol|5 desc` |
| `/cex-screener/` | `POST scanner.tradingview.com/crypto/metainfo?label-product=screener-crypto-cex` | 200 | metainfo requests for exchange, currency, base/counter currency columns |
| `/cex-screener/` | `GET scanner.tradingview.com/enum/ordered?...label-product=screener-crypto-cex` | 200 | enum metadata for exchange/currency/technical-rating families |
| `/dex-screener/` | `POST scanner.tradingview.com/crypto/scan?label-product=screener-crypto-dex` | 200 | `columns`, `filter2`, `range`, `sort`; market `crypto`; DEX + USD spot filters; sort `dex_txs_count_24h desc` |
| `/dex-screener/` | `POST scanner.tradingview.com/crypto/metainfo?label-product=screener-crypto-dex` | 200 | metainfo for blockchain/exchange/currency columns |
| `/dex-screener/` | `GET scanner.tradingview.com/enum/ordered?...label-product=screener-crypto-dex` | 200 | enum metadata for DEX filter families |
| `/bond-screener/` | `POST scanner.tradingview.com/bond/scan?label-product=screener-bond` | 200 | `columns`, `markets`, `range`, `sort`; market `bond`; sort `bond_snp_rating_lt desc` |
| `/bond-screener/` | `POST scanner.tradingview.com/bond/metainfo?label-product=screener-bond` | 200 | metainfo for currency and bond classification/rating columns |
| `/bond-screener/` | `GET scanner.tradingview.com/enum/ordered?...label-product=screener-bond` | 200 | enum metadata for bond type, rating, coupon, issuer, country, sector, duration families |
| `/etf-screener/` | `POST scanner.tradingview.com/america/scan?label-product=screener-etf` | 200 | `columns`, `filter2`, `markets`, `range`, `sort`; market `america`; ETF/structured filter; sort `aum desc` |
| `/etf-screener/` | `POST scanner.tradingview.com/global/metainfo?label-product=screener-etf` | 200 | global ETF metainfo across many markets |
| `/etf-screener/` | `POST scanner.tradingview.com/america/metainfo?label-product=screener-etf` | 200 | local ETF metainfo for currency and classification columns |
| `/etf-screener/` | `GET scanner.tradingview.com/enum/ordered?...label-product=screener-etf` | 200 | enum metadata for ETF filters |

## Passive-Load Shell Only

| Page | Result | Classification |
| --- | --- | --- |
| `/yield-curves/` | document HTTP 200; no product XHR/fetch beyond shell/offers | static/page-lead; runtime API still open |
| `/macro-maps/` | document HTTP 200; no product XHR/fetch beyond shell/offers | static/page-lead; runtime API still open |
| `/pine-screener/` | document HTTP 200; no product XHR/fetch beyond shell/offers | static/page-lead; interaction needed for `/pine_scanner_http/scan` |

Follow-up bundle mining in `docs/tradingview-shell-page-bundle-mining-2026-05-07.md` promoted yield curves to unauthenticated-achievable via `GET /yield-curves/?component-data-only=1`, found macro maps component shell data, and identified the Pine Screener scan host/method/credential behavior.

## Classification Delta

Move these from static/page-only leads to unauthenticated-achievable runtime surfaces:

- ETF heatmap scanner feed.
- Crypto heatmap scanner feed.
- CEX screener first-load scan, metainfo, and enum endpoints.
- DEX screener first-load scan, metainfo, and enum endpoints.
- Bond screener first-load scan, metainfo, and enum endpoints.
- ETF screener first-load scan, metainfo, and enum endpoints.

Keep these open:

- Yield curves runtime APIs.
- Macro maps runtime APIs.
- Pine Screener `/pine_scanner_http/scan`.
- Screener save/autosave/facade/storage paths, because passive first-load scanner data is not persistence behavior.

## Worker Gap

Current Worker `/v1/scan` can post to `scanner.tradingview.com/{market}/scan`, but these product surfaces use additional conventions not modeled as first-class routes:

- `label-product` values carry product identity.
- `scan`, `scan2`, `metainfo`, and `enum/ordered` are separate endpoint families.
- Product payloads use both flat `filter` and nested `filter2`.
- Market namespaces include `coin`, `crypto`, `bond`, `global`, and region-specific stock markets.
- Product metadata calls are needed to populate filters and columns rather than hard-coding field catalogs.

## Failure Classification

- No network, DNS, auth, rate-limit, or upstream failures occurred.
- Passive-load absence for yield curves, macro maps, and Pine Screener is not service absence. Those pages likely require user interaction, lazy loading, or bundle request-builder extraction.

## Next Probes

1. User interaction on `/yield-curves/` and `/macro-maps/` to trigger runtime XHR.
2. Pine Screener interaction and/or bundle decompilation to capture `/pine_scanner_http/scan`.
3. Screener save/autosave capture for `screener-facade`, `screener-storage`, and `/api/v2/screens`.
4. Response schema sketches for scanner/metainfo/enum endpoints by product family.
5. Paired auth probes for product-specific screeners to detect entitlement or saved-view differences.
