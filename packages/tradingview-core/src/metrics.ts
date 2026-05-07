// Pure trading-metric helpers.
//
// Inputs are flat arrays of numbers (returns or equity points). We never reach
// into `tradingview-data` from here — `worker/` consumes these helpers but
// `core/` stays runtime-agnostic so the same code paths can be unit-tested
// without WS/Workers/DO surface.
//
// Conventions
// -----------
// * `returns`   = period-over-period return series r_t such that r_t = (e_t / e_{t-1}) - 1.
//                 The same convention is used in TradingView's report tab.
// * `equity`    = end-of-period account equity points (not log-equity).
// * `tradePnl`  = per-trade signed P&L in account currency (or pct-of-equity, but
//                 caller must stay consistent across helpers).
// * `periodsPerYear` = annualisation factor. Daily ≈ 252, hourly ≈ 252*6.5 for
//                 RTH equities, 252*24 for 24/7 markets, etc. Defaults to 252.
//
// The Sortino-first stance is enforced by `defaultRankingMetric`: it always
// returns "sortino". Callers can request "sharpe" explicitly, but defaults
// won't reward downside volatility.

export type RankingMetric =
  | "sortino"
  | "sharpe"
  | "calmar"
  | "profitFactor"
  | "netProfit"
  | "winRate";

export const defaultRankingMetric = (): RankingMetric => "sortino";

const DEFAULT_PPY = 252;

const isFiniteNumber = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

const finiteOnly = (arr: readonly number[]): number[] =>
  arr.filter(isFiniteNumber);

export const mean = (xs: readonly number[]): number => {
  const v = finiteOnly(xs);
  if (v.length === 0) return 0;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
};

// Sample (Bessel-corrected) variance — denominator (n - 1).
// Returns 0 for arrays with fewer than 2 finite values.
export const variance = (xs: readonly number[]): number => {
  const v = finiteOnly(xs);
  if (v.length < 2) return 0;
  const m = mean(v);
  let s = 0;
  for (const x of v) {
    const d = x - m;
    s += d * d;
  }
  return s / (v.length - 1);
};

export const stdev = (xs: readonly number[]): number => Math.sqrt(variance(xs));

// Downside deviation: stdev of returns below the threshold (default 0).
// Negative-only deviations, denominator = n - 1 over the full sample (this
// matches the "target downside deviation" definition in Sortino's 1980 paper
// and the variant TradingView reports).
export const downsideDeviation = (
  returns: readonly number[],
  threshold = 0,
): number => {
  const v = finiteOnly(returns);
  if (v.length < 2) return 0;
  let s = 0;
  for (const x of v) {
    const d = Math.min(0, x - threshold);
    s += d * d;
  }
  return Math.sqrt(s / (v.length - 1));
};

export interface RatioOptions {
  periodsPerYear?: number;
  riskFreeRatePerPeriod?: number; // already per-period, not annualised
}

// Sharpe ratio (annualised). 0 when stdev is 0.
export const sharpeRatio = (
  returns: readonly number[],
  opts: RatioOptions = {},
): number => {
  const v = finiteOnly(returns);
  if (v.length < 2) return 0;
  const ppy = opts.periodsPerYear ?? DEFAULT_PPY;
  const rf = opts.riskFreeRatePerPeriod ?? 0;
  const sd = stdev(v);
  if (sd === 0) return 0;
  const m = mean(v) - rf;
  return (m / sd) * Math.sqrt(ppy);
};

// Sortino ratio (annualised). Default ranking metric. 0 when downside deviation is 0.
export const sortinoRatio = (
  returns: readonly number[],
  opts: RatioOptions = {},
): number => {
  const v = finiteOnly(returns);
  if (v.length < 2) return 0;
  const ppy = opts.periodsPerYear ?? DEFAULT_PPY;
  const rf = opts.riskFreeRatePerPeriod ?? 0;
  const dd = downsideDeviation(v, rf);
  if (dd === 0) return 0;
  const m = mean(v) - rf;
  return (m / dd) * Math.sqrt(ppy);
};

// CAGR-style annualised return from an equity curve.
export const cagrFromEquity = (
  equity: readonly number[],
  periodsPerYear = DEFAULT_PPY,
): number => {
  const v = finiteOnly(equity);
  if (v.length < 2) return 0;
  const start = v[0];
  const end = v[v.length - 1];
  if (start <= 0 || end <= 0) return 0;
  const years = (v.length - 1) / periodsPerYear;
  if (years <= 0) return 0;
  return Math.pow(end / start, 1 / years) - 1;
};

// Max drawdown of an equity curve. Returns a positive fraction (e.g. 0.25 = 25%).
export const maxDrawdownPct = (equity: readonly number[]): number => {
  const v = finiteOnly(equity);
  if (v.length === 0) return 0;
  let peak = v[0];
  let mdd = 0;
  for (const e of v) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = (peak - e) / peak;
      if (dd > mdd) mdd = dd;
    }
  }
  return mdd;
};

