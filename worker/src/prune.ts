import type { MetaRecord } from "./cache";

const TOTALS_KEY = "_cache:totals";

export const pruneCache = async (kv: KVNamespace, bucket: R2Bucket, maxTotalBytes: number) => {
  if (!maxTotalBytes || maxTotalBytes <= 0) return { pruned: 0, totalBytes: 0 };
  const totals = await kv.get<{ approx_bytes?: number }>(TOTALS_KEY, { type: "json" });
  const current = totals?.approx_bytes || 0;
  if (current <= maxTotalBytes) return { pruned: 0, totalBytes: current };

  const metas = await kv.list({ prefix: "meta:" });
  const items: { key: string; ts: number; approx: number }[] = [];
  for (const k of metas.keys) {
    const rec = await kv.get<MetaRecord>(k.name, { type: "json" });
    if (!rec) continue;
    const ts = rec.last_accessed ? Date.parse(rec.last_accessed) : rec.last_updated ? Date.parse(rec.last_updated) : 0;
    items.push({ key: k.name, ts, approx: rec.approx_bytes || 0 });
  }
  items.sort((a, b) => a.ts - b.ts);

  let running = current;
  let pruned = 0;
  for (const item of items) {
    if (running <= maxTotalBytes) break;
    const parts = item.key.split(":");
    const sym = parts[1];
    const tf = parts[2];
    await kv.delete(item.key);
    await kv.delete(`hot:${sym}:${tf}`);
    const prefix = `candles/${sym}/${tf}/`;
    const listed = await bucket.list({ prefix });
    for (const obj of listed.objects || []) {
      if (obj?.key) await bucket.delete(obj.key);
    }
    running -= item.approx;
    pruned += 1;
  }
  await kv.put(TOTALS_KEY, JSON.stringify({ approx_bytes: running }));
  return { pruned, totalBytes: running };
};
