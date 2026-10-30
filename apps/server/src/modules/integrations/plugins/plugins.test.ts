import { describe, expect, test } from "bun:test";
import { CATALOG, catalogStdio } from "./catalog";
import { getPlugin, PluginError, registerPlugin, type PluginDef } from "./registry";
import { actor, world } from "./test-world";

/** Worked example: a native plugin with an api-key field, one tool, a status check and install validation. Copy this shape. */
const seen: string[] = [];
const fake: PluginDef = {
  id: "fake-notes",
  name: "Fake notes",
  description: "Stores nothing; echoes.",
  icon: "notebook",
  category: "other",
  kind: "native",
  auth: "api-key",
  fields: [
    { key: "apiKey", label: "API key", secret: true, kind: "password" },
    { key: "workspace", label: "Workspace", placeholder: "main", optional: true },
  ],
  async install(ctx) {
    if (ctx.config.apiKey === "bad") throw new PluginError("REJECTED", "The key was rejected.");
  },
  async status(ctx) {
    return ctx.config.apiKey ? { state: "connected" } : { state: "needs-auth" };
  },
  tools: [
    {
      name: "echo",
      description: "Echo text back with the key suffix",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      async handler(ctx, args) {
        seen.push(ctx.userId);
        await ctx.setConfig({ ...ctx.config, last: String(args.text) });
        return { text: args.text, key: `…${ctx.config.apiKey!.slice(-2)}` };
      },
    },
  ],
};
registerPlugin(fake);

describe("plugin registry and catalog", () => {
  test("catalog entries are registered, have docs and declare secrets", () => {
    for (const d of CATALOG) {
      expect(getPlugin(d.id)).toBe(d);
      expect(d.docsUrl).toBeTruthy();
    }
    for (const d of CATALOG.filter((x) => x.mcp?.transport === "http"))
      expect(d.mcp?.transport === "http" && d.mcp.url.startsWith("https://")).toBe(true);
    expect(catalogStdio().every((e) => e.command === "npx")).toBe(true);
  });
  test("rejects duplicate ids and bad ids", () => {
    expect(() => registerPlugin({ ...fake })).toThrow();
    expect(() => registerPlugin({ ...fake, id: "Bad Id" })).toThrow();
  });
});