// Calmar ratio = annualised return / max drawdown. 0 when MDD is 0 or non-positive.
export const calmarRatio = (
  equity: readonly number[],
  periodsPerYear = DEFAULT_PPY,
): number => {
  const mdd = maxDrawdownPct(equity);
  if (mdd <= 0) return 0;
  const cagr = cagrFromEquity(equity, periodsPerYear);
  return cagr / mdd;
};

// Profit factor = sum(profits) / |sum(losses)|. Returns Infinity if losses == 0
// AND profits > 0; 0 when both sides are zero. NaN never returned.
export const profitFactor = (tradePnl: readonly number[]): number => {
  let gp = 0;
  let gl = 0;
  for (const x of tradePnl) {
    if (!isFiniteNumber(x)) continue;
    if (x > 0) gp += x;
    else if (x < 0) gl += -x;
  }
  if (gl === 0) return gp > 0 ? Number.POSITIVE_INFINITY : 0;
  return gp / gl;
};

// Win rate = wins / (wins + losses). Zero-PnL trades excluded from the denom
// because TradingView's report excludes them too. Returns 0 for empty input.
export const winRate = (tradePnl: readonly number[]): number => {
  let w = 0;
  let l = 0;
  for (const x of tradePnl) {
    if (!isFiniteNumber(x)) continue;
    if (x > 0) w += 1;
    else if (x < 0) l += 1;
  }
  const denom = w + l;
  return denom === 0 ? 0 : w / denom;
};

// Returns from an equity curve. r_t = (e_t / e_{t-1}) - 1; output length = input length - 1
// when the curve stays positive throughout. Intervals where either endpoint is non-positive
// are skipped — once equity hits zero the strategy is liquidated, so subsequent returns are
// ill-defined and shouldn't pollute downstream ratios.
export const returnsFromEquity = (equity: readonly number[]): number[] => {
  const v = finiteOnly(equity);
  if (v.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < v.length; i += 1) {
    const prev = v[i - 1];
    const cur = v[i];
    if (prev <= 0 || cur <= 0) continue;
    out.push(cur / prev - 1);
  }
  return out;
};

// Lopez de Prado deflated metric.
//
// Deflated Sharpe Ratio (DSR) tests whether the observed Sharpe is
// statistically distinguishable from zero given the number of trials run
// during selection. The Deflated Sortino is the analogous correction for the
// Sortino ratio (Bailey & López de Prado, 2014, "The Deflated Sharpe Ratio").
//
// Inputs:
//   observed     — the headline ratio that was selected.
//   skewness     — return-distribution skew (γ_3). 0 is the conventional
//                  default when data is too short to estimate.
//   kurtosis     — raw fourth standardised moment (γ_4 = excess + 3). 3 is
//                  the normal baseline. The formula uses (γ_4 − 1)/4, so this
//                  must NOT be excess kurtosis.
//   sampleLen    — number of return observations in the headline run.
//   trialCount   — N, the number of strategies/parameters tried.
//   trialsSharpeStdev — stdev of the Sharpe-ratio distribution across trials.
//                If unknown, pass 1 as a conservative default (this is what
//                Bailey & López de Prado use when the moments of the trial
//                distribution aren't measurable).
//
// Returns the probability that the true Sharpe (or Sortino) exceeds zero given
// the trial count. Values near 0 mean the headline is indistinguishable from
// noise once the trial multiplicity is accounted for.
export interface DeflateOpts {
  skewness?: number;
  kurtosis?: number;
  sampleLen: number;
  trialCount: number;
  trialsSharpeStdev?: number;
}

const EULER_MASCHERONI = 0.577215664901532;

// Z-score → standard-normal CDF using the Abramowitz & Stegun rational
// approximation. Accurate to ~7 decimal digits across the full range.
const normCdf = (z: number): number => {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
};

export const deflatedRatio = (
  observed: number,
  opts: DeflateOpts,
): number => {
  const { sampleLen, trialCount } = opts;
  if (sampleLen < 2 || trialCount < 1) return 0;
  const trialStd = opts.trialsSharpeStdev ?? 1;
  // Expected maximum Sharpe under the null across N trials (Bailey & López
  // de Prado, eq. 5). The asymptotic expansion is undefined at N=1 — there
  // is no max-of-many to correct for in that case, so the deflation
  // baseline collapses to zero.
  const expectedMax =
    trialCount <= 1
      ? 0
      : trialStd *
        ((1 - EULER_MASCHERONI) * normInvCdf(1 - 1 / trialCount) +
          EULER_MASCHERONI * normInvCdf(1 - 1 / (trialCount * Math.E)));
  const skew = opts.skewness ?? 0;
  const kurt = opts.kurtosis ?? 3; // normal baseline
  // Deflated z-score. Equation (9) in Bailey & López de Prado 2014:
  //   DSR = Φ((SR - E[max SR])·√(T-1) / √(1 - γ_3·SR + (γ_4-1)/4·SR²))
  const num = (observed - expectedMax) * Math.sqrt(sampleLen - 1);
  const radicand =
    1 - skew * observed + ((kurt - 1) / 4) * observed * observed;
  if (!Number.isFinite(radicand) || radicand <= 0) return 0;
  return normCdf(num / Math.sqrt(radicand));
};

