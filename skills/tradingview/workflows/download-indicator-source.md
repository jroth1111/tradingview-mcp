# Download indicator source / compiled artifact

Retrieve the Pine Script source or compiled artifact for any indicator — built-in, public open-source, closed-source (protected/UOI), or private. Determined empirically.

## The two artifacts

### Pine Script source (`scriptSource`)

Available for **open-source** `PUB;` scripts only. Returned directly in the `scriptSource` field of `pubscripts-suggest-json` and `pubscripts-get` responses. Non-empty string = open-source; empty = protected.

Routes: `POST /v1/pubscripts/suggest` or `POST /v1/pubscripts/batch`.

### Compiled artifact (`ilTemplate`)

Returned for **every** indicator type the session can access, via `POST /v1/indicators/meta` → `result.script`. Format:

```
<key_id>_<iv_base64>_<ciphertext_base64>
```

This is an AES-encrypted blob. The decryption key is identified by `key_id` and held server-side by TradingView. The blob is only executable inside TradingView's own runtime — it is not decompilable or re-usable externally regardless of whether the indicator is open-source or closed.

> `GET /v1/pine/translate-light` (`pine-facade/translate-light-source`) is a separate path that returns Pine source **only** for `USER;` scripts the authenticated account owns (i.e. scripts the user personally wrote). It returns 404 for every other type — including public open-source `PUB;` scripts, UOI, and `STD;` built-ins.

## Step 1 — Resolve the indicator ID

If you already have the `scriptIdPart` skip to step 2.

**Search public catalog** (returns `scriptSource` for open-source results directly):
```http
POST /v1/pubscripts/suggest
{"search": "Bollinger RSI"}
```
Filter `results` by `result.scriptSource !== ""` for open-source scripts.

**List scripts saved to / accessible by the stored account** (includes UOI indicators added to the account):
```http
POST /v1/indicators/private
{}
```
Returns `USER;` and saved `PUB;` IDs.

**Capture from a loaded chart**: In the TradingView browser DevTools → Network, filter for `pine-facade/translate`. The `id` path segment is the `scriptIdPart`.

## Step 2A — Open-source: get Pine Script source

For `PUB;` scripts with non-empty `scriptSource`:

```http
POST /v1/pubscripts/batch
{"scriptIdPart": "PUB;2187"}
```

Response field `scriptSource` contains the full Pine Script text. Empty string means protected — source is not accessible via the API regardless of how the script is labelled.

Alternatively, `POST /v1/pubscripts/suggest` with a search query returns `scriptSource` inline for matching open-source results.

Auth: HMAC only (public endpoint).

## Step 2B — Any indicator: get the compiled artifact

```http
POST /v1/indicators/meta
{"id": "PUB;2187"}
```

Always returns `result.script` (the `ilTemplate` encrypted blob) when the session has access, for open-source and closed-source alike. Auth: HMAC only for `STD;` and `PUB;` scripts; authenticated for UOI and `USER;`.

## Decision tree

```
Have indicator ID?
  No → POST /v1/pubscripts/suggest    (search; includes scriptSource for open scripts)
     → POST /v1/indicators/private    (account-saved scripts, UOI)
     → DevTools: pine-facade/translate path segment
  Yes ↓

Want Pine Script source?
  → POST /v1/pubscripts/batch {"scriptIdPart": "PUB;..."}
    result.scriptSource non-empty?  → open-source, use it
    result.scriptSource empty?      → protected, source inaccessible via API

  → POST /v1/pubscripts/suggest {"search": "..."}
    results[i].scriptSource non-empty?  → open-source

  → GET /v1/pine/translate-light?id=USER;...&version=last
    Only for USER; scripts you personally authored. 404 for everything else.

Want compiled artifact (any type)?
  → POST /v1/indicators/meta → result.script
    (AES-encrypted blob; executable only in TradingView's runtime)
```

## Auth matrix

| Indicator type | Pine source (`pubscripts/batch`) | `ilTemplate` (`/indicators/meta`) |
| --- | --- | --- |
| `STD;` built-in | n/a — not a pubscript | ✓ HMAC only |
| `PUB;` open-source | ✓ `scriptSource` non-empty, HMAC only | ✓ HMAC only |
| `PUB;` protected / closed-source | ✗ `scriptSource` empty | ✓ HMAC only |
| `PUB;` UOI / closed-source | ✗ `scriptSource` empty | ✓ authenticated |
| `USER;` owned by this account | ✓ via `/v1/pine/translate-light`, authenticated | ✓ authenticated |
| `USER;` shared into account (UOI saved as USER;) | ✗ | ✓ authenticated |

## Common errors

| Error | Cause | Fix |
| --- | --- | --- |
| `scriptSource` empty on `access=1` script | Script is marked published but source is protected | Source is not available via API |
| `indicator not available` | Session lacks access or ID wrong | Verify ID; for UOI confirm stored session was granted access |
| `category:"auth"` | Stored session expired | Refresh via `POST /admin/session` with fresh cookies |
| `HTTP 404` from translate-light | Not a USER; script you own | Use `pubscripts/batch` for PUB; open-source instead |

Reference: `reference/indicators.md`, `reference/wire-formats.md`.
