# Claude Project Notes

Use `AGENTS.md` as the canonical agent instruction file for this repository. It contains the beads workflow, non-interactive shell constraints, session completion rules, and project-specific operating guidance.

Project quick reference:

- Runtime authority: `worker/`
- Shared protocol/types/math authority: `packages/tradingview-core/`
- Agent workflow authority: `skills/tradingview/`
- API contract: `worker/openapi.yaml`

Required local gates after code changes (use pnpm; do not use npm):

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

Do not reintroduce `tradingview-mcp/`, local secret JSON stores, duplicate TradingView WebSocket constants, or caller-supplied session precedence over the Worker admin session store.
