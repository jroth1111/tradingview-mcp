import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "cloudflare:sockets": new URL("./src/tests/cloudflare-sockets-stub.ts", import.meta.url).pathname,
    },
  },
});
