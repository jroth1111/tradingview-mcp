import { BaseModule } from '../base-module.js';
export interface NewsItem {
    id: string;
    title: string;
    link: string;
    published: number;
    source: string;
    urgency?: number;
}
export interface NewsOptions {
    language?: string;
    limit?: number;
    client?: string;
    filters?: string[];
}
export declare class NewsModule extends BaseModule {
    getBySymbol(symbol: string, opts?: NewsOptions): Promise<NewsItem[]>;
}
//# sourceMappingURL=news.module.d.ts.map