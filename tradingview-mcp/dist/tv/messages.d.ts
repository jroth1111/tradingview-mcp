export interface TVMessage {
    m: string;
    p: unknown[];
}
export interface ParsedPayload {
    type: "ping" | "session" | "event";
    data: unknown;
}
/**
 * Frame a TradingView message for sending
 */
export declare function frameMessage(name: string, params: unknown[]): string;
/**
 * Parse incoming TradingView messages
 */
export declare function parseMessages(raw: string): ParsedPayload[];
/**
 * Generate a unique session ID
 */
export declare function generateSessionId(prefix: string): string;
/**
 * Extract event name and params from parsed message
 */
export declare function extractEvent(parsed: unknown): {
    name: string;
    params: unknown[];
} | null;
//# sourceMappingURL=messages.d.ts.map