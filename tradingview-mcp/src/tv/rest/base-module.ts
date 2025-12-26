import type { RestContext } from './context.js';

export abstract class BaseModule {
  constructor(protected ctx: RestContext) {}

  protected async fetch(url: string | URL, init?: RequestInit, options?: { useCompileLimiter?: boolean }): Promise<Response> {
    return await this.ctx.fetch(url, init, options);
  }
}
