// Pine-facade script management (P13)
// Surface: pine-facade.tradingview.com
//
// Endpoint inventory (from /tmp/tv-recon/agents/03-pine-facade.md §1, §7
// and /tmp/tv-recon/agents/12-pine-pipeline.md §7):
//
//   - GET  pine-facade/get_script_info/?pine_id=<id>           -> {userId, userName, chartImageUrl}
//   - GET  pine-facade/versions/{ID}/last                      -> [{created, version}]
//   - GET  pine-facade/versions/{ID}/all                       -> [{created, version}, ...]
//                                                                 (lead — may 404; fall back to /last)
//   - GET  pine-facade/is_auth_to_get/{ID}/{ver}               -> text/plain "true"/"false"
//   - GET  pine-facade/list?filter=<name>                      -> array of script summaries
//   - POST pine-facade/save/{new,next,new_draft,next_draft}    -> {success, scriptIdPart?, version?, ...}
//   - POST pine-facade/publish/{new,next}                      -> {success, scriptIdPart?, ...}
//   - POST pine-facade/delete/{id}                             -> {success}
//   - POST pine-facade/rename/{id}                             -> {success}
//   - POST pine-facade/copy/{id}                               -> {success, scriptIdPart, ...}
//   - POST pine-facade/convert                                 -> {success, source}
//   - POST pine-facade/parse_title                             -> {success, title?}
//   - GET  pine-facade/translate-light-source/{ID}/{ver}       -> {success, source?, metaInfo?, warnings?}
//   - POST pine-facade/gen_alert/                              -> {alert_info, ...}
//
// Auth: every call uses cookie auth (sessionid + sessionid_sign). The Worker
// pulls those from the admin session store; caller-supplied session is
// resolved by the caller (`requireAdminAuth`) before reaching these helpers.
//
// Form-encoded endpoints (save/next/copy/rename/parse_title/convert and
// publish payloads following the legacy bundle pattern from `52174`/`58404`)
// use `application/x-www-form-urlencoded` with URLSearchParams. JSON-bodied
// endpoints (gen_alert, delete, translate-light-source) use JSON.
//
// Error envelope normalization: TradingView's failure shape is
// `{success:false, reason:string|object, reason2:{errors:[{message,
// start:{line,column}, end:{line,column}}], warnings:[...]}}` —
// flattened to `{success:boolean, errors:[{message,line,column}],
// warnings:[{message,line,column}]}`.
//
// Filter allowlist (per recon §1, §7): standard, candlestick, fundamental,
// saved, favorites, public, recent. Other values are 400-rejected at the
// helper boundary so callers cannot smuggle unknown filters upstream.

const PINE_FACADE = "https://pine-facade.tradingview.com";

const FILTER_ALLOWLIST = [
  "standard",
  "candlestick",
  "fundamental",
  "saved",
  "favorites",
  "public",
  "recent",
] as const;

export type PineListFilter = (typeof FILTER_ALLOWLIST)[number];

export const isAllowedFilter = (filter: string): filter is PineListFilter =>
  (FILTER_ALLOWLIST as readonly string[]).includes(filter);

// ----- Types ---------------------------------------------------------------

export interface PineCallContext {
  sessionId: string;
  sessionSign?: string;
  username?: string;
}

export interface PineScriptInfo {
  userId: number | string;
  userName: string;
  chartImageUrl?: string;
  raw?: any;
}

export interface PineVersion {
  version: string;
  created?: number;
}

export interface PineAuthCheck {
  authorized: boolean;
  raw?: string;
}

export interface PineDiagnostic {
  message: string;
  line?: number;
  column?: number;
}

export interface PineNormalizedEnvelope<T = any> {
  success: boolean;
  errors: PineDiagnostic[];
  warnings: PineDiagnostic[];
  data?: T;
  raw?: any;
}

export type PineSaveMode = "new" | "next" | "new_draft" | "next_draft";

export interface PineSaveRequest {
  mode: PineSaveMode;
  source: string;
  /** Required for `next` / `next_draft`. */
  id?: string;
  /** Required for `new` (visible save); optional for `next` to rename. */
  name?: string;
  allowOverwrite?: boolean;
  allowCreateNew?: boolean;
  allowUseExistingDraft?: boolean;
}

export interface PineSaveResult extends PineNormalizedEnvelope {
  scriptIdPart?: string;
  version?: string;
  metaInfo?: any;
}

