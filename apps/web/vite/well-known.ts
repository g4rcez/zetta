import type { Plugin } from "vite-plus";
import { buildWellKnown, normalizeOrigin } from "@zetta/core/server-meta";

const PATH = "/.well-known/zetta.json";

/**
 * Publishes `/.well-known/zetta.json` with the API origin this build was made for (ZETTA_SERVER_URL), in the build and in the dev server.
 * The desktop app reads it when it is given the address of the web UI instead of the API.
 */
export function zettaWellKnown(serverUrl: string | undefined): Plugin {
  const apiOrigin = normalizeOrigin(serverUrl);
  const body = apiOrigin ? JSON.stringify(buildWellKnown(apiOrigin)) : null;
  return {
    name: "zetta-well-known",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!body || req.url?.split("?")[0] !== PATH) return next();
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(body);
      });
    },
    generateBundle() {
      if (body) this.emitFile({ type: "asset", fileName: PATH.slice(1), source: body });
    },
  };
}
