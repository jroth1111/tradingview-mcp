# TradingView Worker Authentication

## HMAC

Every upstream-reaching Worker request must include:

- `Authorization: HMAC <clientId>:<signature>`
- `X-Timestamp: <milliseconds since epoch>`

`X-Timestamp` uses Unix epoch milliseconds, not seconds. The Worker enforces a 5-minute skew window.

Canonical string:

```text
METHOD
/path?query
sha256(body)
timestamp
```

The Worker fails closed when `HMAC_SECRET` or `HMAC_CLIENT_ID` is missing.

The same HMAC scheme protects `/admin`, `/cache`, and upstream-reaching `/v1` routes. Public health and route-inventory endpoints explicitly opt out.

## TradingView Session

Store TradingView browser credentials through the Worker admin endpoint:

1. Capture a fresh `sessionid` and optional `sessionid_sign` from the browser.
2. Send an HMAC-signed `POST /admin/session` request:

```json
{
  "sessionId": "fresh-sessionid-cookie",
  "sessionSign": "optional-sessionid_sign-cookie"
}
```

Do not persist real credentials in `tradingview-auth.json`, `admin-tokens.json`, `.hmac-secrets.json`, `hmac-client.json`, or `auth.json`.

## Session Precedence

The stored Worker session is authoritative. If a request body or query includes `sessionId`, the Worker still prefers the stored session when one exists and is not blocked.

## Recovery Semantics

Do not downgrade a stored signed session to `sessionid` only. Preserve `sessionSign` whenever it is present.

Worker error responses include `category` and `retryable` when upstream failure classification is possible:

- `category:"network"`, `category:"upstream"`, or `category:"rate_limit"` with `retryable:true` means retry with backoff and keep the current stored session.
- `category:"auth"` means the stored TradingView browser session is wrong, expired, blocked, or missing required access. Refresh the admin session instead of retrying indefinitely.

Network and upstream failures must not be treated as auth failures.