export type PinePublishMode = "new" | "next";
export type PinePublishAccess = "open" | "protected" | "invite_only";

export interface PinePublishRequest {
  mode: PinePublishMode;
  source: string;
  /** Required for `next`. */
  id?: string;
  /** First publish only. */
  access?: PinePublishAccess;
  /**
   * Free-form publish payload. Bundle `52174`/`58404` shows
   * `{originalScriptId, originalScriptVersion}` for republish.
   */
  extra?: Record<string, any>;
  /** Optional rename at publish time. */
  name?: string;
}

export interface PinePublishResult extends PineNormalizedEnvelope {
  scriptIdPart?: string;
  version?: string;
}

export interface PineRenameRequest {
  id: string;
  name: string;
  force?: boolean;
}

export interface PineCopyRequest {
  id: string;
  name?: string;
}

export interface PineConvertRequest {
  source: string;
  /** Target version, e.g. "5", "6". */
  version_to: string;
}

export interface PineConvertResult extends PineNormalizedEnvelope {
  source?: string;
}

export interface PineParseTitleResult extends PineNormalizedEnvelope {
  title?: string;
  shortTitle?: string;
  scriptKind?: string;
}

export interface PineTranslateLightResult extends PineNormalizedEnvelope {
  source?: string;
  metaInfo?: any;
  ilTemplate?: string;
}

export interface PineGenAlertRequest {
  source?: string;
  alert_info?: any;
  inputs?: Record<string, any>;
}

export interface PineGenAlertResult extends PineNormalizedEnvelope {
  alert_info?: any;
}

export interface PineListItem {
  scriptName?: string;
  scriptIdPart?: string;
  userId?: number | string;
  version?: string;
  scriptAccess?: string;
  extra?: Record<string, any>;
  lastVersionMaj?: number;
  raw?: any;
}

// ----- HTTP utilities ------------------------------------------------------

