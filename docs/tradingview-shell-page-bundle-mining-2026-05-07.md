# TradingView Shell Page Bundle Mining - 2026-05-07

## Status

- Bead: `tradingview-cef`
- Probe class: temp-only public bundle mining plus direct no-cookie page-data probes
- Pages: `/yield-curves/`, `/macro-maps/`, `/pine-screener/`
- Working directory: `/Users/gwizz/CascadeProjects/Trading/tradingview`

Bundles were downloaded to a temporary directory and deleted after extracting compact evidence. No third-party bundles were committed.

## Bundle Mining Result

The three pages referenced 68 JavaScript bundles, about 4 MB total in the temp workspace.

High-signal request-builder findings:

| Surface | Bundle evidence | Classification |
| --- | --- | --- |
| Yield curves | Bundle code builds `new URL("/yield-curves/", window.location.origin)` and appends `component-data-only=1`; fetch method `GET` | request-builder found |
| Macro maps | Runtime chunk names include `macro-maps-builder-dialog`; page bundle hydrates macro maps state | request-builder partially found |
| Pine Screener | `pine_screener...js` defines scan fetch to `${PINE_SCREENER_HOST || "https://pine-screener.tradingview.com"}/pine_scanner_http/scan` with `method:"POST"`, JSON body, `credentials:"include"`, and `Accept: application/json` | request-builder found; body later derived in `docs/tradingview-pine-screener-macro-decompilation-2026-05-07.md` |

## Direct Page-Data Probes

| Surface | Method | Endpoint | No-cookie result | Shape summary | Classification |
| --- | --- | --- | --- | --- | --- |
| Yield curves page data | `GET` | `www.tradingview.com/yield-curves/?component-data-only=1` | HTTP 200 | top-level keys `available_countries`, `country_code`, `scan_data`, `settings`; default `country_code=us`; `scan_data.columns`; `scan_data.data` length 13; row keys `s`, `d`; first row symbol family `TVC:US01MY`; data vector length 11 | unauthenticated-achievable |
| Macro maps page data | `GET` | `www.tradingview.com/macro-maps/?component-data-only=1` | HTTP 200 | keys `locale`, `isAuthorization`, `activeIndicator`, `timestamps`, `typeTable`, `countryGroup`, `mapExtrasVisible`, `indicators`; no-session response has `isAuthorization=false` and null active data fields | unauthenticated-page-data-shell |

## Pine Screener UI Gate

A clean no-session browser render of `/pine-screener/` produced the visible text `Sign in to use Pine Screener` and no scan controls. This means:

- The bundle exposes the scan transport path and credential behavior.
- The public no-session UI does not expose the scan body.
- Capturing a successful scan requires an authenticated browser session; a later decompilation pass derived the request-body shape.

## Classification Delta

Move yield curves from static/page-only to unauthenticated-achievable for the default component-data endpoint.

Follow-up runtime probes in `docs/tradingview-yield-curves-runtime-probes-2026-05-07.md` confirmed the direct default payload and browser-rendered table, and classified naive `country=de`, `country=jp`, `/yield-curves/de/`, and `#country=de` probes as parameter/route misses rather than non-US absence.

Keep open:

- Macro maps data population, because the no-cookie component-data endpoint returned shell state with null indicators/timestamps/type table.
- Pine Screener authenticated behavior, because a later structurally valid no-cookie scan returned `missing_or_invalid_auth_headers`.

## Failure Classification

- Passive-load absence was not service absence. Bundle mining found the yield-curves component-data path, and direct probing returned data.
- Macro maps component-data returned HTTP 200 shell data, not an auth or network error.
- Pine Screener requires authenticated interaction for successful scans. A later decompilation pass derived the body shape and a no-cookie structurally valid scan returned `missing_or_invalid_auth_headers`.

## Worker Gap

Current Worker has no first-class yield curves, macro maps, or Pine Screener route. Yield curves can likely begin as a public read endpoint for component page data. Macro maps should be modeled as a chart-data-backed economic-symbol composition, and Pine Screener should be modeled as an authenticated/header-required Pine stream endpoint.

## Remaining Probes

1. Macro maps browser interaction to record ChartApi/WebSocket frames for indicator/timestamp changes.
2. Authenticated Pine Screener interaction to distinguish login, feature-flag, and plan entitlement behavior for `/pine_scanner_http/scan`.
3. Yield curves UI-derived parameter exploration: country changes, settings fields, and whether add/clone/delete are local-only or persisted. Simple `country=` query, path suffix, and fragment guesses did not change the default US component-data payload.
