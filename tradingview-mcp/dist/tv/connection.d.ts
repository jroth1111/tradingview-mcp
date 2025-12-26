import { type TradingViewEndpoint, type TVCredentials } from "./types.js";
export interface TVEvent {
    name: string;
    params: unknown[];
}
type EventHandler = (event: TVEvent) => void;
export interface TVConnection {
    send: (name: string, params: unknown[]) => void;
    subscribe: (handler: EventHandler) => () => void;
    close: () => Promise<void>;
    isConnected: () => boolean;
}
/**
 * Get auth token from TradingView session
 */
export declare function getAuthToken(credentials?: TVCredentials): Promise<string>;
export interface ConnectOptions {
    credentials?: TVCredentials;
    endpoint?: TradingViewEndpoint;
    timeoutMs?: number;
    debug?: boolean;
}
/**
 * Connect to TradingView WebSocket with fallback endpoints
 */
export declare function connect(opts?: ConnectOptions): Promise<TVConnection>;
export {};
//# sourceMappingURL=connection.d.ts.map