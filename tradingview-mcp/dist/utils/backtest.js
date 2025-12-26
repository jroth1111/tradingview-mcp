/**
 * Backtest utilities for indicator-based trading strategies
 */
/**
 * Generate trading signals from indicator values using threshold-based logic
 * BUY when indicator drops below entryThreshold
 * SELL when indicator rises above exitThreshold
 */
export function generateSignals(data, config = {}) {
    const { entryThreshold = 30, exitThreshold = 70 } = config;
    const signals = [];
    for (let i = 0; i < data.length; i++) {
        const indicator = data[i].value;
        const prevIndicator = i > 0 ? data[i - 1].value : null;
        if (indicator === null) {
            signals.push("HOLD");
            continue;
        }
        let signal = "HOLD";
        if (prevIndicator !== null) {
            if (prevIndicator >= entryThreshold && indicator < entryThreshold) {
                signal = "BUY";
            }
            else if (prevIndicator <= exitThreshold && indicator > exitThreshold) {
                signal = "SELL";
            }
        }
        signals.push(signal);
    }
    return signals;
}
/**
 * Run backtest simulation with given price data, signals, and configuration
 */
export function runBacktest(bars, signals, config = {}) {
    const { stopLossPercent = 5, takeProfitPercent = 10, initialCapital = 10000, } = config;
    const trades = [];
    let capital = initialCapital;
    let peakCapital = initialCapital;
    let maxDrawdown = 0;
    let currentTrade = null;
    let consecutiveWins = 0;
    let consecutiveLosses = 0;
    const tradeDurations = [];
    for (let i = 0; i < bars.length && i < signals.length; i++) {
        const bar = bars[i];
        const signal = signals[i];
        if (!currentTrade && signal !== "HOLD") {
            const direction = signal === "BUY" ? "long" : "short";
            const positionValue = capital;
            const entryPrice = bar.close;
            currentTrade = {
                entryTime: bar.time,
                entryPrice,
                direction,
            };
        }
        if (currentTrade) {
            const { entryPrice, direction } = currentTrade;
            const currentPrice = bar.close;
            let pnl;
            let pnlPercent;
            if (direction === "long") {
                pnl = ((currentPrice - entryPrice) / entryPrice) * capital;
                pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
            }
            else {
                pnl = ((entryPrice - currentPrice) / entryPrice) * capital;
                pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
            }
            let shouldClose = false;
            let exitReason;
            if (pnlPercent <= -stopLossPercent) {
                shouldClose = true;
                exitReason = "stop_loss";
            }
            else if (pnlPercent >= takeProfitPercent) {
                shouldClose = true;
                exitReason = "take_profit";
            }
            else if (signal !== "HOLD" && ((signal === "BUY" && direction === "short") || (signal === "SELL" && direction === "long"))) {
                shouldClose = true;
                exitReason = "signal_reverse";
            }
            else if (i === bars.length - 1) {
                shouldClose = true;
                exitReason = "end_of_data";
            }
            if (shouldClose) {
                capital += pnl;
                peakCapital = Math.max(peakCapital, capital);
                const drawdown = peakCapital - capital;
                maxDrawdown = Math.max(maxDrawdown, drawdown);
                currentTrade.exitTime = bar.time;
                currentTrade.exitPrice = currentPrice;
                currentTrade.pnl = pnl;
                currentTrade.pnlPercent = pnlPercent;
                currentTrade.exitReason = exitReason;
                if (pnl > 0) {
                    consecutiveWins++;
                    consecutiveLosses = 0;
                }
                else {
                    consecutiveLosses++;
                    consecutiveWins = 0;
                }
                if (currentTrade.exitTime && currentTrade.entryTime) {
                    tradeDurations.push(currentTrade.exitTime - currentTrade.entryTime);
                }
                trades.push({ ...currentTrade });
                currentTrade = null;
            }
        }
    }
    const winningTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;
    const losingTrades = trades.filter(t => (t.pnl ?? 0) <= 0).length;
    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalPnl = capital - initialCapital;
    const totalPnlPercent = (totalPnl / initialCapital) * 100;
    const maxDrawdownPercent = (maxDrawdown / initialCapital) * 100;
    const wins = trades.filter(t => (t.pnl ?? 0) > 0);
    const losses = trades.filter(t => (t.pnl ?? 0) <= 0);
    const averageWin = wins.length > 0
        ? wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / wins.length
        : 0;
    const averageLoss = losses.length > 0
        ? losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / losses.length
        : 0;
    const totalWins = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
    const maxConsecutiveWins = trades.reduce((max, t, idx) => {
        let current = 0;
        for (let j = idx; j < trades.length; j++) {
            if ((trades[j].pnl ?? 0) > 0)
                current++;
            else
                break;
        }
        return Math.max(max, current);
    }, 0);
    const maxConsecutiveLosses = trades.reduce((max, t, idx) => {
        let current = 0;
        for (let j = idx; j < trades.length; j++) {
            if ((trades[j].pnl ?? 0) <= 0)
                current++;
            else
                break;
        }
        return Math.max(max, current);
    }, 0);
    const averageTradeDuration = tradeDurations.length > 0
        ? tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length
        : undefined;
    const returns = trades.map(t => (t.pnlPercent ?? 0) / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
        ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
        : 0;
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    return {
        trades,
        totalTrades,
        winningTrades,
        losingTrades,
        winRate,
        totalPnl,
        totalPnlPercent,
        averageWin,
        averageLoss,
        profitFactor,
        maxDrawdown,
        maxDrawdownPercent,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        sharpeRatio,
        averageTradeDuration,
    };
}
/**
 * Format backtest results as a human-readable summary
 */
export function formatBacktestResult(result) {
    const lines = [
        "=== Backtest Results ===",
        "",
        `Total Trades: ${result.totalTrades}`,
        `Winning Trades: ${result.winningTrades}`,
        `Losing Trades: ${result.losingTrades}`,
        `Win Rate: ${result.winRate.toFixed(2)}%`,
        "",
        `Total P&L: $${result.totalPnl.toFixed(2)}`,
        `Total P&L %: ${result.totalPnlPercent.toFixed(2)}%`,
        `Average Win: $${result.averageWin.toFixed(2)}`,
        `Average Loss: $${result.averageLoss.toFixed(2)}`,
        `Profit Factor: ${result.profitFactor === Infinity ? "∞" : result.profitFactor.toFixed(2)}`,
        "",
        `Max Drawdown: $${result.maxDrawdown.toFixed(2)}`,
        `Max Drawdown %: ${result.maxDrawdownPercent.toFixed(2)}%`,
        `Max Consecutive Wins: ${result.maxConsecutiveWins}`,
        `Max Consecutive Losses: ${result.maxConsecutiveLosses}`,
        "",
        `Sharpe Ratio: ${result.sharpeRatio !== undefined ? result.sharpeRatio.toFixed(4) : "N/A"}`,
        `Avg Trade Duration: ${result.averageTradeDuration ? `${(result.averageTradeDuration / 86400).toFixed(2)} days` : "N/A"}`,
        "",
    ];
    if (result.trades.length > 0) {
        lines.push("=== Last 5 Trades ===");
        const recentTrades = result.trades.slice(-5);
        for (const trade of recentTrades) {
            const entryDate = new Date(trade.entryTime * 1000).toISOString().split("T")[0];
            const exitDate = trade.exitTime ? new Date(trade.exitTime * 1000).toISOString().split("T")[0] : "Open";
            lines.push(`${trade.direction.toUpperCase()}: $${trade.entryPrice.toFixed(2)} → ${trade.exitPrice !== undefined ? `$${trade.exitPrice.toFixed(2)}` : "Open"} | ` +
                `${trade.pnl !== undefined ? `$${trade.pnl.toFixed(2)} (${(trade.pnlPercent ?? 0).toFixed(2)}%)` : "Open"} | ` +
                `${entryDate} → ${exitDate}` +
                (trade.exitReason ? ` [${trade.exitReason}]` : ""));
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=backtest.js.map