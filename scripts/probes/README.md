# TradingView discovery probes

These scripts capture live WebSocket dialogues against TradingView's edge so we
can validate or extend the worker's wire form without guessing. They are NOT
production code — they exist to answer specific operational questions
recorded against `tradingview-bsg` items A4 and A7.

Both probes write JSON-lines transcripts to `probe-output/` (gitignored). The
output includes both directions of the WS chatter, a probe envelope describing
the request, and a closing summary record.

## Prerequisites

- A TradingView session you control (free, pro, premium — the probe's job is
  to reveal what the session actually unlocks).
- `TV_SESSION_ID` and optionally `TV_SESSION_SIGN` in the environment.
- Node 22+ (uses the built-in `WebSocket`).

```bash
export TV_SESSION_ID=...
export TV_SESSION_SIGN=...
```

## A4: deep-backtest-frames.mjs

Captures the full WS dialogue when a strategy create_study runs against an
extended bar window with `set_data_quality` toggled. The skill (strategies.md)
intentionally leaves the deep-backtest wire form open until live frames are
captured. This probe collects them.

```bash
node scripts/probes/deep-backtest-frames.mjs \
  --symbol NASDAQ:AAPL \
  --tf 60 \
  --bars 30000 \
  --study "STD;Supertrend Strategy" \
  --quality optimal
```

Tweak `--quality` (`low` | `optimal` | `fast` are observed in TV UI traffic) to
identify which values upstream rejects. Combine with `--bars` over and under
common plan caps to map the upstream behaviour matrix.

## A7: strategy-entitlement.mjs

Asks the upstream for a specific bar count against a known strategy and reports
how many bars actually arrived. Used to confirm whether the configured session
crosses the legacy 20k clamp from the old worker code.

```bash
node scripts/probes/strategy-entitlement.mjs \
  --symbol NASDAQ:AAPL \
  --tf 60 \
  --study "STD;Supertrend Strategy" \
  --bars 25000 \
  --plan premium
```

`--plan` is informational only; the probe trusts what the upstream returns,
not the caller. The closing summary record (last line of the JSONL output)
reports `requestedBars`, `receivedBars`, `crossedLegacyClamp`, and any
upstream error frames observed during the run.

## Reading output

Each line is a JSON object. Useful greps:

```bash
# Every frame received from upstream:
jq -c 'select(.direction=="recv")' probe-output/<file>.jsonl

# Just the summary:
jq -c 'select(.kind=="probe-summary")' probe-output/<file>.jsonl

# All study/series error frames:
jq -c 'select(.name | test("error"))' probe-output/<file>.jsonl
```

Probe transcripts are **not** committed. Distill the operational findings into
worker code or skill docs and reference the probe run in the relevant beads
ledger entry.

## Pine source recovery boundary exercises

`pine-recovery-exercises.mjs` runs a bounded four-part investigation for the
open-source Pine / `ilTemplate` boundary:

- capture an unauthenticated chart WebSocket study path and check whether
  plaintext Pine or key material appears on the wire
- compare public `scriptSource` lengths against translated `IL`/`ilTemplate`
  ciphertext lengths
- write a gitignored JSONL corpus from public `scriptSource` records
- run local AES-GCM round trips over the collected sources, including a
  compiled-surrogate case that intentionally does not decrypt back to source

Example:

```bash
node scripts/probes/pine-recovery-exercises.mjs \
  --max-open 5 \
  --max-assets 40 \
  --bars 30 \
  --docs-out docs/tradingview-pine-source-recovery-boundary-2026-05-07.md
```

Raw outputs go to `probe-output/` and are not committed. Commit only the
distilled report and script changes.

## Worker-mediated acceptance probes (slices A, C, E, F)

`worker-acceptance-probes.mjs` runs the live acceptance battery against the
deployed Worker over HMAC. The HMAC client material is read from the macOS
Keychain (`security find-generic-password -a gwizz -s tradingview-worker-hmac`).

```bash
# Single probe:
node scripts/probes/worker-acceptance-probes.mjs slice-a-commission-differential

# Full battery:
node scripts/probes/worker-acceptance-probes.mjs all
```

Probes:

- `admin-session-status` — sanity check that the stored TV session is healthy.
- `slice-a-commission-differential` — runs `/v1/strategy/run` against
  STD;Supertrend Strategy with `commission_value` 0 and 1, asserts a non-zero
  `netProfit` delta (proves properties land on the wire).
- `slice-a-source-only` — runs `/v1/strategy/run` with a minimal `{source}`
  Pine v5 strategy and confirms a report came back.
- `slice-a-bars-30000` — runs `/v1/strategy/run` with `bars=30000` and reports
  whether the request crossed the legacy 20k clamp.
- `slice-a-strategy-detection` — runs `/v1/strategy/run` against
  STD;Supertrend Strategy and STD;RSI; asserts the strategy responds with a
  report and the indicator does not.
- `slice-c-walkforward` — submits a walkforward job via `/v1/jobs/submit`.
- `slice-c-matrix` — submits a matrix job (3 symbols × 2 timeframes × 4 params).
- `slice-e-ohlcv-extract` — submits an `ohlcvExtract` job.
- `slice-f-sse-replay` — opens `/v1/strategy/replay`, reads the SSE stream,
  asserts a `done` event arrives within 30s.

The runner expects the deployed Worker at `WORKER_BASE`
(default `https://tradingview-data.gwizz.workers.dev`) to host current `main`.
A 404 on slice routes signals the deployed bundle predates the slice landing —
run `npx wrangler deploy` from `worker/` first.
