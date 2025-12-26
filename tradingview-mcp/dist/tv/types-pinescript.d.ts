/**
 * Response from GET /pine-facade/get/{scriptId}/{version}
 */
export interface PineScriptSource {
    created: string;
    lastVersionMaj: string;
    scriptAccess: "open_no_auth" | "closed_source" | "invite_only" | "other";
    scriptName: string;
    source: string;
    updated: string;
    version: string;
    extra?: {
        kind: "study" | "strategy";
        sourceInputsCount: number;
    };
    scriptIdPart?: string;
}
/**
 * Error location in Pine Script source
 * HAR shows: { start: {line, column}, end: {line, column}, message }
 */
export interface PineScriptError {
    message: string;
    start: {
        line: number;
        column: number;
    };
    end: {
        line: number;
        column: number;
    };
}
/**
 * Response from POST /pine-facade/save/new and POST /pine-facade/save/next/{scriptId}
 * HAR shows: {success, result: {IL, ilTemplate, metaInfo}}
 *
 * On error: {success: false, reason: "...", reason2: {errors: [...], warnings: [...]}}
 * Script is still saved as a "stub" (isTVScriptStub: true) that won't execute
 */
export interface PineScriptSaveResult {
    success: boolean;
    /** Error message (only present when success=false) */
    reason?: string;
    /** Detailed error info (only present when success=false) */
    reason2?: {
        errors: PineScriptError[];
        warnings: PineScriptError[];
    };
    result?: {
        IL: string;
        ilTemplate: string;
        metaInfo: PineMetaInfo;
    };
}
/**
 * Script item from GET /pine-facade/list?filter={saved|published}
 * Updated to match actual HAR response structure
 */
export interface PineScriptListItem {
    scriptIdPart: string;
    version: string;
    scriptName: string;
    scriptTitle: string;
    modified: number;
    scriptSource: string;
    isTVScriptBuiltIn: boolean;
    extra?: {
        kind: "study" | "strategy";
        sourceInputsCount: number;
        stats?: {
            alertcondition?: number;
            plot?: number;
            plotshape?: number;
        };
    };
}
/**
 * Response from GET /pine-facade/list - returns raw array
 * HAR confirms this is a direct array, not wrapped in {success, result}
 */
export type PineScriptListResult = PineScriptListItem[];
/**
 * Response from GET /pine-facade/get_lib_export_data/{libId}/last?v=2
 */
export interface PineLibraryExportInfo {
    user: string;
    userId: number;
    scriptIdPart: string;
    version: string;
    docs: string;
    chartId: string;
    isPublic: boolean;
    lib: string;
    libId: string;
}
export interface PineLibraryFunctionArg {
    name: string;
    desc: string[];
    displayType: string;
    required: boolean;
}
export interface PineLibraryExport {
    name: string;
    desc: string[];
    libId: string;
    args: PineLibraryFunctionArg[];
    returnedTypes: string[];
    returns: string[];
    syntax: string[];
}
export interface PineLibraryExports {
    libInfo: PineLibraryExportInfo;
    exports: {
        functions: PineLibraryExport[];
        types: unknown[];
    };
}
/**
 * MetaInfo structure returned by compilation and used in save operations
 * This is the detailed metadata structure from HAR
 */
export interface PineMetaInfo {
    _metainfoVersion?: number;
    behind_chart?: boolean;
    defaults?: {
        inputs?: Record<string, unknown>;
        styles?: Record<string, unknown>;
    };
    description?: string;
    docs?: string;
    format?: {
        type: "inherit" | string;
    };
    id?: string;
    inputs?: PineMetaInfoInput[];
    is_hidden_study?: boolean;
    is_price_study?: boolean;
    isTVScript?: boolean;
    isTVScriptStrategy?: boolean;
    isTVScriptStub?: boolean;
    pine?: {
        digest: string;
        version: string;
    };
    plots?: PineMetaInfoPlot[];
    scriptIdPart?: string;
    shortDescription?: string;
    stats?: {
        plot?: number;
        alertcondition?: number;
    };
    styles?: Record<string, PineMetaInfoStyle>;
    usesPrivateLib?: boolean;
    warnings?: string[];
}
export interface PineMetaInfoInput {
    active?: boolean;
    defval?: unknown;
    display?: number;
    group?: string;
    groupId?: string;
    id: string;
    internalID?: string;
    isFake?: boolean;
    isHidden?: boolean;
    max?: number;
    min?: number;
    migrate?: boolean;
    name?: string;
    options?: string[];
    step?: number;
    tooltip?: string;
    type?: string;
}
export interface PineMetaInfoPlot {
    id: string;
    type: string;
}
export interface PineMetaInfoStyle {
    histogramBase?: number;
    isHidden?: boolean;
    joinPoints?: boolean;
    title?: string;
}
/**
 * Options for saving a new script
 * FIXED: Removed metaInfo parameter (API handles compilation internally)
 */
export interface PineSaveNewOptions {
    name: string;
    username: string;
    code: string;
    allowOverwrite?: boolean;
}
/**
 * Options for saving next version of existing script
 * FIXED: Removed metaInfo parameter (API handles compilation internally)
 */
export interface PineSaveNextOptions {
    scriptId: string;
    name: string;
    username: string;
    code: string;
    allowCreateNew?: boolean;
}
/**
 * Result from save/new or save/next compilation
 */
export interface PineCompilationResult {
    success: boolean;
    result?: {
        IL?: string;
        ilTemplate?: string;
        metaInfo?: PineMetaInfo;
    };
    reason?: string;
    errors?: Array<{
        line?: number;
        column?: number;
        message: string;
    }>;
}
/**
 * Response from POST /pine-facade/parse_title
 */
export interface PineParseTitleResult {
    success: boolean;
    result: string;
}
/**
 * Variable definition location in source
 */
export interface PineVariableDefinition {
    start: {
        line: number;
        column: number;
    };
    end: {
        line: number;
        column: number;
    };
}
/**
 * Variable info extracted from Pine Script
 */
export interface PineVariable {
    name: string;
    type: string;
    definition: PineVariableDefinition;
}
/**
 * Response from POST /pine-facade/translate_light
 * Used for real-time script validation/parsing in the editor
 *
 * Returns extracted metadata (variables, functions, types) and any errors.
 * This is the main "compilation" endpoint - used to show inline errors.
 *
 * IMPORTANT: Unlike save endpoints, translate_light returns success=true even
 * when there are compilation errors. Errors are in result.errors[], not reason2.
 * Check result.errors.length to detect compilation failures.
 */
export interface PineTranslateLightResponse {
    success: boolean;
    reason?: string;
    result?: {
        /** Compilation errors with line/column locations */
        errors?: PineScriptError[];
        /** Extracted variable definitions */
        variables?: PineVariable[];
        /** Extracted function definitions */
        functions?: unknown[];
        /** Extracted type definitions */
        types?: unknown[];
        /** Extracted enum definitions */
        enums?: unknown[];
        /** Scope information */
        scopes?: unknown[];
    };
}
/**
 * Response from GET /pine-facade/translate/{scriptId}/{version}
 * Used to fetch compiled IL for saved scripts (STD;/PUB; indicators)
 */
export interface PineTranslateResult {
    success: boolean;
    result?: {
        /** Compiled Intermediate Language */
        IL?: string;
        /** Compiled IL template */
        ilTemplate?: string;
        /** Full metadata including inputs, plots, styles */
        metaInfo?: PineMetaInfo;
    };
}
//# sourceMappingURL=types-pinescript.d.ts.map