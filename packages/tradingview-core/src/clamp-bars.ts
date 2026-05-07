// Bar-count clamping per TradingView plan + retrieval mode.
//
// Replaces the worker-local `MAX_BATCH_SIZE = 20000` magic number that lived
// in worker/src/tradingview.ts, study-chain.ts, and chart-session-do.ts.
// Plan caps reflect publicly documented TradingView limits as of 2025-Q4:
//   Free        5,000 chart bars / series
//   Pro         10,000
//   Pro+        20,000
//   Premium     25,000 (chart) — Deep Backtesting up to ~2M (probe-gated)
//
// Modes:
//   chart           single-request batch; cap = plan chart limit
//   chartExtended   chained request_more_data loop; cap = N * chart limit
//                   (N derived per plan; conservative)
//   deep            Premium Deep Backtesting; probe-only today (Slice A item
//                   A4) — caller receives probeOnly:true and must use the
//                   discovery harness, not a wired runtime path
//
// The cap is the upstream-allowed maximum; `bars` is the resolved value the
// caller should request (after clamping `requested` against `cap`). When
// `requested` is undefined or non-positive, the cap itself is the resolved
// value so legacy callers that did `Math.min(req.bars ?? MAX, MAX)` keep
// behavior.

export type BarLimitMode = "chart" | "chartExtended" | "deep";
export type BarLimitPlan =
  | "free"
  | "pro"
  | "pro_plus"
  | "premium"
  | "unknown";

const CHART_CAPS: Readonly<Record<BarLimitPlan, number>> = {
  free: 5_000,
  pro: 10_000,
  pro_plus: 20_000,
  premium: 25_000,
  unknown: 20_000,
};

const CHART_EXTENDED_MULTIPLIER: Readonly<Record<BarLimitPlan, number>> = {
  free: 5,
  pro: 5,
  pro_plus: 5,
  premium: 8,
  unknown: 5,
};

const DEEP_PROBE_CAP = 2_000_000;

export interface ClampBarResult {
  bars: number;
  cap: number;
  clamped: boolean;
  mode: BarLimitMode;
  plan: BarLimitPlan;
  probeOnly?: true;
}

export const clampBarCount = (
  requested: number | undefined,
  mode: BarLimitMode = "chart",
  plan: BarLimitPlan = "unknown",
): ClampBarResult => {
  const resolvedPlan: BarLimitPlan = plan in CHART_CAPS ? plan : "unknown";

  if (mode === "deep") {
    const desired =
      typeof requested === "number" && Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : DEEP_PROBE_CAP;
    return {
      bars: desired,
      cap: DEEP_PROBE_CAP,
      clamped: false,
      mode,
      plan: resolvedPlan,
      probeOnly: true,
    };
  }

  const baseCap = CHART_CAPS[resolvedPlan];
  const cap =
    mode === "chartExtended"
      ? baseCap * CHART_EXTENDED_MULTIPLIER[resolvedPlan]
      : baseCap;

  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return { bars: cap, cap, clamped: false, mode, plan: resolvedPlan };
  }

  const desired = Math.floor(requested);
  if (desired > cap) {
    return { bars: cap, cap, clamped: true, mode, plan: resolvedPlan };
  }
  return { bars: desired, cap, clamped: false, mode, plan: resolvedPlan };
};
