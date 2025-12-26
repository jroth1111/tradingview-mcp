import type { RestContext } from './context.js';
export declare abstract class BaseModule {
    protected ctx: RestContext;
    constructor(ctx: RestContext);
    protected fetch(url: string | URL, init?: RequestInit, options?: {
        useCompileLimiter?: boolean;
    }): Promise<Response>;
}
//# sourceMappingURL=base-module.d.ts.map