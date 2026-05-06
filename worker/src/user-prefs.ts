// User preferences (favorites/recents/saved-screens) — semantic helpers
// over the existing TVSettings backend (see worker/src/templates.ts: loadSettings,
// saveSettings → upstream /loadsettings/ and /savesettings/).
//
// TVSettings shape (recon agents/17-templates-favorites.md §10, §4):
//   { chart: { favoriteLibraryIndicators: [], favoriteDrawingTools: [] },
//     StudyTemplates: { recent: [] },
//     screener: { savedScreens: [] } }
//
// /savesettings/ accepts FormData {delta:JSON.stringify(<partial nested>)} and
// merges shallowly per top-level namespace. We therefore do a load → mutate →
// save round-trip per call so we always submit the full sub-tree we touched
// (otherwise a shallow merge by namespace can drop sibling keys we did not
// re-send). Recent capacity-5 dedup is per recon §5.
//
// saved_screens path (screener.savedScreens) is a LEAD per agents/07-watchlists.md
// §5 — endpoint not present in any captured bundle. Verify against a real
// /loadsettings/ response before relying on it for production routing.

import { loadSettings, saveSettings } from "./templates";

export interface UserPrefsContext {
  sessionId: string;
  sessionSign?: string;
}

export interface FavoriteIndicator {
  id: string;
}

export interface FavoriteDrawing {
  id: string;
}

export interface RecentTemplate {
  id: string | number;
}

export interface SavedScreen {
  name: string;
  market?: string;
  columns?: string[];
  filter?: any;
  [key: string]: any;
}

export interface UserPrefs {
  chart?: {
    favoriteLibraryIndicators?: string[];
    favoriteDrawingTools?: string[];
    [key: string]: any;
  };
  StudyTemplates?: {
    recent?: Array<string | number>;
    [key: string]: any;
  };
  screener?: {
    savedScreens?: SavedScreen[];
    [key: string]: any;
  };
  [key: string]: any;
}

const RECENTS_CAP = 5;

const ensureId = (id: unknown, label = "id"): string => {
  if (id == null) throw new Error(`${label} required`);
  if (typeof id === "string") {
    if (!id.length) throw new Error(`${label} required`);
    return id;
  }
  if (typeof id === "number") return String(id);
  throw new Error(`${label} must be a string or number`);
};

const ensureName = (name: unknown): string => {
  if (typeof name !== "string" || !name.length) {
    throw new Error("name required");
  }
  return name;
};

// /loadsettings/ may return either the merged settings object directly or
// {settings: {…}} / {result: {…}} envelope variants seen across recon. Be
// permissive and unwrap the first plain object that looks like the namespaced
// settings tree. Empty / null is a valid first-write state.
const unwrapSettings = (raw: any): UserPrefs => {
  if (!raw || typeof raw !== "object") return {};
  if (raw.chart || raw.StudyTemplates || raw.screener) return raw as UserPrefs;
  if (raw.settings && typeof raw.settings === "object") return raw.settings as UserPrefs;
  if (raw.result && typeof raw.result === "object") return raw.result as UserPrefs;
  return raw as UserPrefs;
};

export const getRawPrefs = async (ctx: UserPrefsContext): Promise<UserPrefs> => {
  const raw = await loadSettings(ctx);
  return unwrapSettings(raw);
};

// ---------- chart.favoriteLibraryIndicators ----------

export const listFavoriteIndicators = async (
  ctx: UserPrefsContext,
): Promise<string[]> => {
  const prefs = await getRawPrefs(ctx);
  return Array.isArray(prefs.chart?.favoriteLibraryIndicators)
    ? (prefs.chart!.favoriteLibraryIndicators as string[]).slice()
    : [];
};

export const addFavoriteIndicator = async (
  ctx: UserPrefsContext,
  id: string,
): Promise<{ favorites: string[]; result: any }> => {
  const safeId = ensureId(id);
  const current = await listFavoriteIndicators(ctx);
  const next = current.includes(safeId) ? current : [...current, safeId];
  const result = await saveSettings(ctx, {
    chart: { favoriteLibraryIndicators: next },
  });
  return { favorites: next, result };
};

