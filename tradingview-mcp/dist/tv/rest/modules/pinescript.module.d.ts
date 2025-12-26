import type { PineScriptSource, PineScriptSaveResult, PineScriptListResult, PineLibraryExports } from '../../types.js';
import type { PineParseTitleResult, PineTranslateLightResponse, PineSaveNewOptions, PineSaveNextOptions, PineTranslateResult } from '../../types-pinescript.js';
import { BaseModule } from '../base-module.js';
export interface TranslateOptions {
    scriptId: string;
    version?: string;
}
/**
 * Pine Script API module
 * Handles compilation, saving, retrieval, and management of Pine Scripts
 */
export declare class PineScriptModule extends BaseModule {
    /**
     * Check if user has permission to write (edit) a script
     * GET /pine-facade/is_auth_to_write/{scriptId}
     */
    isAuthToWrite(scriptId: string): Promise<boolean>;
    /**
     * Check if user has permission to read (get) a script
     * GET /pine-facade/is_auth_to_get/{scriptId}/{version}
     */
    isAuthToGet(scriptId: string, version?: string): Promise<boolean>;
    /**
     * Get Pine Script source code by script ID and version
     * GET /pine-facade/get/{scriptId}/{version}
     */
    getScriptSource(scriptId: string, version?: string): Promise<PineScriptSource>;
    /**
     * List user's saved or published scripts
     * GET /pine-facade/list?filter={saved|published}
     */
    listScripts(filter?: "saved" | "published"): Promise<PineScriptListResult>;
    /**
     * Parse and validate Pine Script source code (real-time validation)
     * POST /pine-facade/translate_light?user_name={user}&v=3
     *
     * FIXED: HAR shows POST with multipart/form-data containing source field
     */
    translateLightValidate(code: string, username: string): Promise<PineTranslateLightResponse>;
    /**
     * Get library exports (functions and types available from a library)
     * GET /pine-facade/get_lib_export_data/{libId}/last?v=2
     */
    getLibraryExports(libId: string): Promise<PineLibraryExports>;
    /**
     * Parse Pine Script source to extract script title
     * POST /pine-facade/parse_title
     */
    parseTitle(code: string, username: string): Promise<PineParseTitleResult>;
    /**
     * Get compiled IL for a saved Pine Script by script ID
     * GET /pine-facade/translate/{scriptId}/{version}
     *
     * This endpoint returns the compiled Intermediate Language (IL) and metadata
     * for a previously saved script. Used to fetch indicator metadata for STD;/PUB; scripts.
     */
    translate(opts: TranslateOptions): Promise<PineTranslateResult>;
    /**
     * Save a new Pine Script
     * POST /pine-facade/save/new?name={name}&user_name={user}&allow_overwrite={bool}
     *
     * FIXED: Now uses multipart/form-data with source field (matches HAR)
     */
    saveNew(opts: PineSaveNewOptions): Promise<PineScriptSaveResult>;
    /**
     * Save next version of existing Pine Script
     * POST /pine-facade/save/next/{scriptId}?user_name={user}&allow_create_new={bool}&name={name}
     *
     * FIXED: Now uses multipart/form-data with source field (matches HAR)
     */
    saveNext(opts: PineSaveNextOptions): Promise<PineScriptSaveResult>;
    /**
     * Build standard headers for Pine Script API requests
     */
    private buildHeaders;
}
//# sourceMappingURL=pinescript.module.d.ts.map