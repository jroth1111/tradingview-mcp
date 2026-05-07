// Strategy detection helpers and canonical wire-form constants.
//
// Source of truth for the 16 strategy property keys, the two enum-validated
// fields, and the metaInfo predicates used by the worker to distinguish
// strategies from indicators. The skill at
// skills/tradingview/reference/strategies.md owns the canonical names; this
// file is the runtime mirror that the worker imports.

export const STRATEGY_PROPERTY_KEYS: ReadonlySet<string> = new Set<string>([
  "initial_capital",
  "currency",
  "default_qty_value",
  "default_qty_type",
  "pyramiding",
  "commission_value",
  "commission_type",
  "backtest_fill_limits_assumption",
  "slippage",
  "calc_on_order_fills",
  "calc_on_every_tick",
  "margin_long",
  "margin_short",
  "use_bar_magnifier",
  "process_orders_on_close",
  "fill_orders_on_standard_ohlc",
]);

export const STRATEGY_DEFAULT_QTY_TYPES: ReadonlySet<string> = new Set<string>([
  "fixed",
  "cash_per_order",
  "percent_of_equity",
]);

export const STRATEGY_COMMISSION_TYPES: ReadonlySet<string> = new Set<string>([
  "percent",
  "cash_per_contract",
  "cash_per_order",
]);

export interface StudyLikeForStrategyDetection {
  metaInfo?: {
    is_strategy?: boolean;
    isStrategy?: boolean;
    isTVScriptStrategy?: boolean;
    [key: string]: unknown;
  } | null;
  extra?: { kind?: string; [key: string]: unknown } | null;
  pineId?: string | null;
  scriptId?: string | null;
  studyId?: string | null;
}

export const isStudyStrategy = (
  study: StudyLikeForStrategyDetection | null | undefined,
): boolean => {
  if (!study) return false;
  // User-authored Pine strategies use `is_strategy`/`isStrategy`; TV's
  // built-in strategies (STD;Supertrend%Strategy, STD;MACD%1Strategy, …)
  // expose `isTVScriptStrategy` instead.
  if (study.metaInfo?.is_strategy === true) return true;
  if (study.metaInfo?.isStrategy === true) return true;
  if (study.metaInfo?.isTVScriptStrategy === true) return true;
  if (study.extra?.kind === "strategy") return true;
  return false;
};

const TV_SCRIPTING_STUB = /Script\$.+@tv-scripting-101/;

export const isStudyStrategyStub = (
  study: StudyLikeForStrategyDetection | null | undefined,
): boolean => {
  if (!study) return false;
  if (isStudyStrategy(study)) return true;
  const scriptId = study.scriptId ?? "";
  if (TV_SCRIPTING_STUB.test(scriptId)) return true;
  const pineId = study.pineId ?? "";
  if (pineId.startsWith("PUB;") && TV_SCRIPTING_STUB.test(scriptId)) return true;
  return false;
};
