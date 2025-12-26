// NEW WORKFLOW PROMPTS TO BE ADDED TO workflows.tools.ts
server.prompt("create-indicator", "Guided workflow for creating, compiling, and saving a new Pine Script indicator", {
    description: z.string().describe("Indicator description or requirements"),
    name: z.string().optional().describe("Script name (optional, AI will suggest if not provided)"),
    symbol: symbolSchema.default("NASDAQ:AAPL").describe("Symbol for testing"),
    timeframe: timeframeSchema.default("1D").describe("Timeframe for testing"),
}, ({ description, name, symbol, timeframe }) => ({
    description: "End-to-end workflow for creating a new Pine Script indicator",
    messages: [
        {
            role: "user",
            content: {
                type: "text",
                text: [
                    `Create a new Pine Script indicator: ${description}`,
                    "",
                    "Steps:",
                    "1) Write the indicator code with proper inputs, plots, and formatting.",
                    name ? `2) Save with name '${name}'.` : "2) Suggest a concise script name.",
                    `3) Run pinescript_draft_compile to validate and catch errors early.`,
                    `4) Fix any errors and repeat compile until success.`,
                    `5) Run pinescript_draft_compile_and_run on ${symbol} (${timeframe}) to verify output looks correct.`,
                    `6) If results look good, run pinescript_create_and_save to persist the script.`,
                    "7) Return the script ID and summary of what the indicator does.",
                    "",
                    "Notes:",
                    "- Use library functions from TradingView/ta when possible (run pinescript_library_list to explore).",
                    "- Keep code clean and well-commented.",
                    "- Return only the final summary and script ID after saving.",
                ].join("\n"),
            },
        },
    ],
}));
server.prompt("edit-indicator", "Guided workflow for loading, modifying, and saving an existing Pine Script", {
    scriptId: z.string().describe("Script ID to edit (e.g., 'USER;abc123' or 'PUB;xyz789')"),
    modifications: z.string().describe("Description of changes to make"),
}, ({ scriptId, modifications }) => ({
    description: "Edit and update an existing Pine Script with new version",
    messages: [
        {
            role: "user",
            content: {
                type: "text",
                text: [
                    `Edit script ${scriptId}: ${modifications}`,
                    "",
                    "Steps:",
                    "1) Load the script source using pinescript_load (or check permissions first).",
                    "2) Review the current code and understand its logic.",
                    "3) Apply the requested modifications to the code.",
                    "4) Run pinescript_draft_compile to validate the changes.",
                    "5) Fix any errors and repeat compile until success.",
                    "6) Run pinescript_edit_and_save to save as new version.",
                    "7) Report what changed and the new script version.",
                    "",
                    "Notes:",
                    "- Check write permissions before editing (some scripts may be read-only).",
                    "- Preserve existing functionality unless explicitly asked to change it.",
                    "- Add comments explaining the changes.",
                    "- Return summary of modifications and new script ID after saving.",
                ].join("\n"),
            },
        },
    ],
}));
server.prompt("explore-library", "Guided workflow for discovering and using Pine Script library functions", {
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
    goal: z.string().describe("What you want to accomplish (e.g., 'calculate SMA', 'strategy functions')"),
}, ({ library, goal }) => ({
    description: "Discover and use Pine Script library functions for your goal",
    messages: [
        {
            role: "user",
            content: {
                type: "text",
                text: [
                    `I want to: ${goal}`,
                    "",
                    `Explore ${library} library:`,
                    "",
                    "Steps:",
                    "1) Run pinescript_library_list to get all available functions.",
                    "2) Find functions relevant to my goal (match by name or description).",
                    "3) Show function signatures, parameters, and return types for relevant functions.",
                    "4) Provide code examples showing how to import and use these functions.",
                    "5) If I ask, help me write a complete script using these functions.",
                    "",
                    "Notes:",
                    "- Filter functions by name/description to find relevant ones quickly.",
                    "- Show parameter types and whether they're required.",
                    "- Provide working import syntax (e.g., 'import TradingView/ta/1 as ta').",
                    "- Include usage examples for each relevant function.",
                ].join("\n"),
            },
        },
    ],
}));
server.prompt("manage-scripts", "Guided workflow for listing, browsing, and managing Pine Scripts portfolio", {
    filter: z.enum(["saved", "published"]).default("saved").describe("Filter type"),
    username: z.string().optional().describe("List another user's scripts"),
}, ({ filter, username }) => ({
    description: "Browse and manage your Pine Scripts portfolio",
    messages: [
        {
            role: "user",
            content: {
                type: "text",
                text: [
                    `Show my ${filter} scripts${username ? ` (or ${username}'s scripts)` : ''}:`,
                    "",
                    "Steps:",
                    "1) Run pinescript_list to show all scripts with basic info.",
                    "2) Display scripts in a readable format (ID, name, version, access level).",
                    "3) Ask which script I want to work with (view, edit, test, or backtest).",
                    "4) Based on my choice, take the appropriate action:",
                    "   - View: Use pinescript_load to show full source code",
                    "   - Edit: Use edit-indicator workflow to modify",
                    "   - Test: Run pinescript_draft_compile_and_run on a symbol",
                    "   - Backtest: If it's a strategy, run strategy_backtest",
                    "5) For edited scripts, remind me to save changes.",
                    "",
                    "Notes:",
                    "- Show script IDs so I can reference them later.",
                    "- Indicate which scripts are mine vs public.",
                    "- Offer to load any script on demand.",
                    "- Keep the list concise (max 20 scripts shown at once).",
                ].join("\n"),
            },
        },
    ],
}));
export {};
//# sourceMappingURL=workflows-new.js.map