import type { IndicatorMeta, IndicatorSearchResult } from '../types.js';
import type { TVRestClient } from './types.js';
export interface PrivateIndicator {
    id: string;
    version: string;
    name: string;
    access: string;
    type: string;
}
export declare function searchIndicators(client: TVRestClient, query: string): Promise<IndicatorSearchResult[]>;
export declare function getIndicatorMeta(client: TVRestClient, id: string, version?: string): Promise<IndicatorMeta>;
export declare function getPrivateIndicators(client: TVRestClient): Promise<PrivateIndicator[]>;
//# sourceMappingURL=indicators.d.ts.map