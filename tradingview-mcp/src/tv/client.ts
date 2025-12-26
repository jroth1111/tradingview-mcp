// TradingView client - high-level API for candles, studies, and strategies

import {
  type Candle,
  type Quote,
  type StudyResult,
  type StudyError,
  type BacktestResult,
  type TVCredentials,
  type TradingViewEndpoint,
  ENDPOINTS,
  VALID_TIMEFRAMES,
  TIMEFRAME_MAP,
} from "./types.js";
import { connect, type TVConnection, type TVEvent } from "./connection.js";
import { generateSessionId } from "./messages.js";
import { logger } from "../utils/logger.js";
import { buildStudyInputs, type StudyInputMeta } from "../utils/study-inputs.js";
import { ConnectionPool } from "./pool.js";
import { getTimeout, type TimeoutOperation } from "../utils/timeouts.js";

const MAX_BATCH_SIZE = 20000;

export function validateTimeframe(tf: string | number): string {
  const tfStr = typeof tf === "number" ? tf.toString() : tf;
  if (VALID_TIMEFRAMES.has(tfStr)) return tfStr;
  const mapped = TIMEFRAME_MAP.get(tfStr.toLowerCase());
  if (mapped) return mapped;
  throw new Error(`Invalid timeframe: ${tf}`);
}

export interface ClientOptions {
  credentials?: TVCredentials;
  endpoint?: TradingViewEndpoint;
  timeoutMs?: number;
  debug?: boolean;
  /** Use connection pooling (default: true) */
  usePooling?: boolean;
}

export class TradingViewClient {
  private credentials?: TVCredentials;
  private endpoint: TradingViewEndpoint;
  private timeoutMs: number;
  private debug: boolean;
  private pool?: ConnectionPool;
  private usePooling: boolean;

  constructor(opts: ClientOptions = {}) {
    this.credentials = opts.credentials;
    this.endpoint = opts.endpoint ?? "prodata";
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.debug = opts.debug ?? false;
    this.usePooling = opts.usePooling ?? true;

    if (this.debug && !process.env.TV_DEBUG) {
      process.env.TV_DEBUG = "true";
    }

    // Initialize connection pool if enabled
    if (this.usePooling) {
      this.pool = new ConnectionPool({
        credentials: this.credentials,
        endpoint: this.endpoint,
        timeoutMs: this.timeoutMs,
        debug: this.debug,
      });
    }
  }

  setCredentials(credentials: TVCredentials) {
    this.credentials = credentials;
    if (this.pool) {
      this.pool.setCredentials(credentials);
    }
  }

  /**
   * Get pool statistics (only available when pooling is enabled)
   */
  getPoolStats() {
    if (!this.pool) {
      return { poolingEnabled: false };
    }
    return {
      poolingEnabled: true,
      ...this.pool.getStats(),
    };
  }

  /**
   * Close all pooled connections (only applicable when pooling is enabled)
   */
  async closePool(): Promise<void> {
    if (this.pool) {
      await this.pool.closeAll();
    }
  }

  /**
   * Acquire a connection from the pool or create a new one
   */
  private async acquireConnection(endpoint?: TradingViewEndpoint): Promise<TVConnection> {
    if (this.pool) {
      return this.pool.acquire(endpoint);
    }
    return connect({
      credentials: this.credentials,
      endpoint: endpoint ?? this.endpoint,
      timeoutMs: this.timeoutMs,
      debug: this.debug,
    });
  }

  /**
   * Release a connection back to the pool (no-op if pooling disabled)
   */
  private releaseConnection(endpoint: TradingViewEndpoint = this.endpoint): void {
    if (this.pool) {
      this.pool.release(endpoint);
    }
  }

