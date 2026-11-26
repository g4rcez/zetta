import { describe, expect, test } from "bun:test";
import { tenant } from "@zetta/db";
import { AccessError, type ActiveActor } from "../identity/access";
import { createSettingsService, SettingsError, type SettingChange } from "./service";
import { createMemorySettingsStore } from "./testing";

const ORG_A = "0192f3a0-0000-7000-8000-00000000000a";
const ORG_B = "0192f3a0-0000-7000-8000-00000000000b";
const admin = Object.freeze({ userId: "admin", isAdmin: true }) as ActiveActor;
const member = Object.freeze({ userId: "member", isAdmin: false }) as ActiveActor;

function setup(ttlMs = 5000) {
  const store = createMemorySettingsStore();
  let clock = 1_000_000;
  const audits: { userId: string; change: SettingChange }[] = [];
  const warnings: string[] = [];
  const make = () =>
    createSettingsService({
      store,
      ttlMs,
      now: () => clock,
      warn: (m) => warnings.push(m),
      audit: (userId, change) => audits.push({ userId, change }),
    });
  return { store, settings: make(), make, audits, warnings, tick: (ms: number) => (clock += ms) };
}

describe("get, set, unset", () => {
  test("nothing stored: the registry default, with source default", async () => {
    const { settings } = setup();
    expect(await settings.get("harnessMax")).toBe(8);
    expect(await settings.get("lightRuns")).toBe("off");
    expect(await settings.get("vmDrivers")).toEqual(["cua"]);
    expect(await settings.resolve("harnessMax")).toEqual({ value: 8, source: "default" });
  });

  test("set stores a validated value; the source is installation", async () => {
    const { settings } = setup();
    const v = await settings.set(admin, "harnessMax", 12, { via: "person" });
    expect(v).toMatchObject({
      key: "harnessMax",
      value: 12,
      source: "installation",
      installationValue: 12,
    });
    expect(await settings.get("harnessMax")).toBe(12);
    await settings.set(admin, "vmDrivers", [" cua ", "agent-desktop", "cua"], { via: "person" });
    expect(await settings.get("vmDrivers")).toEqual(["cua", "agent-desktop"]);
  });

  test("unset goes back to the default", async () => {
    const { settings } = setup();
    await settings.set(admin, "harnessMax", 12, { via: "person" });
    const v = await settings.unset(admin, "harnessMax", { via: "person" });
    expect(v).toMatchObject({ value: 8, source: "default", installationValue: null });
    expect(await settings.get("harnessMax")).toBe(8);
  });

  test("getMany and reader", async () => {
    const { settings } = setup();
    await settings.set(admin, "roomConcurrency", 2, { via: "person" });
    expect(await settings.getMany(["roomConcurrency", "lightRuns"])).toEqual({
      roomConcurrency: 2,
      lightRuns: "off",
    });
    const live = settings.reader("claudeLiveInput");
    expect(await live()).toBe("on");
    await settings.set(admin, "claudeLiveInput", "off", { via: "person" });
    expect(await live()).toBe("off");
  });

  test("a bad value, a boolean, an unknown key are refused in plain words", async () => {
    const { settings } = setup();
    const refused = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e) => e as SettingsError,
      );
    const range = await refused(settings.set(admin, "harnessMax", 0, { via: "person" }));
    expect(range).toBeInstanceOf(SettingsError);
    expect(range).toMatchObject({
      code: "INVALID",
      message: expect.stringContaining("between 1 and 1000"),
    });
    expect(await refused(settings.set(admin, "lightRuns", true, { via: "person" }))).toMatchObject({
      code: "INVALID",
    });
    expect(await refused(settings.set(admin, "nope", 1, { via: "person" }))).toMatchObject({
      code: "UNKNOWN_KEY",
    });
    expect(await refused(settings.unset(admin, "nope", { via: "person" }))).toMatchObject({
      code: "UNKNOWN_KEY",
    });
    expect(await settings.get("harnessMax")).toBe(8);
  });

  test("a stored value that is no longer valid is ignored with one warning", async () => {
    const { settings, store, warnings, tick } = setup();
    await store.upsert({ kind: "installation" }, "harnessMax", "lots", "someone");
    await store.upsert({ kind: "installation" }, "notAKey", 1, null);
    expect(await settings.get("harnessMax")).toBe(8);
    tick(10_000);
    expect(await settings.get("harnessMax")).toBe(8);
    expect(warnings).toEqual([
      "setting harnessMax has a stored value that is not valid, so its default is used.",
    ]);
  });
});

