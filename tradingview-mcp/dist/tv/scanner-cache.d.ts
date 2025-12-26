import type { ScannerCacheManifest, ScannerEnumValuesResult, ScannerManifestSummaryResult, ScannerFiltersResult } from "./types.js";
export declare function loadScannerManifest(manifestPath?: string): Promise<ScannerCacheManifest>;
export declare function getScannerManifestSummary(opts?: {
    manifestPath?: string;
}): Promise<ScannerManifestSummaryResult>;
export declare function getScannerFiltersFromCache(opts?: {
    labelProduct?: string;
    market?: string;
    includeEnumValues?: boolean;
    includeRaw?: boolean;
    pattern?: string;
    fields?: string[];
    limit?: number;
    offset?: number;
    summary?: boolean;
    manifestPath?: string;
}): Promise<ScannerFiltersResult>;
export declare function getScannerEnumValuesFromCache(opts: {
    labelProduct?: string;
    enumIds: string[];
    pattern?: string;
    limit?: number;
    offset?: number;
    manifestPath?: string;
}): Promise<ScannerEnumValuesResult>;
//# sourceMappingURL=scanner-cache.d.ts.map