import type { TVRestClient } from './types.js';
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
export declare function getNews(client: TVRestClient, symbol: string, opts?: NewsOptions): Promise<NewsItem[]>;
//# sourceMappingURL=news.d.ts.map