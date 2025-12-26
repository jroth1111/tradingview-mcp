import { BaseModule } from '../base-module.js';
export interface TASummary {
    Other?: number;
    All?: number;
    MA?: number;
}
export declare class TAModule extends BaseModule {
    summary(symbol: string, timeframe?: string): Promise<TASummary>;
}
//# sourceMappingURL=ta.module.d.ts.map