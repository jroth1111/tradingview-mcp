# TradingView Worker Authority

This repository now has three authoritative artifacts:

- `worker/` - Cloudflare Worker HTTP runtime for TradingView data, cache, auth, and admin session storage.
- `packages/tradingview-core/` - shared TypeScript TradingView protocol, market-data helpers, Pine types, and backtest utilities.
- `skills/tradingview/` - agent workflow instructions. The skill contains no runtime client and defers to the Worker.

The previous `tradingview-mcp/` runtime has been removed. Do not reintroduce TradingView protocol constants, WebSocket clients, or credential stores outside the Worker/core package boundary.

## Commands

```bash
npm run typecheck
npm run build
npm run test
npm run dev
```

## Security Model

The Worker fails closed when HMAC configuration is missing. Upstream-reaching routes require HMAC authorization, and the Worker admin session store is the source of truth for TradingView browser credentials.

Do not commit local secret JSON such as `tradingview-auth.json`, `admin-tokens.json`, `.hmac-secrets.json`, `hmac-client.json`, or `auth.json`.

## Worker

See `worker/README.md` and `worker/openapi.yaml` for route-level details.

## Skill

Use `skills/tradingview/SKILL.md` for agent workflow routing and `skills/tradingview/auth.md` for request-signing/session-storage procedure.
