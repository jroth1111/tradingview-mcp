import { z } from "zod";
import { McpError, withErrorHandling } from "../utils/errors.js";
import { buildStudyInputs } from "../utils/study-inputs.js";
import { symbolSchema, timeframeSchema, positiveIntSchema } from "../utils/validators.js";
import type { ToolContext } from "./context.js";

export function registerPineScriptTools(ctx: ToolContext): void {
  const { server, wsClient, restClient, ensureAuthenticated } = ctx;

  server.tool(
    "pinescript_draft_compile",
    `Validate PineScript code. Returns errors with line/column locations.

USE THIS WHEN: User asks to write/fix/check PineScript code.
DO NOT USE FOR: Running code to get values (use pinescript_draft_compile_and_run instead).

ON SUCCESS: {success: true} - code is valid, proceed to save or backtest.
ON ERROR: {success: false, errors: [{message, start: {line, column}}]} - fix the code at that location and call again.

NEXT STEP after success:
- To save: pinescript_create_and_save
- To backtest strategy: strategy_backtest
- To see indicator values: pinescript_draft_compile_and_run`,
    {
      code: z.string().describe("PineScript source code to validate"),
      username: z.string().optional().describe("TradingView username (default: authenticated user)"),
    },
    withErrorHandling(async ({ code, username }) => {
      const auth = await ensureAuthenticated();
      if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required for draft compile", {
          details: auth.error,
        });
      }

      const user = username || auth.username;
      if (!user) {
        throw McpError.invalidParams("username required (missing from session and input)");
      }

      try {
        const result = await restClient.pinescript.translateLightValidate(code, user);
        // Transform to match expected format
        const hasErrors = (result.result?.errors?.length ?? 0) > 0;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: !hasErrors,
              errors: result.result?.errors ?? [],
              variables: result.result?.variables ?? [],
              functions: result.result?.functions ?? [],
              types: result.result?.types ?? [],
              // Note: translate_light doesn't return IL - use save endpoints for that
              note: hasErrors
                ? "Fix errors before saving"
                : "Validation passed. Use pinescript_create_and_save to save.",
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error validating PineScript", err);
      }
    })
  );

  server.tool(
    "pinescript_draft_compile_and_run",
    `Validate AND run PineScript indicator to see computed values.

USE THIS WHEN: User wants to test their indicator and see output values before saving.
DO NOT USE FOR: Running built-in indicators (use study_execute), or strategies (use strategy_backtest).

ON SUCCESS: Returns computed values. If user is satisfied → pinescript_create_and_save.
ON ERROR: Returns errors with line/column - fix and call again.`,
    {
      code: z.string().describe("PineScript source code to validate and run"),
      username: z.string().optional().describe("TradingView username (default: authenticated user)"),
      pineVersion: z.string().default("6").describe("PineScript version for inline execution"),
      symbol: symbolSchema.default("NASDAQ:AAPL").describe("Symbol for execution"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe for execution"),
      count: positiveIntSchema.max(5000, "Count cannot exceed 5000").default(50)
        .describe("Number of data points to return. Response includes last 20."),
      inputs: z.record(z.any()).optional()
        .describe("Optional input overrides by id"),
    },
    withErrorHandling(async ({ code, username, pineVersion, symbol, timeframe, count, inputs }) => {
      const auth = await ensureAuthenticated();
      if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required for draft compile/run", {
          details: auth.error,
        });
      }

      const user = username || auth.username;
      if (!user) {
        throw McpError.invalidParams("username required (missing from session and input)");
      }

      try {
        // Step 1: Validate with translate_light
        const validation = await restClient.pinescript.translateLightValidate(code, user);
        const hasErrors = (validation.result?.errors?.length ?? 0) > 0;

        if (hasErrors) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                validation: {
                  success: false,
                  errors: validation.result?.errors ?? [],
                },
                run: null,
                note: "Validation failed. Fix errors and retry.",
              }, null, 2),
            }],
          };
        }

        // Step 2: Build inputs for WebSocket execution
        // translate_light doesn't return IL - we pass raw code for inline execution
        const studyInputs = {
          ...(inputs ?? {}),
          text: code,  // Raw Pine Script code
          pineVersion: pineVersion,
        };

        const result = await wsClient.runStudy({
          symbol,
          studyId: "Script@tv-scripting-101!",
          timeframe,
          inputs: studyInputs,
          count,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              validation: {
                success: true,
                variables: validation.result?.variables?.length ?? 0,
              },
              run: {
                symbol: result.symbol,
                timeframe,
                count: result.data.length,
                data: result.data.slice(-20),
                note: result.data.length > 20
                  ? `Showing last 20 of ${result.data.length} data points`
                  : undefined,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error validating and running PineScript", err);
      }
    })
  );

  server.tool(
    "strategy_backtest",
    `Backtest a PineScript strategy on historical data.

USE THIS WHEN: User wants to test a trading strategy and see performance metrics.
REQUIRED: Script must use strategy() declaration + strategy.entry()/strategy.close() calls.

BEFORE CALLING: Use pinescript_draft_compile to catch errors first.
ON SUCCESS: Returns metrics. If user wants to save → pinescript_create_and_save.
ON ERROR: Returns errors with line/column - fix and call pinescript_draft_compile again.`,
    {
      script: z.string().describe("PineScript strategy code with strategy() + entry/exit calls"),
      symbol: symbolSchema.describe("Symbol to backtest (e.g., NASDAQ:AAPL)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe (1, 5, 15, 60, 240, 1D, 1W)"),
    },
    withErrorHandling(async ({ script, symbol, timeframe }) => {
      const auth = await ensureAuthenticated();
      if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required for backtesting", {
          details: auth.error,
          action: "A browser window should have opened for login. If not, run: tradingview-mcp login --browser",
        });
      }

      try {
        const result = await wsClient.runBacktest({ script, symbol, timeframe });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Backtest error", err);
      }
    })
  );

  server.tool(
    "strategy_backtest_chained",
    `Backtest a strategy that receives signals from another indicator (Receiver Strategy pattern).

USE THIS WHEN: User wants to backtest using signals from a closed-source indicator.
This chains an indicator to a strategy via input.source() bridging.

WORKFLOW:
1. indicator_search or pinescript_list → get indicator ID
2. indicator_meta → see plots array with titles (e.g., "Buy Signal" = plot index 0)
3. Write receiver strategy with input.source() declarations
4. Use this tool to chain them together and backtest

HOW INPUT IDs WORK:
TradingView assigns input IDs in declaration order:
- First input.source() in your code → "in_0"
- Second input.source() → "in_1"
- And so on...

EXAMPLE receiverScript:
\`\`\`pine
//@version=6
strategy('Receiver', overlay=true)
longSource = input.source(close, 'Long Signal')   // ← This becomes in_0
shortSource = input.source(close, 'Short Signal') // ← This becomes in_1
if not na(longSource) and longSource != 0
    strategy.entry('Long', strategy.long)
if not na(shortSource) and shortSource != 0
    strategy.close('Long')
\`\`\`

EXAMPLE inputMappings (maps input IDs to indicator plot indices):
{ "in_0": 0, "in_1": 1 }
- in_0 (first input.source) receives indicator's plot index 0
- in_1 (second input.source) receives indicator's plot index 1`,
    {
      indicatorId: z.string().describe("Indicator ID to chain (e.g., PUB;abc123, STD;RSI, USER;xyz789)"),
      receiverScript: z.string().describe("Receiver strategy Pine Script with input.source() declarations"),
      inputMappings: z.record(z.number()).describe("Maps input IDs to indicator plot indices: { 'in_0': 0, 'in_1': 1 }"),
      symbol: symbolSchema.describe("Symbol to backtest (e.g., NASDAQ:AAPL)"),
      timeframe: timeframeSchema.default("1D").describe("Timeframe (1, 5, 15, 60, 240, 1D, 1W)"),
      indicatorInputs: z.record(z.any()).optional().describe("Optional input overrides for the indicator"),
    },
    withErrorHandling(async ({ indicatorId, receiverScript, inputMappings, symbol, timeframe, indicatorInputs }) => {
      const auth = await ensureAuthenticated();
      if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required for chained backtesting", {
          details: auth.error,
        });
      }

      try {
        const result = await wsClient.runChainedBacktest({
          indicatorId,
          indicatorInputs,
          receiverScript,
          inputMappings,
          symbol,
          timeframe,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Chained backtest error", err);
      }
    })
  );

  // ============================================================
  // Script Management & Library Access
  // ============================================================

  server.tool(
    "pinescript_create_and_save",
    `Save PineScript as a new script to user's TradingView account.

USE THIS WHEN: User wants to save their PineScript to TradingView.
BEFORE CALLING: Use pinescript_draft_compile to validate - saves time if there are errors.

ON SUCCESS: Returns scriptId - user can find it in their TradingView Pine Editor.
ON ERROR: Returns errors with line/column - fix and call again.`,
    {
      code: z.string().describe("PineScript source code to create"),
      name: z.string().describe("Script name (e.g., 'My Custom Indicator')"),
      username: z.string().optional().describe("TradingView username (default: authenticated user)"),
      allowOverwrite: z.boolean().default(false).describe("Allow overwriting if script with same name exists"),
    },
    withErrorHandling(async ({ code, name, username, allowOverwrite }) => {
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

      // Save to account - the API handles compilation and returns errors if any
      try {
        const saveResult = await restClient.pinescript.saveNew({
          name,
          username: user,
          code,
          allowOverwrite,
        });

        // Check if save succeeded or returned compilation errors
        if (!saveResult.success) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                reason: saveResult.reason,
                errors: saveResult.reason2?.errors ?? [],
                warnings: saveResult.reason2?.warnings ?? [],
                // Script is saved as stub (code preserved but won't execute)
                savedAsStub: saveResult.result?.metaInfo?.isTVScriptStub ?? false,
                message: "Compilation failed. Fix errors and save again.",
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              scriptId: saveResult.result?.metaInfo?.scriptIdPart,
              name: saveResult.result?.metaInfo?.shortDescription || name,
              version: saveResult.result?.metaInfo?.pine?.version,
              message: `Script '${name}' saved successfully`,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error saving script to TradingView", err);
      }
    })
  );

  server.tool(
    "pinescript_save_version",
    `Update an existing script with new code (creates new version).

USE THIS WHEN: User wants to modify a script they already saved.
WORKFLOW: pinescript_list → pinescript_load → modify → pinescript_save_version

ON ERROR: Returns errors with line/column - fix and call again.`,
    {
      scriptId: z.string().describe("Script ID to update (e.g., 'USER;abc123')"),
      newCode: z.string().describe("The modified PineScript source code to save as new version"),
      username: z.string().optional().describe("TradingView username (default: authenticated user)"),
    },
    withErrorHandling(async ({ scriptId, newCode, username }) => {
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
      } catch (err) {
        // Permission check might fail for public scripts - continue anyway
        console.warn("Permission check failed, continuing:", err);
      }

      // Step 2: Load existing script metadata
      let script;
      try {
        script = await restClient.pinescript.getScriptSource(scriptId);
      } catch (err) {
        throw McpError.invalidParams(`Failed to load script ${scriptId}`, { error: String(err) });
      }

      // Step 3: Save as new version - the API handles compilation
      try {
        const saveResult = await restClient.pinescript.saveNext({
          scriptId,
          name: script.scriptName,
          username: user,
          code: newCode,
        });

        // Check if save succeeded or returned compilation errors
        if (!saveResult.success) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                original: {
                  id: script.scriptIdPart,
                  name: script.scriptName,
                  version: script.version,
                },
                reason: saveResult.reason,
                errors: saveResult.reason2?.errors ?? [],
                warnings: saveResult.reason2?.warnings ?? [],
                savedAsStub: saveResult.result?.metaInfo?.isTVScriptStub ?? false,
                message: "Compilation failed. Fix errors and save again.",
              }, null, 2),
            }],
          };
        }

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
              newVersion: saveResult.result?.metaInfo?.pine?.version,
              message: `Script '${script.scriptName}' updated successfully`,
            }, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal("Error saving script update", err);
      }
    })
  );

  server.tool(
    "pinescript_library_list",
    `List functions available in a Pine Script library.

USE THIS WHEN: User asks what functions are in a library, or needs to use library functions.
COMMON LIBRARIES: TradingView/ta, TradingView/Strategy, PineCoders/Time

RETURNS: Function names, parameters, return types.`,
    {
      library: z.string().describe("Library ID in format 'User/LibraryName' (e.g., 'TradingView/ta', 'PineCoders/Time')"),
      filter: z.string().optional().describe("Optional filter for function names (e.g., 'sma' for moving averages)"),
    },
    withErrorHandling(async ({ library, filter }) => {
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
          functions = functions.filter(f => 
            f.name.toLowerCase().includes(filterLower) ||
            f.description.toLowerCase().includes(filterLower) ||
            f.args.some(a => a.name.toLowerCase().includes(filterLower))
          );
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
      } catch (err) {
        throw McpError.internal(`Error fetching library exports for ${library}`, err);
      }
    })
  );

  server.tool(
    "pinescript_list",
    `List user's saved Pine Scripts.

USE THIS WHEN: User asks to see their scripts, or wants to run their saved indicator.
RETURNS: Array of {scriptId, name, ...}

USE SCRIPT ID WITH:
- pinescript_load → view/edit source
- pinescript_save_version → save changes
- study_execute → run and get values (for indicators)`,
    {
      filter: z.enum(["saved", "published"]).default("saved").describe("Filter type: 'saved' for your scripts, 'published' for public scripts"),
    },
    withErrorHandling(async ({ filter }) => {
      const auth = await ensureAuthenticated();
      if (!auth.authenticated) {
        throw McpError.authRequired("Authentication required to list saved scripts", {
          details: auth.error,
        });
      }

      try {
        // List own saved or published scripts
        // Note: PineScriptListResult is now a raw array (fixed to match HAR)
        const scripts = await restClient.pinescript.listScripts(filter);
        const result = {
          filter,
          scripts,
          count: scripts.length,
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        throw McpError.internal(`Error listing ${filter} scripts`, err);
      }
    })
  );

  server.tool(
    "pinescript_load",
    `Load a Pine Script's source code by ID.

USE THIS WHEN: User wants to view or edit an existing script.
GET SCRIPT ID FROM: pinescript_list, or user provides it directly (e.g., USER;abc123).
RETURNS: Full source code + metadata. Modify code and use pinescript_save_version to save.`,
    {
      scriptId: z.string().describe("Script ID to load (e.g., 'USER;abc123' or 'PUB;xyz789')"),
      version: z.string().default("1").describe("Script version to load (default: 1)"),
    },
    withErrorHandling(async ({ scriptId, version }) => {
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
      } catch (err) {
        throw McpError.internal(`Error loading script ${scriptId}`, err);
      }
    })
  );
}
