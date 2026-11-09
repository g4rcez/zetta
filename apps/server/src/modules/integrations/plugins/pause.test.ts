import { describe, expect, test } from "bun:test";
import { PluginPause, registerPlugin, type PluginDef } from "./registry";
import { actor, world } from "./test-world";

/** Pausing tools: the service remembers which tool paused and checks a resume against it, for installed and built-in plugins. */
const pause = () =>
  new PluginPause(
    {
      requestId: "apr_1",
      mode: "approval",
      tool: "things.close",
      message: "Approve?",
      expiresAt: Date.now() + 60_000,
    },
    "pause-unit",
  );
const base = (id: string): Omit<PluginDef, "tools" | "fields" | "auth"> => ({
  id,
  name: id,
  description: "Only for the pause tests.",
  icon: "plug",
  category: "other",
  kind: "native",
});
const tools: PluginDef["tools"] = [
  {
    name: "ask",
    description: "stops",
    effect: "write",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      throw pause();
    },
  },
  {
    name: "other",
    description: "does not pause",
    inputSchema: { type: "object", properties: {} },
    async handler() {
      return "ok";
    },
  },
];
const seen: string[] = [];
const pausing: PluginDef["pausing"] = {
  async resume(_ctx, requestId, answer) {
    seen.push(`${requestId}:${answer.action}`);
    return "resumed";
  },
};
registerPlugin({ ...base("pause-unit"), auth: "none", fields: [], tools, pausing });
registerPlugin({
  ...base("pause-builtin"),
  auth: "none",
  fields: [],
  tools,
  pausing,
  always: { available: async (botId) => botId === "bot-yes" },
});

const a = actor("u1");
const accept = { action: "accept", content: {} } as const;

describe("an installed plugin", () => {
  test("a call that pauses carries the plugin tool that paused", async () => {
    const { plugins } = world();
    await plugins.install(a, "pause-unit", {}, ["bot-1"]);
    const e = await plugins.callTool(a, "bot-1", "pause-unit", "ask", {}).catch((x) => x);
    expect(e).toBeInstanceOf(PluginPause);
    expect((e as PluginPause).pluginTool).toBe("ask");
  });

  test("a resume runs for a bound bot and a tool the plugin has", async () => {
    const { plugins } = world();
    await plugins.install(a, "pause-unit", {}, ["bot-1"]);
    seen.length = 0;
    expect(await plugins.resumeTool(a, "bot-1", "pause-unit", "apr_1", accept, "ask")).toBe(
      "resumed",
    );
    expect(
      await plugins.resumeTool(a, "bot-1", "pause-unit", "apr_2", { action: "decline" }, "ask"),
    ).toBe("resumed");
    expect(seen).toEqual(["apr_1:accept", "apr_2:decline"]);
  });

  test("a tool the plugin does not have, or a bot that lost the plugin, is refused", async () => {
    const { plugins } = world();
    await plugins.install(a, "pause-unit", {}, ["bot-1"]);
    await expect(
      plugins.resumeTool(a, "bot-1", "pause-unit", "apr_1", accept, "nope"),
    ).rejects.toMatchObject({ code: "UNKNOWN_TOOL" });
    await expect(
      plugins.resumeTool(a, "bot-2", "pause-unit", "apr_1", accept, "ask"),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
    await expect(
      plugins.resumeTool(actor("u2"), "bot-1", "pause-unit", "apr_1", accept, "ask"),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
  });

  test("a plugin that never pauses cannot be resumed", async () => {
    const { plugins } = world();
    await expect(
      plugins.resumeTool(a, "bot-1", "no-such-plugin", "apr_1", accept, "ask"),
    ).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });

  test("a call that stops again carries the tool that was resumed", async () => {
    const { plugins } = world();
    const again: PluginDef = {
      ...base("pause-again"),
      auth: "none",
      fields: [],
      tools,
      pausing: {
        async resume() {
          throw pause();
        },
      },
    };
    registerPlugin(again);
    await plugins.install(a, "pause-again", {}, ["bot-1"]);
    const e = await plugins
      .resumeTool(a, "bot-1", "pause-again", "apr_1", accept, "ask")
      .catch((x) => x);
    expect(e).toBeInstanceOf(PluginPause);
    expect((e as PluginPause).pluginTool).toBe("ask");
  });
});

describe("a built-in plugin (no install, no binding)", () => {
  test("resumes for a bot it is available to, not for another", async () => {
    const { plugins } = world();
    seen.length = 0;
    expect(await plugins.resumeTool(a, "bot-yes", "pause-builtin", "apr_1", accept, "ask")).toBe(
      "resumed",
    );
    await expect(
      plugins.resumeTool(a, "bot-no", "pause-builtin", "apr_1", accept, "ask"),
    ).rejects.toMatchObject({ code: "NOT_BOUND" });
    expect(seen).toEqual(["apr_1:accept"]);
  });

  test("a call that pauses carries its tool here too", async () => {
    const { plugins } = world();
    const e = await plugins.callTool(a, "bot-yes", "pause-builtin", "ask", {}).catch((x) => x);
    expect((e as PluginPause).pluginTool).toBe("ask");
  });
});
