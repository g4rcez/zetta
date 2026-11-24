// The computers page (Studio and chat) asks `GET /api/computer/capabilities` for the drivers and systems a person may pick. The answer comes
// from the settings `vmDrivers` and `vmOs`, read on each request: a change shows at the next load, with no restart.
import { describe, expect, test } from "bun:test";
import { createComputerRoutes } from "./routes";
import { createVmService, type VmStore } from "./vm";
import { createTestSettings } from "../settings/testing";

const store = {
  list: async () => [],
  get: async () => undefined,
  ensureDefault: async () => undefined,
  create: async () => undefined,
  setDriver: async () => undefined,
  count: async () => 0,
  setStatus: async () => undefined,
  resetRunning: async () => undefined,
} as unknown as VmStore;

function setup() {
  const settings = createTestSettings();
  const vms = createVmService({
    store,
    docker: { bin: "docker", image: "x", memory: "1g", cpus: "1", pids: 64, shm: "64m" },
    tokenRoot: `${process.env.TMPDIR ?? "/tmp"}/zetta-vm-caps`,
    exec: async () => ({ code: 0, stdout: "" }),
    settings: settings.service,
  });
  const app = createComputerRoutes(
    {
      access: { requireActive: async () => ({ userId: "u", isAdmin: false }) } as never,
      computer: { capabilities: () => ({ note: "n" }) } as never,
      vms,
    },
    ["http://web.test"],
  );
  const capabilities = async () =>
    (await (
      await app.handle(new Request("http://localhost/api/computer/capabilities"))
    ).json()) as {
      targets: { vm: string[] };
      os: Array<{ id: string; available: boolean }>;
    };
  return { settings, capabilities };
}

describe("GET /api/computer/capabilities answers from the settings", () => {
  test("drivers and systems follow the stored lists, and the registry defaults when nothing is stored", async () => {
    const { settings, capabilities } = setup();
    let c = await capabilities();
    expect(c.targets.vm).toEqual(["cua"]);
    expect(c.os.filter((o) => o.available).map((o) => o.id)).toEqual(["debian"]);
    await settings.set("vmDrivers", ["cua", "agent-desktop"]);
    await settings.set("vmOs", ["debian", "ubuntu"]);
    c = await capabilities();
    expect(c.targets.vm).toEqual(["cua", "agent-desktop"]);
    expect(c.os.filter((o) => o.available).map((o) => o.id)).toEqual(["debian", "ubuntu"]);
    await settings.set("vmDrivers", ["agent-desktop"]);
    expect((await capabilities()).targets.vm).toEqual(["agent-desktop"]);
    await settings.unset("vmDrivers");
    await settings.unset("vmOs");
    c = await capabilities();
    expect(c.targets.vm).toEqual(["cua"]);
    expect(c.os.filter((o) => o.available).map((o) => o.id)).toEqual(["debian"]);
  });

  test("the old variables have no effect on the answer", async () => {
    const was = [process.env.ZETTA_VM_DRIVERS, process.env.ZETTA_VM_OS];
    try {
      process.env.ZETTA_VM_DRIVERS = "agent-desktop";
      process.env.ZETTA_VM_OS = "ubuntu";
      const { settings, capabilities } = setup();
      expect((await capabilities()).targets.vm).toEqual(["cua"]);
      await settings.set("vmDrivers", ["cua"]);
      process.env.ZETTA_VM_DRIVERS = "cua,agent-desktop";
      expect((await capabilities()).targets.vm).toEqual(["cua"]);
    } finally {
      for (const [k, v] of [
        ["ZETTA_VM_DRIVERS", was[0]],
        ["ZETTA_VM_OS", was[1]],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
