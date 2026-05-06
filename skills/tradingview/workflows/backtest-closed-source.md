# Backtest closed-source strategy

Backtest a strategy whose Pine source is not visible to the user.

1. Find the strategy id (e.g., a paid `Script$PUB;<hash>@tv-scripting-101!`) via `list-indicators.md`.
2. Read the metainfo with `POST /v1/indicators/meta` to get `pineId`, `pineVersion`, and the typed inputs/properties.
3. Negotiate the version: `GET /v1/pine/versions?id=<pineId>` → `{version, created}`. Use this `version` for the next steps so closed-source paywall checks always run against the script author's published major. (`/v1/pine/versions-all` returns the full version list when available; the Worker falls back to `/last` when the upstream `versions/<id>/all` 404s — this is a recon lead, not HAR-verified.)
4. Check read access **before** dispatching: `GET /v1/pine/auth?id=<pineId>&version=<version>` → `{authorized: boolean}`. The Worker proxies `pine-facade/is_auth_to_get/<id>/<ver>` (text/plain `"true"` / `"false"`) and normalises to JSON. Surface the boolean to the caller; do not silently swallow the gate.
5. **Authorized=true path (reference)**: `POST /v1/strategy/run` with `pineId`/`pineVersion` and the user's `properties` + `inputs`. The Worker sends `Script$<pineId>@tv-scripting-101!` to TradingView; TV resolves source server-side. Returns the same `{report, trades, equity}` shape.
6. **Authorized=false path (plot-echo)**: author a thin receiver Pine strategy that consumes the closed-source indicator's public plot output as a `source` input. Limited to plots the closed-source script publicly exposes:
   ```pine
   //@version=5
   strategy("Echo")
   sig = input.source(close, "Closed-source plot")  // user binds to the target plot at runtime
   if ta.crossover(sig, 0)
       strategy.entry("Long", strategy.long)
   ```
   Then run `POST /v1/strategy/run` with `source` (the receiver) plus a chained study reference.
7. Report as in `backtest-strategy.md`. Surface read-access status: "ran by reference" (`/v1/pine/auth` returned `{authorized:true}`) vs "ran via plot-echo, limited to public plots" (`{authorized:false}`).

Caveats:
- Plot-echo cannot read internal strategy state (entry/exit price, position size) — only declared plots. Many closed-source strategies hide the entry/exit signals; backtest fidelity drops accordingly.
- Some scripts have `is_auth_to_get` truthy but require an active subscription; the Worker surfaces `category:"upstream"` with `details.upstreamReason:"subscription_required"` in that case.

Reference: `reference/strategies.md`, `reference/pinescript.md`.