export const removeFavoriteIndicator = async (
  ctx: UserPrefsContext,
  id: string,
): Promise<{ favorites: string[]; result: any }> => {
  const safeId = ensureId(id);
  const current = await listFavoriteIndicators(ctx);
  const next = current.filter((x) => x !== safeId);
  const result = await saveSettings(ctx, {
    chart: { favoriteLibraryIndicators: next },
  });
  return { favorites: next, result };
};

// ---------- chart.favoriteDrawingTools ----------

export const listFavoriteDrawings = async (
  ctx: UserPrefsContext,
): Promise<string[]> => {
  const prefs = await getRawPrefs(ctx);
  return Array.isArray(prefs.chart?.favoriteDrawingTools)
    ? (prefs.chart!.favoriteDrawingTools as string[]).slice()
    : [];
};

export const addFavoriteDrawing = async (
  ctx: UserPrefsContext,
  id: string,
): Promise<{ favorites: string[]; result: any }> => {
  const safeId = ensureId(id);
  const current = await listFavoriteDrawings(ctx);
  const next = current.includes(safeId) ? current : [...current, safeId];
  const result = await saveSettings(ctx, {
    chart: { favoriteDrawingTools: next },
  });
  return { favorites: next, result };
};

export const removeFavoriteDrawing = async (
  ctx: UserPrefsContext,
  id: string,
): Promise<{ favorites: string[]; result: any }> => {
  const safeId = ensureId(id);
  const current = await listFavoriteDrawings(ctx);
  const next = current.filter((x) => x !== safeId);
  const result = await saveSettings(ctx, {
    chart: { favoriteDrawingTools: next },
  });
  return { favorites: next, result };
};

// ---------- StudyTemplates.recent (capacity 5, MRU dedup) ----------

export const listRecentStudyTemplates = async (
  ctx: UserPrefsContext,
): Promise<Array<string | number>> => {
  const prefs = await getRawPrefs(ctx);
  return Array.isArray(prefs.StudyTemplates?.recent)
    ? (prefs.StudyTemplates!.recent as Array<string | number>).slice()
    : [];
};

export const addRecentStudyTemplate = async (
  ctx: UserPrefsContext,
  id: string | number,
): Promise<{ recents: Array<string | number>; result: any }> => {
  if (id == null || (typeof id !== "string" && typeof id !== "number")) {
    throw new Error("id required");
  }
  if (typeof id === "string" && !id.length) throw new Error("id required");
  const current = await listRecentStudyTemplates(ctx);
  const recents = current.filter((x) => x !== id);
  recents.unshift(id);
  if (recents.length > RECENTS_CAP) recents.length = RECENTS_CAP;
  const result = await saveSettings(ctx, {
    StudyTemplates: { recent: recents },
  });
  return { recents, result };
};

// ---------- screener.savedScreens (LEAD path; verify in residual capture) ----------

export const listSavedScreens = async (
  ctx: UserPrefsContext,
): Promise<SavedScreen[]> => {
  const prefs = await getRawPrefs(ctx);
  return Array.isArray(prefs.screener?.savedScreens)
    ? (prefs.screener!.savedScreens as SavedScreen[]).slice()
    : [];
};

export const saveScreen = async (
  ctx: UserPrefsContext,
  screen: SavedScreen,
): Promise<{ screens: SavedScreen[]; result: any }> => {
  const name = ensureName(screen?.name);
  const entry: SavedScreen = {
    name,
    ...(screen.market !== undefined ? { market: screen.market } : {}),
    ...(screen.columns !== undefined ? { columns: screen.columns } : {}),
    ...(screen.filter !== undefined ? { filter: screen.filter } : {}),
  };
  // Preserve any extra fields the caller passed (forward-compat with upstream
  // additions) while still letting our typed slots dominate name conflicts.
  const merged: SavedScreen = { ...screen, ...entry };
  const current = await listSavedScreens(ctx);
  const without = current.filter((s) => s?.name !== name);
  const next = [...without, merged];
  const result = await saveSettings(ctx, {
    screener: { savedScreens: next },
  });
  return { screens: next, result };
};

export const deleteSavedScreen = async (
  ctx: UserPrefsContext,
  name: string,
): Promise<{ screens: SavedScreen[]; result: any }> => {
  const safeName = ensureName(name);
  const current = await listSavedScreens(ctx);
  const next = current.filter((s) => s?.name !== safeName);
  const result = await saveSettings(ctx, {
    screener: { savedScreens: next },
  });
  return { screens: next, result };
};
