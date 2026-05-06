// Alerts CRUD (P6)
// Surface: https://pricealerts.tradingview.com
//   - All POST routes wrap the body as {"payload":<obj>}
//   - Query string carries log_username + maintenance_unset_reason on every call,
//     plus build_time on POST and user_id on GET /list_alerts.
//   - Response envelope is {s:"ok"|"error", id?, r?}.
//   - alerts.tradingview.com/alerts/health/ is legacy healthcheck only — use
//     /is_alive on pricealerts to liveness-check.

const PRICEALERTS = "https://pricealerts.tradingview.com";

const cookieHeader = (sessionId: string, sessionSign?: string): Record<string, string> => ({
  cookie: sessionSign
    ? `sessionid=${sessionId};sessionid_sign=${sessionSign}`
    : `sessionid=${sessionId}`,
});

const buildQuery = (
  username: string,
  extras: Record<string, string | number | undefined>,
): string => {
  const params = new URLSearchParams();
  params.set("log_username", username);
  params.set("maintenance_unset_reason", "");
  for (const [k, v] of Object.entries(extras)) {
    if (v != null) params.set(k, String(v));
  }
  return params.toString();
};

const readEnvelope = async (resp: Response, route: string): Promise<any> => {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${route} failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  const data: any = await resp.json();
  if (data && data.s === "error") {
    const err = new Error(`${route} error: ${data.r ?? "unknown"}`);
    (err as any).envelope = data;
    throw err;
  }
  return data;
};

interface AlertCallContext {
  sessionId: string;
  sessionSign?: string;
  username: string;
}

const postAlerts = async (
  ctx: AlertCallContext,
  path: string,
  payload: any,
): Promise<any> => {
  const qs = buildQuery(ctx.username, { build_time: Date.now() });
  const resp = await fetch(`${PRICEALERTS}${path}?${qs}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...cookieHeader(ctx.sessionId, ctx.sessionSign),
    },
    body: JSON.stringify({ payload }),
  });
  return readEnvelope(resp, `POST ${path}`);
};

const getAlerts = async (
  ctx: AlertCallContext,
  path: string,
  extras: Record<string, string | number | undefined> = {},
): Promise<any> => {
  const qs = buildQuery(ctx.username, extras);
  const resp = await fetch(`${PRICEALERTS}${path}?${qs}`, {
    method: "GET",
    headers: cookieHeader(ctx.sessionId, ctx.sessionSign),
  });
  return readEnvelope(resp, `GET ${path}`);
};

// Health probe — does NOT require auth in practice but accepts a session.
export const isAlertsAlive = async (sessionId?: string, sessionSign?: string): Promise<any> => {
  const headers: Record<string, string> = {};
  if (sessionId) Object.assign(headers, cookieHeader(sessionId, sessionSign));
  const resp = await fetch(`${PRICEALERTS}/is_alive`, { headers });
  if (!resp.ok) throw new Error(`is_alive failed: ${resp.status} ${resp.statusText}`);
  // Some responses are plain text "true"/"OK"; accept either JSON or text.
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { alive: text.trim() };
  }
};

export const listAlerts = async (
  ctx: AlertCallContext,
  userId: string | number,
): Promise<any> => getAlerts(ctx, "/list_alerts", { user_id: userId });

export const getAlertsBatch = async (ctx: AlertCallContext, alertIds: number[]): Promise<any> =>
  postAlerts(ctx, "/get_alerts", { alerts: alertIds });

export const createAlert = async (ctx: AlertCallContext, alert: any): Promise<any> =>
  postAlerts(ctx, "/create_alert", alert);

export const modifyRestartAlert = async (
  ctx: AlertCallContext,
  alert: any & { alert_id: number },
): Promise<any> => postAlerts(ctx, "/modify_restart_alert", alert);

export const deleteAlerts = async (ctx: AlertCallContext, alertIds: number[]): Promise<any> =>
  postAlerts(ctx, "/delete_alerts", { alerts: alertIds });

export const stopAlerts = async (ctx: AlertCallContext, alertIds: number[]): Promise<any> =>
  postAlerts(ctx, "/stop_alerts", { alerts: alertIds });

export const restartAlerts = async (ctx: AlertCallContext, alertIds: number[]): Promise<any> =>
  postAlerts(ctx, "/restart_alerts", { alerts: alertIds });

export const cloneAlerts = async (ctx: AlertCallContext, alertIds: number[]): Promise<any> =>
  postAlerts(ctx, "/clone_alerts", { alerts: alertIds });

export const listFires = async (
  ctx: AlertCallContext,
  body: { limit?: number; alert_id?: number; before_time?: number },
): Promise<any> => postAlerts(ctx, "/list_fires", { limit: body.limit ?? 100, ...body });

export const deleteFires = async (ctx: AlertCallContext, fireIds: number[]): Promise<any> =>
  postAlerts(ctx, "/delete_fires", { fires: fireIds });

export const deleteAllFires = async (ctx: AlertCallContext): Promise<any> =>
  postAlerts(ctx, "/delete_all_fires", {});

export const deleteFiresByFilter = async (
  ctx: AlertCallContext,
  body: { alert_id?: number; before_time?: number },
): Promise<any> => postAlerts(ctx, "/delete_fires_by_filter", body);

export const getOfflineFires = async (
  ctx: AlertCallContext,
  limit?: number,
): Promise<any> => postAlerts(ctx, "/get_offline_fires", { limit: limit ?? 2000 });

export const getOfflineFireControls = async (ctx: AlertCallContext): Promise<any> =>
  postAlerts(ctx, "/get_offline_fire_controls", {});

export const clearOfflineFires = async (
  ctx: AlertCallContext,
  payloads: any[],
): Promise<any> => postAlerts(ctx, "/clear_offline_fires", { payloads });

export const clearOfflineFireControls = async (
  ctx: AlertCallContext,
  payloads: any[],
): Promise<any> => postAlerts(ctx, "/clear_offline_fire_controls", { payloads });

// === Pine alert two-phase create ===
// Phase 1: pine-facade/gen_alert/ produces an alert_info object.
// Phase 2: pricealerts/create_alert with condition.type:"pine_alert" + alert_info.

export const generatePineAlert = async (
  sessionId: string,
  sessionSign: string | undefined,
  alertInfo: any,
): Promise<any> => {
  const resp = await fetch("https://pine-facade.tradingview.com/pine-facade/gen_alert/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...cookieHeader(sessionId, sessionSign),
    },
    body: JSON.stringify({ alert_info: alertInfo }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`gen_alert failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ""}`);
  }
  return resp.json();
};
