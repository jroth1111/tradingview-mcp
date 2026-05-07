import { describe, expect, it } from "vitest";

import {
  STRATEGY_COMMISSION_TYPES,
  STRATEGY_DEFAULT_QTY_TYPES,
  STRATEGY_PROPERTY_KEYS,
  isStudyStrategy,
  isStudyStrategyStub,
} from "./strategy";

describe("STRATEGY_PROPERTY_KEYS", () => {
  it("contains exactly the 16 canonical strategy property keys", () => {
    const expected = [
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
    ].sort();
    expect([...STRATEGY_PROPERTY_KEYS].sort()).toEqual(expected);
    expect(STRATEGY_PROPERTY_KEYS.size).toBe(16);
  });
});

describe("STRATEGY_DEFAULT_QTY_TYPES", () => {
  it("uses skill canonical enum values, not the legacy worker values", () => {
    expect([...STRATEGY_DEFAULT_QTY_TYPES].sort()).toEqual([
      "cash_per_order",
      "fixed",
      "percent_of_equity",
    ]);
    expect(STRATEGY_DEFAULT_QTY_TYPES.has("fixed_units")).toBe(false);
    expect(STRATEGY_DEFAULT_QTY_TYPES.has("cash")).toBe(false);
  });
});

describe("STRATEGY_COMMISSION_TYPES", () => {
  it("uses skill canonical enum values", () => {
    expect([...STRATEGY_COMMISSION_TYPES].sort()).toEqual([
      "cash_per_contract",
      "cash_per_order",
      "percent",
    ]);
  });
});

describe("isStudyStrategy", () => {
  it("returns true when metaInfo.is_strategy is true", () => {
    expect(isStudyStrategy({ metaInfo: { is_strategy: true } })).toBe(true);
  });

  it("returns true when metaInfo.isStrategy (camelCase) is true", () => {
    expect(isStudyStrategy({ metaInfo: { isStrategy: true } })).toBe(true);
  });

  it("returns true when metaInfo.isTVScriptStrategy is true (built-in strategies)", () => {
    expect(
      isStudyStrategy({ metaInfo: { isTVScriptStrategy: true } }),
    ).toBe(true);
  });

  it("returns true when extra.kind is 'strategy'", () => {
    expect(isStudyStrategy({ extra: { kind: "strategy" } })).toBe(true);
  });

  it("returns false on plain RSI metaInfo", () => {
    expect(
      isStudyStrategy({
        metaInfo: { id: "Script$STD;RSI@tv-basicstudies-1", is_strategy: false },
      }),
    ).toBe(false);
  });

  it("returns false on null and undefined", () => {
    expect(isStudyStrategy(null)).toBe(false);
    expect(isStudyStrategy(undefined)).toBe(false);
  });
});

describe("isStudyStrategyStub", () => {
  it("returns true when isStudyStrategy is true", () => {
    expect(isStudyStrategyStub({ metaInfo: { is_strategy: true } })).toBe(true);
  });

  it("matches scriptId tv-scripting-101 marker", () => {
    expect(
      isStudyStrategyStub({
        scriptId: "Script$STD;Supertrend%1Strategy@tv-scripting-101!",
      }),
    ).toBe(true);
  });

  it("returns false on RSI built-in", () => {
    expect(
      isStudyStrategyStub({
        scriptId: "Script$STD;RSI@tv-basicstudies-1",
        metaInfo: { is_strategy: false },
      }),
    ).toBe(false);
  });
});
