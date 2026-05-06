// Line-tools / drawing-template persistence (P19)
//
// This module exposes a per-tool drawing-template CRUD surface that mirrors
// /tmp/tv-recon/agents/05-charts-storage.md §3 + §5.
//
// Bundle-confirmed literals (verified): "/save-drawing-template/", "/remove-drawing-template/".
// Lead paths (per agent 05 §5, parallel to verified save/remove):
//   GET /list-drawing-templates/?tool=<DrawingTool>
//   GET /load-drawing-template/?tool=<DrawingTool>&templateName=<name>
//
// All routes are www.tradingview.com and use cookie auth (sessionid +
// optional sessionid_sign). The agent-05 line-tools-storage host described
// in §3 is the realtime drawing-sync surface (WebSocket + a separate
// per-user token); the REST list/load/save/delete persistence path is the
// shared drawing-templates store on www.tradingview.com (same persistence
// store fronted in agent 17 §3 with the verified shape; this module
// follows the agent-05 lead paths so callers can keep templates.ts and
// line-tools.ts on independent surfaces while we probe).
//
// This file deliberately does NOT modify worker/src/templates.ts. The
// existing /v1/drawing-templates/* family stays on agent 17's verified
// `/drawing-templates/${tool}/` + `/drawing-template/${tool}/` paths;
// the line-tools.ts family wraps the agent-05 lead paths and exposes a
// per-tool tool-enum endpoint for clients that need the supported list.
//
// FormData encoding for save/delete is identical to templates.ts and
// matches the bundle-confirmed POST surface verified in both reconnaissance
// agents.

const TV_WWW = "https://www.tradingview.com";

const cookieHeader = (sessionId: string, sessionSign?: string): Record<string, string> => ({
  cookie: sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`,
});

export interface LineToolCallContext {
  sessionId: string;
  sessionSign?: string;
}

const readJson = async (resp: Response, route: string): Promise<any> => {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

// ---------- Tool enum ----------
//
// Exhaustive list of drawing tools surfaced through the line-tools-storage
// subsystem. Sourced from the bundle's primitive registry (agent 05 §3,
// agent 17 §3) and the bead spec for tradingview-34p. The Worker returns
// this list to clients via /v1/line-tools/tools so the UI can populate
// per-tool template pickers without round-tripping the bundle.
export const LINE_TOOLS = [
  "LineToolTrendLine",
  "LineToolHorzLine",
  "LineToolHorzRay",
  "LineToolVertLine",
  "LineToolFibRetracement",
  "LineToolFibExtension",
  "LineToolFibChannel",
  "LineToolFibSpiral",
  "LineToolFibTimeZone",
  "LineToolFibCircles",
  "LineToolPitchfork",
  "LineToolGannFan",
  "LineToolGannSquare",
  "LineToolGannBox",
  "LineToolElliottWave1",
  "LineToolElliottWave2",
  "LineToolElliottWave3",
  "LineToolElliottWave4",
  "LineToolElliottWave5",
  "LineToolElliottCorrection",
  "LineToolElliottTriangle",
  "LineToolElliottDoubleCombo",
  "LineToolElliottTripleCombo",
  "LineToolText",
  "LineToolNote",
  "LineToolArrow",
  "LineToolRectangle",
  "LineToolEllipse",
  "LineToolCircle",
  "LineToolTriangle",
  "LineToolPath",
  "LineToolPolyline",
  "LineToolBrush",
  "LineToolBalloon",
  "LineToolPriceRange",
  "LineToolDateRange",
  "LineToolDateAndPriceRange",
  "LineToolPriceLabel",
  "LineToolFlag",
  "LineToolSignpost",
  "LineToolEmoji",
  "LineToolImage",
  "LineToolCallout",
  "LineToolAnchoredVWAP",
  "LineToolAnchoredText",
  "LineToolMeasure",
  "LineToolSchiffPitchfork",
  "LineToolModifiedSchiffPitchfork",
  "LineToolInsidePitchfork",
  "LineToolHeadAndShoulders",
  "LineToolThreeDrivers",
  "LineToolDisjointAngle",
  "LineToolFlatTopBottom",
  "LineToolBarsPattern",
  "LineToolGhostFeed",
  "LineToolPriceNote",
  "LineToolHighlighter",
  "LineToolCrossLine",
] as const;

export type DrawingTool = (typeof LINE_TOOLS)[number];

const LINE_TOOL_SET: ReadonlySet<string> = new Set(LINE_TOOLS);

export const isDrawingTool = (tool: string): tool is DrawingTool => LINE_TOOL_SET.has(tool);

const requireTool = (tool: string): void => {
  if (!tool) throw new Error("tool required");
  if (!isDrawingTool(tool)) throw new Error(`unknown drawing tool: ${tool}`);
};

// ---------- Public types ----------

export interface LineToolTemplate {
  tool: DrawingTool;
  name: string;
  content: any;
}

export interface ListLineToolsResult {
  tools: readonly DrawingTool[];
}

// ---------- Tool enumeration helper ----------

export const listLineTools = (): ListLineToolsResult => ({ tools: LINE_TOOLS });

// ---------- Per-tool template CRUD ----------

export const listLineToolTemplates = async (
  ctx: LineToolCallContext,
  tool: string,
): Promise<any> => {
  requireTool(tool);
  const url = `${TV_WWW}/list-drawing-templates/?tool=${encodeURIComponent(tool)}`;
  const resp = await fetch(url, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, `GET /list-drawing-templates/?tool=${tool}`);
};

export const loadLineToolTemplate = async (
  ctx: LineToolCallContext,
  tool: string,
  templateName: string,
): Promise<any> => {
  requireTool(tool);
  if (!templateName) throw new Error("templateName required");
  const url = `${TV_WWW}/load-drawing-template/?tool=${encodeURIComponent(
    tool,
  )}&templateName=${encodeURIComponent(templateName)}`;
  const resp = await fetch(url, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  const data = await readJson(
    resp,
    `GET /load-drawing-template/?tool=${tool}&templateName=${templateName}`,
  );
  // Upstream historically returns {payload: <stringified content>} on the
  // sibling /drawing-template/ surface; mirror that parse so callers see
  // a structured `content` even if the lead path hands back the raw payload
  // string. If upstream already returns a parsed object the spread leaves
  // the object untouched.
  if (data && typeof data.payload === "string") {
    try {
      data.content = JSON.parse(data.payload);
    } catch {
      data.content = data.payload;
    }
  }
  return data;
};

export const saveLineToolTemplate = async (
  ctx: LineToolCallContext,
  body: { tool: string; name: string; content: any },
): Promise<any> => {
  if (!body) throw new Error("body required");
  requireTool(body.tool);
  if (!body.name) throw new Error("name required");
  const form = new FormData();
  form.set("tool", body.tool);
  form.set("name", body.name);
  form.set(
    "content",
    typeof body.content === "string" ? body.content : JSON.stringify(body.content ?? {}),
  );
  const resp = await fetch(`${TV_WWW}/save-drawing-template/`, {
    method: "POST",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
    body: form,
  });
  return readJson(resp, "POST /save-drawing-template/");
};

export const deleteLineToolTemplate = async (
  ctx: LineToolCallContext,
  tool: string,
  name: string,
): Promise<any> => {
  requireTool(tool);
  if (!name) throw new Error("name required");
  const form = new FormData();
  form.set("tool", tool);
  form.set("name", name);
  const resp = await fetch(`${TV_WWW}/remove-drawing-template/`, {
    method: "POST",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
    body: form,
  });
  return readJson(resp, "POST /remove-drawing-template/");
};
