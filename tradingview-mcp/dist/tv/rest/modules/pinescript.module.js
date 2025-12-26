import { BaseModule } from '../base-module.js';
import { AUTH_HEADERS_BASE } from '../utils.js';
/**
 * Pine Script API module
 * Handles compilation, saving, retrieval, and management of Pine Scripts
 */
export class PineScriptModule extends BaseModule {
    // ============================================================
    // PERMISSIONS
    // ============================================================
    /**
     * Check if user has permission to write (edit) a script
     * GET /pine-facade/is_auth_to_write/{scriptId}
     */
    async isAuthToWrite(scriptId) {
        if (!scriptId)
            throw new Error("scriptId required");
        const url = `https://pine-facade.tradingview.com/pine-facade/is_auth_to_write/${scriptId}`;
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Auth check failed: ${resp.status} ${resp.statusText}`);
        }
        const text = await resp.text();
        return text === 'true';
    }
    /**
     * Check if user has permission to read (get) a script
     * GET /pine-facade/is_auth_to_get/{scriptId}/{version}
     */
    async isAuthToGet(scriptId, version = "1") {
        if (!scriptId)
            throw new Error("scriptId required");
        const url = `https://pine-facade.tradingview.com/pine-facade/is_auth_to_get/${scriptId}/${version}`;
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Auth check failed: ${resp.status} ${resp.statusText}`);
        }
        const text = await resp.text();
        return text === 'true';
    }
    // ============================================================
    // RETRIEVAL
    // ============================================================
    /**
     * Get Pine Script source code by script ID and version
     * GET /pine-facade/get/{scriptId}/{version}
     */
    async getScriptSource(scriptId, version = "1") {
        if (!scriptId)
            throw new Error("scriptId required");
        const url = `https://pine-facade.tradingview.com/pine-facade/get/${scriptId}/${version}`;
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Get script source failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    /**
     * List user's saved or published scripts
     * GET /pine-facade/list?filter={saved|published}
     */
    async listScripts(filter = "saved") {
        const url = `https://pine-facade.tradingview.com/pine-facade/list?filter=${filter}`;
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`List scripts failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    /**
     * Parse and validate Pine Script source code (real-time validation)
     * POST /pine-facade/translate_light?user_name={user}&v=3
     *
     * FIXED: HAR shows POST with multipart/form-data containing source field
     */
    async translateLightValidate(code, username) {
        if (!code || !username)
            throw new Error("code and username required");
        const url = `https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=${username}&v=3`;
        // Create FormData with source field (matches HAR)
        const formData = new FormData();
        formData.append("source", code);
        // Build headers (Note: Don't set Content-Type for FormData)
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, {
            method: "POST",
            headers,
            body: formData,
        });
        if (!resp.ok) {
            throw new Error(`Translate light failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    /**
     * Get library exports (functions and types available from a library)
     * GET /pine-facade/get_lib_export_data/{libId}/last?v=2
     */
    async getLibraryExports(libId) {
        if (!libId)
            throw new Error("libId required");
        const url = `https://pine-facade.tradingview.com/pine-facade/get_lib_export_data/${libId}/last?v=2`;
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`Get library exports failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    // ============================================================
    // PARSING
    // ============================================================
    /**
     * Parse Pine Script source to extract script title
     * POST /pine-facade/parse_title
     */
    async parseTitle(code, username) {
        if (!code || !username)
            throw new Error("code and username required");
        const url = "https://pine-facade.tradingview.com/pine-facade/parse_title";
        // Create FormData with source and user_name fields
        const formData = new FormData();
        formData.append("source", code);
        formData.append("user_name", username);
        // Build headers (Note: Don't set Content-Type for FormData - browser will set with boundary)
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, {
            method: "POST",
            headers,
            body: formData,
        });
        if (!resp.ok) {
            throw new Error(`Parse title failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    // ============================================================
    // TRANSLATION (Get compiled IL for saved scripts)
    // ============================================================
    /**
     * Get compiled IL for a saved Pine Script by script ID
     * GET /pine-facade/translate/{scriptId}/{version}
     *
     * This endpoint returns the compiled Intermediate Language (IL) and metadata
     * for a previously saved script. Used to fetch indicator metadata for STD;/PUB; scripts.
     */
    async translate(opts) {
        if (!opts.scriptId)
            throw new Error("scriptId required");
        const version = opts.version || "last";
        const url = `https://pine-facade.tradingview.com/pine-facade/translate/${opts.scriptId}/${version}`;
        const headers = this.buildHeaders();
        const resp = await this.fetch(url, { method: "GET", headers });
        if (!resp.ok) {
            throw new Error(`PineScript translation failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    // ============================================================
    // SAVE OPERATIONS (FIXED - HAR ANALYSIS)
    // ============================================================
    /**
     * Save a new Pine Script
     * POST /pine-facade/save/new?name={name}&user_name={user}&allow_overwrite={bool}
     *
     * FIXED: Now uses multipart/form-data with source field (matches HAR)
     */
    async saveNew(opts) {
        if (!opts.name || !opts.username || !opts.code) {
            throw new Error("name, username, and code required");
        }
        // Create URL with query params
        const url = new URL("https://pine-facade.tradingview.com/pine-facade/save/new");
        url.searchParams.set("name", opts.name);
        url.searchParams.set("user_name", opts.username);
        url.searchParams.set("allow_overwrite", String(opts.allowOverwrite ?? false));
        // Create FormData with source field
        const formData = new FormData();
        formData.append("source", opts.code);
        // Build headers (Note: Don't set Content-Type for FormData - browser will set with boundary)
        const headers = this.buildHeaders();
        // Send FormData (NOT JSON)
        const resp = await this.fetch(url.toString(), {
            method: "POST",
            headers,
            body: formData,
        });
        if (!resp.ok) {
            throw new Error(`Save new script failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    /**
     * Save next version of existing Pine Script
     * POST /pine-facade/save/next/{scriptId}?user_name={user}&allow_create_new={bool}&name={name}
     *
     * FIXED: Now uses multipart/form-data with source field (matches HAR)
     */
    async saveNext(opts) {
        if (!opts.scriptId || !opts.name || !opts.username || !opts.code) {
            throw new Error("scriptId, name, username, and code required");
        }
        // Create URL with query params
        const url = new URL(`https://pine-facade.tradingview.com/pine-facade/save/next/${opts.scriptId}`);
        url.searchParams.set("name", opts.name);
        url.searchParams.set("user_name", opts.username);
        url.searchParams.set("allow_create_new", String(opts.allowCreateNew ?? false));
        // Create FormData with source field
        const formData = new FormData();
        formData.append("source", opts.code);
        // Build headers (Note: Don't set Content-Type for FormData - browser will set with boundary)
        const headers = this.buildHeaders();
        // Send FormData (NOT JSON)
        const resp = await this.fetch(url.toString(), {
            method: "POST",
            headers,
            body: formData,
        });
        if (!resp.ok) {
            throw new Error(`Save next version failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.json();
    }
    // ============================================================
    // HELPER METHODS
    // ============================================================
    /**
     * Build standard headers for Pine Script API requests
     */
    buildHeaders(additional = {}) {
        const headers = {
            Origin: AUTH_HEADERS_BASE.Origin,
            Referer: AUTH_HEADERS_BASE.Referer,
            ...additional,
        };
        if (this.ctx.credentials?.sessionId) {
            headers.Cookie = this.ctx.credentials.sessionSign
                ? `sessionid=${this.ctx.credentials.sessionId}; sessionid_sign=${this.ctx.credentials.sessionSign}`
                : `sessionid=${this.ctx.credentials.sessionId}`;
        }
        return headers;
    }
}
//# sourceMappingURL=pinescript.module.js.map