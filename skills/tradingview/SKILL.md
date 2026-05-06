---
name: tradingview
description: Use the TradingView Cloudflare Worker to fetch market data, run studies, inspect Pine metadata, screen markets, and guide Pine/backtest workflows. The Worker is the only runtime authority; this skill contains workflow instructions only.
---

# TradingView Skill

Use this skill when a user asks for TradingView market data, technical analysis, scanner results, indicator metadata, PineScript compile/run loops, or strategy/backtest workflows.

## Runtime Authority

- Runtime endpoint: the deployed Cloudflare Worker described by `worker/openapi.yaml`.
- Shared protocol/constants authority: `packages/tradingview-core`.
- This skill is procedural prose only. Do not add local clients, MCP tools, or TradingView protocol constants here.

## Authentication

Read `auth.md` before making authenticated requests.

All Worker requests that can reach TradingView upstream require HMAC authorization. Use the Worker admin session store for TradingView browser credentials; do not place `sessionId` values in local JSON files.

## Workflows

- `workflows/backtest-strategy.md`
- `workflows/analyze-stock.md`
- `workflows/screen-to-idea.md`
- `workflows/options-snapshot.md`
- `workflows/indicator-evaluate.md`
- `workflows/indicator-to-strategy-backtest.md`
- `workflows/pinescript-iterate.md`
- `workflows/backtest-closed-source.md`

## Request Pattern

1. Resolve ambiguous symbols with `POST /v1/search`.
2. Prefer stored Worker session credentials. Do not pass caller-provided `sessionId` unless the admin store is intentionally empty.
3. Keep data requests bounded: small `amount`, `limit`, or date ranges first.
4. Report source limits clearly: TradingView plan/access, missing stored session, upstream rate limits, and partial cache responses.
