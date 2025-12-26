import type { TVCredentials } from "../tv/types.js";
import { type Logger } from "./logger.js";
interface BrowserLoginResult {
    success: boolean;
    credentials?: TVCredentials;
    username?: string;
    plan?: string;
    error?: string;
}
/**
 * Opens a browser for TradingView login and captures session cookies
 * Uses Playwright to automate browser interaction
 */
export declare function browserLogin(log?: Logger): Promise<BrowserLoginResult>;
/**
 * Check if browser login is available (playwright installed)
 */
export declare function isBrowserLoginAvailable(): Promise<boolean>;
export {};
//# sourceMappingURL=browser-login.d.ts.map