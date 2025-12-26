import type { TVCredentials } from "./tv/types.js";
import { z } from "zod";
/**
 * Validates a TradingView session by checking authentication status
 * @param credentials - Optional TVCredentials to validate
 * @returns Object with valid flag, username, and plan
 */
export declare function validateSession(credentials?: TVCredentials): Promise<{
    valid: boolean;
    username?: string;
    plan?: string;
}>;
/**
 * Creates a JSON resource response for MCP
 * @param uri - The resource URI
 * @param data - The data to serialize to JSON
 * @returns Formatted resource response
 */
export declare function resourceJson(uri: URL, data: unknown): {
    contents: {
        uri: string;
        mimeType: string;
        text: string;
    }[];
};
/**
 * Extracts and decodes a template variable from resource parameters
 * @param variables - Record of template variables
 * @param key - The variable key to extract
 * @returns Decoded string value or empty string
 */
export declare function getTemplateVariable(variables: Record<string, string | string[]>, key: string): string;
/**
 * Parses a value using a Zod schema with error handling
 * @param schema - The Zod schema to validate against
 * @param value - The value to parse
 * @param label - Label for error messages
 * @returns Parsed and validated data
 * @throws McpError if validation fails
 */
export declare function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T;
//# sourceMappingURL=server-helpers.d.ts.map