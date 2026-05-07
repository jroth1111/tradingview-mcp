# TradingView UOI Protected Indicator Translate Boundary - 2026-05-07

## Scope

This is a disclosure-ready summary of the authorized UOI protected-indicator boundary probes performed on May 7, 2026.

Scope was limited to HAR-designated `uoi2020` / UOI indicators and artifacts covered by the authorization. The probes did not attempt AES key recovery, offline decryption, protected source extraction, or arbitrary unrelated protected-script collection.

No cookies, session IDs, auth tokens, plaintext Pine source, full response bodies, `IL`, or `ilTemplate` values are included in this report. Evidence artifacts record statuses, response hashes, selected metadata, and encrypted-artifact segment summaries only.

## Executive Summary

The current evidence shows a mismatch between the source-code access boundary and the compiled-artifact translate boundary:

- `/pine-facade/get/<pine_id>/last` remained protected: 10/10 scoped scripts returned HTTP 401 in both no-cookie and authenticated contexts, and no source-like body was observed.
- `/pine-facade/translate/<pine_id>/<version>` returned HTTP 200 in a no-cookie context for 10/10 scoped access=3 UOI indicators.
- The no-cookie and authenticated translate responses were byte-identical at the redacted hash/length level for 10/10 scripts.
- Each translate response contained encrypted `IL`, encrypted `ilTemplate`, and `metaInfo` for the protected indicator.
- Authenticated WebSocket runtime execution completed with plot output for 10/10 scoped scripts.
- No-cookie WebSocket runtime did not produce plot output in the runtime probe; it failed before output with a subscription-limit study error.

The confirmed issue is public retrieval of encrypted compiled indicator artifacts and metadata for protected indicators in this scope. The current evidence does not show Pine source disclosure, AES key recovery, decrypted IR recovery, or no-cookie runtime execution.

## Distilled Request / Response Flow

### 1. Indicator Inventory

Input inventory came from the local HAR-derived UOI indicator set:

```text
probe-output/har-indicator-analysis-2026-05-07T10-57-45-960Z/uoi-indicators.json
```

The selected probe subset used:

```text
author = uoi2020
access = 3
userHaveAccess = true
limit = 10
```

### 2. Version Discovery

For each scoped script, the unauthenticated client can resolve the available version:

```http
GET /pine-facade/versions/<pine_id>/last
Host: pine-facade.tradingview.com
Cookie: <omitted>
```

Observed result:

```text
10/10 returned HTTP 200
example version values: 1.0, 2.0, 4.0, 7.0, 9.0, 12.0
```

### 3. Source Authorization Check

The source authorization endpoint reports no authorization in both contexts:

```http
GET /pine-facade/is_auth_to_get/?pine_id=<pine_id>
Host: pine-facade.tradingview.com
Cookie: <omitted or session-authenticated>
```

Observed result:

```text
unauthIsAuthTrue = 0/10
authIsAuthTrue = 0/10
```

### 4. Source Retrieval Boundary

Source retrieval remains blocked:

```http
GET /pine-facade/get/<pine_id>/last
Host: pine-facade.tradingview.com
Cookie: <omitted or session-authenticated>
```

Observed result:

```text
unauthGetSourceSourceLikePresent = 0/10
authGetSourceSourceLikePresent = 0/10
unauth get status = 401 for 10/10
authenticated get status = 401 for 10/10
```

Interpretation: the source-code access boundary appears to be enforced for the scoped scripts.

### 5. Translate / Compiled Artifact Boundary

The translate endpoint returns compiled encrypted artifacts without a cookie:

```http
GET /pine-facade/translate/<pine_id>/<version>
Host: pine-facade.tradingview.com
Cookie: <omitted>
```

Observed response shape:

```json
{
  "IL": "<encrypted artifact omitted>",
  "ilTemplate": "<encrypted artifact omitted>",
  "metaInfo": {
    "id": "Script$PUB;<id>@tv-scripting-101",
    "description": "<indicator title>",
    "shortDescription": "<indicator title>",
    "pine": {
      "digest": "<digest>",
      "version": "<version>"
    },
    "plots": "<count>",
    "inputs": "<count>",
    "stats": "<selected counters>"
  }
}
```

Aggregate result:

```text
requested = 10
unauthTranslateSuccess = 10
authTranslateSuccess = 10
unauthIlPresent = 10
authIlPresent = 10
translateBodyHashEqualAcrossContexts = 10
translateIlBytesEqualAcrossContexts = 10
```

The artifact format observed by the redacted parser was:

```text
header/key_id segment + 16-byte IV + ciphertext
```

Example redacted metadata from one scoped script:

```text
scriptId = PUB;8ec469c9f5ff4879a0f3d5bc3950fd52
name = Bollinger Bands Trend - Boosted [UOI]
plots = 58
inputs = 95
header bytes = 6
IV bytes = 16
ciphertext bytes = 15029
```

### 6. Authenticated Runtime Use

Authenticated chart WebSocket execution uses the encrypted text artifact as an input to the TradingView scripting runtime:

```text
set_auth_token
set_locale
chart_create_session
switch_timezone
resolve_symbol
create_series
create_study
```

The Pine `create_study` shape uses:

```text
wire id = Script@tv-scripting-101!
inputs include:
  text = <encrypted IL or ilTemplate artifact>
  pineId = PUB;<hash>
  pineVersion = <version>
```

Observed authenticated baseline result for the 10-script batch:

