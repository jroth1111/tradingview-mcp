import type { IndicatorMeta, IndicatorSearchResult } from '../../types.js';
import { BaseModule } from '../base-module.js';
export interface PrivateIndicator {
    id: string;
    version: string;
    name: string;
    title: string;
    modified: number;
    type: string;
    sourceInputsCount?: number;
}
export declare class IndicatorsModule extends BaseModule {
    search(query: string): Promise<IndicatorSearchResult[]>;
    getMeta(id: string, version?: string): Promise<IndicatorMeta>;
    getPrivate(): Promise<PrivateIndicator[]>;
}
//# sourceMappingURL=indicators.module.d.ts.map