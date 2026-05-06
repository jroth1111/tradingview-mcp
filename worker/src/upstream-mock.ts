import type { Candle } from "./tradingview";

// Simple synthetic candle generator for test mode
export const generateMockCandles = (startTs: number, count: number, step: number = 60): Candle[] => {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const t = startTs + i * step;
    candles.push({
      timestamp: t,
      open: i,
      high: i + 1,
      low: i - 1,
      close: i + 0.5,
      volume: 1000 + i,
    });
  }
  return candles;
};
