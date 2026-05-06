# TradingView Pine And Calendar Direct Probes - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Probe class: direct no-cookie replay of safe read-only HAR-observed request shapes
- Sensitive source: `/Users/gwizz/Downloads/www.tradingview.com.har`
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`

The HAR remains uncommitted. Scanner request bodies were replayed without cookies or JWTs; this artifact records sanitized endpoint, body-key, response-key, and classification evidence only.

## Probe Contract

Source requirement: distinguish unauthenticated from authenticated capability, and preserve shape/network/auth failure categories without downgrading surfaces on transient or invocation failures.

Counterexample shown: guessed scanner payloads for earnings/IPO/related-symbols returned 400 shape errors, but exact HAR body replay without cookies returned HTTP 200. Those first failures were invocation defects, not auth gates.

## Public Scanner Shape Replays

| Surface | Method | Endpoint | No-cookie result | Shape summary | Classification |
| --- | --- | --- | --- | --- | --- |
| Markets earnings | `POST` | `scanner.tradingview.com/america/scan?label-product=markets-earnings` | HTTP 200 | `preset=earning`; body keys `columns`, `filter`, `options`, `preset`, `range`, `sort`; range `[0,10]`; response includes `totalCount`, `data` | unauthenticated-achievable |
| IPO calendar | `POST` | `scanner.tradingview.com/global/scan?label-product=calendar-ipo` | HTTP 200 | `preset=ipo_calendar`; body keys `columns`, `filter`, `ignore_unknown_fields`, `markets`, `options`, `preset`, `range`, `sort`; response includes IPO rows | unauthenticated-achievable |
| Related symbols | `POST` | `scanner.tradingview.com/australia/scan?label-product=related-symbols` | HTTP 200 | body keys `columns`, `filter`, `filter2`, `ignore_unknown_fields`, `options`, `range`, `sort`; response includes `totalCount`, `data` | unauthenticated-achievable |
| Bond details | `POST` | `scanner.tradingview.com/bond/scan?label-product=details` | HTTP 200 | `preset=stocks_related_bonds`; body keys `columns`, `ignore_unknown_fields`, `index_filters`, `preset`, `range`; `index_filters.name=bond_issuer_cr_parent_stock_symbol`; response includes `totalCount`, `data`, `params` | unauthenticated-achievable |

## Pine Facade No-Cookie Probes

| Surface | Method | Endpoint family | No-cookie result | Classification |
| --- | --- | --- | --- | --- |
| Built-in/public Pine versions | `GET` | `pine-facade.tradingview.com/pine-facade/versions/<id>/last` | HTTP 200 list with `created`, `version` | unauthenticated-achievable |
| Built-in/public Pine translate | `GET` | `pine-facade.tradingview.com/pine-facade/translate/<id>/last` | HTTP 200 `success` result for probed scripts | unauthenticated-achievable |
| Pine script info | `GET` | `pine-facade.tradingview.com/pine-facade/get_script_info/?pine_id=<id>` | HTTP 401 `header 'X-Userid' is not specified` | authenticated-or-header-required |

## Classification Delta

Move these from `auth-status-unknown` or cookie-observed scanner leads to `unauthenticated-achievable` for the replayed shapes:

- Markets earnings scanner.
- IPO calendar scanner.
- Related-symbols scanner.
- Bond details / related bonds scanner.
- Pine versions for public/built-in scripts.
- Pine translate for public/built-in scripts.

Keep open:

- Pine `get_script_info`, because no-cookie probes returned a concrete 401 header/session requirement.
- Pine `eval_pine_ex`, because a safe direct compile/eval probe was not run in this pass.
- Pine Screener `/pine_scanner_http/scan`, because passive page load still does not trigger it.

## Failure Classification

- Harness/invocation: guessed scanner bodies returned 400 for earnings, IPO, and related-symbols. Exact HAR body replay without cookies returned 200, so the earlier failures are not source/auth evidence.
- Auth/header gate: Pine `get_script_info` returned HTTP 401 with missing `X-Userid`.
- No network, DNS, rate-limit, or upstream failures occurred in the corrected probe set.

## Worker Gap

Current Worker support includes generic `/v1/scan`, dividend calendar, earnings calendar, indicator search/meta/private, and study execution. It does not expose first-class IPO calendar, markets-earnings, related-symbols, bond-details, Pine versions, Pine translate, or Pine script-info routes.

These public scanner/Pine read surfaces are implementation candidates, but they should be grouped by authority boundary rather than added as one-off routes:

- Scanner product-read families: calendar, related-symbols, bond details, screener/heatmap/product scanners.
- Pine facade read families: list, versions, translate, script-info with explicit auth/header classification, and eval after safe probing.

## Remaining Safe Probes

1. Safe minimal `eval_pine_ex` compile/eval with a non-secret Pine snippet and redacted response-key sketch.
2. Pine Screener interaction or bundle request-builder extraction for `/pine_scanner_http/scan`.
3. Response schema sketches for IPO calendar, markets earnings, related-symbols, and bond details.
4. Authenticated pair probe for `get_script_info` to determine whether it needs cookies, `X-Userid`, or both.
