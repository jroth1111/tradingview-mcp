/**
 * Stderr-safe logger for MCP servers using stdio transport.
 *
 * CRITICAL: In stdio transport, stdout is used for JSON-RPC messages.
 * Any console.log() will corrupt the protocol. All logging MUST go to stderr.
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
function shouldLog(level) {
    const currentLevel = process.env.TV_DEBUG ? "debug" : "info";
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
function formatLog(entry) {
    const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
    if (entry.data !== undefined) {
        try {
            const data = entry.data instanceof Error
                ? { name: entry.data.name, message: entry.data.message }
                : entry.data;
            const dataStr = JSON.stringify(data);
            return `${prefix} ${entry.message} ${dataStr}\n`;
        }
        catch {
            return `${prefix} ${entry.message} [unserializable data]\n`;
        }
    }
    return `${prefix} ${entry.message}\n`;
}
function log(level, message, data) {
    if (!shouldLog(level))
        return;
    const entry = {
        level,
        message,
        timestamp: new Date().toISOString(),
        data,
    };
    // CRITICAL: Write to stderr, not stdout
    process.stderr.write(formatLog(entry));
}
export const logger = {
    /**
     * Debug-level logging. Only shown when TV_DEBUG is set.
     */
    debug: (message, data) => log("debug", message, data),
    /**
     * Info-level logging. General operational messages.
     */
    info: (message, data) => log("info", message, data),
    /**
     * Warning-level logging. Non-critical issues.
     */
    warn: (message, data) => log("warn", message, data),
    /**
     * Error-level logging. Critical issues.
     */
    error: (message, data) => log("error", message, data),
};
function cliWrite(write, message, data) {
    if (data !== undefined) {
        write(message, data);
    }
    else {
        write(message);
    }
}
/**
 * CLI-safe console output for commands that aren't running as MCP server.
 * Use this in the CLI commands (login, status, etc.) where stdout is safe.
 */
export const cli = {
    debug: (message, data) => cliWrite(console.log, message, data),
    info: (message, data) => cliWrite(console.log, message, data),
    warn: (message, data) => cliWrite(console.warn, message, data),
    error: (message, data) => cliWrite(console.error, message, data),
    log: (...args) => console.log(...args),
};
//# sourceMappingURL=logger.js.map