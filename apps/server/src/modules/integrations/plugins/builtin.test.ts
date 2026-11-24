import { describe, expect, test } from "bun:test";

import "../mcp"; // importing registers the plugins of the integrations module
import "../../phone/live"; // and the phone ones, which register from their own modules
import "../../phone/outbound";
import { getPlugin, listPlugins, registerPlugin, type PluginDef } from "./registry";
import { actor, world } from "./test-world";

/**
 * Built-in plugins ship with Zetta and need no configuration, but they are not on by default: the person activates one (an install with
 * nothing to fill in) and chooses the bots, like any plugin. A gate adds conditions on top of the binding.
 */
const base = (id: string): Omit<PluginDef, "tools" | "fields" | "auth"> => ({
  id,
  name: `Fake ${id}`,
  description: "Only for the built-in plugin tests.",
  icon: "plug",
  category: "other",
  kind: "native",
  guide: () => [],
});
const a = actor("u-builtin");

let gateOpen = true;
registerPlugin({
  ...base("builtin-gated"),
  auth: "none",
  fields: [],
  builtin: true,
  gate: {
    available: async (botId) => gateOpen && botId !== "bot-closed",
    prompt: async () => "Use it only for tests.",
  },
  tools: [
    {
      name: "where",
      description: "Answers where the call comes from",
      inputSchema: { type: "object", properties: {} },
      handler: async (ctx) => ({ turn: ctx.turn ?? null, bot: ctx.botId ?? null }),
    },
  ],
});
registerPlugin({
  ...base("config-fresh"),
  auth: "api-key",
  fields: [{ key: "k", label: "K", optional: true }],
  tools: [
    {
      name: "bump",
      description: "Saves a new value and reads it back",
      inputSchema: { type: "object", properties: {} },
      handler: async (ctx) => {
        const before = ctx.config.k;
        await ctx.setConfig({ k: "2" });
        return { before, after: ctx.config.k, turn: ctx.turn ?? null };
      },
    },
  ],
});

describe("what a built-in plugin is", () => {
  test("the plugins that ship with Zetta are marked, and the rest are not", () => {
    const builtin = listPlugins()
      .filter((d) => d.builtin)
      .map((d) => d.id)
      .filter((id) => !id.startsWith("builtin-") && !id.startsWith("pause-"))
      .sort();
    expect(builtin).toEqual(
      expect.arrayContaining([
        "apps",
        "botmail",
        "mailbox",
        "phone",
        "phone_line",
        "phone_out",
        "video-transcription",
        "youtube",
      ]),
    );
    expect(getPlugin("github")?.builtin).toBeFalsy();
    expect(getPlugin("slack")?.builtin).toBeFalsy();
  });

  test("a built-in plugin has only optional, non-secret fields, and a gate belongs to a built-in plugin", () => {
    expect(() =>
      registerPlugin({
        ...base("bad-required"),
        auth: "api-key",
        fields: [{ key: "k", label: "K" }],
        builtin: true,
        tools: [],
      }),
    ).toThrow(/optional, non-secret/);
    expect(() =>
      registerPlugin({
        ...base("bad-secret"),
        auth: "api-key",
        fields: [{ key: "k", label: "K", optional: true, secret: true }],
        builtin: true,
        tools: [],
      }),
    ).toThrow(/optional, non-secret/);
    expect(() =>
      registerPlugin({
        ...base("bad-gate"),
        auth: "none",
        fields: [],
        gate: { available: async () => true },
        tools: [],
      }),
    ).toThrow(/not built in/);
    for (const d of listPlugins().filter((x) => x.builtin))
      expect(d.fields.every((f) => f.optional && !f.secret)).toBe(true);
  });
});

describe("a built-in plugin is not on by default", () => {
  test("before activation a call is refused with how to activate it; after, it runs", async () => {
    const { plugins } = world();
    await expect(plugins.callTool(a, "bot-a", "builtin-gated", "where", {})).rejects.toMatchObject({
      code: "NOT_BOUND",
      safe: "Fake builtin-gated is not turned on for this bot.",
      fix: "Activate Fake builtin-gated in Studio > Plugins and choose this bot.",
    });
    await plugins.install(a, "builtin-gated", {}, ["bot-a"]);
    const out = await plugins.callTool(a, "bot-a", "builtin-gated", "where", {}, undefined, "chat");
    expect(JSON.parse(out)).toEqual({ turn: "chat", bot: "bot-a" });
    // Activated for one bot only: another bot of the same person is still refused.
    await expect(plugins.callTool(a, "bot-b", "builtin-gated", "where", {})).rejects.toMatchObject({
      code: "NOT_BOUND",
    });
  });

  test("activating takes no configuration, and each person activates their own", async () => {
    const { plugins } = world();
    await plugins.install(a, "builtin-gated", {}, ["bot-a"]);
    await expect(plugins.install(a, "builtin-gated", {}, [])).rejects.toMatchObject({
      code: "ALREADY_INSTALLED",
    });
    await expect(
      plugins.callTool(actor("u-other"), "bot-a", "builtin-gated", "where", {}),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
  });

  test("the gate still decides on every call, after the binding", async () => {
    const { plugins } = world();
    await plugins.install(a, "builtin-gated", {}, ["bot-a", "bot-closed"]);
    gateOpen = false;
    try {
      await expect(
        plugins.callTool(a, "bot-a", "builtin-gated", "where", {}),
      ).rejects.toMatchObject({
        code: "NOT_BOUND",
        safe: "Fake builtin-gated is switched off for this bot.",
      });
    } finally {
      gateOpen = true;
    }
    await expect(
      plugins.callTool(a, "bot-closed", "builtin-gated", "where", {}),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
    expect(
      JSON.parse(await plugins.callTool(a, "bot-a", "builtin-gated", "where", {})),
    ).toMatchObject({
      bot: "bot-a",
    });
  });

  test("the bot's prompt lists it only once activated and let in by its gate; otherwise it is offered as a setup", async () => {
    const { plugins } = world();
    expect(await plugins.promptFor(a, "bot-a", "chat")).not.toContain("- builtin-gated (");
    await plugins.install(a, "builtin-gated", {}, ["bot-a", "bot-closed"]);
    const on = await plugins.promptFor(a, "bot-a", "chat");
    expect(on).toContain("- builtin-gated (Fake builtin-gated)");
    expect(on).toContain("Use it only for tests.");
    expect(await plugins.promptFor(a, "bot-closed", "chat")).not.toContain("- builtin-gated (");
    expect(await plugins.promptFor(a, "bot-b", "chat")).not.toContain("- builtin-gated (");
  });

  test("it can be removed like any plugin, and then the bot loses it", async () => {
    const { plugins } = world();
    await plugins.install(a, "builtin-gated", {}, ["bot-a"]);
    await plugins.uninstall(a, "builtin-gated");
    await expect(plugins.callTool(a, "bot-a", "builtin-gated", "where", {})).rejects.toMatchObject({
      code: "NOT_BOUND",
    });
  });
});

describe("the context of a call", () => {
  // `config` is a getter that `setConfig` keeps current. A copy of the context would freeze it at the value before the call.
  test("a plugin that saves its configuration reads the new value back", async () => {
    const { plugins } = world();
    await plugins.install(a, "config-fresh", { k: "1" }, ["bot-a"]);
    const out = JSON.parse(
      await plugins.callTool(a, "bot-a", "config-fresh", "bump", {}, undefined, "chat"),
    );
    expect(out).toEqual({ before: "1", after: "2", turn: null });
  });
});
