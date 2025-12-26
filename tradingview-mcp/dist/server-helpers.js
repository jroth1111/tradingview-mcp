// Server helper functions extracted from server.ts
// These functions support server operation and resource handling
import { ErrorCode, McpError as SdkMcpError } from "@modelcontextprotocol/sdk/types.js";
/**
 * Validates a TradingView session by checking authentication status
 * @param credentials - Optional TVCredentials to validate
 * @returns Object with valid flag, username, and plan
 */
export async function validateSession(credentials) {
    if (!credentials?.sessionId)
        return { valid: false };
    // Multiple regex patterns for robustness
    const USERNAME_PATTERNS = [
        /"username":"([^"]+)"/,
        /"currentUser":\{[^}]*"username":"([^"]+)"/,
        /"name":"([^"]+)"/,
        /"user":\{[^}]*"username":"([^"]+)"/,
    ];
    const PLAN_PATTERNS = [
        /"pro_plan":"([^"]+)"/,
        /"pro_plan":(\d+)/,
        /"is_pro":true/,
    ];
    const AUTH_PATTERNS = [
        /"auth_token"/,
        /authToken=/,
        /"authenticated":true/,
    ];
    try {
        const cookies = credentials.sessionSign
            ? `sessionid=${credentials.sessionId}; sessionid_sign=${credentials.sessionSign}`
            : `sessionid=${credentials.sessionId}`;
        const resp = await fetch("https://www.tradingview.com/", {
            headers: { Cookie: cookies },
            redirect: "manual",
        });
        const text = await resp.text();
        // Check for authentication using multiple patterns
        const isAuthenticated = AUTH_PATTERNS.some(p => p.test(text));
        if (!isAuthenticated) {
            return { valid: false };
        }
        // Extract username using fallback patterns
        let username;
        for (const pattern of USERNAME_PATTERNS) {
            const match = text.match(pattern);
            if (match?.[1]) {
                username = match[1];
                break;
            }
        }
        // Extract plan using fallback patterns
        let plan = "free";
        for (const pattern of PLAN_PATTERNS) {
            const match = text.match(pattern);
            if (match) {
                if (pattern.source.includes("pro_plan")) {
                    plan = match[1] || "free";
                }
                else {
                    plan = "pro";
                }
                break;
            }
        }
        return { valid: true, username, plan };
    }
    catch {
        return { valid: false };
    }
}
/**
 * Creates a JSON resource response for MCP
 * @param uri - The resource URI
 * @param data - The data to serialize to JSON
 * @returns Formatted resource response
 */
export function resourceJson(uri, data) {
    return {
        contents: [
            {
                uri: uri.toString(),
                mimeType: "application/json",
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}
/**
 * Extracts and decodes a template variable from resource parameters
 * @param variables - Record of template variables
 * @param key - The variable key to extract
 * @returns Decoded string value or empty string
 */
export function getTemplateVariable(variables, key) {
    const raw = variables[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== "string") {
        return "";
    }
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
/**
 * Parses a value using a Zod schema with error handling
 * @param schema - The Zod schema to validate against
 * @param value - The value to parse
 * @param label - Label for error messages
 * @returns Parsed and validated data
 * @throws McpError if validation fails
 */
export function parseWithSchema(schema, value, label) {
    const result = schema.safeParse(value);
    if (!result.success) {
        const message = result.error.issues.map((issue) => issue.message).join("; ");
        throw new SdkMcpError(ErrorCode.InvalidParams, `${label}: ${message}`);
    }
    return result.data;
}
//# sourceMappingURL=server-helpers.js.map