describe("who may", () => {
  test("only administrators write or list", async () => {
    const { settings } = setup();
    await expect(settings.set(member, "harnessMax", 3, { via: "person" })).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(settings.unset(member, "harnessMax", { via: "person" })).rejects.toBeInstanceOf(
      AccessError,
    );
    await expect(settings.list(member)).rejects.toBeInstanceOf(AccessError);
    expect(await settings.get("harnessMax")).toBe(8);
  });

  test("a workspace administrator who is not root changes what a workspace may have, and nothing of the whole server", async () => {
    const { settings } = setup();
    const workspaceAdmin = Object.freeze({
      userId: "ws-admin",
      isAdmin: true,
      isRoot: false,
      role: "admin",
      workspaceId: ORG_A,
    }) as ActiveActor;
    // `lightRuns` is a workspace's to choose: the value is that workspace's, read by what runs there, and the server's stays as it was.
    await settings.set(workspaceAdmin, "lightRuns", "on", { via: "person" });
    expect(await tenant.run(ORG_A, () => settings.get("lightRuns"))).toBe("on");
    expect(await settings.get("lightRuns")).toBe("off");
    expect(await tenant.run(ORG_B, () => settings.get("lightRuns"))).toBe("off");
    // Another workspace's value is not theirs to change.
    await expect(
      settings.set(workspaceAdmin, "lightRuns", "on", { via: "person", organizationId: ORG_B }),
    ).rejects.toBeInstanceOf(AccessError);
    await settings.unset(workspaceAdmin, "lightRuns", { via: "person" });
    expect(await tenant.run(ORG_A, () => settings.get("lightRuns"))).toBe("off");
    expect((await settings.list(workspaceAdmin)).settings.length).toBeGreaterThan(10);
    // `harnessMax` is one number for the server, `codeAccess` is security policy: both are root's.
    for (const [key, value] of [
      ["harnessMax", 3],
      ["hostRunner", "on"],
      ["codeAccess", "on"],
    ] as const) {
      await expect(
        settings.set(workspaceAdmin, key, value, { via: "person" }),
      ).rejects.toMatchObject({ code: "ROOT_ONLY" });
      await expect(settings.unset(workspaceAdmin, key, { via: "person" })).rejects.toMatchObject({
        code: "ROOT_ONLY",
      });
    }
    expect(await settings.get("harnessMax")).toBe(8);
    // Naming their own workspace is the same as naming none; another's is refused.
    await settings.set(workspaceAdmin, "lightRuns", "on", {
      via: "person",
      organizationId: ORG_A,
    });
    expect(await tenant.run(ORG_A, () => settings.get("lightRuns"))).toBe("on");
    await expect(
      settings.set(workspaceAdmin, "lightRuns", "on", { via: "person", organizationId: ORG_B }),
    ).rejects.toBeInstanceOf(AccessError);
    // Root changes all of it.
    const root = Object.freeze({ userId: "root", isAdmin: true, isRoot: true }) as ActiveActor;
    await settings.set(root, "harnessMax", 3, { via: "person" });
    expect(await settings.get("harnessMax")).toBe(3);
  });

  test("a bot or an MCP client cannot change a sensitive key; a person can", async () => {
    const { settings } = setup();
    for (const key of [
      "allowPrivateNetwork",
      "codeAccess",
      "mcpAllowlist",
      "mcpMemberStdio",
      "hostSkills",
    ]) {
      const value = key === "mcpAllowlist" ? ["npx -y x"] : "on";
      await expect(settings.set(admin, key, value, { via: "bot" })).rejects.toMatchObject({
        code: "SENSITIVE",
      });
      await expect(settings.unset(admin, key, { via: "bot" })).rejects.toMatchObject({
        code: "SENSITIVE",
      });
    }
    expect(await settings.get("allowPrivateNetwork")).toBe("off");
    await settings.set(admin, "allowPrivateNetwork", "on", { via: "person" });
    expect(await settings.get("allowPrivateNetwork")).toBe("on");
    // A bot may change one that is not sensitive.
    await settings.set(admin, "harnessMax", 5, { via: "bot" });
    expect(await settings.get("harnessMax")).toBe(5);
  });
});

