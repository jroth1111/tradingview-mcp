import type { PineDraftCompileResult, PineTranslateLightResult } from '../types.js';
import type { TVRestClient } from './types.js';
export interface CompileOptions {
    code: string;
    username: string;
    reuseDraft?: boolean;
}
export interface TranslateOptions {
    code: string;
    username: string;
    version?: string;
}
export declare function compilePineDraft(client: TVRestClient, opts: CompileOptions): Promise<PineDraftCompileResult>;
export declare function translatePineLight(client: TVRestClient, opts: TranslateOptions): Promise<PineTranslateLightResult>;
//# sourceMappingURL=pinescript.d.ts.map