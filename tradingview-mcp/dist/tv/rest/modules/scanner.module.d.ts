import type { ScanFilter, ScanResult, ScannerMetainfoResult, ScannerEnumOrderedResult } from '../../types.js';
import { BaseModule } from '../base-module.js';
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
export declare class ScannerModule extends BaseModule {
    request(opts: ScannerRequestOptions): Promise<unknown>;
    scan(opts: ScanOptions): Promise<ScanResult>;
    getMetainfo(opts: MetainfoOptions): Promise<ScannerMetainfoResult>;
    getEnumOrdered(opts: EnumOptions): Promise<ScannerEnumOrderedResult>;
}
//# sourceMappingURL=scanner.module.d.ts.map