describe("list", () => {
  test("every key with its value, source and metadata", async () => {
    const { settings, store } = setup();
    await settings.set(admin, "harnessMax", 12, { via: "person" });
    await store.insertMissing({ kind: "installation" }, "lightRuns", "on");
    settings.invalidate(); // written behind the service's back, as another process would
    const { groups, settings: all } = await settings.list(admin);
    expect(Object.keys(groups)).toContain("limits");
    expect(all.length).toBe(23);
    const by = Object.fromEntries(all.map((s) => [s.key, s]));
    expect(by.harnessMax).toMatchObject({
      value: 12,
      source: "installation",
      default: 8,
      sensitive: false,
      type: "integer",
    });
    expect(by.lightRuns).toMatchObject({ value: "on", source: "imported" });
    expect(by.embedding).toMatchObject({ value: "on", source: "default", scope: "organization" });
    expect(by.allowPrivateNetwork).toMatchObject({ sensitive: true, scope: "installation" });
    expect(by.codeAccess).toMatchObject({ sensitive: true, combine: "narrow" });
    expect(JSON.stringify(all)).not.toContain("fromEnv");
  });

  test("an administrator's own save replaces an imported source", async () => {
    const { settings, store } = setup();
    await store.insertMissing({ kind: "installation" }, "lightRuns", "on");
    expect((await settings.resolve("lightRuns")).source).toBe("imported");
    await settings.set(admin, "lightRuns", "on", { via: "person" });
    expect((await settings.resolve("lightRuns")).source).toBe("installation");
  });
});

