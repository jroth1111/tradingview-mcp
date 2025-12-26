// Local cache loader for TradingView scanner metadata/enums.
import { readFile } from "node:fs/promises";
import path from "node:path";
const DEFAULT_MANIFEST_PATH = "data/scanner/manifest.json";
let manifestCache = null;
let manifestPathCache = null;
const metainfoCache = new Map();
const enumCache = new Map();
function resolveManifestPath(manifestPath) {
    const candidate = manifestPath || process.env.SCANNER_CACHE_MANIFEST || DEFAULT_MANIFEST_PATH;
    return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}
async function loadJson(filePath) {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
}
export async function loadScannerManifest(manifestPath) {
    const resolved = resolveManifestPath(manifestPath);
    if (manifestCache && manifestPathCache === resolved) {
        return manifestCache;
    }
    const manifest = await loadJson(resolved);
    manifestCache = manifest;
    manifestPathCache = resolved;
    return manifest;
}
export async function getScannerManifestSummary(opts = {}) {
    const manifestPath = resolveManifestPath(opts.manifestPath);
    const manifest = await loadScannerManifest(manifestPath);
    const items = Object.entries(manifest)
        .map(([labelProduct, entry]) => ({
        labelProduct,
        markets: entry.markets,
        metainfoMarkets: Object.keys(entry.metainfo),
        hasEnumOrdered: !!entry.enumOrdered,
    }))
        .sort((a, b) => a.labelProduct.localeCompare(b.labelProduct));
    return {
        manifestPath,
        items,
        count: items.length,
    };
}
function getManifestEntry(manifest, labelProduct) {
    const entry = manifest[labelProduct];
    if (!entry) {
        const known = Object.keys(manifest).sort().join(", ");
        throw new Error(`Unknown labelProduct "${labelProduct}". Known: ${known}`);
    }
    return entry;
}
async function loadMetainfo(filePath) {
    const cached = metainfoCache.get(filePath);
    if (cached)
        return cached;
    const data = await loadJson(filePath);
    metainfoCache.set(filePath, data);
    return data;
}
async function loadEnumOrdered(filePath) {
    const cached = enumCache.get(filePath);
    if (cached)
        return cached;
    const data = await loadJson(filePath);
    enumCache.set(filePath, data);
    return data;
}
export async function getScannerFiltersFromCache(opts = {}) {
    const manifest = await loadScannerManifest(opts.manifestPath);
    const labelProduct = opts.labelProduct || "screener-stock";
    const entry = getManifestEntry(manifest, labelProduct);
    const market = opts.market || entry.markets[0];
    if (!market || !entry.metainfo[market]) {
        const available = Object.keys(entry.metainfo).sort().join(", ");
        throw new Error(`Unknown market "${market}" for "${labelProduct}". Available: ${available}`);
    }
    const manifestPath = resolveManifestPath(opts.manifestPath);
    const manifestDir = path.dirname(manifestPath);
    const metainfoPath = path.resolve(manifestDir, entry.metainfo[market]);
    const enumOrderedPath = entry.enumOrdered
        ? path.resolve(manifestDir, entry.enumOrdered)
        : null;
    const metainfo = await loadMetainfo(metainfoPath);
    const rawFields = Array.isArray(metainfo.fields)
        ? metainfo.fields
        : [];
    const fields = [];
    for (const field of rawFields) {
        const id = typeof field.n === "string"
            ? field.n
            : typeof field.id === "string"
                ? field.id
                : typeof field.name === "string"
                    ? field.name
                    : "";
        if (!id)
            continue;
        const type = typeof field.t === "string" ? field.t : undefined;
        const range = field.r ?? null;
        fields.push({ id, type, range });
    }
    const totalFields = fields.length;
    const fieldMap = new Map(fields.map(field => [field.id, field]));
    const rawPattern = opts.pattern?.trim();
    const pattern = rawPattern ? rawPattern.toLowerCase() : null;
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
    const summary = opts.summary === true;
    let matchedFields = fields;
    let missingFields;
    if (opts.fields?.length) {
        const requested = opts.fields;
        matchedFields = requested.map(id => fieldMap.get(id)).filter(Boolean);
        missingFields = requested.filter(id => !fieldMap.has(id));
    }
    else if (pattern) {
        matchedFields = fields.filter(field => field.id.toLowerCase().includes(pattern));
    }
    const matchedCount = matchedFields.length;
    const slicedFields = summary
        ? []
        : matchedFields.slice(offset, limit ? offset + limit : undefined);
    const returnedFields = slicedFields.length;
    const truncated = !summary && (offset + returnedFields) < matchedCount;
    const enumOrderedData = enumOrderedPath ? await loadEnumOrdered(enumOrderedPath) : null;
    const enums = opts.includeEnumValues ? enumOrderedData : null;
    const hint = truncated
        ? "Results truncated. Use pattern/limit/offset to narrow or paginate."
        : undefined;
    return {
        labelProduct,
        market,
        fields: slicedFields,
        enumIds: enumOrderedData ? Object.keys(enumOrderedData) : [],
        enums,
        totalFields,
        matchedFields: matchedCount,
        returnedFields,
        truncated,
        missingFields: missingFields?.length ? missingFields : undefined,
        hint,
        rawMetainfo: opts.includeRaw ? metainfo : undefined,
        sources: {
            manifestPath,
            metainfoPath,
            enumOrderedPath,
        },
    };
}
export async function getScannerEnumValuesFromCache(opts) {
    if (!opts.enumIds?.length) {
        throw new Error("enumIds required");
    }
    const manifest = await loadScannerManifest(opts.manifestPath);
    const labelProduct = opts.labelProduct || "screener-stock";
    const entry = getManifestEntry(manifest, labelProduct);
    if (!entry.enumOrdered) {
        throw new Error(`No enumOrdered cache for labelProduct "${labelProduct}"`);
    }
    const manifestPath = resolveManifestPath(opts.manifestPath);
    const enumOrderedPath = path.resolve(path.dirname(manifestPath), entry.enumOrdered);
    const enumOrderedData = await loadEnumOrdered(enumOrderedPath);
    const rawPattern = opts.pattern?.trim();
    const pattern = rawPattern ? rawPattern.toLowerCase() : null;
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = opts.limit && opts.limit > 0 ? opts.limit : undefined;
    const enums = {};
    const counts = {};
    for (const enumId of opts.enumIds) {
        const items = enumOrderedData[enumId] || [];
        const matched = pattern
            ? items.filter(item => {
                const name = String(item.name || "").toLowerCase();
                const id = String(item.id || "").toLowerCase();
                return name.includes(pattern) || id.includes(pattern);
            })
            : items;
        const sliced = matched.slice(offset, limit ? offset + limit : undefined);
        enums[enumId] = sliced;
        counts[enumId] = {
            total: items.length,
            matched: matched.length,
            returned: sliced.length,
        };
    }
    const truncated = Object.values(counts).some(count => count.returned < count.matched);
    const hint = truncated
        ? "Enum values truncated. Use pattern/limit/offset to narrow or paginate."
        : undefined;
    return {
        labelProduct,
        enumIds: opts.enumIds,
        enums,
        counts,
        sources: {
            manifestPath,
            enumOrderedPath,
        },
        hint,
    };
}
//# sourceMappingURL=scanner-cache.js.map