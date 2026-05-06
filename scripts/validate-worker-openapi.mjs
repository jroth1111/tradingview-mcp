import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

const index = readFileSync("worker/src/index.ts", "utf8");
const openapiText = readFileSync("worker/openapi.yaml", "utf8");

const routeRegex = /app\.(?:get|post|all)\("([^"]+)"/g;
const routes = new Set();
for (const match of index.matchAll(routeRegex)) {
  const route = match[1].replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  routes.add(route);
}

const openapi = parseYaml(openapiText);
if (!openapi || typeof openapi !== "object" || !openapi.paths || typeof openapi.paths !== "object") {
  throw new Error("worker/openapi.yaml: missing or invalid `paths` object");
}

const hmac = openapi.components?.securitySchemes?.HmacAuth;
if (!hmac || hmac.type !== "http" || hmac.scheme !== "hmac") {
  throw new Error("worker/openapi.yaml: missing HmacAuth http/hmac security scheme");
}

if (!Array.isArray(openapi.security) || !openapi.security.some((entry) => entry?.HmacAuth)) {
  throw new Error("worker/openapi.yaml: missing top-level HmacAuth security requirement");
}

const serverUrls = Array.isArray(openapi.servers) ? openapi.servers.map((server) => server?.url) : [];
if (!serverUrls.includes("https://tradingview-data.gwizz.workers.dev")) {
  throw new Error("worker/openapi.yaml: missing deployed Worker server URL");
}
if (serverUrls.some((url) => typeof url === "string" && url.includes("example.workers.dev"))) {
  throw new Error("worker/openapi.yaml: placeholder example workers.dev server URL remains");
}

const paths = new Set(Object.keys(openapi.paths));

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

if (openapiText.includes("/ws/") || openapiText.includes("StreamHub")) {
  throw new Error("OpenAPI still documents deleted StreamHub WebSocket surface");
}

const publicOperations = new Set(["GET /", "GET /health"]);
for (const [path, pathItem] of Object.entries(openapi.paths)) {
  if (!pathItem || typeof pathItem !== "object") continue;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!["get", "post", "put", "patch", "delete", "all"].includes(method)) continue;
    if (!operation || typeof operation !== "object") {
      throw new Error(`worker/openapi.yaml: ${method.toUpperCase()} ${path} operation is not an object`);
    }
    const key = `${method.toUpperCase()} ${path}`;
    const security = operation.security;
    if (publicOperations.has(key)) {
      if (!Array.isArray(security) || security.length !== 0) {
        throw new Error(`worker/openapi.yaml: ${key} must explicitly opt out of HmacAuth with security: []`);
      }
      continue;
    }
    if (Array.isArray(security) && security.length === 0) {
      throw new Error(`worker/openapi.yaml: ${key} must not disable HmacAuth`);
    }
  }
}

console.log("worker OpenAPI validation passed");
