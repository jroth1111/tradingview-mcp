/**
 * Test script for backtest logic with mock data
 */
import { generateSignals, runBacktest, formatBacktestResult } from "./utils/backtest.js";
function generateMockPriceData(count) {
    const basePrice = 150;
    const data = [];
    const now = Math.floor(Date.now() / 1000);
    const daySeconds = 86400;
    let price = basePrice;
    let momentum = 0;
    for (let i = 0; i < count; i++) {
        const change = (Math.random() - 0.5) * 4;
        momentum = momentum * 0.9 + change * 0.1;
        price += momentum + (Math.random() - 0.5) * 2;
        const open = price + (Math.random() - 0.5) * 1;
        const high = Math.max(open, price) + Math.random() * 1;
        const low = Math.min(open, price) - Math.random() * 1;
        const close = price + (Math.random() - 0.5) * 0.5;
        data.push({
            time: now - (count - i) * daySeconds,
            open,
            high,
            low,
            close,
            volume: Math.floor(Math.random() * 10000000 + 5000000),
        });
    }
    return data;
}
function generateMockRSIData(bars) {
    const data = [];
    const period = 14;
    for (let i = 0; i < bars.length; i++) {
        if (i < period) {
            data.push({ time: bars[i].time, value: null });
            continue;
        }
        const slice = bars.slice(i - period + 1, i + 1);
        const gains = [];
        const losses = [];
        for (let j = 1; j < slice.length; j++) {
            const change = slice[j].close - slice[j - 1].close;
            if (change > 0)
                gains.push(change);
            else
                losses.push(Math.abs(change));
        }
        const avgGain = gains.reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        data.push({
            time: bars[i].time,
            value: Math.max(0, Math.min(100, rsi)),
        });
    }
    return data;
}
function testBacktest() {
    console.log("=== Testing Backtest Logic ===\n");
    const priceData = generateMockPriceData(500);
    const rsiData = generateMockRSIData(priceData);
    console.log("Generated mock data:");
    console.log(`- Price bars: ${priceData.length}`);
    console.log(`- RSI values: ${rsiData.filter(d => d.value !== null).length}`);
    console.log();
    const signals = generateSignals(rsiData, {
        entryThreshold: 30,
        exitThreshold: 70,
    });
    const buySignals = signals.filter(s => s === "BUY").length;
    const sellSignals = signals.filter(s => s === "SELL").length;
    const holdSignals = signals.filter(s => s === "HOLD").length;
    console.log("Generated signals:");
    console.log(`- BUY signals: ${buySignals}`);
    console.log(`- SELL signals: ${sellSignals}`);
    console.log(`- HOLD signals: ${holdSignals}`);
    console.log();
    const backtestConfig = {
        entryThreshold: 30,
        exitThreshold: 70,
        stopLossPercent: 5,
        takeProfitPercent: 10,
        initialCapital: 10000,
    };
    const result = runBacktest(priceData, signals, backtestConfig);
    console.log(formatBacktestResult(result));
    console.log("=== Validation ===");
    const totalPnlMatches = result.trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const pnlMatches = Math.abs(totalPnlMatches - result.totalPnl) < 0.01;
    console.log(`Total P&L from trades matches result.totalPnl: ${pnlMatches ? "✓" : "✗"}`);
    const winRateMatches = result.totalTrades > 0
        ? Math.abs(result.winRate - (result.winningTrades / result.totalTrades) * 100) < 0.01
        : true;
    console.log(`Win rate calculation correct: ${winRateMatches ? "✓" : "✗"}`);
    const profitFactorWins = result.trades.filter(t => (t.pnl ?? 0) > 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const profitFactorLosses = Math.abs(result.trades.filter(t => (t.pnl ?? 0) <= 0).reduce((sum, t) => sum + (t.pnl ?? 0), 0));
    const profitFactorMatches = profitFactorLosses > 0
        ? Math.abs(result.profitFactor - profitFactorWins / profitFactorLosses) < 0.01
        : (result.profitFactor === Infinity && profitFactorWins > 0);
    console.log(`Profit factor calculation correct: ${profitFactorMatches ? "✓" : "✗"}`);
    const allValid = pnlMatches && winRateMatches && profitFactorMatches;
    console.log(`\nAll validations passed: ${allValid ? "✓" : "✗"}`);
    if (!allValid) {
        console.error("\nTest failed!");
        process.exit(1);
    }
    console.log("\n=== Test Passed ===");
}
testBacktest();
//# sourceMappingURL=test-backtest.js.map