```text
translateSuccess = 10/10
liveCompletedWithOutput = 10/10
liveErrors = 0/10
baseline du rows = about 300 rows per script
```

### 7. No-Cookie Runtime Boundary

A no-cookie WebSocket runtime probe used the public translate artifact and an unauthorized token:

```text
set_auth_token ["unauthorized_user_token"]
set_locale
chart_create_session
switch_timezone
resolve_symbol
create_series
create_study
```

Observed result:

```text
outcome = study_error
studyCompleted = false
duRows = 0
detail = The maximum number of studies per chart has been reached for current subscription
```

Interpretation: public artifact retrieval is confirmed. Public runtime execution is not confirmed by this evidence.

### 8. Tamper Boundary

Two scoped scripts were tested with controlled encrypted-artifact mutations under an authenticated runtime:

| Mutation | Observed result |
| --- | --- |
| baseline valid artifact | `study_completed`, `completed_with_output`, about 300 `du` rows |
| flip ciphertext byte | `study_error`, `Can't parse pine`, 0 `du` rows |
| flip IV byte | `study_error`, `Can't parse pine`, 0 `du` rows |
| flip header/key byte | `study_error`, `Invalid keyId in pine text input`, 0 `du` rows |
| truncate ciphertext | `study_error`, `Can't parse pine`, 0 `du` rows |
| swap `IL` / `ilTemplate` from same target | `study_completed`, `completed_with_output` |
| empty text | `study_completed`, `completed_no_output`, 0 `du` rows |

Interpretation: the server processes the encrypted artifact and rejects simple corruption. These probes do not prove which cipher mode is used or whether authentication is enforced before parse; they only establish the externally observable behavior for the tested mutations.

## Evidence Artifacts

- UOI translate boundary summary: `probe-output/uoi-unauth-translate-boundary-2026-05-07T11-24-25-291Z/summary.json`
- UOI translate boundary table: `probe-output/uoi-unauth-translate-boundary-2026-05-07T11-24-25-291Z/table.tsv`
- No-cookie runtime evidence: `probe-output/uoi-unauth-runtime-2026-05-07T11-26-53-853Z/evidence.json`
- Authenticated UOI baseline/tamper batch summary: `probe-output/uoi-boundary-probe-2026-05-07T11-09-42-236Z/summary.json`
- Authenticated UOI baseline table: `probe-output/uoi-boundary-probe-2026-05-07T11-09-42-236Z/table.tsv`
- Two-script tamper comparison: `probe-output/iltemplate-tamper-comparison-2026-05-07T11-09-28-223Z/comparison.json`

## Impact Boundary

Confirmed:

- Unauthenticated clients can retrieve encrypted compiled artifacts for scoped protected UOI indicators through `/translate`.
- Unauthenticated clients can retrieve `metaInfo` fields including title, script identifier, version/digest, plot counts, input counts, and selected stats.
- The returned encrypted artifacts expose deterministic size/length metadata and stable artifact hashes to anyone who can query the endpoint.
- The no-cookie translate response matches the authenticated translate response for the scoped scripts at the redacted hash and length level.

Not confirmed:

- Pine source disclosure.
- AES key recovery.
- Decrypted IR recovery.
- No-cookie chart runtime execution with plot output.
- Access to arbitrary unrelated protected scripts outside the authorized scope.

Security relevance:

- If encrypted `IL` / `ilTemplate` artifacts are intended to be available only to users authorized for a protected indicator, `/translate` currently appears less restrictive than `/get`.
- Even when strong encryption is used correctly, public artifact access increases exposure to length fingerprinting, corpus comparison, future implementation bugs, and any server-side parser/runtime oracle that accepts attacker-supplied artifacts.
- The `metaInfo` object alone may disclose operational details about protected indicator structure: plot count, input count, alert/stat counters, digest/version identifiers, and exact compiled artifact lengths.

## Recommended Remediation

1. Apply the same entitlement check to `/pine-facade/translate/<pine_id>/<version>` that is applied to protected source retrieval and protected runtime use.
2. Treat encrypted compiled artifacts as protected code, not as public cacheable metadata, for invite-only and protected indicators.
3. If browser-side runtime needs an artifact, return it only after session and indicator entitlement verification, or replace raw artifact delivery with a short-lived server-side execution handle.
4. Bind artifact context cryptographically: script id, version, artifact type, tenant/user scope, and intended purpose should be authenticated metadata for the encrypted artifact.
5. Verify integrity before any parser or runtime processing and return indistinguishable errors for key-id, IV, ciphertext, tag, parse, and entitlement failures.
6. Rate-limit and monitor translate and runtime failures, especially repeated requests against protected scripts or close-in-Hamming-distance artifact mutations.
7. Consider length bucketing or padding for protected artifacts if compiled length is considered sensitive.

## Suggested Triage Framing

Suggested severity depends on intended product semantics:

- If protected/invite-only indicators are expected to hide compiled artifacts from non-entitled users, this is a protected-artifact authorization bypass.
- If TradingView intentionally allows public encrypted artifact distribution and relies exclusively on server-held keys plus runtime authorization, this is not source disclosure, but it is still a boundary mismatch worth documenting and hardening.

The report should not be framed as a cryptographic break. The evidence supports a narrower and more defensible claim: protected source remains blocked, but encrypted compiled artifacts and structural metadata are public through the translate path for the scoped UOI indicators.