  /**
   * Fetch OHLCV candles for a symbol
   */
  async getCandles(opts: {
    symbol: string;
    timeframe?: string | number;
    amount?: number;
    to?: number;
  }): Promise<Candle[]> {
    const timeframe = validateTimeframe(opts.timeframe ?? "60");
    const batchSize = Math.min(opts.amount ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE);
    const chartSession = generateSessionId("cs");

    const connection = await this.acquireConnection();

    try {
      return await new Promise<Candle[]>((resolve, reject) => {
        let rawCandles: unknown[] = [];
        let completed = false;
        let fetches = 0;

        const unsubscribe = connection.subscribe((event: TVEvent) => {
          try {
            if (event.name === "timescale_update") {
              const sessionData = event.params[1] as Record<string, unknown>;
              const seriesKey = Object.keys(sessionData).find(
                k => k.startsWith("sds_") && (sessionData[k] as Record<string, unknown>)?.s
              );
              if (seriesKey) {
                const series = sessionData[seriesKey] as { s: unknown[] };
                rawCandles = [...series.s, ...rawCandles];
              }
            }

            if (event.name === "series_completed" || event.name === "symbol_error") {
              const loaded = rawCandles.length;
              const needMore = loaded > 0 && loaded % batchSize === 0 && (!opts.amount || loaded < opts.amount);

              if (needMore && fetches < 500) {
                fetches += 1;
                connection.send("request_more_data", [chartSession, "sds_1", batchSize]);
                return;
              }

              completed = true;
              unsubscribe();
              resolve(this.processCandles(rawCandles, opts.amount));
            }
          } catch (err) {
            this.handleErrorPooled(completed, unsubscribe, reject, err);
          }
        });

        try {
          connection.send("chart_create_session", [chartSession, ""]);
          connection.send("resolve_symbol", [
            chartSession,
            "sds_sym_1",
            "=" + JSON.stringify({ symbol: opts.symbol, adjustment: "splits" }),
          ]);
          connection.send("create_series", [
            chartSession,
            "sds_1",
            "s1",
            "sds_sym_1",
            timeframe,
            batchSize,
            opts.to ?? "",
          ]);
        } catch (err) {
          this.handleErrorPooled(completed, unsubscribe, reject, err);
        }

        setTimeout(() => {
          if (!completed) {
            completed = true;
            unsubscribe();
            reject(new Error("Timed out fetching candles"));
          }
        }, getTimeout("candles"));
      });
    } finally {
      this.releaseConnection();
    }
  }

  /**
   * Get real-time quotes for symbols
   */
  async getQuotes(symbols: string[], fields?: string[]): Promise<Record<string, Quote>> {
    const quoteSession = generateSessionId("qs");
    const connection = await this.acquireConnection();

    try {
      const defaultFields = [
        "lp", "ch", "chp", "volume", "bid", "ask",
        "high_price", "low_price", "open_price", "prev_close_price",
        "lp_time", "currency_code", "exchange", "pro_name",
      ];

      return await new Promise((resolve, reject) => {
        const quotes = new Map<string, Quote>();
        let completed = false;

        const unsubscribe = connection.subscribe((event: TVEvent) => {
          try {
            if (event.name === "qsd") {
              const q = event.params[1] as { n?: string; s?: Quote };
              if (q?.n && q?.s) {
                const prev = quotes.get(q.n) || {};
                quotes.set(q.n, { ...prev, ...q.s });
              }
            }

            if (event.name === "quote_completed") {
              completed = true;
              unsubscribe();
              resolve(Object.fromEntries(quotes));
            }
          } catch (err) {
            this.handleErrorPooled(completed, unsubscribe, reject, err);
          }
        });

        try {
          const useFields = fields?.length ? fields : defaultFields;
          connection.send("quote_create_session", [quoteSession]);
          connection.send("quote_set_fields", [quoteSession, ...useFields]);
          connection.send("quote_add_symbols", [quoteSession, ...symbols]);
        } catch (err) {
          this.handleErrorPooled(completed, unsubscribe, reject, err);
        }

        setTimeout(() => {
          if (!completed) {
            completed = true;
            unsubscribe();
            // Return partial results on timeout
            resolve(Object.fromEntries(quotes));
          }
        }, getTimeout("quote"));
      });
    } finally {
      this.releaseConnection();
    }
  }

