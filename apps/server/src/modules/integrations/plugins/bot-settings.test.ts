import { describe, expect, test } from "bun:test";
import { registerPlugin, type PluginDef } from "./registry";
import { actor, world } from "./test-world";

const chat: PluginDef = {
  id: "fake-channel",
  name: "Fake channel",
  description: "A channel with push.",
  icon: "message-circle",
  category: "messaging",
  kind: "native",
  auth: "api-key",
  fields: [
    { key: "apiKey", label: "API key", secret: true, kind: "password", botEditable: true },
    { key: "baseUrl", label: "Server address", kind: "url", optional: true },
    { key: "hookUrl", label: "Push address", kind: "url", optional: true, botEditable: true },
    { key: "timeFormat", label: "Time format", optional: true, botEditable: true },
  ],
  inbound: {
    label: "FakeChannel",
    reply: { tool: "send", chatArg: "chat", normalize: (c) => c },
    poll: async () => ({ events: [], cursor: null }),
  },
  tools: [
    {
      name: "send",
      description: "send",
      inputSchema: { type: "object", properties: { chat: { type: "string" } } },
      handler: async () => "ok",
    },
  ],
};
registerPlugin(chat);
describe("settings a bot may read and propose", () => {
  test("a plugin that is not installed shows nothing to change", async () => {
    const { plugins } = world();
    expect(await plugins.botSettings(actor("u1"), "fake-channel")).toEqual({
      name: "Fake channel",
      installed: false,
      settings: [],
    });
  });

  test("only the settings the plugin allows appear, with their values; secrets and other fields never do", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(
      a,
      "fake-channel",
      { apiKey: "key-u1", hookUrl: "http://old.test:3000", baseUrl: "http://waha.test" },
      [],
    );
    const seen = await plugins.botSettings(a, "fake-channel");
    expect(seen.settings).toEqual([
      { key: "hookUrl", label: "Push address", value: "http://old.test:3000" },
      { key: "timeFormat", label: "Time format", value: "" },
    ]);
    expect(JSON.stringify(seen)).not.toContain("key-u1");
    expect(JSON.stringify(seen)).not.toContain("waha.test");
  });

  test("a proposal says exactly what would change, and saves nothing", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(
      a,
      "fake-channel",
      { apiKey: "key-u1", hookUrl: "http://old.test:3000" },
      [],
    );
    const proposal = await plugins.proposeSettings(a, "fake-channel", {
      hookUrl: "http://host.docker.internal:3000",
      timeFormat: "24h",
    });
    expect(proposal.changes).toEqual([
      {
        key: "hookUrl",
        label: "Push address",
        from: "http://old.test:3000",
        to: "http://host.docker.internal:3000",
      },
      { key: "timeFormat", label: "Time format", from: "", to: "24h" },
    ]);
    expect((await plugins.botSettings(a, "fake-channel")).settings[0]!.value).toBe(
      "http://old.test:3000",
    );
  });

  test("a value that is already saved is not a change", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-channel", { apiKey: "key-u1", timeFormat: "24h" }, []);
    expect(
      (await plugins.proposeSettings(a, "fake-channel", { timeFormat: "24h" })).changes,
    ).toEqual([]);
  });

  test("a bot cannot propose a secret, an address the plugin did not open, or an unknown setting", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-channel", { apiKey: "key-u1" }, []);
    await expect(
      plugins.proposeSettings(a, "fake-channel", { apiKey: "stolen" }),
    ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(
      plugins.proposeSettings(a, "fake-channel", { baseUrl: "http://evil.test" }),
    ).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    await expect(plugins.proposeSettings(a, "fake-channel", { nope: "x" })).rejects.toMatchObject({
      code: "NOT_ALLOWED",
    });
  });

  test("an address must be http or https", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-channel", { apiKey: "key-u1" }, []);
    await expect(
      plugins.proposeSettings(a, "fake-channel", { hookUrl: "file:///etc/passwd" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
  });

  test("another user's settings are out of reach", async () => {
    const { plugins } = world();
    await plugins.install(
      actor("u1"),
      "fake-channel",
      { apiKey: "key-u1", hookUrl: "http://old.test:3000" },
      [],
    );
    expect((await plugins.botSettings(actor("u2"), "fake-channel")).installed).toBe(false);
    await expect(
      plugins.proposeSettings(actor("u2"), "fake-channel", { hookUrl: "http://x.test" }),
    ).rejects.toBeDefined();
  });

  test("the bot is taught the block only for a plugin that has incoming messages, with the settings it may propose", async () => {
    const { plugins } = world();
    const a = actor("u1");
    await plugins.install(a, "fake-channel", { apiKey: "key-u1" }, ["bot1"]);
    const prompt = await plugins.promptFor(a, "bot1");
    expect(prompt).toContain("zetta:inbound");
    expect(prompt).toContain("hookUrl (Push address), timeFormat (Time format)");
    expect(prompt).not.toContain("baseUrl (");
  });
});
