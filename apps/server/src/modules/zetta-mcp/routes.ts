import { createMcpHandler } from "@modelcontextprotocol/server";
import { MCP_SCOPES, requireMcpAuth } from "@zetta/auth";
import { Elysia } from "elysia";

import type { ActiveActor } from "../identity/access";
import { createZettaMcpServer, type ZettaMcpServices } from "./server";

export type ZettaMcpRouteServices = ZettaMcpServices & {
  /** The better-auth instance that issues the access tokens (its JWKS verifies them). */
  auth: Parameters<typeof requireMcpAuth>[0];
  /** The access token's subject as an actor, or null when that user is no longer an active member. */
  actorFor(userId: string): Promise<ActiveActor | null>;
  /** The protected resource the access tokens must be bound to (`mcpResource` from @zetta/auth). */
  resource: string;
};

/**
 * POST /api/mcp: Streamable HTTP MCP endpoint. Not cookie-authenticated (no Origin check): only an OAuth access token issued to an MCP
 * client for this resource is accepted, and the token's member must still be active on every request.
 */
export function createZettaMcpRoutes(
  services: ZettaMcpRouteServices,
  authHandler: (request: Request) => Response | Promise<Response>,
): Elysia {
  // authInfo is pass-through: the SDK never fills it from headers, so the actor below only comes from a verified token.
  const mcp = createMcpHandler(({ authInfo }) => {
    const actor = authInfo?.extra?.actor as ActiveActor | undefined;
    if (!actor) throw new Error("zetta-mcp: request without a verified actor");
    return createZettaMcpServer(services, actor);
  });
  const handle = requireMcpAuth(
    services.auth,
    async (request, claims) => {
      const actor = typeof claims.sub === "string" ? await services.actorFor(claims.sub) : null;
      if (!actor) return Response.json({ error: "inactive_member" }, { status: 403 });
      const scopes = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
      const clientId =
        typeof claims.azp === "string"
          ? claims.azp
          : typeof claims.client_id === "string"
            ? claims.client_id
            : "";
      return mcp.fetch(request, {
        authInfo: { token: "", clientId, scopes, expiresAt: claims.exp, extra: { actor } },
      });
    },
    { resource: services.resource, requiredScopes: [MCP_SCOPES.read] },
  );
  // Registered without chaining so the plugin adds no route types: app.ts's `.use` chain is at TypeScript's union size limit (TS2590).
  const routes = new Elysia();
  // OAuth discovery (RFC 8414 authorization server, RFC 9728 protected resource) sits at the origin root, outside /api/auth;
  // better-auth answers these paths itself.
  routes.get("/.well-known/*", ({ request }) => authHandler(request));
  routes.all("/api/mcp", ({ request }) => handle(request));
  return routes;
}
