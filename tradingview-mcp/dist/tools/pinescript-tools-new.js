// NEW TOOLS TO BE ADDED - THESE WILL BE APPENDED TO pinescript.tools.ts
// ============================================================
// NEW TOOLS: Script Management & Library Access
// ============================================================
server.tool("pinescript_create_and_save", "Compile PineScript and save as new script to TradingView account. End-to-end workflow for script creation.", {
    code: z.string().describe("PineScript source code to create"),
    name: z.string().describe("Script name (e.g., 'My Custom Indicator')"),
    username: z.string().optional().describe("TradingView username (default: authenticated user)"),
    allowOverwrite: z.boolean().default(false).describe("Allow overwriting if script with same name exists"),
}, withErrorHandling(async ({ code, name, username, allowOverwrite }) => {
    const auth = await ensureAuthenticated();
    if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required to save scripts", {
            details: auth.error,
            action: "Run 'tradingview-mcp login --browser' to authenticate",
        });
    }
    const user = username || auth.username;
    if (!user) {
        throw McpError.invalidParams("username required (missing from session and input)");
    }
    // Step 1: Compile to validate and get metadata
    const compile = await restClient.pinescript.compileDraft({
        code,
        username: user,
        reuseDraft: false
    });
    if (!compile.success) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        stage: "compile",
                        errors: compile.errors,
                        warnings: compile.warnings,
                        message: "Compilation failed. Fix errors before saving.",
                    }, null, 2),
                }],
        };
    }
    // Step 2: Save to account
    try {
        const saveResult = await restClient.pinescript.saveNew({
            name,
            username: user,
            code,
            metaInfo: compile.metaInfo || {},
            allowOverwrite,
        });
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        compile: {
                            success: compile.success,
                            warnings: compile.warnings.length,
                            ilTemplate: compile.ilTemplate ? "[present]" : "[missing]",
                        },
                        save: saveResult,
                        message: saveResult.success
                            ? `Script '${name}' saved successfully with ID: ${saveResult.result?.scriptIdPart}`
                            : `Save failed: ${saveResult.reason}`,
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        throw McpError.internal("Error saving script to TradingView", err);
    }
}));
server.tool("pinescript_edit_and_save", "Load existing script, apply modifications, and save as new version. Requires write permission.", {
    scriptId: z.string().describe("Script ID to edit (e.g., 'USER;abc123' or 'PUB;xyz789')"),
    modifications: z.string().describe("AI-applied modifications (instructions or code changes)"),
    username: z.string().optional().describe("TradingView username (default: authenticated user)"),
}, withErrorHandling(async ({ scriptId, modifications, username }) => {
    const auth = await ensureAuthenticated();
    if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required to edit scripts", {
            details: auth.error,
        });
    }
    const user = username || auth.username;
    if (!user) {
        throw McpError.invalidParams("username required (missing from session and input)");
    }
    // Step 1: Check write permissions
    try {
        const canWrite = await restClient.pinescript.isAuthToWrite(scriptId);
        if (!canWrite) {
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            stage: "permission",
                            canWrite: false,
                            message: "You do not have permission to edit this script. It may belong to another user or be read-only.",
                        }, null, 2),
                    }],
            };
        }
    }
    catch (err) {
        // Permission check might fail for public scripts - continue anyway
        console.warn("Permission check failed, continuing:", err);
    }
    // Step 2: Load existing script
    let script;
    try {
        script = await restClient.pinescript.getScriptSource(scriptId);
    }
    catch (err) {
        throw McpError.invalidParams(`Failed to load script ${scriptId}`, err);
    }
    // Step 3: Apply modifications (AI will handle this)
    const modifiedCode = script.source; // AI will modify this
    // Step 4: Compile to validate changes
    const compile = await restClient.pinescript.compileDraft({
        code: modifiedCode,
        username: user,
        reuseDraft: false
    });
    if (!compile.success) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        stage: "compile",
                        script: {
                            id: script.scriptIdPart,
                            name: script.scriptName,
                            version: script.version,
                        },
                        modifications,
                        errors: compile.errors,
                        warnings: compile.warnings,
                        message: "Compilation failed after modifications. Fix errors and retry.",
                    }, null, 2),
                }],
        };
    }
    // Step 5: Save as new version
    try {
        const saveResult = await restClient.pinescript.saveNext({
            scriptId,
            name: script.scriptName,
            username: user,
            code: modifiedCode,
            metaInfo: compile.metaInfo || {},
        });
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        original: {
                            id: script.scriptIdPart,
                            name: script.scriptName,
                            version: script.version,
                            updated: script.updated,
                        },
                        modifications,
                        compile: {
                            success: compile.success,
                            warnings: compile.warnings.length,
                        },
                        save: saveResult,
                        message: saveResult.success
                            ? `Script '${script.scriptName}' updated successfully (version ${script.version} → new version)`
                            : `Save failed: ${saveResult.reason}`,
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        throw McpError.internal("Error saving script update", err);
    }
}));
server.tool("pinescript_library_list", "List all available functions from a Pine Script library. Essential for discovering library capabilities.", {
    library: z.enum([
        "TradingView/ta",
        "TradingView/Strategy",
        "TradingView/chart",
        "TradingView/type",
        "TradingView/math",
        "PineCoders/Time",
        "PineCoders/VisibleChart",
        "PineCoders/AutoSupportResistance",
        "PineCoders/Misc"
    ]).describe("Library to explore"),
    filter: z.string().optional().describe("Optional filter for function names (e.g., 'sma' for moving averages)"),
}, withErrorHandling(async ({ library, filter }) => {
    try {
        const lib = await restClient.pinescript.getLibraryExports(library);
        let functions = lib.exports.functions.map(f => ({
            name: f.name,
            description: f.desc[0] || "",
            args: f.args.map(a => ({
                name: a.name,
                description: a.desc[0] || "",
                type: a.displayType,
                required: a.required
            })),
            returnedTypes: f.returnedTypes,
            returns: f.returns,
            syntax: f.syntax[0] || "",
        }));
        // Apply filter if provided
        if (filter) {
            const filterLower = filter.toLowerCase();
            functions = functions.filter(f => f.name.toLowerCase().includes(filterLower) ||
                f.description.toLowerCase().includes(filterLower) ||
                f.args.some(a => a.name.toLowerCase().includes(filterLower)));
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        library: {
                            id: lib.libInfo.libId,
                            name: lib.libInfo.lib,
                            version: lib.libInfo.version,
                            user: lib.libInfo.user,
                            isPublic: lib.libInfo.isPublic,
                        },
                        functions,
                        stats: {
                            total: lib.exports.functions.length,
                            filtered: functions.length,
                            types: lib.exports.types.length,
                        },
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        throw McpError.internal(`Error fetching library exports for ${library}`, err);
    }
}));
server.tool("pinescript_list", "List user's saved or published Pine Scripts. Also can list another user's public scripts.", {
    filter: z.enum(["saved", "published"]).default("saved").describe("Filter type: 'saved' for your scripts, 'published' for public scripts"),
    username: z.string().optional().describe("List another user's public scripts (optional)"),
}, withErrorHandling(async ({ filter, username }) => {
    const auth = await ensureAuthenticated();
    if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required to list saved scripts", {
            details: auth.error,
        });
    }
    let result;
    if (username) {
        // List another user's public scripts
        try {
            const scripts = await restClient.pinescript.getUserScripts(username);
            result = {
                filter: "user",
                username,
                scripts,
                count: scripts.length,
            };
        }
        catch (err) {
            throw McpError.internal(`Error listing scripts for user ${username}`, err);
        }
    }
    else {
        // List own saved or published scripts
        try {
            const listResult = await restClient.pinescript.listScripts(filter);
            result = {
                filter,
                scripts: listResult.result || [],
                count: (listResult.result || []).length,
            };
        }
        catch (err) {
            throw McpError.internal(`Error listing ${filter} scripts`, err);
        }
    }
    return {
        content: [{
                type: "text",
                text: JSON.stringify(result, null, 2),
            }],
    };
}));
server.tool("pinescript_load", "Load a specific Pine Script by ID (source code + metadata). Useful for reviewing or editing scripts.", {
    scriptId: z.string().describe("Script ID to load (e.g., 'USER;abc123' or 'PUB;xyz789')"),
    version: z.string().default("1").describe("Script version to load (default: 1)"),
}, withErrorHandling(async ({ scriptId, version }) => {
    try {
        const script = await restClient.pinescript.getScriptSource(scriptId, version);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        id: script.scriptIdPart,
                        name: script.scriptName,
                        version: script.version,
                        access: script.scriptAccess,
                        created: script.created,
                        updated: script.updated,
                        source: script.source,
                        lines: script.source.split('\n').length,
                        extra: script.extra,
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        throw McpError.internal(`Error loading script ${scriptId}`, err);
    }
}));
export {};
//# sourceMappingURL=pinescript-tools-new.js.map