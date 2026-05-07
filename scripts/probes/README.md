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
