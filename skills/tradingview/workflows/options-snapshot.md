# Options snapshot

Capture an option chain, IV term structure, and skew curve via Worker `/v1/options/*`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/options/iv/{symbol}` | IV term structure (`real-ivs[{span:{value,unit:d|w|m|y},value}]`). |
| GET | `/v1/options/volatility-chart/{symbol}?root&expiry&xaxis=strikes\|moneyness` | Smile/skew curve. `xaxis` enum strict: only `strikes` or `moneyness`; `400` on anything else. |
| GET | `/v1/options/expiries/{symbol}` | Sorted distinct expiration list. |
| GET | `/v1/options/strikes/{symbol}?expiry` | Distinct `(strike,type)` tuples. |
| GET | `/v1/options/chain/{symbol}?expiry&type=call\|put\|both&range=[0,N]` | Flattened typed contracts. |
| GET | `/v1/options/greeks/{contract-symbol}` | Single-contract greeks shortcut. |
| POST | `/v1/options/scan` | Advanced screener passthrough. |
| GET | `/v1/options/metainfo` | 71-field column schema. |

All `GET` routes require HMAC. Live greek and quote cells are entitlement-gated (OPRA realtime); the Worker forwards the admin session, but unauth or non-Pro responses surface `null` cells — do **not** treat `null` as zero or as an error.

## Steps

1. **Resolve underlying.** `POST /v1/search` → canonical `EXCHANGE:UNDERLYING` (e.g., `AAPL` → `NASDAQ:AAPL`).
2. **List expirations.** `GET /v1/options/expiries/{symbol}` and pick the target expiry (`YYYYMMDD`).
3. **Pull the chain.** `GET /v1/options/chain/{symbol}?expiry=YYYYMMDD&type=both&range=[0,200]`. Each contract has typed fields:
   ```ts
   { symbol, strike, expiration, type:'call'|'put',
     bid, ask, delta, gamma, theta, vega, rho, iv,
     openInterest, theoreticalPrice, underlying }
   ```
4. **(Optional) Pull skew/smile.** `GET /v1/options/volatility-chart/{symbol}?expiry=YYYYMMDD&xaxis=strikes` (or `moneyness`). Delta-axis skew is **not** server-side — compute client-side from the chain `delta` column if needed.
5. **(Optional) Pull IV term structure.** `GET /v1/options/iv/{symbol}` for ATM realized/implied IV across `d/w/m/y` horizons.
6. **Summarise.** ATM strike + IV, top-volume strikes, max-pain estimate, skew slope between wings.

For multi-expiry sweeps, batch one expiry at a time. Expect `category:"rate_limit"` on aggressive fan-out.

## Caveats

- US equity options are reliable; FX and futures options are sparse.
- Greek/quote values nullable unless admin session holds an OPRA-capable plan. Surface this in the report whenever the chain returns null cells.
- `xaxis` accepts only `strikes` and `moneyness`. Do not retry with `delta`/`log_strike`/`deltas` — those are client-side only.
- `options/scan` (advanced) currently rejects every probed `index` payload shape with `400 required index "underlying_symbol" is missing`. Until an authed HAR settles the index format, the chain endpoint falls back to `global/scan2 + filter:[underlying_symbol equal SYM]`. Document slowness when scanning broad sets.

Reference: `reference/endpoints.md`, recon `/tmp/tv-recon/agents/09-options.md`.
