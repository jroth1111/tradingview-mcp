import type { ScanFilter, ScanResult, ScannerEnumOrderedResult, ScannerMetainfoResult } from '../types.js';
import type { TVRestClient } from './types.js';
export interface ScannerRequestOptions {
    path: string;
    method?: "GET" | "POST";
    query?: Record<string, unknown>;
    payload?: unknown;
}
export interface ScanOptions {
    market?: string;
    symbols?: string[];
    filter?: ScanFilter[];
    columns?: string[];
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    limit?: number;
    labelProduct?: string;
}
export interface MetainfoOptions {
    market?: string;
    labelProduct?: string;
    payload?: unknown;
}
export interface EnumOptions {
    ids: string[];
    lang?: string;
    labelProduct?: string;
}
export declare function scannerRequest(client: TVRestClient, opts: ScannerRequestOptions): Promise<unknown>;
export declare function scan(client: TVRestClient, opts: ScanOptions): Promise<ScanResult>;
export declare function getScannerMetainfo(client: TVRestClient, opts: MetainfoOptions): Promise<ScannerMetainfoResult>;
export declare function getScannerEnumOrdered(client: TVRestClient, opts: EnumOptions): Promise<ScannerEnumOrderedResult>;
//# sourceMappingURL=scanner.d.ts.map