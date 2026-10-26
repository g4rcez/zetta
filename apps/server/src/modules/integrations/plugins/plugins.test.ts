import { describe, expect, test } from "bun:test";
import { CATALOG, catalogStdio } from "./catalog";
import { getPlugin, PluginError, registerPlugin, type PluginDef } from "./registry";
import { createPlugins, NATIVE_URL_PREFIX, type McpCore } from "./service";

type Actor = { userId: string };
const actor = (userId: string) => ({ userId }) as never;

/** In-memory stand-ins for the MCP service (rows + bindings) and the sealed connection store, enforcing per-user isolation like the real ones. */
function world() {
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

/** Worked example: a native plugin with an api-key field, one tool, a status check and install validation. Copy this shape. */
const seen: string[] = [];
const fake: PluginDef = {
  id: "fake-notes", name: "Fake notes", description: "Stores nothing; echoes.", icon: "notebook", category: "other", kind: "native", auth: "api-key",
  fields: [{ key: "apiKey", label: "API key", secret: true, kind: "password" }, { key: "workspace", label: "Workspace", placeholder: "main", optional: true }],
  async install(ctx) { if (ctx.config.apiKey === "bad") throw new PluginError("REJECTED", "The key was rejected."); },
  async status(ctx) { return ctx.config.apiKey ? { state: "connected" } : { state: "needs-auth" }; },
  tools: [{
    name: "echo", description: "Echo text back with the key suffix", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    async handler(ctx, args) { seen.push(ctx.userId); await ctx.setConfig({ ...ctx.config, last: String(args.text) }); return { text: args.text, key: `…${ctx.config.apiKey!.slice(-2)}` }; },
  }],
};
registerPlugin(fake);

describe("plugin registry and catalog", () => {
  test("catalog entries are registered, have docs and declare secrets", () => {
    for (const d of CATALOG) { expect(getPlugin(d.id)).toBe(d); expect(d.docsUrl).toBeTruthy(); }
    for (const d of CATALOG.filter((x) => x.mcp?.transport === "http")) expect(d.mcp?.transport === "http" && /^https:\/\//.test(d.mcp.url)).toBe(true);
    expect(catalogStdio().every((e) => e.command === "npx")).toBe(true);
  });
  test("rejects duplicate ids and bad ids", () => {
    expect(() => registerPlugin({ ...fake })).toThrow();
    expect(() => registerPlugin({ ...fake, id: "Bad Id" })).toThrow();
  });
});

describe("plugin service", () => {
  test("install validates the schema, seals secrets and never exposes them", async () => {
    const { plugins, secrets } = world(); const a = actor("u1");
    await expect(plugins.install(a, "fake-notes", {})).rejects.toMatchObject({ code: "MISSING_FIELD" });
    await expect(plugins.install(a, "fake-notes", { apiKey: "k", nope: "x" })).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(plugins.install(a, "fake-notes", { apiKey: "bad" })).rejects.toMatchObject({ code: "REJECTED" });
    expect(await plugins.list(a)).toEqual([]); // rolled back
    expect([...secrets.values()].filter((s) => !s.revoked)).toHaveLength(0);
    await plugins.install(a, "fake-notes", { apiKey: "secret-ab" });
    await expect(plugins.install(a, "fake-notes", { apiKey: "x" })).rejects.toMatchObject({ code: "ALREADY_INSTALLED" });
    const listed = JSON.stringify(await plugins.list(a)) + JSON.stringify(plugins.catalog());
    expect(listed).not.toContain("secret-ab");
    expect((await plugins.test(a, "fake-notes")).status.state).toBe("connected");
  });

  test("a bot calls native tools only when this user bound the plugin; config can be refreshed", async () => {
    const { plugins } = world(); const a = actor("u1");
    await plugins.install(a, "fake-notes", { apiKey: "secret-ab" });
    await expect(plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "hi" })).rejects.toMatchObject({ code: "NOT_BOUND" });
    await plugins.setBinding(a, "bot1", "fake-notes", true);
    expect(await plugins.bindings(a, "bot1")).toEqual(["fake-notes"]);
    expect(JSON.parse(await plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "hi" }))).toEqual({ text: "hi", key: "…ab" });
    await expect(plugins.callTool(a, "bot1", "fake-notes", "echo", {})).rejects.toMatchObject({ code: "INVALID_ARGS" });
    await expect(plugins.callTool(a, "bot1", "fake-notes", "nope", {})).rejects.toMatchObject({ code: "UNKNOWN_TOOL" });
    const prompt = await plugins.promptFor(a, "bot1");
    expect(prompt).toContain("zetta:plugin"); expect(prompt).toContain("echo"); expect(prompt).not.toContain("secret-ab");
    await plugins.setBinding(a, "bot1", "fake-notes", false);
    expect(await plugins.promptFor(a, "bot1")).toBe("");
  });

  test("users never see or use each other's plugins, bindings or secrets", async () => {
    const { plugins } = world(); const a = actor("alice"), b = actor("bob");
    await plugins.install(a, "fake-notes", { apiKey: "alice-key-AA" });
    await plugins.setBinding(a, "shared-bot", "fake-notes", true);
    expect(await plugins.list(b)).toEqual([]);
    expect(await plugins.bindings(b, "shared-bot")).toEqual([]);
    expect(await plugins.promptFor(b, "shared-bot")).toBe("");
    await expect(plugins.callTool(b, "shared-bot", "fake-notes", "echo", { text: "x" })).rejects.toMatchObject({ code: "NOT_BOUND" });
    await expect(plugins.setBinding(b, "shared-bot", "fake-notes", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(plugins.uninstall(b, "fake-notes")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Bob installs his own with a different key; each call resolves its own caller's secret.
    await plugins.install(b, "fake-notes", { apiKey: "bob-key-BB" }); await plugins.setBinding(b, "shared-bot", "fake-notes", true);
    expect(JSON.parse(await plugins.callTool(b, "shared-bot", "fake-notes", "echo", { text: "x" })).key).toBe("…BB");
    expect(JSON.parse(await plugins.callTool(a, "shared-bot", "fake-notes", "echo", { text: "x" })).key).toBe("…AA");
  });

  test("uninstall removes the server and revokes the secret; mcp plugins install from the catalog", async () => {
    const { plugins, secrets, servers } = world(); const a = actor("u1");
    await plugins.install(a, "fake-notes", { apiKey: "k1234" });
    await plugins.uninstall(a, "fake-notes");
    expect(servers).toHaveLength(0); expect([...secrets.values()].every((s) => s.revoked)).toBe(true);
    await plugins.install(a, "linear", { token: "lin_api_x" }, ["bot9"]);
    expect(servers[0]).toMatchObject({ name: "linear", url: "https://mcp.linear.app/mcp" });
    expect(await plugins.bindings(a, "bot9")).toEqual(["linear"]);
    expect((await plugins.test(a, "linear")).tools).toEqual([{ name: "ping", description: "pong" }]);
    expect(await plugins.promptFor(a, "bot9")).toContain("zetta:mcp");
    await expect(plugins.callTool(a, "bot9", "linear", "x", {})).rejects.toMatchObject({ code: "NOT_BOUND" }); // mcp kind goes through zetta:mcp, not zetta:plugin
  });
});
