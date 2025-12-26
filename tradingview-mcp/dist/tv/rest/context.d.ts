import type { TVCredentials } from '../types.js';
export interface RestContext {
    credentials?: TVCredentials;
    fetch(url: string | URL, init?: RequestInit, options?: {
        useCompileLimiter?: boolean;
    }): Promise<Response>;
}
//# sourceMappingURL=context.d.ts.map