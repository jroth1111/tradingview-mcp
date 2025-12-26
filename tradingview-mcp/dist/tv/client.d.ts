import { type Candle, type Quote, type StudyResult, type BacktestResult, type TVCredentials, type TradingViewEndpoint } from "./types.js";
export declare function validateTimeframe(tf: string | number): string;
export interface ClientOptions {
    credentials?: TVCredentials;
    endpoint?: TradingViewEndpoint;
    timeoutMs?: number;
    debug?: boolean;
    /** Use connection pooling (default: true) */
    usePooling?: boolean;
}
export declare class TradingViewClient {
    private credentials?;
    private endpoint;
    private timeoutMs;
    private debug;
    private pool?;
    private usePooling;
    constructor(opts?: ClientOptions);
    setCredentials(credentials: TVCredentials): void;
    /**
     * Get pool statistics (only available when pooling is enabled)
     */
    getPoolStats(): {
        poolingEnabled: boolean;
    } | {
        totalConnections: number;
        activeConnections: number;
        idleConnections: number;
        pendingConnections: number;
        connectionsByEndpoint: Record<string, number>;
        poolingEnabled: boolean;
    };
    /**
     * Close all pooled connections (only applicable when pooling is enabled)
     */
    closePool(): Promise<void>;
    /**
     * Acquire a connection from the pool or create a new one
     */
    private acquireConnection;
    /**
     * Release a connection back to the pool (no-op if pooling disabled)
     */
    private releaseConnection;
    /**
     * Fetch OHLCV candles for a symbol
     */
    getCandles(opts: {
        symbol: string;
        timeframe?: string | number;
        amount?: number;
        to?: number;
    }): Promise<Candle[]>;
    /**
     * Get real-time quotes for symbols
     */
    getQuotes(symbols: string[], fields?: string[]): Promise<Record<string, Quote>>;
    /**
     * Validate PineScript code by attempting to create a study
     * Returns errors if compilation fails
     */
    validatePineScript(opts: {
        code: string;
        symbol?: string;
        timeframe?: string;
    }): Promise<StudyResult>;
    /**
     * Run a PineScript strategy and get backtest results
     */
    runBacktest(opts: {
        script: string;
        symbol: string;
        timeframe?: string;
    }): Promise<BacktestResult>;
    /**
     * Fetch indicator metadata including compiled ILScript (required for STD/PUB indicators)
     */
    private fetchIndicatorMeta;
    /**
     * Run a built-in indicator (study) and get actual plot values
     * Returns the indicator data for the requested symbol
     *
     * For STD;/PUB; indicators, automatically fetches and injects the required ILScript
     */
    runStudy(opts: {
        symbol: string;
        studyId: string;
        timeframe?: string;
        inputs?: Record<string, unknown>;
        count?: number;
    }): Promise<{
        symbol: string;
        studyId: string;
        data: Array<{
            timestamp: number;
            plots: Record<string, number>;
        }>;
    }>;
    /**
     * Run a chained backtest: indicator → receiver strategy
     *
     * This allows backtesting a strategy that consumes signals from another indicator
     * using the Receiver Strategy pattern with input.source() bridging.
     *
     * Key mechanics (from protocol analysis):
     * - Keep data source as 'sds_1' (main chart) for both studies
     * - Link via inputs using 'StudyID$PlotIndex' format (e.g., 'st1$0')
     */
    runChainedBacktest(opts: {
        /** Indicator ID to chain (e.g., "PUB;abc123", "STD;RSI") */
        indicatorId: string;
        /** Optional input overrides for the indicator */
        indicatorInputs?: Record<string, unknown>;
        /** Receiver strategy Pine Script code with input.source() declarations */
        receiverScript: string;
        /** Maps receiver input IDs to indicator plot indices: { "in_0": 0, "in_1": 1 } */
        inputMappings: Record<string, number>;
        symbol: string;
        timeframe?: string;
    }): Promise<BacktestResult & {
        chainInfo: {
            indicatorId: string;
            mappings: Record<string, string>;
        };
    }>;
    /**
     * Fetch deep historical candle data with pagination
     * Can fetch up to 40k+ bars by automatically requesting more data
     */
    getDeepCandles(opts: {
        symbol: string;
        timeframe?: string;
        total?: number;
        delayMs?: number;
    }): Promise<Candle[]>;
    private getEndpointFallbacks;
    private isStudyNotAllowedMessage;
    private extractStudyErrorMessage;
    private withStudyEndpointFallback;
    private generateStudyId;
    /**
     * Process raw candle data from TradingView.
     * @returns Candles sorted from newest to oldest (descending timestamp)
     */
    private processCandles;
    private parseStrategyReport;
    private handleError;
    /**
     * Error handler for pooled connections (does not close connection)
     * The pool manages connection lifecycle
     */
    private handleErrorPooled;
}
//# sourceMappingURL=client.d.ts.map