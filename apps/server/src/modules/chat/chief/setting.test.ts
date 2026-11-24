// The Chief's `zetta:setting` block against the real settings service on an in-memory store: what it reads, which changes are cards, that a
// security-policy key is refused with the Studio sentence, that only an administrator uses it, and that nothing is remembered.
import { describe, expect, test } from "bun:test";
import { settingDefault } from "@zetta/core/settings";
import { actionKeyOf, canRemember, NEVER_REMEMBERED_TOOLS } from "../approval-rules";
import { parseTools } from "../tools";
import { createSettingsService } from "../../settings/service";
import { createMemorySettingsStore } from "../../settings/testing";
import { applySetting, runSetting } from "./setting";
import { chiefSchemas } from "./schemas";

const fence = (body: string) => "```zetta:setting\n" + body + "\n```";
const admin = { userId: "u", isAdmin: true } as never;
const member = { userId: "m", isAdmin: false } as never;

function setup(isAdmin = true) {
  const settings = createSettingsService({ store: createMemorySettingsStore(), ttlMs: 0 });
  const ctx = { actor: isAdmin ? admin : member, deps: { settings } } as never;
  return { settings, ctx };
}
const run = (ctx: never, body: object) =>
  runSetting(ctx, chiefSchemas.setting.parse(body) as never);

describe("zetta:setting", () => {
  test("is parsed from a block and never remembered", () => {
    const parsed = parseTools(fence('{"action":"get","key":"harnessMax"}'));
    expect(parsed.calls[0]?.kind).toBe("setting");
    expect(NEVER_REMEMBERED_TOOLS.has("setting")).toBe(true);
    const patch = { tool: "setting", op: "set", key: "harnessMax", value: 3 };
    expect(actionKeyOf("chief_action", patch)).toBe("setting");
    expect(canRemember("chief_action", patch)).toBe(false);
  });

  test("list answers at once, with sources, and shows no sensitive key as changeable", async () => {
    const { ctx } = setup();
    const out = (await run(ctx, { action: "list", group: "security" })) as { read: string };
    expect(out.read).toContain("setting.list");
    expect(out.read).toContain("codeAccess");
    expect(out.read).toContain('"securityPolicy":true');
    expect(out.read).toContain('"source":"default"');
    expect(out.read).not.toContain("harnessMax");
  });

  test("get answers at once with the value of a plain key", async () => {
    const { ctx } = setup();
    const out = (await run(ctx, { action: "get", key: "harnessMax" })) as { read: string };
    expect(out.read).toContain(`"value":${settingDefault("harnessMax")}`);
  });

  test("get of a sensitive key says where it stands but shows no value", async () => {
    const { ctx } = setup();
    const out = (await run(ctx, { action: "get", key: "allowPrivateNetwork" })) as { read: string };
    expect(out.read).toContain("Studio > Server settings");
    expect(out.read).toContain('"source":"default"');
    expect(out.read).not.toContain('"value"');
  });

  test("set is a card, and approving it saves the value", async () => {
    const { ctx, settings } = setup();
    const out = (await run(ctx, { action: "set", key: "harnessMax", value: 3 })) as {
      plan: { patch: Record<string, unknown>; diff: unknown[] };
    };
    expect(out.plan.patch).toEqual({ tool: "setting", op: "set", key: "harnessMax", value: 3 });
    expect(out.plan.diff).toHaveLength(1);
    expect(await settings.get("harnessMax")).toBe(settingDefault("harnessMax"));
    await applySetting(ctx, out.plan.patch);
    expect(await settings.get("harnessMax")).toBe(3);
  });

  test("a key can be found by its label, and a bad value is refused before any card", async () => {
    const { ctx } = setup();
    const byLabel = await run(ctx, { action: "set", key: "Light background runs", value: "on" });
    expect("plan" in byLabel).toBe(true);
    const bad = (await run(ctx, { action: "set", key: "harnessMax", value: -4 })) as {
      error: string;
    };
    expect(bad.error.length).toBeGreaterThan(0);
    expect(((await run(ctx, { action: "get", key: "nope" })) as { error: string }).error).toContain(
      "no setting",
    );
  });

  test("reset is a card only when something differs from the default", async () => {
    const { ctx, settings } = setup();
    const none = (await run(ctx, { action: "reset", key: "harnessMax" })) as { error: string };
    expect(none.error).toContain("already");
    await settings.set(admin, "harnessMax", 2, { via: "person" });
    const card = (await run(ctx, { action: "reset", key: "harnessMax" })) as {
      plan: { patch: Record<string, unknown> };
    };
    await applySetting(ctx, card.plan.patch);
    expect(await settings.get("harnessMax")).toBe(settingDefault("harnessMax"));
  });

  test("a sensitive key is refused by set and reset with the Studio sentence", async () => {
    const { ctx, settings } = setup();
    for (const body of [
      { action: "set", key: "allowPrivateNetwork", value: "on" },
      { action: "reset", key: "codeAccess" },
    ]) {
      const out = (await run(ctx, body)) as { error: string };
      expect(out.error).toContain("Studio > Server settings");
      expect(out.error).toContain("security policy");
    }
    expect(await settings.get("allowPrivateNetwork")).toBe(settingDefault("allowPrivateNetwork"));
  });

  test("even a forged card for a sensitive key is refused when applied", async () => {
    const { ctx, settings } = setup();
    await expect(
      applySetting(ctx, { tool: "setting", op: "set", key: "allowPrivateNetwork", value: "on" }),
    ).rejects.toThrow("Studio > Server settings");
    expect(await settings.get("allowPrivateNetwork")).toBe(settingDefault("allowPrivateNetwork"));
  });

  test("a person who is not an administrator is refused, even to read", async () => {
    const { ctx } = setup(false);
    for (const body of [
      { action: "list" },
      { action: "get", key: "harnessMax" },
      { action: "set", key: "harnessMax", value: 2 },
    ])
      expect(((await run(ctx, body)) as { error: string }).error).toContain("administrator");
  });

  test("without the service it says so", async () => {
    const out = await runSetting(
      { actor: admin, deps: {} } as never,
      chiefSchemas.setting.parse({ action: "list" }) as never,
    );
    expect("error" in out).toBe(true);
  });
});