  /**
   * Validate PineScript code by attempting to create a study
   * Returns errors if compilation fails
   */
  async validatePineScript(opts: {
    code: string;
    symbol?: string;
    timeframe?: string;
  }): Promise<StudyResult> {
    const symbol = opts.symbol ?? "NASDAQ:AAPL";
    const timeframe = validateTimeframe(opts.timeframe ?? "1D");
    const runOnce = async (endpoint: TradingViewEndpoint): Promise<StudyResult> => {
      const chartSession = generateSessionId("cs");
      const connection = await this.acquireConnection(endpoint);

      try {
        return await new Promise<StudyResult>((resolve, reject) => {
          let completed = false;
          const errors: StudyError[] = [];
          const warnings: StudyError[] = [];

          const unsubscribe = connection.subscribe((event: TVEvent) => {
            try {
              // Study successfully created
              if (event.name === "du" || event.name === "study_completed") {
                completed = true;
                unsubscribe();
                resolve({
                  valid: true,
                  errors: [],
                  warnings: warnings,
                });
              }

              // Study error - compilation failed
              if (event.name === "study_error") {
                const errorMsg = this.extractStudyErrorMessage(event.params);
                if (this.isStudyNotAllowedMessage(errorMsg)) {
                  completed = true;
                  unsubscribe();
                  reject(new Error(errorMsg));
                  return;
                }

                // Parse line:column from error message
                const match = errorMsg.match(/line (\d+)/i) || errorMsg.match(/at (\d+):(\d+)/);

                errors.push({
                  line: match ? parseInt(match[1]) : 1,
                  column: match && match[2] ? parseInt(match[2]) : 1,
                  message: errorMsg,
                  severity: "error",
                });

                completed = true;
                unsubscribe();
                resolve({
                  valid: false,
                  errors,
                  warnings,
                });
              }

              // Critical error (symbol not found, etc.)
              if (event.name === "symbol_error" || event.name === "critical_error") {
                const errorData = event.params as unknown[];
                errors.push({
                  line: 1,
                  column: 1,
                  message: `Symbol/Connection error: ${JSON.stringify(errorData)}`,
                  severity: "error",
                });

                completed = true;
                unsubscribe();
                resolve({ valid: false, errors, warnings });
              }
            } catch (err) {
              this.handleErrorPooled(completed, unsubscribe, reject, err);
            }
          });

          try {
            // Set up chart session
            connection.send("chart_create_session", [chartSession, ""]);
            connection.send("resolve_symbol", [
              chartSession,
              "sds_sym_1",
              "=" + JSON.stringify({ symbol, adjustment: "splits" }),
            ]);
            connection.send("create_series", [
              chartSession,
              "sds_1",
              "s1",
              "sds_sym_1",
              timeframe,
              300, // Small batch for validation
            ]);

            // Create study with custom PineScript
            // The "Script@tv-scripting-101!" indicator allows inline scripts
            connection.send("create_study", [
              chartSession,
              "st1",
              "st1",
              "sds_1",
              "Script@tv-scripting-101!",
              { text: opts.code, pineVersion: "6" },
            ]);
          } catch (err) {
            this.handleErrorPooled(completed, unsubscribe, reject, err);
          }

          setTimeout(() => {
            if (!completed) {
              completed = true;
              unsubscribe();
              reject(new Error("Timed out validating PineScript"));
            }
          }, getTimeout("validation"));
        });
      } finally {
        this.releaseConnection(endpoint);
      }
    };

    return this.withStudyEndpointFallback(runOnce);
  }