const cookieHeader = (sessionId: string, sessionSign?: string): Record<string, string> => ({
  cookie: sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`,
});

const fetchJson = async (
  url: string,
  init: RequestInit,
  route: string,
): Promise<any> => {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const err: any = new Error(
      `${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`,
    );
    err.status = resp.status;
    throw err;
  }
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { __text: text };
  }
};

// ----- Error envelope normalization ----------------------------------------

const parseLineColFromText = (msg: string): { line?: number; column?: number } => {
  const out: { line?: number; column?: number } = {};
  const lineMatch = msg.match(/line\s+(\d+)(?:[,\s]+col(?:umn)?\s+(\d+))?/i);
  if (lineMatch) {
    out.line = Number(lineMatch[1]);
    if (lineMatch[2] != null) out.column = Number(lineMatch[2]);
  }
  return out;
};

const normalizeOne = (entry: any): PineDiagnostic | null => {
  if (entry == null) return null;
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    return { message: trimmed, ...parseLineColFromText(trimmed) };
  }
  if (typeof entry === "object") {
    const message =
      typeof entry.message === "string"
        ? entry.message
        : typeof entry.text === "string"
          ? entry.text
          : typeof entry.reason === "string"
            ? entry.reason
            : JSON.stringify(entry);
    const out: PineDiagnostic = { message };
    const start = entry.start || entry.position || entry.location || null;
    const line = start?.line ?? entry.line ?? entry.row ?? null;
    const column = start?.column ?? entry.column ?? entry.col ?? null;
    if (line != null) out.line = Number(line);
    if (column != null) out.column = Number(column);
    return out;
  }
  return null;
};

const normalizeList = (input: any): PineDiagnostic[] => {
  if (input == null) return [];
  const arr = Array.isArray(input) ? input : [input];
  const out: PineDiagnostic[] = [];
  for (const item of arr) {
    const n = normalizeOne(item);
    if (n) out.push(n);
  }
  return out;
};

/**
 * Flatten the canonical TV envelope. Accepts both the standard
 * `{success, reason, reason2:{errors,warnings}}` shape and the
 * lightly-nested `{success, result:{errors, warnings}}` shape.
 */
export const normalizeEnvelope = <T = any>(data: any): PineNormalizedEnvelope<T> => {
  if (data == null) return { success: false, errors: [{ message: "empty response" }], warnings: [] };
  const errors: PineDiagnostic[] = [];
  const warnings: PineDiagnostic[] = [];
  const seen = new Set<any>();
  const collect = (obj: any) => {
    if (obj == null || typeof obj !== "object") return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj.errors != null) errors.push(...normalizeList(obj.errors));
    if (obj.warnings != null) warnings.push(...normalizeList(obj.warnings));
  };
  collect(data);
  collect(data.result);
  collect(data.reason2);
  // `reason` may be a category label ("compile_error") or a free-text
  // error string. Treat it as a per-error message only when no structured
  // errors are already populated by `errors`/`reason2.errors`. This avoids
  // duplicating the canonical structured diagnostic with a label string.
  if (data.reason != null && typeof data.reason !== "object" && errors.length === 0) {
    errors.push(...normalizeList(data.reason));
  } else if (data.reason && typeof data.reason === "object") {
    collect(data.reason);
  }
  const success = data.success !== false && errors.length === 0;
  return { success, errors, warnings, data: (data.result ?? data) as T, raw: data };
};

// ----- GET endpoints -------------------------------------------------------

export const getScriptInfo = async (
  ctx: PineCallContext,
  pineId: string,
): Promise<PineScriptInfo> => {
  if (!pineId) throw new Error("pineId required");
  const params = new URLSearchParams({ pine_id: pineId });
  const url = `${PINE_FACADE}/pine-facade/get_script_info/?${params.toString()}`;
  const data = await fetchJson(
    url,
    { method: "GET", headers: cookieHeader(ctx.sessionId, ctx.sessionSign) },
    "GET get_script_info",
  );
  return {
    userId: data?.userId,
    userName: data?.userName,
    chartImageUrl: data?.chartImageUrl,
    raw: data,
  };
};

export const getVersionsLast = async (
  ctx: PineCallContext,
  pineId: string,
): Promise<PineVersion> => {
  if (!pineId) throw new Error("pineId required");
  const url = `${PINE_FACADE}/pine-facade/versions/${encodeURIComponent(pineId)}/last`;
  const data = await fetchJson(
    url,
    { method: "GET", headers: cookieHeader(ctx.sessionId, ctx.sessionSign) },
    "GET versions/last",
  );
  const entry = Array.isArray(data) ? data[0] : data;
  if (!entry || entry.version == null) {
    throw new Error("versions/last returned no version");
  }
  return { version: String(entry.version), created: entry.created };
};

/**
 * Lead route per recon §1, §7. The HAR never captured an `/all` response, so
 * a 404 (or 405) falls back to `/last` and returns a single-element array.
 */
export const getVersionsAll = async (
  ctx: PineCallContext,
  pineId: string,
): Promise<PineVersion[]> => {
  if (!pineId) throw new Error("pineId required");
  const url = `${PINE_FACADE}/pine-facade/versions/${encodeURIComponent(pineId)}/all`;
  const resp = await fetch(url, {
    method: "GET",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  if (resp.status === 404 || resp.status === 405) {
    const last = await getVersionsLast(ctx, pineId);
    return [last];
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GET versions/all failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  const data: any = await resp.json();
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((entry) => ({
    version: String(entry.version),
    created: entry.created,
  }));
};

export const isAuthToGet = async (
  ctx: PineCallContext,
  pineId: string,
  version: string,
): Promise<PineAuthCheck> => {
  if (!pineId) throw new Error("pineId required");
  if (!version) throw new Error("version required");
  const url = `${PINE_FACADE}/pine-facade/is_auth_to_get/${encodeURIComponent(pineId)}/${encodeURIComponent(version)}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GET is_auth_to_get failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  const text = (await resp.text()).trim().toLowerCase();
  return { authorized: text === "true", raw: text };
};

export const listPineScripts = async (
  ctx: PineCallContext | null,
  filter: string,
): Promise<PineListItem[]> => {
  if (!filter) throw new Error("filter required");
  if (!isAllowedFilter(filter)) {
    const err: any = new Error(
      `filter not in allowlist (got '${filter}'; allowed: ${FILTER_ALLOWLIST.join(", ")})`,
    );
    err.status = 400;
    err.code = "filter_not_allowed";
    throw err;
  }
  const params = new URLSearchParams({ filter });
  const url = `${PINE_FACADE}/pine-facade/list?${params.toString()}`;
  const headers: Record<string, string> = {};
  if (ctx?.sessionId) Object.assign(headers, cookieHeader(ctx.sessionId, ctx.sessionSign));
  const data = await fetchJson(url, { method: "GET", headers }, "GET pine-facade/list");
  if (!Array.isArray(data)) return [];
  return data.map((entry: any) => ({
    scriptName: entry.scriptName,
    scriptIdPart: entry.scriptIdPart,
    userId: entry.userId,
    version: entry.version != null ? String(entry.version) : undefined,
    scriptAccess: entry.scriptAccess,
    extra: entry.extra,
    lastVersionMaj: entry.lastVersionMaj,
    raw: entry,
  }));
};

// ----- POST endpoints ------------------------------------------------------

const formPost = async (
  ctx: PineCallContext,
  url: string,
  body: URLSearchParams,
  route: string,
): Promise<any> => {
  return fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...cookieHeader(ctx.sessionId, ctx.sessionSign),
      },
      body: body.toString(),
    },
    route,
  );
};

