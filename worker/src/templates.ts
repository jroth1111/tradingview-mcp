// Study-templates and drawing-templates (P10)
// Surfaces (all on www.tradingview.com, cookie-auth):
//   - /api/v1/study-templates  (custom CRUD; standard ids 1-6 R/O; fundamentals ids 12-23 R/O)
//   - /drawing-templates/{tool}/  (list of saved drawing-template names)
//   - /drawing-template/{tool}/?templateName={name}  (load one — note singular)
//   - /save-drawing-template/   POST FormData {tool,name,content}
//   - /remove-drawing-template/ POST FormData {tool,name}
//   - /savesettings/   POST FormData delta=JSON({k:v})
//   - /loadsettings/   GET (returns saved TVSettings keys)
//
// Apply flow is fully client-side: GET content → JSON.parse → applyStudyTemplate
// runs an undo macro that replays sources via direct model mutation. There is
// no `apply_template` envelope on the WS protocol. Worker exposes raw CRUD only.

const TV_WWW = "https://www.tradingview.com";

const cookieHeader = (sessionId: string, sessionSign?: string): Record<string, string> => ({
  cookie: sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`,
});

interface TemplateCallContext {
  sessionId: string;
  sessionSign?: string;
}

const readJson = async (resp: Response, route: string): Promise<any> => {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  // Some endpoints return empty body on success.
  const text = await resp.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

// ---------- Study-templates ----------

export const listStudyTemplates = async (ctx: TemplateCallContext): Promise<any> => {
  const resp = await fetch(`${TV_WWW}/api/v1/study-templates`, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, "GET /api/v1/study-templates");
};

export const getStudyTemplate = async (
  ctx: TemplateCallContext,
  id: string | number,
  bucket: "custom" | "standard" | "fundamentals" = "custom",
): Promise<any> => {
  const path =
    bucket === "custom"
      ? `/api/v1/study-templates/${encodeURIComponent(String(id))}`
      : `/api/v1/study-templates/${bucket}/${encodeURIComponent(String(id))}`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, `GET ${path}`);
};

export const createStudyTemplate = async (
  ctx: TemplateCallContext,
  body: { name: string; content: string; meta_info?: any },
): Promise<any> => {
  if (!body?.name) throw new Error("name required");
  if (typeof body.content !== "string") throw new Error("content must be a JSON-encoded string");
  const resp = await fetch(`${TV_WWW}/api/v1/study-templates`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...cookieHeader(ctx.sessionId, ctx.sessionSign),
    },
    body: JSON.stringify(body),
  });
  return readJson(resp, "POST /api/v1/study-templates");
};

export const updateStudyTemplate = async (
  ctx: TemplateCallContext,
  id: string | number,
  body: { name?: string; content?: string; meta_info?: any },
): Promise<any> => {
  const resp = await fetch(
    `${TV_WWW}/api/v1/study-templates/${encodeURIComponent(String(id))}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...cookieHeader(ctx.sessionId, ctx.sessionSign),
      },
      body: JSON.stringify(body),
    },
  );
  return readJson(resp, `PUT /api/v1/study-templates/${id}`);
};

export const renameStudyTemplate = async (
  ctx: TemplateCallContext,
  id: string | number,
  name: string,
): Promise<any> => {
  if (!name) throw new Error("name required");
  const resp = await fetch(
    `${TV_WWW}/api/v1/study-templates/${encodeURIComponent(String(id))}/rename/`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...cookieHeader(ctx.sessionId, ctx.sessionSign),
      },
      body: JSON.stringify({ name }),
    },
  );
  return readJson(resp, `POST /api/v1/study-templates/${id}/rename/`);
};

export const deleteStudyTemplate = async (
  ctx: TemplateCallContext,
  id: string | number,
): Promise<any> => {
  const resp = await fetch(
    `${TV_WWW}/api/v1/study-templates/${encodeURIComponent(String(id))}`,
    {
      method: "DELETE",
      headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
    },
  );
  return readJson(resp, `DELETE /api/v1/study-templates/${id}`);
};

export const setStudyTemplateFavorite = async (
  ctx: TemplateCallContext,
  id: string | number,
  bucket: "custom" | "standard" = "custom",
  favorite: boolean = true,
): Promise<any> => {
  const path =
    bucket === "custom"
      ? `/api/v1/study-templates/${encodeURIComponent(String(id))}/favorite`
      : `/api/v1/study-templates/standard/${encodeURIComponent(String(id))}/favorite`;
  const resp = await fetch(`${TV_WWW}${path}`, {
    method: favorite ? "POST" : "DELETE",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, `${favorite ? "POST" : "DELETE"} ${path}`);
};

// ---------- Drawing-templates ----------

export const listDrawingTemplates = async (
  ctx: TemplateCallContext,
  tool: string,
): Promise<any> => {
  if (!tool) throw new Error("tool required");
  const resp = await fetch(`${TV_WWW}/drawing-templates/${encodeURIComponent(tool)}/`, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, `GET /drawing-templates/${tool}/`);
};

export const getDrawingTemplate = async (
  ctx: TemplateCallContext,
  tool: string,
  name: string,
): Promise<any> => {
  if (!tool || !name) throw new Error("tool and name required");
  const url = `${TV_WWW}/drawing-template/${encodeURIComponent(
    tool,
  )}/?templateName=${encodeURIComponent(name)}`;
  const resp = await fetch(url, { headers: cookieHeader(ctx.sessionId, ctx.sessionSign) });
  const data = await readJson(resp, `GET /drawing-template/${tool}/`);
  // Upstream returns {payload: <stringified content>}; parse the inner object for callers.
  if (data && typeof data.payload === "string") {
    try {
      data.content = JSON.parse(data.payload);
    } catch {
      data.content = data.payload;
    }
  }
  return data;
};

export const saveDrawingTemplate = async (
  ctx: TemplateCallContext,
  body: { tool: string; name: string; content: any },
): Promise<any> => {
  if (!body?.tool || !body?.name) throw new Error("tool and name required");
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

export const deleteDrawingTemplate = async (
  ctx: TemplateCallContext,
  tool: string,
  name: string,
): Promise<any> => {
  if (!tool || !name) throw new Error("tool and name required");
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

// ---------- TVSettings save/load (covers favorites + recents) ----------

export const saveSettings = async (
  ctx: TemplateCallContext,
  delta: Record<string, any>,
): Promise<any> => {
  const form = new FormData();
  form.set("delta", JSON.stringify(delta ?? {}));
  const resp = await fetch(`${TV_WWW}/savesettings/`, {
    method: "POST",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
    body: form,
  });
  return readJson(resp, "POST /savesettings/");
};

export const loadSettings = async (ctx: TemplateCallContext): Promise<any> => {
  const resp = await fetch(`${TV_WWW}/loadsettings/`, {
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readJson(resp, "GET /loadsettings/");
};
