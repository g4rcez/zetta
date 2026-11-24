// Code access: the setting `codeAccess` and the install (open to the network without Docker) decide, at every call; the old variable has no
// effect and nothing writes the process environment any more.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { codeEnabled } from "../chat/pipeline";
import { codeAccessOn, configureCodeAccess } from "../chat/code-access";
import { pickRunner } from "../playground/host-gate";
import { createCodeAccess } from "./code-access";
import { createMemorySettingsStore, createTestSettings } from "./testing";
import { createSettingsService } from "./service";

const bot = { codeAccess: true, harness: "claude-code" } as const;

async function build(o: { mode?: "local" | "network"; runtime?: string } = {}) {
  const t = createTestSettings();
  await t.service.warm();
  let mode = o.mode ?? "local";
  let runtime = o.runtime;
  const access = createCodeAccess({
    settings: t.service,
    networkMode: () => mode,
    harnessRuntime: () => runtime,
  });
  return {
    ...t,
    access,
    setMode: (m: "local" | "network") => (mode = m),
    setRuntime: (r: string | undefined) => (runtime = r),
  };
}
afterEach(() => configureCodeAccess(() => true));

describe("code access", () => {
  test("on by default; the setting off turns it off for every bot at once, on turns it back, with no restart", async () => {
    const { access, set, unset } = await build();
    configureCodeAccess(access.allowed);
    const bots = [bot, { ...bot }, { codeAccess: true, harness: "codex" } as never];
    expect(bots.every((b) => codeEnabled(b, "u1"))).toBe(true);
    await set("codeAccess", "off");
    expect(bots.some((b) => codeEnabled(b, "u1"))).toBe(false);
    expect(access.verdict()).toBe("setting_off");
    await set("codeAccess", "on");
    expect(bots.every((b) => codeEnabled(b, "u1"))).toBe(true);
    await set("codeAccess", "off");
    await unset("codeAccess");
    expect(codeEnabled(bot, "u1")).toBe(true);
  });

  test("a bot whose own switch is off never runs code, whatever the setting says", async () => {
    const { access } = await build();
    configureCodeAccess(access.allowed);
    expect(codeEnabled({ ...bot, codeAccess: false }, "u1")).toBe(false);
  });

  test("on plus network mode without Docker is off; on plus Docker, or local mode, is on", async () => {
    const { access, setMode, setRuntime } = await build({ mode: "network" });
    expect(access.allowed()).toBe(false);
    expect(access.verdict()).toBe("open_network_without_docker");
    setRuntime("docker");
    expect(access.allowed()).toBe(true);
    setRuntime("host");
    expect(access.allowed()).toBe(false);
    setMode("local");
    expect(access.allowed()).toBe(true);
    setMode("network");
    setRuntime(undefined);
    expect(access.allowed()).toBe(false);
  });

  test('on an open network without Docker, only a saved "on" accepts the risk: the default and off do not', async () => {
    const { access, set, unset, service } = await build({ mode: "network" });
    // A write drops the cache; the synchronous reader answers again once it is refilled.
    const refilled = () => service.warm();
    // Never chosen: the registry default is "on" but nobody saved it, so code stays off.
    expect(access.allowed()).toBe(false);
    await set("codeAccess", "on");
    await refilled();
    expect(access.verdict()).toBeNull();
    expect(access.allowed()).toBe(true);
    await set("codeAccess", "off");
    await refilled();
    // An explicit "off" does not opt in either (the network reason is reported first).
    expect(access.allowed()).toBe(false);
    await unset("codeAccess");
    await refilled();
    expect(access.verdict()).toBe("open_network_without_docker");
  });

  test("the setting off wins over Docker and local mode too", async () => {
    const { access, set } = await build({ mode: "network", runtime: "docker" });
    expect(access.allowed()).toBe(true);
    await set("codeAccess", "off");
    expect(access.allowed()).toBe(false);
  });

  test("the playground's host runner follows the same answer", async () => {
    const { access, set } = await build();
    const runners = { host: (async () => ({})) as never };
    expect(pickRunner(runners, "host", access.allowed)).toMatchObject({ runner: runners.host });
    await set("codeAccess", "off");
    expect(pickRunner(runners, "host", access.allowed)).toEqual({ refused: "host_off" });
  });

  test("fails closed when the value is unknown (never read, or the database has not answered for a long time)", async () => {
    const store = createMemorySettingsStore();
    let clock = 0;
    const service = createSettingsService({ store, now: () => clock, ttlMs: 1000 });
    const access = createCodeAccess({
      settings: service,
      networkMode: () => "local",
      harnessRuntime: () => "docker",
    });
    expect(access.allowed()).toBe(false);
    expect(access.verdict()).toBe("unknown");
    await service.warm();
    expect(access.allowed()).toBe(true);
    store.readScope = async () => {
      throw new Error("down");
    };
    clock += 10_000;
    expect(access.allowed()).toBe(false);
  });

  test("the old variable has no effect, and nothing writes it", async () => {
    const saved = process.env.ZETTA_CODE_ACCESS;
    try {
      delete process.env.ZETTA_CODE_ACCESS;
      const { access, set } = await build({ mode: "network" });
      configureCodeAccess(access.allowed);
      expect(codeEnabled(bot, "u1")).toBe(false);
      process.env.ZETTA_CODE_ACCESS = "on";
      expect(codeEnabled(bot, "u1")).toBe(false);
      delete process.env.ZETTA_CODE_ACCESS;
      const local = await build({ mode: "local" });
      configureCodeAccess(local.access.allowed);
      process.env.ZETTA_CODE_ACCESS = "off";
      expect(codeEnabled(bot, "u1")).toBe(true);
      await local.set("codeAccess", "off");
      process.env.ZETTA_CODE_ACCESS = "host";
      expect(codeEnabled(bot, "u1")).toBe(false);
      void set;
      // Computing the verdict leaves the environment as it was.
      delete process.env.ZETTA_CODE_ACCESS;
      access.verdict();
      expect(process.env.ZETTA_CODE_ACCESS).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.ZETTA_CODE_ACCESS;
      else process.env.ZETTA_CODE_ACCESS = saved;
    }
  });

  test("before services.ts configures it, the registry default holds: on", () => {
    expect(codeAccessOn()).toBe(true);
  });

  test("the boot code in services.ts no longer writes the process environment", () => {
    const source = readFileSync(new URL("../../services.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env\.ZETTA_CODE_ACCESS\s*=/);
    expect(source).not.toMatch(/process\.env\.ZETTA_CODE_ACCESS/);
    expect(source).not.toMatch(/process\.env\.ZETTA_ALLOW_PRIVATE_NETWORK/);
    expect(source).toContain("configureCodeAccess(codeAccess.allowed)");
  });
});
