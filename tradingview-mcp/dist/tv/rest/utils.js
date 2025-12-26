import { restRateLimiter, compileRateLimiter } from '../../utils/rate-limiter.js';
import { FUNDAMENTAL_FIELDS } from '../types.js';
export const SCANNER_BASE = "https://scanner.tradingview.com";
export const SCAN_URL = `${SCANNER_BASE}/global/scan`;
export const SCAN_INDICATORS = ["Recommend.Other", "Recommend.All", "Recommend.MA"];
export const OPTIONS_CHARTING_BASE = "https://options-charting.tradingview.com/v1";
export { FUNDAMENTAL_FIELDS };
export const OPTIONS_GREEKS_FIELDS = [
    "iv",
    "delta",
    "gamma",
    "rho",
    "theta",
    "vega",
    "theoPrice",
    "underlying_symbol",
    "open_interest",
];
export const AUTH_HEADERS_BASE = {
    Origin: "https://www.tradingview.com",
    Referer: "https://www.tradingview.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};
export function buildAuthHeaders(credentials) {
    return {
        ...AUTH_HEADERS_BASE,
        Cookie: credentials.sessionSign
            ? `sessionid=${credentials.sessionId}; sessionid_sign=${credentials.sessionSign}`
            : `sessionid=${credentials.sessionId}`,
    };
}
export async function rateLimitedFetch(url, init, options) {
    const limiter = options?.useCompileLimiter ? compileRateLimiter : restRateLimiter;
    await limiter.acquire();
    const response = await fetch(url, init);
    if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : undefined;
        limiter.record429(retryAfterMs);
        await limiter.acquire();
        return await fetch(url, init);
    }
    return response;
}
//# sourceMappingURL=utils.js.map