  /**
   * Run a PineScript strategy and get backtest results
   */
  async runBacktest(opts: {
    script: string;
    symbol: string;
    timeframe?: string;
  }): Promise<BacktestResult> {
    const timeframe = validateTimeframe(opts.timeframe ?? "1D");
    const runOnce = async (endpoint: TradingViewEndpoint): Promise<BacktestResult> => {
      const chartSession = generateSessionId("cs");
      const connection = await this.acquireConnection(endpoint);

      try {
        return await new Promise<BacktestResult>((resolve, reject) => {
          let completed = false;
          let strategyReport: Record<string, unknown> | null = null;

          const unsubscribe = connection.subscribe((event: TVEvent) => {
            try {
              // Strategy report with metrics
              if (event.name === "strategy_report" || event.name === "du") {
                const data = event.params[1] as Record<string, unknown>;

                // Check if this contains strategy data
                if (data && (data.net_profit !== undefined || data.strategy)) {
                  strategyReport = data.strategy as Record<string, unknown> || data;
                }
              }

              // Study/strategy completed
              if (event.name === "study_completed" || event.name === "series_completed") {
                if (strategyReport) {
                  completed = true;
                  unsubscribe();
                  resolve(this.parseStrategyReport(strategyReport));
                }
              }

              // Error handling
              if (event.name === "study_error") {
                const errorMsg = this.extractStudyErrorMessage(event.params);
                if (this.isStudyNotAllowedMessage(errorMsg)) {
                  completed = true;
                  unsubscribe();
                  reject(new Error(errorMsg));
                  return;
                }
                completed = true;
                unsubscribe();
                reject(new Error(`Strategy error: ${errorMsg}`));
              }
            } catch (err) {
              this.handleErrorPooled(completed, unsubscribe, reject, err);
            }
          });

          try {
            connection.send("chart_create_session", [chartSession, ""]);
            connection.send("resolve_symbol", [
              chartSession,
              "sds_sym_1",
              "=" + JSON.stringify({ symbol: opts.symbol, adjustment: "splits" }),
            ]);
            connection.send("create_series", [
              chartSession,
              "sds_1",
              "s1",
              "sds_sym_1",
              timeframe,
              MAX_BATCH_SIZE,
            ]);

            // Create strategy study
            connection.send("create_study", [
              chartSession,
              "st1",
              "st1",
              "sds_1",
              "Script@tv-scripting-101!",
              { text: opts.script, pineVersion: "6" },
            ]);
          } catch (err) {
            this.handleErrorPooled(completed, unsubscribe, reject, err);
          }

          setTimeout(() => {
            if (!completed) {
              completed = true;
              unsubscribe();

              // Return partial results if we have them
              if (strategyReport) {
                resolve(this.parseStrategyReport(strategyReport));
              } else {
                reject(new Error("Timed out running backtest"));
              }
            }
          }, getTimeout("backtest"));
        });
      } finally {
        this.releaseConnection(endpoint);
      }
    };

    return this.withStudyEndpointFallback(runOnce);
  }

  /**
   * Fetch indicator metadata including compiled ILScript (required for STD/PUB indicators)
   */
  private async fetchIndicatorMeta(studyId: string): Promise<{
    ilScript?: string;
    pineId?: string;
    pineVersion?: string;
    pineFeatures?: string;
    defaults: Record<string, unknown>;
    inputMeta: StudyInputMeta[];
  }> {
    const url = `https://pine-facade.tradingview.com/pine-facade/translate/${encodeURIComponent(studyId)}/last`;

    const headers: Record<string, string> = {};
    if (this.credentials?.sessionId) {
      headers.cookie = this.credentials.sessionSign
        ? `sessionid=${this.credentials.sessionId};sessionid_sign=${this.credentials.sessionSign}`
        : `sessionid=${this.credentials.sessionId}`;
    }

    const resp = await fetch(url, { method: "GET", headers });
    if (!resp.ok) {
      throw new Error(`Failed to fetch indicator metadata: ${resp.status}`);
    }

    const data = await resp.json() as {
      success?: boolean;
      result?: {
        metaInfo?: {
          inputs?: Array<{
            id: string;
            name: string;
            defval: unknown;
            isHidden?: boolean;
            type?: string;
          }>;
        };
      };
    };

    if (!data?.success || !data?.result?.metaInfo) {
      throw new Error("Indicator metadata not available");
    }

    const inputs = data.result.metaInfo.inputs || [];
    const defaults: Record<string, unknown> = {};
    const inputMeta: StudyInputMeta[] = [];

    // Extract hidden system inputs and user-facing defaults
    let ilScript: string | undefined;
    let pineId: string | undefined;
    let pineVersion: string | undefined;
    let pineFeatures: string | undefined;

    for (const inp of inputs) {
      inputMeta.push({
        id: inp.id,
        type: inp.type,
        defval: inp.defval,
        isHidden: inp.isHidden,
      });

      if (inp.name === "ILScript" && typeof inp.defval === "string") {
        ilScript = inp.defval;
      } else if (inp.name === "pineId" && typeof inp.defval === "string") {
        pineId = inp.defval;
      } else if (inp.name === "pineVersion" && typeof inp.defval === "string") {
        pineVersion = inp.defval;
      } else if (inp.name === "pineFeatures" && typeof inp.defval === "string") {
        pineFeatures = inp.defval;
      } else if (inp.id) {
        // Capture defaults for both user-facing and required hidden inputs.
        defaults[inp.id] = inp.defval;
      }
    }

    return { ilScript, pineId, pineVersion, pineFeatures, defaults, inputMeta };
  }

