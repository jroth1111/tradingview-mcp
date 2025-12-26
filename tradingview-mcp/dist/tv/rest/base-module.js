export class BaseModule {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async fetch(url, init, options) {
        return await this.ctx.fetch(url, init, options);
    }
}
//# sourceMappingURL=base-module.js.map