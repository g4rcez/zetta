import { createPlugins, NATIVE_URL_PREFIX, type McpCore } from "./service";

type Actor = { userId: string };
export const actor = (userId: string) => ({ userId }) as never;

/** In-memory stand-ins for the MCP service (rows + bindings) and the sealed connection store, enforcing per-user isolation like the real ones. */
export function world() {
  let n = 0;
  const servers: { id: string; owner: string; name: string; url: string | null; connectionId: string | null }[] = [];
  const bindings: { botId: string; owner: string; serverId: string }[] = [];
  const secrets = new Map<string, { owner: string; secret: string; revoked: boolean; revision: number }>();
  const connections = {
    configured: () => true,
    create: async (a: Actor, v: { secret: string }) => { const id = `c${++n}`; secrets.set(id, { owner: a.userId, secret: v.secret, revoked: false, revision: 1 }); return { id }; },
    list: async (a: Actor) => [...secrets].filter(([, s]) => s.owner === a.userId).map(([id, s]) => ({ id, revision: s.revision })),
    revoke: async (a: Actor, id: string) => { const s = secrets.get(id); if (!s || s.owner !== a.userId) throw new Error("nf"); s.revoked = true; },
    secretFor: async (a: Actor, id: string) => { const s = secrets.get(id); if (!s || s.owner !== a.userId || s.revoked) throw new Error("nf"); return Buffer.from(s.secret); },
  };
  const own = (a: Actor, id: string) => { const s = servers.find((x) => x.id === id && x.owner === a.userId); if (!s) throw new Error("NOT_FOUND"); return s; };
  const mcp: McpCore = {
    addServer: async (a, v) => { const s = { id: `s${++n}`, owner: a.userId, name: v.name, url: v.url ?? null, connectionId: v.connectionId ?? null }; servers.push(s); return s; },
    addNative: async (a, id, connectionId) => { const s = { id: `s${++n}`, owner: a.userId, name: id, url: `${NATIVE_URL_PREFIX}${id}`, connectionId: connectionId ?? null }; servers.push(s); return s; },
    serverByName: async (a, name) => servers.find((x) => x.owner === a.userId && x.name === name),
    setConnection: async (a, id, c) => { own(a, id).connectionId = c; },
    removeServer: async (a, id) => { own(a, id); servers.splice(servers.findIndex((x) => x.id === id), 1); },
    bind: async (a, botId, serverId) => { own(a, serverId); bindings.push({ botId, owner: a.userId, serverId }); },
    unbind: async (a, botId, serverId) => { const i = bindings.findIndex((b) => b.botId === botId && b.owner === a.userId && b.serverId === serverId); if (i >= 0) bindings.splice(i, 1); },
    bound: async (a, botId) => bindings.filter((b) => b.botId === botId && b.owner === a.userId).map((b) => ({ id: b.serverId, name: servers.find((s) => s.id === b.serverId)!.name })),
    tools: async () => [{ name: "ping", description: "pong" }],
  };
  return { plugins: createPlugins({} as never, connections as never, () => mcp), secrets, servers };
}

