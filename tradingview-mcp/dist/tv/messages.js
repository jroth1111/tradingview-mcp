// TradingView message framing and parsing
// Protocol: netstring format ~m~{length}~m~{json}
const textEncoder = new TextEncoder();
/**
 * Frame a TradingView message for sending
 */
export function frameMessage(name, params) {
    const json = JSON.stringify({ m: name, p: params });
    const len = textEncoder.encode(json).length;
    return `~m~${len}~m~${json}`;
}
/**
 * Normalize Engine.IO / Socket.IO prefixes
 */
function normalizePayload(payload) {
    if (!payload)
        return payload;
    // Socket.IO binary event prefix
    if (payload.startsWith("42") && payload.includes("~m~"))
        return payload.slice(2);
    // Socket.IO event prefix
    if (payload.startsWith("4") && payload.includes("~m~"))
        return payload.slice(1);
    return payload;
}
/**
 * Parse incoming TradingView messages
 */
export function parseMessages(raw) {
    if (!raw)
        return [];
    const normalized = normalizePayload(raw.toString());
    const results = [];
    // Split on netstring delimiter pattern
    const parts = normalized.split(/~m~\d+~m~/).slice(1);
    for (const part of parts) {
        if (part.startsWith("~h~")) {
            // Ping message - need to echo back
            results.push({ type: "ping", data: `~m~${part.length}~m~${part}` });
        }
        else {
            try {
                const parsed = JSON.parse(part);
                if (parsed["session_id"]) {
                    results.push({ type: "session", data: parsed });
                }
                else {
                    results.push({ type: "event", data: parsed });
                }
            }
            catch {
                // Skip unparseable messages
            }
        }
    }
    return results;
}
/**
 * Generate a unique session ID
 */
export function generateSessionId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
/**
 * Extract event name and params from parsed message
 */
export function extractEvent(parsed) {
    if (!parsed || typeof parsed !== "object")
        return null;
    const msg = parsed;
    if (typeof msg.m === "string" && Array.isArray(msg.p)) {
        return { name: msg.m, params: msg.p };
    }
    return null;
}
//# sourceMappingURL=messages.js.map