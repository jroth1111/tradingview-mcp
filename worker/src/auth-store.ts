export interface StoredSession {
  sessionId: string;
  sessionSign?: string;
  failures?: number;
  blockedUntil?: number;
  updatedAt?: number;
}

const KEY = "auth:session";
const MAX_FAILURES_BEFORE_BLOCK = 3;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export const getStoredSession = async (kv: KVNamespace): Promise<StoredSession | null> => {
  const rec = await kv.get<StoredSession>(KEY, { type: "json" });
  return rec || null;
};

export const setStoredSession = async (
  kv: KVNamespace,
  sessionId: string,
  sessionSign?: string,
): Promise<StoredSession> => {
  const rec: StoredSession = {
    sessionId,
    sessionSign,
    failures: 0,
    blockedUntil: 0,
    updatedAt: Date.now(),
  };
  await kv.put(KEY, JSON.stringify(rec));
  return rec;
};

export const markAuthFailure = async (kv: KVNamespace): Promise<StoredSession | null> => {
  const current = (await getStoredSession(kv)) || undefined;
  if (!current) return null;
  const failures = (current.failures || 0) + 1;
  const blockedUntil =
    failures >= MAX_FAILURES_BEFORE_BLOCK ? Date.now() + BLOCK_DURATION_MS : current.blockedUntil;
  const next: StoredSession = {
    ...current,
    failures,
    blockedUntil,
    updatedAt: Date.now(),
  };
  await kv.put(KEY, JSON.stringify(next));
  return next;
};

export const clearAuthBlock = async (kv: KVNamespace): Promise<StoredSession | null> => {
  const current = await getStoredSession(kv);
  if (!current) return null;
  const next: StoredSession = {
    ...current,
    failures: 0,
    blockedUntil: 0,
    updatedAt: Date.now(),
  };
  await kv.put(KEY, JSON.stringify(next));
  return next;
};

export const isBlocked = (rec: StoredSession | null): boolean =>
  !!rec?.blockedUntil && rec.blockedUntil > Date.now();
