# TradingView Worker

Cloudflare Worker runtime authority for TradingView market data, cache management, HMAC authentication, and stored browser-session administration.

## Commands

Run from the repository root unless noted. This repo uses pnpm; do not use npm.

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run dev
pnpm run deploy
```

Worker-local type generation:

```bash
pnpm --filter worker cf-typegen
```

## Authentication Model

All upstream-reaching routes require HMAC authorization. The Worker fails closed when `HMAC_SECRET` or `HMAC_CLIENT_ID` is missing.

TradingView browser credentials are stored through the admin API:

- `POST /admin/session` stores a fresh `sessionid` and optional `sessionid_sign` in KV.
- Stored session credentials are authoritative for normal data routes.
- Caller-provided `sessionId` fields are compatibility inputs only and do not override a valid stored session.
- `POST /admin/session/unblock` clears temporary auth-failure block state.
- `GET /admin/session/status` validates that the stored session can support the Worker market-data path.

Do not persist real credentials in repo files or local JSON stores.

## API Contract

Use `worker/openapi.yaml` as the route-level contract. The validator in `scripts/validate-worker-openapi.mjs` checks that Hono routes and OpenAPI paths stay aligned and that upstream-reaching routes remain HMAC-protected.

The deployed Worker URL is:

```text
https://tradingview-data.gwizz.workers.dev
```

## Runtime State

- `CACHE_META`: KV namespace for cache metadata and stored admin session.
- `CACHE_DATA`: R2 bucket for candle chunks and metadata snapshots.
- `FETCH_COORDINATOR`: Durable Object that serializes cache misses and rate budget decisions across isolates.
- Cron trigger: daily `0 3 * * *` cache metadata snapshot.

## Manual Smoke Checks

After deployment, sign requests with the configured HMAC client and verify:

- `GET /health` returns `ok:true`.
- `GET /admin/session/status` returns `ok:true` after a fresh session is stored.
- `POST /v1/candles` returns candles with `authSource:"stored"`.
- `GET /cache/:symbol/:tf` fills through `FETCH_COORDINATOR` and returns cache metadata.

Use placeholders only in documentation. Never commit live `sessionid`, `sessionid_sign`, HMAC secrets, or derived TradingView auth tokens.
