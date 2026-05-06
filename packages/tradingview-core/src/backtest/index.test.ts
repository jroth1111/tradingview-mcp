import { describe, expect, it } from "vitest";
import {
  generateSignals,
  runBacktest,
  type BacktestBar,
  type TradeSignal,
} from "./index";

describe("generateSignals", () => {
  it("returns HOLD for the first bar (no previous indicator)", () => {
    const signals = generateSignals([{ time: 0, value: 25 }]);
    expect(signals).toEqual(["HOLD"]);
  });

  it("emits BUY only on the bar that crosses entryThreshold from above", () => {
    const data = [
      { time: 0, value: 40 },
      { time: 1, value: 35 },
      { time: 2, value: 25 },
      { time: 3, value: 20 },
      { time: 4, value: 28 },
    ];
    const signals = generateSignals(data);
    expect(signals).toEqual(["HOLD", "HOLD", "BUY", "HOLD", "HOLD"]);
  });

  it("emits SELL only on the bar that crosses exitThreshold from below", () => {
    const data = [
      { time: 0, value: 50 },
      { time: 1, value: 65 },
      { time: 2, value: 75 },
      { time: 3, value: 80 },
      { time: 4, value: 60 },
    ];
    const signals = generateSignals(data);
    expect(signals).toEqual(["HOLD", "HOLD", "SELL", "HOLD", "HOLD"]);
  });

  it("returns HOLD when the indicator is null and skips cross detection until two real values exist", () => {
    const data = [
      { time: 0, value: 40 },
      { time: 1, value: null },
      { time: 2, value: 25 },
      { time: 3, value: 35 },
      { time: 4, value: 25 },
    ];
    const signals = generateSignals(data);
    expect(signals[1]).toBe("HOLD");
    expect(signals[2]).toBe("HOLD");
    expect(signals[3]).toBe("HOLD");
    expect(signals[4]).toBe("BUY");
  });

  it("respects custom thresholds", () => {
    const data = [
      { time: 0, value: 50 },
      { time: 1, value: 19 },
      { time: 2, value: 18 },
      { time: 3, value: 50 },
      { time: 4, value: 81 },
    ];
    const signals = generateSignals(data, { entryThreshold: 20, exitThreshold: 80 });
    expect(signals).toEqual(["HOLD", "BUY", "HOLD", "HOLD", "SELL"]);
  });
});

describe("runBacktest", () => {
  const bar = (time: number, close: number): BacktestBar => ({
    time,
    open: close,
    high: close,
    low: close,
    close,
  });

  it("opens long on BUY and closes on SELL with the expected PnL", () => {
    const bars = [bar(0, 100), bar(1, 105)];
    const signals: TradeSignal[] = ["BUY", "SELL"];
    const result = runBacktest(bars, signals);

    expect(result.totalTrades).toBe(1);
    expect(result.winningTrades).toBe(1);
    expect(result.losingTrades).toBe(0);
    expect(result.winRate).toBe(100);
    expect(result.totalPnl).toBeCloseTo(500, 6);
    expect(result.totalPnlPercent).toBeCloseTo(5, 6);
    expect(result.trades[0].direction).toBe("long");
    expect(result.trades[0].exitReason).toBe("signal_reverse");
    expect(result.trades[0].entryPrice).toBe(100);
    expect(result.trades[0].exitPrice).toBe(105);
  });

  it("triggers stop_loss when price retraces past the threshold", () => {
    const bars = [bar(0, 100), bar(1, 94)];
    const signals: TradeSignal[] = ["BUY", "HOLD"];
    const result = runBacktest(bars, signals, { stopLossPercent: 5 });

    expect(result.totalTrades).toBe(1);
    expect(result.winningTrades).toBe(0);
    expect(result.losingTrades).toBe(1);
    expect(result.trades[0].exitReason).toBe("stop_loss");
    expect(result.totalPnl).toBeCloseTo(-600, 6);
  });

  it("triggers take_profit when price runs past the threshold", () => {
    const bars = [bar(0, 100), bar(1, 111)];
    const signals: TradeSignal[] = ["BUY", "HOLD"];
    const result = runBacktest(bars, signals, { takeProfitPercent: 10 });

    expect(result.totalTrades).toBe(1);
    expect(result.winningTrades).toBe(1);
    expect(result.trades[0].exitReason).toBe("take_profit");
    expect(result.totalPnl).toBeCloseTo(1100, 6);
  });

  it("closes any open trade at end_of_data", () => {
    const bars = [bar(0, 100), bar(1, 102)];
    const signals: TradeSignal[] = ["BUY", "HOLD"];
    const result = runBacktest(bars, signals);

    expect(result.totalTrades).toBe(1);
    expect(result.trades[0].exitReason).toBe("end_of_data");
    expect(result.totalPnl).toBeCloseTo(200, 6);
  });

  it("preserves initialCapital when no signals fire", () => {
    const bars = [bar(0, 100), bar(1, 110), bar(2, 120)];
    const signals: TradeSignal[] = ["HOLD", "HOLD", "HOLD"];
    const result = runBacktest(bars, signals, { initialCapital: 10000 });

    expect(result.totalTrades).toBe(0);
    expect(result.totalPnl).toBe(0);
    expect(result.winRate).toBe(0);
  });
});
