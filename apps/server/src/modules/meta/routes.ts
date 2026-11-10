import { Elysia } from "elysia";
import { buildServerMeta } from "@zetta/core/server-meta";

/**
 * `GET /api/meta`: what a client (the desktop app) needs to know about this server before anyone signs in.
 * Public on purpose and limited to the two origins an operator already shows in the address bar. Never add a version, a build id or anything
 * about the installation here: it answers anyone who can reach the port.
 */
export const metaRoutes = (webOrigin: string, apiOrigin: string) =>
  new Elysia({ name: "meta" }).get("/api/meta", ({ set }) => {
    set.headers["cache-control"] = "no-store";
    // Any origin may read it: it holds nothing a request to the same address would not show, and a desktop launcher is not on our origin.
    set.headers["access-control-allow-origin"] = "*";
    return buildServerMeta(webOrigin, apiOrigin);
  });
