import { createPlugins, NATIVE_URL_PREFIX, type McpCore } from "./service";

type Actor = { userId: string };
export const actor = (userId: string) => ({ userId }) as never;

/** In-memory stand-ins for the MCP service (rows + bindings) and the sealed connection store, enforcing per-user isolation like the real ones. */
export function world() {
  let n = 0;
  const servers: {
    id: string;
    owner: string;
    name: string;
    url: string | null;
    connectionId: string | null;
    sharing: "private" | "team";
  }[] = [];
  const bindings: {
    botId: string;
    owner: string;
    serverId: string;
    toolsMode: "all" | "selected";
    allowedTools: string[];
  }[] = [];
  const secrets = new Map<
    string,
    { owner: string; secret: string; revoked: boolean; revision: number }
  >();
  const connections = {
    configured: () => true,
    create: async (a: Actor, v: { secret: string }) => {
      const id = `c${++n}`;
      secrets.set(id, { owner: a.userId, secret: v.secret, revoked: false, revision: 1 });
      return { id };
    },
    list: async (a: Actor) =>
      [...secrets]
        .filter(([, s]) => s.owner === a.userId)
        .map(([id, s]) => ({ id, revision: s.revision })),
    revoke: async (a: Actor, id: string) => {
      const s = secrets.get(id);
      if (!s || s.owner !== a.userId) throw new Error("nf");
      s.revoked = true;
    },
    secretFor: async (a: Actor, id: string) => {
      const s = secrets.get(id);
      if (!s || s.owner !== a.userId || s.revoked) throw new Error("nf");
      return Buffer.from(s.secret);
    },
  };
  const own = (a: Actor, id: string) => {
    const s = servers.find((x) => x.id === id && x.owner === a.userId);
    if (!s) throw new Error("NOT_FOUND");
    return s;
  };
  const mcp: McpCore = {
    addServer: async (a, v) => {
      const s = {
        id: `s${++n}`,
        owner: a.userId,
        name: v.name,
        url: v.url ?? null,
        connectionId: v.connectionId ?? null,
        sharing: "private" as const,
      };
      servers.push(s);
      return s;
    },
    addNative: async (a, id, connectionId) => {
      const s = {
        id: `s${++n}`,
        owner: a.userId,
        name: id,
        url: `${NATIVE_URL_PREFIX}${id}`,
        connectionId: connectionId ?? null,
        sharing: "private" as const,
      };
      servers.push(s);
      return s;
    },
    serverByName: async (a, name) => servers.find((x) => x.owner === a.userId && x.name === name),
    setConnection: async (a, id, c) => {
      own(a, id).connectionId = c;
    },
    removeServer: async (a, id) => {
      own(a, id);
      servers.splice(
        servers.findIndex((x) => x.id === id),
        1,
      );
    },
    bind: async (a, botId, serverId) => {
      const t = servers.find((x) => x.id === serverId);
      if (!t || (t.owner !== a.userId && t.sharing !== "team")) throw new Error("NOT_FOUND");
      for (let i = bindings.length - 1; i >= 0; i--)
        if (
          bindings[i]!.botId === botId &&
          bindings[i]!.owner === a.userId &&
          servers.find((x) => x.id === bindings[i]!.serverId)!.name === t.name
        )
          bindings.splice(i, 1);
      bindings.push({ botId, owner: a.userId, serverId, toolsMode: "all", allowedTools: [] });
    },
    unbind: async (a, botId, serverId) => {
      const i = bindings.findIndex(
        (b) => b.botId === botId && b.owner === a.userId && b.serverId === serverId,
      );
      if (i >= 0) bindings.splice(i, 1);
    },
    bound: async (a, botId) =>
      bindings
        .filter((b) => b.botId === botId && b.owner === a.userId)
        .map((b) => ({
          id: b.serverId,
          name: servers.find((s) => s.id === b.serverId)!.name,
          toolsMode: b.toolsMode,
          allowedTools: b.allowedTools,
          tools: [],
          ownerUserId: servers.find((s) => s.id === b.serverId)!.owner,
          sharing: servers.find((s) => s.id === b.serverId)!.sharing,
        })),
    serverById: async (id) => {
      const s = servers.find((x) => x.id === id);
      return (
        s && {
          id: s.id,
          name: s.name,
          url: s.url,
          connectionId: s.connectionId,
          ownerUserId: s.owner,
          sharing: s.sharing,
        }
      );
    },
    setSharing: async (a, id, sharing) => {
      own(a, id).sharing = sharing;
      if (sharing === "private")
        for (let i = bindings.length - 1; i >= 0; i--)
          if (bindings[i]!.serverId === id && bindings[i]!.owner !== a.userId)
            bindings.splice(i, 1);
    },
    sharedWithMe: async (a) =>
      servers
        .filter((s) => s.sharing === "team" && s.owner !== a.userId)
        .map((s) => ({ id: s.id, name: s.name, ownerName: s.owner })),
    tools: async () => [{ name: "ping", description: "pong" }],
  };
  return {
    plugins: createPlugins({} as never, connections as never, () => mcp),
    secrets,
    servers,
    bindings,
  };
}