  /**
   * Run a built-in indicator (study) and get actual plot values
   * Returns the indicator data for the requested symbol
   *
   * For STD;/PUB; indicators, automatically fetches and injects the required ILScript
   */
  async runStudy(opts: {
    symbol: string;
    studyId: string; // e.g., "STD;RSI", "STD;MACD", "PUB;abc123"
    timeframe?: string;
    inputs?: Record<string, unknown>;
    count?: number;
  }): Promise<{
    symbol: string;
    studyId: string;
    data: Array<{ timestamp: number; plots: Record<string, number> }>;
  }> {
    const timeframe = validateTimeframe(opts.timeframe ?? "1D");
    const count = opts.count ?? 100;

    // For STD; and PUB; indicators, fetch metadata to get compiled ILScript
    let studyInputs: Record<string, unknown> = { ...(opts.inputs || {}) };

    if (opts.studyId.startsWith("STD;") || opts.studyId.startsWith("PUB;")) {
      try {
        const meta = await this.fetchIndicatorMeta(opts.studyId);

        // Inject required system inputs
        if (meta.ilScript) {
          studyInputs = meta.inputMeta.length
            ? buildStudyInputs({
              inputMeta: meta.inputMeta,
              overrides: studyInputs,
              ilScript: meta.ilScript,
              pineId: meta.pineId || opts.studyId,
              pineVersion: meta.pineVersion,
              pineFeatures: meta.pineFeatures,
            })
            : (() => {
              const resolved: Record<string, unknown> = {
                text: meta.ilScript,
                pineId: meta.pineId || opts.studyId,
                ...meta.defaults,  // Default input values
                ...studyInputs,    // User overrides
              };
              if (meta.pineVersion) {
                resolved.pineVersion = meta.pineVersion;
              }
              if (meta.pineFeatures) {
                resolved.pineFeatures = meta.pineFeatures;
              }
              return resolved;
            })();
        }
      } catch (err) {
        if (this.debug) {
          logger.debug("TV failed to fetch indicator metadata", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        // Continue with original inputs, may fail
      }
    }

    const runOnce = async (endpoint: TradingViewEndpoint): Promise<{
      symbol: string;
      studyId: string;
      data: Array<{ timestamp: number; plots: Record<string, number> }>;
    }> => {
      const chartSession = generateSessionId("cs");
      const connection = await this.acquireConnection(endpoint);

      try {
        return await new Promise((resolve, reject) => {
          let completed = false;
          const studyData: Array<{ timestamp: number; plots: Record<string, number> }> = [];

          const unsubscribe = connection.subscribe((event: TVEvent) => {
            try {
              // Study data update
              if (event.name === "du") {
                const data = event.params[1] as Record<string, unknown>;
                // Look for study data in the response
                if (data && typeof data === "object") {
                  Object.entries(data).forEach(([key, value]) => {
                    if (key.startsWith("st") && value && typeof value === "object") {
                      const studyPayload = value as { st?: unknown[]; ns?: { d?: string } };
                      if (studyPayload.st && Array.isArray(studyPayload.st)) {
                        studyPayload.st.forEach((point: unknown) => {
                          const p = point as { i?: number; v?: number[] };
                          if (p?.i !== undefined && p?.v) {
                            const plots: Record<string, number> = {};
                            p.v.forEach((val, idx) => {
                              plots[`plot_${idx}`] = val;
                            });
                            studyData.push({ timestamp: p.i, plots });
                          }
                        });
                      }
                    }
                  });
                }
              }

              // Study completed
              if (event.name === "study_completed") {
                completed = true;
                unsubscribe();
                resolve({
                  symbol: opts.symbol,
                  studyId: opts.studyId,
                  data: studyData.slice(-count).sort((a, b) => a.timestamp - b.timestamp),
                });
              }

              if (event.name === "series_completed" && studyData.length > 0) {
                completed = true;
                unsubscribe();
                resolve({
                  symbol: opts.symbol,
                  studyId: opts.studyId,
                  data: studyData.slice(-count).sort((a, b) => a.timestamp - b.timestamp),
                });
              }

              // Error
              if (event.name === "study_error") {
                const errorMsg = this.extractStudyErrorMessage(event.params);
                if (this.isStudyNotAllowedMessage(errorMsg)) {
                  completed = true;
                  unsubscribe();
                  reject(new Error(errorMsg));
                  return;
                }
                completed = true;
                unsubscribe();
                reject(new Error(`Study error: ${errorMsg}`));
              }
            } catch (err) {
              this.handleErrorPooled(completed, unsubscribe, reject, err);
            }
          });

          try {
            connection.send("chart_create_session", [chartSession, "disable_statistics"]);
            connection.send("switch_timezone", [chartSession, "Etc/UTC"]);
            connection.send("resolve_symbol", [
              chartSession,
              "sds_sym_1",
              "=" + JSON.stringify({ symbol: opts.symbol, adjustment: "splits" }),
            ]);
            connection.send("create_series", [
              chartSession,
              "sds_1",
              "s1",
              "sds_sym_1",
              timeframe,
              count,
            ]);
            connection.send("set_future_tickmarks_mode", [chartSession, "full_single_session"]);

            // Create the study
            // If we have an ILScript (for STD;/PUB; indicators), use the scripting interpreter
            const studyIdToUse = studyInputs.text ? "Script@tv-scripting-101!" : opts.studyId;
            const studyInstanceId = this.generateStudyId();
            const paneId = "st1";

            connection.send("create_study", [
              chartSession,
              studyInstanceId,
              paneId,
              "sds_1",
              studyIdToUse,
              studyInputs,
            ]);
          } catch (err) {
            this.handleErrorPooled(completed, unsubscribe, reject, err);
          }

          setTimeout(() => {
            if (!completed) {
              completed = true;
              unsubscribe();
              // Return partial data if we have some
              if (studyData.length > 0) {
                resolve({
                  symbol: opts.symbol,
                  studyId: opts.studyId,
                  data: studyData.slice(-count).sort((a, b) => a.timestamp - b.timestamp),
                });
              } else {
                reject(new Error("Timed out running study"));
              }
            }
          }, getTimeout("study"));
        });
      } finally {
        this.releaseConnection(endpoint);
      }
    };

    return this.withStudyEndpointFallback(runOnce);
  }

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
  async runChainedBacktest(opts: {
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
  }): Promise<BacktestResult & { chainInfo: { indicatorId: string; mappings: Record<string, string> } }> {
    const timeframe = validateTimeframe(opts.timeframe ?? "1D");

    // Fetch indicator metadata to get ILScript
    let indicatorInputs: Record<string, unknown> = { ...(opts.indicatorInputs || {}) };

    if (opts.indicatorId.startsWith("STD;") || opts.indicatorId.startsWith("PUB;") || opts.indicatorId.startsWith("USER;")) {
      try {
        const meta = await this.fetchIndicatorMeta(opts.indicatorId);

        if (meta.ilScript) {
          indicatorInputs = meta.inputMeta.length
            ? buildStudyInputs({
              inputMeta: meta.inputMeta,
              overrides: indicatorInputs,
              ilScript: meta.ilScript,
              pineId: meta.pineId || opts.indicatorId,
              pineVersion: meta.pineVersion,
              pineFeatures: meta.pineFeatures,
            })
            : {
              text: meta.ilScript,
              pineId: meta.pineId || opts.indicatorId,
              ...meta.defaults,
              ...indicatorInputs,
              ...(meta.pineVersion && { pineVersion: meta.pineVersion }),
              ...(meta.pineFeatures && { pineFeatures: meta.pineFeatures }),
            };
        }
      } catch (err) {
        if (this.debug) {
          logger.debug("TV failed to fetch indicator metadata for chained backtest", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Build the input mappings in StudyID$PlotIndex format
    const resolvedMappings: Record<string, string> = {};
    const receiverInputs: Record<string, unknown> = {
      text: opts.receiverScript,
      pineVersion: "6",
    };

    for (const [inputId, plotIndex] of Object.entries(opts.inputMappings)) {
      // Format: "st1$0" - study instance ID + plot index
      resolvedMappings[inputId] = `st1$${plotIndex}`;
      receiverInputs[inputId] = `st1$${plotIndex}`;
    }

    const runOnce = async (endpoint: TradingViewEndpoint): Promise<BacktestResult & { chainInfo: { indicatorId: string; mappings: Record<string, string> } }> => {
      const chartSession = generateSessionId("cs");
      const connection = await this.acquireConnection(endpoint);

      try {
        return await new Promise((resolve, reject) => {
          let completed = false;
          let strategyReport: Record<string, unknown> | null = null;
          let indicatorReady = false;

          const unsubscribe = connection.subscribe((event: TVEvent) => {
            try {
              // Track when indicator study is ready
              if (event.name === "study_completed") {
                const studyId = event.params[1];
                if (studyId === "st1") {
                  indicatorReady = true;
                }
              }

              // Strategy report with metrics
              if (event.name === "strategy_report" || event.name === "du") {
                const data = event.params[1] as Record<string, unknown>;

                if (data && (data.net_profit !== undefined || data.strategy)) {
                  strategyReport = data.strategy as Record<string, unknown> || data;
                }
              }

              // Strategy completed
              if ((event.name === "study_completed" || event.name === "series_completed") && strategyReport) {
                completed = true;
                unsubscribe();
                resolve({
                  ...this.parseStrategyReport(strategyReport),
                  chainInfo: {
                    indicatorId: opts.indicatorId,
                    mappings: resolvedMappings,
                  },
                });
              }

              // Error handling
              if (event.name === "study_error") {
                const errorMsg = this.extractStudyErrorMessage(event.params);
                if (this.isStudyNotAllowedMessage(errorMsg)) {
                  completed = true;
                  unsubscribe();
                  reject(new Error(errorMsg));
                  return;
                }
                completed = true;
                unsubscribe();
                reject(new Error(`Chained backtest error: ${errorMsg}`));
              }
            } catch (err) {
              this.handleErrorPooled(completed, unsubscribe, reject, err);
            }
          });

          try {
            // 1. Create chart session
            connection.send("chart_create_session", [chartSession, ""]);

            // 2. Resolve symbol
            connection.send("resolve_symbol", [
              chartSession,
              "sds_sym_1",
              "=" + JSON.stringify({ symbol: opts.symbol, adjustment: "splits" }),
            ]);

            // 3. Create series with main chart data (sds_1)
            connection.send("create_series", [
              chartSession,
              "sds_1",
              "s1",
              "sds_sym_1",
              timeframe,
              MAX_BATCH_SIZE,
            ]);

            // 4. Create indicator study (st1) on main chart data (sds_1)
            //    NOT on st1 - that would replace OHLC data
            const indicatorStudyId = indicatorInputs.text ? "Script@tv-scripting-101!" : opts.indicatorId;
            connection.send("create_study", [
              chartSession,
              "st1",     // Instance ID
              "st1",     // Pane ID
              "sds_1",   // Data source - KEEP AS sds_1, not the indicator!
              indicatorStudyId,
              indicatorInputs,
            ]);

            // 5. Create receiver strategy (st2) on main chart data (sds_1)
            //    with inputs referencing st1's plots
            connection.send("create_study", [
              chartSession,
              "st2",     // Instance ID
              "st2",     // Pane ID
              "sds_1",   // Data source - KEEP AS sds_1!
              "Script@tv-scripting-101!",
              receiverInputs,
            ]);
          } catch (err) {
            this.handleErrorPooled(completed, unsubscribe, reject, err);
          }

          setTimeout(() => {
            if (!completed) {
              completed = true;
              unsubscribe();

              if (strategyReport) {
                resolve({
                  ...this.parseStrategyReport(strategyReport),
                  chainInfo: {
                    indicatorId: opts.indicatorId,
                    mappings: resolvedMappings,
                  },
                });
              } else {
                reject(new Error("Timed out running chained backtest"));
              }
            }
          }, getTimeout("backtest"));
        });
      } finally {
        this.releaseConnection(endpoint);
      }
    };

    return this.withStudyEndpointFallback(runOnce);
  }

  /**
   * Fetch deep historical candle data with pagination
   * Can fetch up to 40k+ bars by automatically requesting more data
   */
  async getDeepCandles(opts: {
    symbol: string;
    timeframe?: string;
    total?: number; // Desired total bars (default: 40000)
    delayMs?: number; // Delay between pagination requests
  }): Promise<Candle[]> {
    const total = opts.total ?? 40000;
    let remaining = total;
    let cursor: number | undefined = undefined;
    const all: Candle[] = [];

    while (remaining > 0) {
      const amount = Math.min(remaining, MAX_BATCH_SIZE);
      const candles = await this.getCandles({
        symbol: opts.symbol,
        timeframe: opts.timeframe,
        amount,
        to: cursor,
      });

      if (!candles.length) break;

      // Candles are returned newest first
      const newest = candles[0]?.timestamp;
      const oldest = candles[candles.length - 1]?.timestamp;
      all.unshift(...candles);
      remaining -= candles.length;

      if (!oldest || candles.length < amount) break;
      cursor = oldest;

      if (opts.delayMs) {
        await new Promise(r => setTimeout(r, opts.delayMs));
      }
    }

    // Deduplicate by timestamp
    const dedup = new Map<number, Candle>();
    all.forEach(c => {
      if (!dedup.has(c.timestamp)) dedup.set(c.timestamp, c);
    });

    return Array.from(dedup.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  // --- Helper methods ---

  private getEndpointFallbacks(): TradingViewEndpoint[] {
    const endpoints = Object.keys(ENDPOINTS) as TradingViewEndpoint[];
    const preferred = this.endpoint;
    return [preferred, ...endpoints.filter(endpoint => endpoint !== preferred)];
  }

  private isStudyNotAllowedMessage(message: string): boolean {
    return message.includes("Study not allowed in this connection");
  }

  private extractStudyErrorMessage(params: unknown[]): string {
    if (!Array.isArray(params)) return "Unknown error";

    if (typeof params[3] === "string") return params[3];
    if (typeof params[1] === "string") return params[1];

    const candidate = params.find((value) => value && typeof value === "object") as
      | { reason?: string; error?: string }
      | undefined;

    if (candidate?.reason) return candidate.reason;
    if (candidate?.error) return candidate.error;

    const strings = params.filter((value) => typeof value === "string") as string[];
    const descriptive = strings.find((value) => value.includes(" "))
      || strings.find((value) => value.length > 12);
    return descriptive || "Unknown error";
  }

  private async withStudyEndpointFallback<T>(
    run: (endpoint: TradingViewEndpoint) => Promise<T>
  ): Promise<T> {
    const endpoints = this.getEndpointFallbacks();
    let lastError: unknown;

    for (const endpoint of endpoints) {
      try {
        return await run(endpoint);
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!this.isStudyNotAllowedMessage(message)) {
          throw err;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private generateStudyId(): string {
    return Math.random().toString(36).slice(2, 8);
  }

  /**
   * Process raw candle data from TradingView.
   * @returns Candles sorted from newest to oldest (descending timestamp)
   */
  private processCandles(raw: unknown[], limit?: number): Candle[] {
    const slice = limit ? raw.slice(0, limit) : raw;
    return slice.map((c: unknown) => {
      const candle = c as { v: number[] };
      return {
        timestamp: candle.v[0],
        open: candle.v[1],
        high: candle.v[2],
        low: candle.v[3],
        close: candle.v[4],
        volume: candle.v[5] ?? 0,
      };
    });
  }

  private parseStrategyReport(data: Record<string, unknown>): BacktestResult {
    return {
      netProfit: (data.net_profit as number) ?? 0,
      netProfitPercent: (data.net_profit_percent as number) ?? 0,
      grossProfit: (data.gross_profit as number) ?? 0,
      grossLoss: (data.gross_loss as number) ?? 0,
      maxDrawdown: (data.max_drawdown as number) ?? 0,
      maxDrawdownPercent: (data.max_drawdown_percent as number) ?? 0,
      sharpeRatio: (data.sharpe_ratio as number) ?? 0,
      sortinoRatio: (data.sortino_ratio as number) ?? 0,
      profitFactor: (data.profit_factor as number) ?? 0,
      totalTrades: (data.total_trades as number) ?? 0,
      winningTrades: (data.winning_trades as number) ?? 0,
      losingTrades: (data.losing_trades as number) ?? 0,
      winRate: (data.win_rate as number) ?? 0,
      avgTrade: (data.avg_trade as number) ?? 0,
      avgWinningTrade: (data.avg_winning_trade as number) ?? 0,
      avgLosingTrade: (data.avg_losing_trade as number) ?? 0,
      trades: [], // Individual trade data not currently exposed by TradingView API
    };
  }

  private handleError(
    completed: boolean,
    unsubscribe: () => void,
    connection: TVConnection,
    reject: (err: Error) => void,
    err: unknown
  ) {
    if (!completed) {
      unsubscribe();
      connection.close().catch(() => {});
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Error handler for pooled connections (does not close connection)
   * The pool manages connection lifecycle
   */
  private handleErrorPooled(
    completed: boolean,
    unsubscribe: () => void,
    reject: (err: Error) => void,
    err: unknown
  ) {
    if (!completed) {
      unsubscribe();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
