import { normalizeOrigin } from "@zetta/core/server-meta";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { mcpServer } from "@zetta/db/schema/features";
import type { ConnectionsService } from "../connections/service";
import type { ActiveActor } from "../identity/access";
import type { createMcp } from "../integrations/mcp";

type Mcp = Pick<ReturnType<typeof createMcp>, "addServer" | "removeServer">;
type Connections = Pick<ConnectionsService, "create" | "list" | "revoke">;

export class DesktopLinkError extends Error {
  constructor(readonly code: "NOT_READY" | "INVALID") {
    super(code);
  }
}

export const remoteServerName = (origin: string) => `Zetta: ${new URL(origin).host}`;

/**
 * Lets the desktop app that runs this server give it a way into the owner's other Zetta server (the cloud one): an access token the app
 * got by signing in there. The server keeps it sealed like any connection and lists the remote as an MCP server, so the owner's bots can
 * use what that server offers, with the scopes the owner approved there. Only the owner of this installation is linked.
 */
export function createDesktopLink(deps: {
  db: Database;
  connections: Connections;
  mcp: Mcp;
  /** The installation owner, or null when nobody has signed up yet. */
  admin: () => Promise<ActiveActor | null>;
}) {
  const { db, connections, mcp } = deps;
  const find = (a: ActiveActor, name: string) =>
    db
      .select()
      .from(mcpServer)
      .where(
        and(
          eq(mcpServer.ownerUserId, a.userId),
          eq(mcpServer.name, name),
          eq(mcpServer.sharing, "private"),
        ),
      )
      .then((rows) => rows[0]);

  async function revokeQuietly(a: ActiveActor, connectionId: string | null | undefined) {
    if (!connectionId) return;
    try {
      const current = (await connections.list(a)).find((row) => row.id === connectionId);
      if (current) await connections.revoke(a, connectionId, current.revision);
    } catch {
      // A connection that cannot be revoked stays sealed and unused; the link itself is already switched.
    }
  }

  return {
    /** Adds the remote, or swaps the token of one already added (the app refreshes it before it expires). */
    async upsert(input: { origin: string; accessToken: string }) {
      const origin = normalizeOrigin(input.origin);
      if (!origin || new URL(origin).origin !== input.origin.replace(/\/+$/, ""))
        throw new DesktopLinkError("INVALID");
      if (!input.accessToken || input.accessToken.length > 8_192)
        throw new DesktopLinkError("INVALID");
      const a = await deps.admin();
      if (!a) throw new DesktopLinkError("NOT_READY");
      const name = remoteServerName(origin);
      const sealed = await connections.create(a, {
        provider: "plugin",
        label: name,
        secret: input.accessToken,
      });
      const existing = await find(a, name);
      if (existing) {
        await db
          .update(mcpServer)
          .set({ connectionId: sealed.id, url: `${origin}/api/mcp` })
          .where(eq(mcpServer.id, existing.id));
        await revokeQuietly(a, existing.connectionId);
      } else {
        await mcp.addServer(a, {
          name,
          transport: "http",
          url: `${origin}/api/mcp`,
          connectionId: sealed.id,
        });
      }
      return { origin, name };
    },
    async remove(originInput: string) {
      const origin = normalizeOrigin(originInput);
      if (!origin) throw new DesktopLinkError("INVALID");
      const a = await deps.admin();
      if (!a) throw new DesktopLinkError("NOT_READY");
      const existing = await find(a, remoteServerName(origin));
      if (!existing) return false;
      await mcp.removeServer(a, existing.id);
      await revokeQuietly(a, existing.connectionId);
      return true;
    },
  };
}

export type DesktopLink = ReturnType<typeof createDesktopLink>;
