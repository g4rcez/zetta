import { Elysia } from "elysia";
import { z } from "zod";
import { TransportError } from "@zetta/core/sealed-transport";
import {
  TransportKeyExpiredError,
  transportKeyring,
  type TransportKeyring,
} from "../connections/transport";
import { AccessError, type createIdentityAccess } from "../identity/access";
import { McpError, type Mcp } from "./mcp";
import { PluginError } from "./plugins/registry";
import { SourceError, type Sources } from "./sources";

export type IntegrationServices = {
  access: ReturnType<typeof createIdentityAccess>;
  mcp: Mcp;
  sources: Sources;
};
const uuid = z.string().uuid();
const pluginId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
/** Which configuration of a plugin a request is about: the user's own (default) or the workspace's team one. */
const scopeOf = z.enum(["mine", "team"]);
/** What a sealed plugin body opens to. Same limits the plaintext body had. */
const sealedConfig = z.strictObject({
  config: z.record(z.string().max(40), z.string().max(4000)).default({}),
});
const out = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (status: number, code: string, message: string) =>
  out({ error: { code, message } }, status);

export function createIntegrationRoutes(
  { access, mcp, sources }: IntegrationServices,
  trustedOrigins: readonly string[],
  keyring: TransportKeyring = transportKeyring,
) {
  type Ctx = {
    actor: Awaited<ReturnType<typeof access.requireActive>>;
    body: unknown;
    params: Record<string, string>;
    scope: z.infer<typeof scopeOf>;
  };
  function mapError(e: unknown) {
    if (e instanceof AccessError)
      return fail(
        e.code === "SIGN_IN_REQUIRED"
          ? 401
          : e.code === "NOT_FOUND"
            ? 404
            : e.code === "IDENTITY_UNAVAILABLE"
              ? 503
              : 403,
        e.code,
        e.message,
      );
    if (e instanceof McpError)
      return fail(
        e.code === "NOT_BOUND"
          ? 404
          : e.code === "TOOL_NOT_ALLOWED"
            ? 403
            : e.code === "TIMEOUT"
              ? 504
              : e.code === "FAILED"
                ? 502
                : 400,
        e.code,
        e.code === "STDIO_NOT_ALLOWED"
          ? "Local commands are for the administrator (or members, when ZETTA_MCP_MEMBER_STDIO=1) and must be listed in ZETTA_MCP_ALLOWLIST."
          : e.code === "BLOCKED_URL"
            ? "That address is not allowed."
            : e.code === "NOT_BOUND"
              ? "That server is not connected to this bot."
              : e.code === "TOOL_NOT_ALLOWED"
                ? "This bot may not use that tool."
                : e.code === "TIMEOUT"
                  ? "The server took too long."
                  : e.code === "FAILED"
                    ? "The server could not be reached."
                    : "Check the details and try again.",
      );
    if (e instanceof PluginError)
      return fail(
        e.code === "NOT_BOUND"
          ? 404
          : e.code === "TOOL_NOT_ALLOWED" || e.code === "ADMIN_ONLY"
            ? 403
            : e.code === "TIMEOUT"
              ? 504
              : e.code === "ALREADY_INSTALLED"
                ? 409
                : e.code === "CONNECTIONS_NOT_CONFIGURED"
                  ? 503
                  : e.code === "FAILED"
                    ? 502
                    : 400,
        e.code,
        e.safe,
      );
    if (e instanceof SourceError)
      return fail(
        e.code === "BLOCKED" ? 400 : 502,
        e.code,
        e.code === "BLOCKED" ? "That address is not allowed." : "The source could not be read.",
      );
    if (e instanceof TransportKeyExpiredError)
      return fail(409, "TRANSPORT_KEY_EXPIRED", "The encryption key rotated. Try again.");
    if (e instanceof z.ZodError || e instanceof TransportError)
      return fail(400, "INVALID_REQUEST", "Check the details and try again.");
    console.error("integrations: unhandled error", e);
    return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
  }
  const g =
    (work: (c: Ctx) => Promise<unknown>, status = 200) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        if (request.method !== "GET") {
          const o = request.headers.get("origin");
          if (!o || !trustedOrigins.includes(o))
            return fail(
              403,
              "UNTRUSTED_ORIGIN",
              "Open Zetta from its trusted application and try again.",
            );
        }
        return out(
          await work({
            actor: await access.requireActive(request.headers),
            body,
            params,
            scope: scopeOf.catch("mine").parse(new URL(request.url).searchParams.get("scope")),
          }),
          status,
        );
      } catch (e) {
        return mapError(e);
      }
    };
  return (
    new Elysia({ prefix: "/api", normalize: false })
      .get(
        "/mcp/servers",
        g(async (c) => ({ servers: await mcp.listServers(c.actor) })),
      )
      .post(
        "/mcp/servers",
        g(
          async (c) => ({
            server: await mcp.addServer(
              c.actor,
              z
                .strictObject({
                  name: z.string().regex(/^[a-z0-9_-]{1,32}$/),
                  transport: z.enum(["http", "stdio"]),
                  url: z.string().url().max(2000).optional(),
                  command: z.string().max(300).optional(),
                  args: z.array(z.string().max(300)).max(16).optional(),
                  connectionId: uuid.optional(),
                })
                .parse(c.body),
            ),
          }),
          201,
        ),
      )
      .delete(
        "/mcp/servers/:id",
        g(async (c) => ({ server: await mcp.removeServer(c.actor, uuid.parse(c.params.id)) })),
      )
      .get(
        "/mcp/servers/:id/tools",
        g(async (c) => ({ tools: await mcp.tools(c.actor, uuid.parse(c.params.id)) })),
      )
      .get(
        "/bots/:id/integrations",
        g(async (c) => ({ servers: await mcp.bound(c.actor, uuid.parse(c.params.id)) })),
      )
      .put(
        "/bots/:id/integrations/:serverId",
        g(async (c) => ({
          binding: await mcp.bind(c.actor, uuid.parse(c.params.id), uuid.parse(c.params.serverId)),
        })),
      )
      .get(
        "/bots/:id/integrations/:serverId/tools",
        g(async (c) =>
          mcp.toolAccess(c.actor, uuid.parse(c.params.id), uuid.parse(c.params.serverId)),
        ),
      )
      .put(
        "/bots/:id/integrations/:serverId/tools",
        g(async (c) =>
          mcp.setToolAccess(
            c.actor,
            uuid.parse(c.params.id),
            uuid.parse(c.params.serverId),
            z
              .strictObject({
                toolsMode: z.enum(["all", "selected"]),
                allowedTools: z.array(z.string().min(1).max(200)).max(200),
              })
              .parse(c.body),
          ),
        ),
      )
      .delete(
        "/bots/:id/integrations/:serverId",
        g(async (c) => ({
          binding: await mcp.unbind(
            c.actor,
            uuid.parse(c.params.id),
            uuid.parse(c.params.serverId),
          ),
        })),
      )
      .get(
        "/plugins/catalog",
        g(async () => ({ plugins: mcp.plugins.catalog() })),
      )
      .get(
        "/plugins",
        g(async (c) => ({ plugins: await mcp.plugins.list(c.actor) })),
      )
      .post(
        "/plugins",
        g(async (c) => {
          // The config arrives sealed to the server key (see @zetta/core/sealed-transport); a plaintext `config` fails the strict schema.
          const v = z
            .strictObject({
              id: pluginId,
              sealed: z.unknown(),
              botIds: z.array(uuid).max(50).default([]),
            })
            .parse(c.body);
          const { config } = sealedConfig.parse(
            await keyring.open(v.sealed, {
              userId: c.actor.userId,
              purpose: `plugin.install:${v.id}`,
            }),
          );
          return {
            plugin: await mcp.plugins.install(c.actor, v.id, config, v.botIds, c.scope),
          };
        }, 201),
      )
      .delete(
        "/plugins/:id",
        g(async (c) => ({
          plugin: await mcp.plugins.uninstall(c.actor, pluginId.parse(c.params.id), c.scope),
        })),
      )
      .put(
        "/plugins/:id/config",
        g(async (c) => {
          const id = pluginId.parse(c.params.id);
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { config } = sealedConfig.parse(
            await keyring.open(sealed, {
              userId: c.actor.userId,
              purpose: `plugin.configure:${id}`,
            }),
          );
          return { plugin: await mcp.plugins.configure(c.actor, id, config, c.scope) };
        }),
      )
      .post(
        "/plugins/:id/test",
        g(async (c) => mcp.plugins.test(c.actor, pluginId.parse(c.params.id), c.scope)),
      )
      .post(
        "/plugins/:id/connect",
        g(async (c) =>
          mcp.plugins.connect(
            c.actor,
            pluginId.parse(c.params.id),
            z
              .strictObject({ options: z.record(z.string().max(40), z.unknown()).optional() })
              .parse(c.body ?? {}).options,
            c.scope,
          ),
        ),
      )
      .post(
        "/plugins/:id/disconnect",
        g(async (c) =>
          mcp.plugins.disconnect(
            c.actor,
            pluginId.parse(c.params.id),
            c.scope,
            z
              .strictObject({ options: z.record(z.string().max(40), z.unknown()).optional() })
              .parse(c.body ?? {}).options,
          ),
        ),
      )
      // Browser navigation from the plugin's OAuth provider: no JSON, no token in the URL; always ends in a redirect to the plugin's page with a status flag.
      .get("/plugins/:id/callback", async ({ request, params }) => {
        const id = pluginId.safeParse(params.id);
        const web = trustedOrigins[0] ?? "";
        const back = (ok: boolean, reason?: string) =>
          new Response(null, {
            status: 303,
            headers: {
              location: `${web.replace(/\/+$/, "")}/${id.success ? `plugins/${id.data}` : "studio/plugins"}?plugin=${id.success ? id.data : "unknown"}&status=${ok ? "ok" : "error"}${reason ? `&reason=${encodeURIComponent(reason)}` : ""}`,
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            },
          });
        try {
          if (!id.success) return back(false, "INVALID_REQUEST");
          await mcp.plugins.callback(
            await access.requireActive(request.headers),
            id.data,
            new URL(request.url).searchParams,
          );
          return back(true);
        } catch (e) {
          return back(
            false,
            e instanceof PluginError || e instanceof AccessError ? e.code : "UNAVAILABLE",
          );
        }
      })
      .get(
        "/bots/:id/plugins",
        g(async (c) => {
          const botId = uuid.parse(c.params.id);
          return {
            plugins: await mcp.plugins.bindings(c.actor, botId),
            configs: await mcp.plugins.bindingScopes(c.actor, botId),
          };
        }),
      )
      .put(
        "/bots/:id/plugins/:pluginId",
        g(async (c) => ({
          binding: await mcp.plugins.setBinding(
            c.actor,
            uuid.parse(c.params.id),
            pluginId.parse(c.params.pluginId),
            true,
            c.scope,
          ),
        })),
      )
      .delete(
        "/bots/:id/plugins/:pluginId",
        g(async (c) => ({
          binding: await mcp.plugins.setBinding(
            c.actor,
            uuid.parse(c.params.id),
            pluginId.parse(c.params.pluginId),
            false,
            c.scope,
          ),
        })),
      )
      .get(
        "/sources",
        g(async (c) => ({ sources: await sources.list(c.actor) })),
      )
      .post(
        "/sources",
        g(async (c) => {
          const label = z.string().trim().min(1).max(100);
          const v = z
            .discriminatedUnion("kind", [
              z.strictObject({
                kind: z.enum(["rss", "web"]),
                url: z.string().url().max(2000),
                label,
              }),
              z.strictObject({
                kind: z.literal("email"),
                label,
                connectionId: z.string().min(1).max(100),
                host: z.string().max(253),
                port: z.number().int().min(1).max(65535).optional(),
                user: z.string().min(1).max(254),
                mailbox: z.string().max(100).optional(),
                limit: z.number().int().min(1).max(25).optional(),
              }),
              z.strictObject({
                kind: z.literal("x"),
                label,
                connectionId: z.string().min(1).max(100),
                mode: z.enum(["user", "search"]),
                value: z.string().min(1).max(400),
              }),
            ])
            .parse(c.body);
          return {
            source:
              v.kind === "email"
                ? await sources.addEmail(c.actor, v)
                : v.kind === "x"
                  ? await sources.addX(c.actor, v)
                  : await sources.add(c.actor, v),
          };
        }, 201),
      )
      .delete(
        "/sources/:id",
        g(async (c) => ({ source: await sources.remove(c.actor, uuid.parse(c.params.id)) })),
      )
      .post(
        "/sources/briefing",
        g(async (c) =>
          sources.briefing(
            c.actor,
            z.strictObject({ sourceIds: z.array(uuid).max(10).optional() }).parse(c.body ?? {})
              .sourceIds,
          ),
        ),
      )
  );
}