// Approximate inverse standard-normal CDF (Beasley-Springer-Moro algorithm).
// Used by deflatedRatio to compute the quantile points of the trial
// distribution. Accurate to ~10^-9 in the tails.
export const normInvCdf = (p: number): number => {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
};

// Skewness of a finite array. 0 for fewer than 3 finite values or zero variance.
export const skewness = (xs: readonly number[]): number => {
  const v = finiteOnly(xs);
  if (v.length < 3) return 0;
  const m = mean(v);
  const sd = stdev(v);
  if (sd === 0) return 0;
  let s = 0;
  for (const x of v) {
    const z = (x - m) / sd;
    s += z * z * z;
  }
  return s / v.length;
};

// Excess kurtosis (kurtosis - 3). 0 for fewer than 4 finite values or zero
// variance — that's the normal-distribution baseline.
export const excessKurtosis = (xs: readonly number[]): number => {
  const v = finiteOnly(xs);
  if (v.length < 4) return 0;
  const m = mean(v);
  const sd = stdev(v);
  if (sd === 0) return 0;
  let s = 0;
  for (const x of v) {
    const z = (x - m) / sd;
    s += z * z * z * z;
  }
  return s / v.length - 3;
};

// Convenience wrappers for the common deflated-ratio call shapes.
export const deflatedSharpe = (
  returns: readonly number[],
  trialCount: number,
  opts: { trialsSharpeStdev?: number; periodsPerYear?: number } = {},
): number => {
  const v = finiteOnly(returns);
  if (v.length < 2 || trialCount < 1) return 0;
  return deflatedRatio(sharpeRatio(v, { periodsPerYear: opts.periodsPerYear }), {
    sampleLen: v.length,
    trialCount,
    trialsSharpeStdev: opts.trialsSharpeStdev,
    skewness: skewness(v),
    kurtosis: excessKurtosis(v) + 3,
  });
};

export const deflatedSortino = (
  returns: readonly number[],
  trialCount: number,
  opts: { trialsSharpeStdev?: number; periodsPerYear?: number } = {},
): number => {
  const v = finiteOnly(returns);
  if (v.length < 2 || trialCount < 1) return 0;
  return deflatedRatio(sortinoRatio(v, { periodsPerYear: opts.periodsPerYear }), {
    sampleLen: v.length,
    trialCount,
    trialsSharpeStdev: opts.trialsSharpeStdev,
    skewness: skewness(v),
    kurtosis: excessKurtosis(v) + 3,
  });
};

// Compose a metric bundle for ranking / reporting.
//
// `pickMetric` walks the bundle so callers don't have to switch on every
// `RankingMetric` value.
export interface MetricBundle {
  sortino: number;
  sharpe: number;
  calmar: number;
  profitFactor: number;
  netProfit: number;
  winRate: number;
  maxDrawdown: number;
  cagr: number;
  observations: number;
}

export interface BuildMetricBundleArgs {
  returns?: readonly number[];
  equity?: readonly number[];
  tradePnl?: readonly number[];
  periodsPerYear?: number;
}

export const buildMetricBundle = (
  args: BuildMetricBundleArgs,
): MetricBundle => {
  const ppy = args.periodsPerYear ?? DEFAULT_PPY;
  const equity = args.equity ?? [];
  const returns =
    args.returns ?? (equity.length >= 2 ? returnsFromEquity(equity) : []);
  const trades = args.tradePnl ?? [];
  const equityFinal = equity.length > 0 ? equity[equity.length - 1] : 0;
  const equityStart = equity.length > 0 ? equity[0] : 0;
  return {
    sortino: sortinoRatio(returns, { periodsPerYear: ppy }),
    sharpe: sharpeRatio(returns, { periodsPerYear: ppy }),
    calmar: equity.length > 0 ? calmarRatio(equity, ppy) : 0,
    profitFactor: profitFactor(trades),
    netProfit: equityFinal - equityStart,
    winRate: winRate(trades),
    maxDrawdown: equity.length > 0 ? maxDrawdownPct(equity) : 0,
    cagr: equity.length > 0 ? cagrFromEquity(equity, ppy) : 0,
    observations: returns.length,
  };
};

export const pickMetric = (bundle: MetricBundle, metric: RankingMetric): number => {
  switch (metric) {
    case "sortino":
      return bundle.sortino;
    case "sharpe":
      return bundle.sharpe;
    case "calmar":
      return bundle.calmar;
    case "profitFactor":
      return bundle.profitFactor;
    case "netProfit":
      return bundle.netProfit;
    case "winRate":
      return bundle.winRate;
  }
};
