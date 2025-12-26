// TradingView WebSocket connection manager
import WebSocket from "ws";
import { ENDPOINTS } from "./types.js";
import { frameMessage, parseMessages, extractEvent } from "./messages.js";
import { logger } from "../utils/logger.js";
/**
 * Get auth token from TradingView session
 */
export async function getAuthToken(credentials) {
    if (!credentials?.sessionId)
        return "unauthorized_user_token";
    try {
        const cookie = credentials.sessionSign
            ? `sessionid=${credentials.sessionId}; sessionid_sign=${credentials.sessionSign}`
            : `sessionid=${credentials.sessionId}`;
        const resp = await fetch("https://www.tradingview.com/disclaimer/", {
            method: "GET",
            headers: { Cookie: cookie },
        });
        const text = await resp.text();
        const match = text.match(/"auth_token":"(.+?)"/);
        return match ? match[1] : "unauthorized_user_token";
    }
    catch {
        return "unauthorized_user_token";
    }
}
/**
 * Connect to TradingView WebSocket with fallback endpoints
 */
export async function connect(opts = {}) {
    const preferred = opts.endpoint && ENDPOINTS[opts.endpoint] ? opts.endpoint : "prodata";
    const fallback = Object.keys(ENDPOINTS).filter(k => k !== preferred);
    const attempts = [preferred, ...fallback];
    const token = await getAuthToken(opts.credentials);
    let lastError;
    for (const ep of attempts) {
        const wsUrl = ENDPOINTS[ep];
        try {
            const connection = await connectToEndpoint(wsUrl, token, opts);
            if (opts.debug) {
                logger.debug("TV connected", { endpoint: ep });
            }
            return connection;
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (opts.debug) {
                logger.debug("TV failed to connect", { endpoint: ep, error: lastError.message });
            }
            // Small backoff before trying next endpoint
            await new Promise(r => setTimeout(r, 50));
        }
    }
    throw lastError || new Error("Failed to connect to any TradingView endpoint");
}
async function connectToEndpoint(wsUrl, authToken, opts) {
    return new Promise((resolve, reject) => {
        const subscribers = new Set();
        let ready = false;
        let ws;
        const headers = {
            "Origin": "https://www.tradingview.com",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        };
        if (opts.credentials?.sessionId) {
            const cookie = opts.credentials.sessionSign
                ? `sessionid=${opts.credentials.sessionId}; sessionid_sign=${opts.credentials.sessionSign}`
                : `sessionid=${opts.credentials.sessionId}`;
            headers["Cookie"] = cookie;
        }
        try {
            ws = new WebSocket(wsUrl, { headers });
        }
        catch (err) {
            reject(err);
            return;
        }
        const timeout = setTimeout(() => {
            if (!ready) {
                ws.close();
                reject(new Error("Connection timeout"));
            }
        }, opts.timeoutMs ?? 10000);
        const send = (name, params) => {
            const framed = frameMessage(name, params);
            if (opts.debug) {
                logger.debug("TV >>", { name, params: JSON.stringify(params).slice(0, 200) });
            }
            ws.send(framed);
        };
        const subscribe = (handler) => {
            subscribers.add(handler);
            return () => subscribers.delete(handler);
        };
        const close = async () => {
            subscribers.clear();
            return new Promise((res) => {
                ws.once("close", () => res());
                ws.close();
                // Force resolve after timeout
                setTimeout(res, 1000);
            });
        };
        const isConnected = () => ws.readyState === WebSocket.OPEN;
        ws.on("error", (err) => {
            if (!ready) {
                clearTimeout(timeout);
                reject(err);
            }
        });
        ws.on("close", () => {
            if (!ready) {
                clearTimeout(timeout);
                reject(new Error("Connection closed"));
            }
        });
        ws.on("message", (data) => {
            const text = data.toString();
            // Engine.IO ping -> pong
            if (text === "2") {
                ws.send("3");
                return;
            }
            const payloads = parseMessages(text);
            for (const payload of payloads) {
                switch (payload.type) {
                    case "ping":
                        // Echo ping back
                        ws.send(payload.data);
                        break;
                    case "session":
                        // Session established - authenticate and resolve
                        ready = true;
                        clearTimeout(timeout);
                        send("set_auth_token", [authToken]);
                        resolve({ send, subscribe, close, isConnected });
                        break;
                    case "event": {
                        const event = extractEvent(payload.data);
                        if (event) {
                            if (opts.debug) {
                                logger.debug("TV <<", { name: event.name, params: JSON.stringify(event.params).slice(0, 200) });
                            }
                            subscribers.forEach(handler => handler(event));
                        }
                        break;
                    }
                }
            }
        });
    });
}
//# sourceMappingURL=connection.js.map