const jsonPost = async (
  ctx: PineCallContext,
  url: string,
  payload: any,
  route: string,
): Promise<any> => {
  return fetchJson(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...cookieHeader(ctx.sessionId, ctx.sessionSign),
      },
      body: JSON.stringify(payload),
    },
    route,
  );
};

export const savePineScript = async (
  ctx: PineCallContext,
  req: PineSaveRequest,
): Promise<PineSaveResult> => {
  if (!req?.source) throw new Error("source required");
  const params = new URLSearchParams();
  let path: string;
  switch (req.mode) {
    case "new": {
      if (!req.name) throw new Error("name required for save/new");
      params.set("name", req.name);
      if (req.allowOverwrite != null) params.set("allow_overwrite", String(req.allowOverwrite));
      path = "save/new";
      break;
    }
    case "next": {
      if (!req.id) throw new Error("id required for save/next");
      if (req.name) params.set("name", req.name);
      if (req.allowCreateNew != null) params.set("allow_create_new", String(req.allowCreateNew));
      path = `save/next/${encodeURIComponent(req.id)}`;
      break;
    }
    case "new_draft": {
      if (req.allowUseExistingDraft != null) {
        params.set("allow_use_existing_draft", String(req.allowUseExistingDraft));
      }
      path = "save/new_draft";
      break;
    }
    case "next_draft": {
      if (!req.id) throw new Error("id required for save/next_draft");
      if (req.allowCreateNew != null) params.set("allow_create_new", String(req.allowCreateNew));
      path = `save/next_draft/${encodeURIComponent(req.id)}`;
      break;
    }
    default: {
      throw new Error(`unknown save mode: ${(req as any).mode}`);
    }
  }
  const qs = params.toString();
  const url = `${PINE_FACADE}/pine-facade/${path}${qs ? `?${qs}` : ""}`;
  const body = new URLSearchParams({ source: req.source });
  const data = await formPost(ctx, url, body, `POST ${path}`);
  const env = normalizeEnvelope(data);
  return {
    ...env,
    scriptIdPart: data?.scriptIdPart ?? data?.result?.scriptIdPart ?? data?.metaInfo?.scriptIdPart,
    version: data?.version ?? data?.result?.version,
    metaInfo: data?.metaInfo ?? data?.result?.metaInfo,
  };
};

export const publishPineScript = async (
  ctx: PineCallContext,
  req: PinePublishRequest,
): Promise<PinePublishResult> => {
  if (!req?.source) throw new Error("source required");
  const params = new URLSearchParams();
  let path: string;
  if (req.mode === "new") {
    if (req.access) params.set("access", req.access);
    path = "publish/new/";
  } else if (req.mode === "next") {
    if (!req.id) throw new Error("id required for publish/next");
    path = `publish/next/${encodeURIComponent(req.id)}`;
  } else {
    throw new Error(`unknown publish mode: ${(req as any).mode}`);
  }
  if (req.name) params.set("name", req.name);
  const qs = params.toString();
  const url = `${PINE_FACADE}/pine-facade/${path}${qs ? `?${qs}` : ""}`;
  const body = new URLSearchParams({ source: req.source });
  if (req.extra) body.set("extra", JSON.stringify(req.extra));
  const data = await formPost(ctx, url, body, `POST ${path}`);
  const env = normalizeEnvelope(data);
  return {
    ...env,
    scriptIdPart: data?.scriptIdPart ?? data?.result?.scriptIdPart,
    version: data?.version ?? data?.result?.version,
  };
};

export const deletePineScript = async (
  ctx: PineCallContext,
  id: string,
): Promise<PineNormalizedEnvelope> => {
  if (!id) throw new Error("id required");
  const url = `${PINE_FACADE}/pine-facade/delete/${encodeURIComponent(id)}`;
  const data = await formPost(ctx, url, new URLSearchParams(), `POST delete/${id}`);
  return normalizeEnvelope(data);
};