describe("plugin service", () => {
  test("install validates the schema, seals secrets and never exposes them", async () => {
    const { plugins, secrets } = world();
    const a = actor("u1");
    await expect(plugins.install(a, "fake-notes", {})).rejects.toMatchObject({
      code: "MISSING_FIELD",
    });
    await expect(
      plugins.install(a, "fake-notes", { apiKey: "k", nope: "x" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(plugins.install(a, "fake-notes", { apiKey: "bad" })).rejects.toMatchObject({
      code: "REJECTED",
    });
    expect(await plugins.list(a)).toEqual([]); // rolled back
    expect([...secrets.values()].filter((s) => !s.revoked)).toHaveLength(0);
    await plugins.install(a, "fake-notes", { apiKey: "secret-ab" });
    await expect(plugins.install(a, "fake-notes", { apiKey: "x" })).rejects.toMatchObject({
      code: "ALREADY_INSTALLED",
    });
    const listed = JSON.stringify(await plugins.list(a)) + JSON.stringify(plugins.catalog());
    expect(listed).not.toContain("secret-ab");
    expect((await plugins.test(a, "fake-notes")).status.state).toBe("connected");
  });

  test("a bot calls native tools only when this user bound the plugin; config can be refreshed", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-notes", { apiKey: "secret-ab" });
    await expect(
      plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
    await plugins.setBinding(a, "bot1", "fake-notes", true);
    expect(await plugins.bindings(a, "bot1")).toEqual(["fake-notes"]);
    expect(
      JSON.parse(await plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "hi" })),
    ).toEqual({ text: "hi", key: "…ab" });
    await expect(plugins.callTool(a, "bot1", "fake-notes", "echo", {})).rejects.toMatchObject({
      code: "INVALID_ARGS",
    });
    await expect(plugins.callTool(a, "bot1", "fake-notes", "nope", {})).rejects.toMatchObject({
      code: "UNKNOWN_TOOL",
    });
    const prompt = await plugins.promptFor(a, "bot1");
    expect(prompt).toContain("zetta:plugin");
    expect(prompt).toContain("echo");
    expect(prompt).not.toContain("secret-ab");
    await plugins.setBinding(a, "bot1", "fake-notes", false);
    expect(await plugins.promptFor(a, "bot1")).toBe("");
  });

  test("a bot restricted to selected tools cannot call or see the others", async () => {
    const { plugins, bindings } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-notes", { apiKey: "secret-ab" });
    await plugins.setBinding(a, "bot1", "fake-notes", true);
    bindings[0]!.toolsMode = "selected";
    await expect(
      plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "hi" }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    expect(await plugins.promptFor(a, "bot1")).not.toContain("    echo:");
    bindings[0]!.allowedTools = ["echo"];
    expect(
      JSON.parse(await plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "hi" })),
    ).toEqual({ text: "hi", key: "…ab" });
    expect(await plugins.promptFor(a, "bot1")).toContain("    echo:");
  });

  test("configure replaces settings in the sealed config; blank keeps the stored value; other users are untouched", async () => {
    const { plugins } = world();
    const a = actor("u1"),
      b = actor("u2");
    await plugins.install(a, "fake-notes", { apiKey: "alice-old-AA" });
    await plugins.setBinding(a, "bot1", "fake-notes", true);
    await plugins.install(b, "fake-notes", { apiKey: "bob-key-BB" });
    await plugins.setBinding(b, "bot2", "fake-notes", true);
    await plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "keep-me" });
    await expect(plugins.configure(a, "fake-notes", { nope: "x" })).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    expect(await plugins.configure(a, "fake-notes", { apiKey: "" })).toEqual({
      id: "fake-notes",
      changed: false,
    });
    expect(
      await plugins.configure(a, "fake-notes", { apiKey: "alice-new-CC", workspace: "w1" }),
    ).toEqual({ id: "fake-notes", changed: true });
    expect(
      JSON.parse(await plugins.callTool(a, "bot1", "fake-notes", "echo", { text: "x" })).key,
    ).toBe("…CC");
    expect(
      JSON.parse(await plugins.callTool(b, "bot2", "fake-notes", "echo", { text: "x" })).key,
    ).toBe("…BB");
    await expect(plugins.configure(b, "linear", { token: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("users never see or use each other's plugins, bindings or secrets", async () => {
    const { plugins } = world();
    const a = actor("alice"),
      b = actor("bob");
    await plugins.install(a, "fake-notes", { apiKey: "alice-key-AA" });
    await plugins.setBinding(a, "shared-bot", "fake-notes", true);
    expect(await plugins.list(b)).toEqual([]);
    expect(await plugins.bindings(b, "shared-bot")).toEqual([]);
    expect(await plugins.promptFor(b, "shared-bot")).toBe("");
    await expect(
      plugins.callTool(b, "shared-bot", "fake-notes", "echo", { text: "x" }),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
    await expect(plugins.setBinding(b, "shared-bot", "fake-notes", true)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(plugins.uninstall(b, "fake-notes")).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Bob installs his own with a different key; each call resolves its own caller's secret.
    await plugins.install(b, "fake-notes", { apiKey: "bob-key-BB" });
    await plugins.setBinding(b, "shared-bot", "fake-notes", true);
    expect(
      JSON.parse(await plugins.callTool(b, "shared-bot", "fake-notes", "echo", { text: "x" })).key,
    ).toBe("…BB");
    expect(
      JSON.parse(await plugins.callTool(a, "shared-bot", "fake-notes", "echo", { text: "x" })).key,
    ).toBe("…AA");
  });

  test("uninstall removes the server and revokes the secret; mcp plugins install from the catalog", async () => {
    const { plugins, secrets, servers } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-notes", { apiKey: "k1234" });
    await plugins.uninstall(a, "fake-notes");
    expect(servers).toHaveLength(0);
    expect([...secrets.values()].every((s) => s.revoked)).toBe(true);
    await plugins.install(a, "linear", { token: "lin_api_x" }, ["bot9"]);
    expect(servers[0]).toMatchObject({ name: "linear", url: "https://mcp.linear.app/mcp" });
    expect(await plugins.bindings(a, "bot9")).toEqual(["linear"]);
    expect((await plugins.test(a, "linear")).tools).toEqual([
      { name: "ping", description: "pong" },
    ]);
    expect(await plugins.promptFor(a, "bot9")).toContain("zetta:mcp");
    await expect(plugins.callTool(a, "bot9", "linear", "x", {})).rejects.toMatchObject({
      code: "NOT_BOUND",
    }); // mcp kind goes through zetta:mcp, not zetta:plugin
  });
});

const line: PluginDef = {
  id: "fake-line",
  name: "Fake line",
  description: "A shared line.",
  icon: "phone",
  category: "other",
  kind: "native",
  auth: "api-key",
  teamTools: ["echo"],
  fields: [{ key: "apiKey", label: "API key", secret: true, kind: "password" }],
  tools: [
    {
      name: "echo",
      description: "Send text",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      async handler(ctx, args) {
        seen.push(ctx.userId);
        return { text: args.text, key: `…${ctx.config.apiKey!.slice(-2)}` };
      },
    },
    {
      name: "peek",
      description: "Read the owner's history",
      inputSchema: { type: "object", properties: {} },
      async handler() {
        return "private history";
      },
    },
  ],
};
registerPlugin(line);

describe("sharing a plugin with the team", () => {
  test("a plugin stays private until its owner shares it, and a personal plugin cannot be shared at all", async () => {
    const { plugins } = world();
    const alice = actor("alice"),
      bob = actor("bob");
    await plugins.install(alice, "fake-line", { apiKey: "alice-key-AA" });
    expect(await plugins.shared(bob)).toEqual([]);
    await expect(plugins.setBinding(bob, "bot-b", "fake-line", true)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await plugins.install(alice, "fake-notes", { apiKey: "alice-key-AA" });
    await expect(plugins.setSharing(alice, "fake-notes", "team")).rejects.toMatchObject({
      code: "NOT_SHAREABLE",
    });
  });

  test("teammates use a shared plugin through the owner's account, with the team tools only", async () => {
    const { plugins } = world();
    const alice = actor("alice"),
      bob = actor("bob");
    await plugins.install(alice, "fake-line", { apiKey: "alice-key-AA" });
    await plugins.setSharing(alice, "fake-line", "team");
    expect((await plugins.shared(bob)).map((s) => [s.id, s.ownerName, s.tools])).toEqual([
      ["fake-line", "alice", ["echo"]],
    ]);
    await plugins.setBinding(bob, "bot-b", "fake-line", true);
    expect(await plugins.bindings(bob, "bot-b")).toEqual(["fake-line"]);
    seen.length = 0;
    expect(
      JSON.parse(await plugins.callTool(bob, "bot-b", "fake-line", "echo", { text: "hi" })),
    ).toEqual({ text: "hi", key: "…AA" });
    expect(seen).toEqual(["alice"]);
    await expect(plugins.callTool(bob, "bot-b", "fake-line", "peek", {})).rejects.toMatchObject({
      code: "TOOL_NOT_ALLOWED",
    });
    const prompt = await plugins.promptFor(bob, "bot-b");
    expect(prompt).toContain("shared by a teammate");
    expect(prompt).toContain("    echo:");
    expect(prompt).not.toContain("    peek:");
  });

  test("going back to private cuts every teammate off at once", async () => {
    const { plugins } = world();
    const alice = actor("alice"),
      bob = actor("bob");
    await plugins.install(alice, "fake-line", { apiKey: "alice-key-AA" });
    await plugins.setSharing(alice, "fake-line", "team");
    await plugins.setBinding(bob, "bot-b", "fake-line", true);
    await plugins.setSharing(alice, "fake-line", "private");
    expect(await plugins.bindings(bob, "bot-b")).toEqual([]);
    await expect(
      plugins.callTool(bob, "bot-b", "fake-line", "echo", { text: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
    expect(await plugins.shared(bob)).toEqual([]);
  });

  test("a teammate's own install wins over a shared one and is not listed as shared", async () => {
    const { plugins } = world();
    const alice = actor("alice"),
      bob = actor("bob");
    await plugins.install(alice, "fake-line", { apiKey: "alice-key-AA" });
    await plugins.setSharing(alice, "fake-line", "team");
    await plugins.install(bob, "fake-line", { apiKey: "bob-key-BB" });
    expect(await plugins.shared(bob)).toEqual([]);
    await plugins.setBinding(bob, "bot-b", "fake-line", true);
    expect(
      JSON.parse(await plugins.callTool(bob, "bot-b", "fake-line", "echo", { text: "x" })).key,
    ).toBe("…BB");
  });
});
