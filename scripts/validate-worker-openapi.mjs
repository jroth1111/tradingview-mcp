import { readFileSync } from "node:fs";

const index = readFileSync("worker/src/index.ts", "utf8");
const openapi = readFileSync("worker/openapi.yaml", "utf8");

const routeRegex = /app\.(?:get|post|all)\("([^"]+)"/g;
const routes = new Set();
for (const match of index.matchAll(routeRegex)) {
  const route = match[1].replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  routes.add(route);
}

const pathRegex = /^  (\/.*):$/gm;
const paths = new Set();
for (const match of openapi.matchAll(pathRegex)) {
  paths.add(match[1]);
}

const missing = [...routes].filter((route) => !paths.has(route));
const stale = [...paths].filter((path) => !routes.has(path));

if (missing.length || stale.length) {
  throw new Error(
    [
      missing.length ? `OpenAPI missing routes: ${missing.join(", ")}` : "",
      stale.length ? `OpenAPI stale routes: ${stale.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

if (openapi.includes("/ws/") || openapi.includes("StreamHub")) {
  throw new Error("OpenAPI still documents deleted StreamHub WebSocket surface");
}

console.log("worker OpenAPI validation passed");