export const renamePineScript = async (
  ctx: PineCallContext,
  req: PineRenameRequest,
): Promise<PineNormalizedEnvelope> => {
  if (!req?.id) throw new Error("id required");
  if (!req?.name) throw new Error("name required");
  const params = new URLSearchParams({ name: req.name });
  if (req.force != null) params.set("force", String(req.force));
  const url = `${PINE_FACADE}/pine-facade/rename/${encodeURIComponent(req.id)}?${params.toString()}`;
  const data = await formPost(ctx, url, new URLSearchParams(), `POST rename/${req.id}`);
  return normalizeEnvelope(data);
};

export const copyPineScript = async (
  ctx: PineCallContext,
  req: PineCopyRequest,
): Promise<PineNormalizedEnvelope & { scriptIdPart?: string }> => {
  if (!req?.id) throw new Error("id required");
  const params = new URLSearchParams();
  if (req.name) params.set("name", req.name);
  const qs = params.toString();
  const url = `${PINE_FACADE}/pine-facade/copy/${encodeURIComponent(req.id)}${qs ? `?${qs}` : ""}`;
  const data = await formPost(ctx, url, new URLSearchParams(), `POST copy/${req.id}`);
  const env = normalizeEnvelope(data);
  return {
    ...env,
    scriptIdPart: data?.scriptIdPart ?? data?.result?.scriptIdPart,
  };
};

export const convertPineScript = async (
  ctx: PineCallContext,
  req: PineConvertRequest,
): Promise<PineConvertResult> => {
  if (!req?.source) throw new Error("source required");
  if (!req?.version_to) throw new Error("version_to required");
  const url = `${PINE_FACADE}/pine-facade/convert`;
  const body = new URLSearchParams({ source: req.source, version_to: req.version_to });
  const data = await formPost(ctx, url, body, "POST convert");
  const env = normalizeEnvelope(data);
  return { ...env, source: data?.source ?? data?.result?.source };
};

export const parsePineTitle = async (
  ctx: PineCallContext,
  source: string,
): Promise<PineParseTitleResult> => {
  if (!source) throw new Error("source required");
  const url = `${PINE_FACADE}/pine-facade/parse_title`;
  const body = new URLSearchParams({ source });
  const data = await formPost(ctx, url, body, "POST parse_title");
  const env = normalizeEnvelope(data);
  const payload = data?.result ?? data ?? {};
  return {
    ...env,
    title: payload.title ?? payload.scriptName,
    shortTitle: payload.shortTitle ?? payload.short_title,
    scriptKind: payload.scriptKind ?? payload.kind,
  };
};

export const translateLightSource = async (
  ctx: PineCallContext,
  pineId: string,
  version: string,
): Promise<PineTranslateLightResult> => {
  if (!pineId) throw new Error("pineId required");
  if (!version) throw new Error("version required");
  const url = `${PINE_FACADE}/pine-facade/translate-light-source/${encodeURIComponent(pineId)}/${encodeURIComponent(version)}`;
  const data = await fetchJson(
    url,
    { method: "GET", headers: cookieHeader(ctx.sessionId, ctx.sessionSign) },
    `GET translate-light-source/${pineId}/${version}`,
  );
  const env = normalizeEnvelope(data);
  const payload = data?.result ?? data ?? {};
  return {
    ...env,
    source: payload.source,
    metaInfo: payload.metaInfo,
    ilTemplate: payload.ilTemplate,
  };
};

export const genPineAlert = async (
  ctx: PineCallContext,
  req: PineGenAlertRequest,
): Promise<PineGenAlertResult> => {
  const url = `${PINE_FACADE}/pine-facade/gen_alert/`;
  const payload: Record<string, any> = {};
  if (req.alert_info != null) payload.alert_info = req.alert_info;
  if (req.source != null) payload.source = req.source;
  if (req.inputs != null) payload.inputs = req.inputs;
  const data = await jsonPost(ctx, url, payload, "POST gen_alert");
  const env = normalizeEnvelope(data);
  return {
    ...env,
    alert_info: data?.alert_info ?? data?.result?.alert_info,
  };
};

// ----- Re-exports for convenience -----------------------------------------

export const PINE_LIST_FILTERS = FILTER_ALLOWLIST;
