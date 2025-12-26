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
export declare const logger: Logger;
/**
 * CLI-safe console output for commands that aren't running as MCP server.
 * Use this in the CLI commands (login, status, etc.) where stdout is safe.
 */
export declare const cli: Logger & {
    log: (...args: unknown[]) => void;
};
//# sourceMappingURL=logger.d.ts.map