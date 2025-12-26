/**
 * Stderr-safe logger for MCP servers using stdio transport.
 *
 * CRITICAL: In stdio transport, stdout is used for JSON-RPC messages.
 * Any console.log() will corrupt the protocol. All logging MUST go to stderr.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const currentLevel = process.env.TV_DEBUG ? "debug" : "info";
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(entry: LogEntry): string {
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
  if (entry.data !== undefined) {
    try {
      const data =
        entry.data instanceof Error
          ? { name: entry.data.name, message: entry.data.message }
          : entry.data;
      const dataStr = JSON.stringify(data);
      return `${prefix} ${entry.message} ${dataStr}\n`;
    } catch {
      return `${prefix} ${entry.message} [unserializable data]\n`;
    }
  }
  return `${prefix} ${entry.message}\n`;
}

function log(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    data,
  };

  // CRITICAL: Write to stderr, not stdout
  process.stderr.write(formatLog(entry));
}

export const logger: Logger = {
  /**
   * Debug-level logging. Only shown when TV_DEBUG is set.
   */
  debug: (message: string, data?: unknown) => log("debug", message, data),

  /**
   * Info-level logging. General operational messages.
   */
  info: (message: string, data?: unknown) => log("info", message, data),

  /**
   * Warning-level logging. Non-critical issues.
   */
  warn: (message: string, data?: unknown) => log("warn", message, data),

  /**
   * Error-level logging. Critical issues.
   */
  error: (message: string, data?: unknown) => log("error", message, data),
};

function cliWrite(
  write: (message?: unknown, ...optionalParams: unknown[]) => void,
  message: string,
  data?: unknown
): void {
  if (data !== undefined) {
    write(message, data);
  } else {
    write(message);
  }
}

/**
 * CLI-safe console output for commands that aren't running as MCP server.
 * Use this in the CLI commands (login, status, etc.) where stdout is safe.
 */
export const cli: Logger & { log: (...args: unknown[]) => void } = {
  debug: (message: string, data?: unknown) => cliWrite(console.log, message, data),
  info: (message: string, data?: unknown) => cliWrite(console.log, message, data),
  warn: (message: string, data?: unknown) => cliWrite(console.warn, message, data),
  error: (message: string, data?: unknown) => cliWrite(console.error, message, data),
  log: (...args: unknown[]) => console.log(...args),
};
