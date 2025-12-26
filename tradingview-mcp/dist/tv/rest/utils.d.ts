import type { TVCredentials } from '../types.js';
import { FUNDAMENTAL_FIELDS } from '../types.js';
export declare const SCANNER_BASE = "https://scanner.tradingview.com";
export declare const SCAN_URL = "https://scanner.tradingview.com/global/scan";
export declare const SCAN_INDICATORS: string[];
export declare const OPTIONS_CHARTING_BASE = "https://options-charting.tradingview.com/v1";
export { FUNDAMENTAL_FIELDS };
export declare const OPTIONS_GREEKS_FIELDS: string[];
export declare const AUTH_HEADERS_BASE: {
    Origin: string;
    Referer: string;
    "User-Agent": string;
};
export declare function buildAuthHeaders(credentials: TVCredentials): Record<string, string>;
export declare function rateLimitedFetch(url: string | URL, init?: RequestInit, options?: {
    useCompileLimiter?: boolean;
}): Promise<Response>;
//# sourceMappingURL=utils.d.ts.map