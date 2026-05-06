import { getCachedCandles, type CacheRequest } from "./cache";

export class FetchCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: CloudflareBindings,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const req = (await request.json()) as CacheRequest;
    const result = await this.state.blockConcurrencyWhile(() =>
      getCachedCandles(this.env.CACHE_META, this.env.CACHE_DATA, req),
    );
    return Response.json(result);
  }
}
