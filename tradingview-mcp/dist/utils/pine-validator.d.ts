export interface PineSyntaxError {
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning";
}
export interface PineSyntaxResult {
    valid: boolean;
    errors: PineSyntaxError[];
    warnings: PineSyntaxError[];
    version: number | null;
    type: "indicator" | "strategy" | "library" | null;
}
/**
 * Basic PineScript syntax validation
 * Checks for common issues without full compilation
 */
export declare function validatePineSyntax(code: string): PineSyntaxResult;
/**
 * Format PineScript code for better readability
 * (Basic formatting - indentation, spacing)
 */
export declare function formatPineScript(code: string): string;
//# sourceMappingURL=pine-validator.d.ts.map