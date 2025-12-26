// Browser-based login for TradingView
// Opens a browser window, lets user login, captures session cookies
import { logger } from "./logger.js";
/**
 * Opens a browser for TradingView login and captures session cookies
 * Uses Playwright to automate browser interaction
 */
export async function browserLogin(log = logger) {
    // Dynamic import to make playwright optional
    let chromium;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const playwright = await import("playwright");
        chromium = playwright.chromium;
    }
    catch {
        return {
            success: false,
            error: "Playwright not installed. Run: npm install playwright && npx playwright install chromium",
        };
    }
    log.info("\n🌐 Opening browser for TradingView login...\n");
    log.info("   Please login to your TradingView account in the browser window.");
    log.info("   This window will close automatically after successful login.\n");
    let browser;
    try {
        // Launch browser in non-headless mode so user can interact
        browser = await chromium.launch({
            headless: false,
            args: ["--disable-blink-features=AutomationControlled"],
        });
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });
        const page = await context.newPage();
        // Navigate to TradingView login
        await page.goto("https://www.tradingview.com/#signin", {
            waitUntil: "domcontentloaded",
        });
        // Wait for successful login by detecting session cookie or auth state
        // Poll for sessionid cookie - indicates successful login
        log.info("   Waiting for login...");
        let sessionId;
        let sessionSign;
        let username;
        let plan;
        // Wait up to 5 minutes for login
        const maxWaitMs = 5 * 60 * 1000;
        const startTime = Date.now();
        const pollIntervalMs = 1000;
        while (Date.now() - startTime < maxWaitMs) {
            // Check cookies
            const cookies = await context.cookies("https://www.tradingview.com");
            const sessionCookie = cookies.find((c) => c.name === "sessionid");
            const signCookie = cookies.find((c) => c.name === "sessionid_sign");
            if (sessionCookie?.value) {
                sessionId = sessionCookie.value;
                sessionSign = signCookie?.value;
                // Try to get username from page
                try {
                    // Navigate to main page to get user info
                    await page.goto("https://www.tradingview.com/", { waitUntil: "domcontentloaded" });
                    await page.waitForTimeout(1000);
                    const content = await page.content();
                    const usernameMatch = content.match(/"username":"([^"]+)"/);
                    const planMatch = content.match(/"pro_plan":"([^"]+)"/);
                    username = usernameMatch?.[1];
                    plan = planMatch?.[1] || "free";
                }
                catch {
                    // Ignore - we have the session which is what matters
                }
                break;
            }
            await page.waitForTimeout(pollIntervalMs);
        }
        await browser.close();
        if (!sessionId) {
            return {
                success: false,
                error: "Login timeout - no session cookie detected after 5 minutes",
            };
        }
        log.info("\n✓ Login successful!");
        if (username)
            log.info(`   User: ${username}`);
        if (plan)
            log.info(`   Plan: ${plan}`);
        return {
            success: true,
            credentials: {
                sessionId,
                sessionSign,
            },
            username,
            plan,
        };
    }
    catch (err) {
        if (browser) {
            try {
                await browser.close();
            }
            catch {
                // Ignore close errors
            }
        }
        const message = err instanceof Error ? err.message : String(err);
        // Check for common issues
        if (message.includes("Executable doesn't exist")) {
            return {
                success: false,
                error: "Browser not installed. Run: npx playwright install chromium",
            };
        }
        return {
            success: false,
            error: `Browser login failed: ${message}`,
        };
    }
}
/**
 * Check if browser login is available (playwright installed)
 */
export async function isBrowserLoginAvailable() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        await import("playwright");
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=browser-login.js.map