describe("organizations (synthetic workspace ids)", () => {
  test("override: the organization value wins for that organization only", async () => {
    const { settings } = setup();
    await settings.set(admin, "claudeLiveInput", "off", { via: "person", organizationId: ORG_A });
    expect(await settings.get("claudeLiveInput", { organizationId: ORG_A })).toBe("off");
    expect(await settings.get("claudeLiveInput", { organizationId: ORG_B })).toBe("on");
    expect(await settings.get("claudeLiveInput")).toBe("on");
    expect(await settings.resolve("claudeLiveInput", { organizationId: ORG_A })).toEqual({
      value: "off",
      source: "organization",
    });
    const { settings: all } = await settings.list(admin, { organizationId: ORG_A });
    expect(all.find((s) => s.key === "claudeLiveInput")).toMatchObject({
      value: "off",
      source: "organization",
      organizationValue: "off",
      installationValue: null,
    });
  });

  test("narrow: an organization can lower a limit, not raise it", async () => {
    const { settings } = setup();
    await settings.set(admin, "artifactsQuota", 1000, { via: "person" });
    await settings.set(admin, "artifactsQuota", 400, { via: "person", organizationId: ORG_A });
    expect(await settings.get("artifactsQuota", { organizationId: ORG_A })).toBe(400);
    const raise = settings.set(admin, "artifactsQuota", 5000, {
      via: "person",
      organizationId: ORG_B,
    });
    await expect(raise).rejects.toMatchObject({
      code: "INVALID",
      message: expect.stringContaining("only be stricter"),
    });
    expect(await settings.get("artifactsQuota", { organizationId: ORG_B })).toBe(1000);
    // Lowering the installation afterwards: a stored organization value that is now looser is ignored.
    await settings.set(admin, "artifactsQuota", 100, { via: "person" });
    expect(await settings.get("artifactsQuota", { organizationId: ORG_A })).toBe(100);
  });

  test("narrow switch and list", async () => {
    const { settings } = setup();
    await settings.set(admin, "codeAccess", "off", { via: "person", organizationId: ORG_A });
    expect(await settings.get("codeAccess", { organizationId: ORG_A })).toBe("off");
    await settings.set(admin, "codeAccess", "off", { via: "person" });
    await expect(
      settings.set(admin, "codeAccess", "on", { via: "person", organizationId: ORG_B }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await settings.set(admin, "vmDrivers", ["cua", "agent-desktop"], { via: "person" });
    await settings.set(admin, "vmDrivers", ["cua"], { via: "person", organizationId: ORG_A });
    expect(await settings.get("vmDrivers", { organizationId: ORG_A })).toEqual(["cua"]);
    await settings.unset(admin, "vmDrivers", { via: "person" });
    await expect(
      settings.set(admin, "vmDrivers", ["agent-desktop"], { via: "person", organizationId: ORG_B }),
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  test("an installation-only key takes no organization value; a bad organization id is refused", async () => {
    const { settings } = setup();
    await expect(
      settings.set(admin, "harnessMax", 3, { via: "person", organizationId: ORG_A }),
    ).rejects.toMatchObject({ code: "SCOPE" });
    await expect(
      settings.set(admin, "claudeLiveInput", "off", { via: "person", organizationId: "x" }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(settings.list(admin, { organizationId: "x" })).rejects.toMatchObject({
      code: "INVALID",
    });
    expect(await settings.get("harnessMax", { organizationId: ORG_A })).toBe(8);
  });

  test("reset of an organization value leaves the installation value", async () => {
    const { settings } = setup();
    await settings.set(admin, "claudeLiveInput", "off", { via: "person" });
    await settings.set(admin, "claudeLiveInput", "on", { via: "person", organizationId: ORG_A });
    expect(await settings.get("claudeLiveInput", { organizationId: ORG_A })).toBe("on");
    await settings.unset(admin, "claudeLiveInput", { via: "person", organizationId: ORG_A });
    expect(await settings.get("claudeLiveInput", { organizationId: ORG_A })).toBe("off");
  });
});

describe("cache", () => {
  test("a hot path reads the store once per time-to-live", async () => {
    const { settings, store, tick } = setup(5000);
    for (let i = 0; i < 50; i++) await settings.get("harnessMax");
    expect(store.reads).toBe(1);
    tick(4999);
    await settings.get("harnessMax");
    expect(store.reads).toBe(1);
    tick(2);
    await settings.get("harnessMax");
    expect(store.reads).toBe(2);
  });

  test("a local write is seen at once", async () => {
    const { settings } = setup();
    expect(await settings.get("harnessMax")).toBe(8);
    await settings.set(admin, "harnessMax", 3, { via: "person" });
    expect(await settings.get("harnessMax")).toBe(3);
    await settings.unset(admin, "harnessMax", { via: "person" });
    expect(await settings.get("harnessMax")).toBe(8);
  });

  test("another instance sees the change within the time-to-live, not before", async () => {
    const { settings, make, tick } = setup(5000);
    const other = make();
    expect(await other.get("harnessMax")).toBe(8);
    await settings.set(admin, "harnessMax", 3, { via: "person" });
    expect(await other.get("harnessMax")).toBe(8);
    tick(5001);
    expect(await other.get("harnessMax")).toBe(3);
  });
});

describe("audit", () => {
  test("a change is recorded with the key and the scope, never the value", async () => {
    const { settings, audits } = setup();
    await settings.set(admin, "harnessMax", 12, { via: "person" });
    await settings.set(admin, "claudeLiveInput", "off", { via: "person", organizationId: ORG_A });
    await settings.unset(admin, "harnessMax", { via: "person" });
    await settings.unset(admin, "harnessMax", { via: "person" });
    expect(audits).toEqual([
      { userId: "admin", change: { key: "harnessMax", change: "set", scope: "installation" } },
      { userId: "admin", change: { key: "claudeLiveInput", change: "set", scope: "organization" } },
      { userId: "admin", change: { key: "harnessMax", change: "reset", scope: "installation" } },
    ]);
    expect(JSON.stringify(audits)).not.toContain("12");
  });

  test("a refused change leaves no audit line", async () => {
    const { settings, audits } = setup();
    await settings.set(member, "harnessMax", 12, { via: "person" }).catch(() => undefined);
    await settings.set(admin, "codeAccess", "off", { via: "bot" }).catch(() => undefined);
    await settings.set(admin, "harnessMax", 0, { via: "person" }).catch(() => undefined);
    expect(audits).toEqual([]);
  });
});
