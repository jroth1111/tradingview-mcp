import type { TVCredentials, TradingViewEndpoint } from "./tv/types.js";
export interface MCPConfig {
    credentials?: TVCredentials;
    endpoint?: TradingViewEndpoint;
    timeoutMs?: number;
    debug?: boolean;
}
/**
 * Load configuration from file or environment
 */
export declare function loadConfig(): MCPConfig;
/**
 * Save credentials to config file
 */
export declare function saveCredentials(credentials: TVCredentials): void;
/**
 * Get config file path for user reference
 */
export declare function getConfigPath(): string;
//# sourceMappingURL=config.d.ts.map