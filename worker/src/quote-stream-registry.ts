// Quote-stream registry (Slice F / tradingview-1nt).
//
// KV-backed concurrent-stream registry for the per-HMAC-client quota gate.
// Worker calls into this on /v1/quotes/stream/subscribe and /close; the
// registry enforces MAX_STREAMS_PER_HMAC_CLIENT and lazily GCs entries
// that have been idle past IDLE_STREAM_AUTO_CLOSE + grace.
//
// KV consistency note: KV doesn't expose CAS so concurrent /subscribe calls
// can race past the cap. The cap is a courtesy quota (DoS guard, not a
// security boundary), so a brief race window allowing a 6th stream is
// acceptable; lazy GC + the DO's own idle-alarm cleanup converge state
// quickly.
//
// Single-tenant deployment: HMAC_CLIENT_ID is currently per-Worker-deploy,
// so the cap effectively applies to "this Worker" — adequate for the
// current self-hosted topology. If the Worker grows multi-tenant, swap
// hmacClient out for a per-client identity without changing the registry
// shape.

const REGISTRY_KEY = "quotes:active-streams";

export const MAX_SYMBOLS_PER_STREAM_DEFAULT = 100;
export const MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT = 5;
export const IDLE_STREAM_AUTO_CLOSE_MS = 5 * 60 * 1000;
const IDLE_GC_GRACE_MS = 30 * 1000;

export interface RegistryEntry {
  hmacClient: string;
  registeredAt: number;
  lastSeen: number;
}

export interface Registry {
  [streamId: string]: RegistryEntry;
}

const loadRegistry = async (kv: KVNamespace): Promise<Registry> => {
  const raw = await kv.get<Registry>(REGISTRY_KEY, { type: "json" });
  return raw ?? {};
};

const saveRegistry = async (kv: KVNamespace, reg: Registry): Promise<void> => {
  await kv.put(REGISTRY_KEY, JSON.stringify(reg));
};

const gcRegistry = (reg: Registry, now: number): Registry => {
  const cutoff = now - (IDLE_STREAM_AUTO_CLOSE_MS + IDLE_GC_GRACE_MS);
  const next: Registry = {};
  for (const [streamId, entry] of Object.entries(reg)) {
    if (entry.lastSeen >= cutoff) next[streamId] = entry;
  }
  return next;
};

export const countActiveForClient = (reg: Registry, hmacClient: string): number =>
  Object.values(reg).filter((e) => e.hmacClient === hmacClient).length;

export interface RegisterArgs {
  kv: KVNamespace;
  hmacClient: string;
  streamId: string;
  maxStreamsPerClient?: number;
  now?: number;
}

export interface RegisterResult {
  ok: boolean;
  active: number;
  limit: number;
  reason?: "quota_exceeded";
}

export const registerStream = async (args: RegisterArgs): Promise<RegisterResult> => {
  const now = args.now ?? Date.now();
  const limit = args.maxStreamsPerClient ?? MAX_STREAMS_PER_HMAC_CLIENT_DEFAULT;
  const current = await loadRegistry(args.kv);
  const pruned = gcRegistry(current, now);
  const active = countActiveForClient(pruned, args.hmacClient);
  if (active >= limit) {
    if (Object.keys(pruned).length !== Object.keys(current).length) {
      await saveRegistry(args.kv, pruned);
    }
    return { ok: false, active, limit, reason: "quota_exceeded" };
  }
  pruned[args.streamId] = {
    hmacClient: args.hmacClient,
    registeredAt: now,
    lastSeen: now,
  };
  await saveRegistry(args.kv, pruned);
  return { ok: true, active: active + 1, limit };
};

export const touchStream = async (
  kv: KVNamespace,
  streamId: string,
  now: number = Date.now(),
): Promise<void> => {
  const reg = await loadRegistry(kv);
  const entry = reg[streamId];
  if (!entry) return;
  entry.lastSeen = now;
  await saveRegistry(kv, reg);
};

export const releaseStream = async (kv: KVNamespace, streamId: string): Promise<void> => {
  const reg = await loadRegistry(kv);
  if (!(streamId in reg)) return;
  delete reg[streamId];
  await saveRegistry(kv, reg);
};

export const lookupStream = async (
  kv: KVNamespace,
  streamId: string,
): Promise<RegistryEntry | null> => {
  const reg = await loadRegistry(kv);
  return reg[streamId] ?? null;
};

export const _registryKey = REGISTRY_KEY;
