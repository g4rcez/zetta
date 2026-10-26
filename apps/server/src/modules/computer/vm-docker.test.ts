import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliExec, createVmService, dockerVmConfig, type VmRow, type VmStore } from "./vm";

/**
 * Real containers from docker/desktop (build it first: `docker build -t zetta-desktop:latest docker/desktop`).
 * Run with ZETTA_VM_TEST=1; ZETTA_DOCKER_BIN=podman works too.
 */
const enabled = process.env.ZETTA_VM_TEST === "1";
function memoryStore(): VmStore {
  const rows: VmRow[] = [];
  const live = (u: string) => rows.filter((r) => r.ownerUserId === u && r.status !== "deleted");
  return {
    list: async (u) => live(u), get: async (u, id) => live(u).find((r) => r.id === id),
    ensureDefault: async (u) => { const hit = live(u).find((r) => r.kind === "default"); if (hit) return hit; const r: VmRow = { id: crypto.randomUUID(), ownerUserId: u, name: "Default", kind: "default", createdByBotId: null, purpose: null, status: "stopped", createdAt: new Date(), lastStartedAt: null, deletedAt: null }; rows.push(r); return r; },
    create: async () => { throw new Error("unused"); }, count: async (u) => live(u).length,
    setStatus: async (id, status) => { rows.find((r) => r.id === id)!.status = status; }, resetRunning: async () => {},
  };
}

describe.skipIf(!enabled)("vm service (real containers)", () => {
  test("two users get two desktops; navigation and AT-SPI reads work; home survives stop/start; delete removes the volume", async () => {
    const docker = dockerVmConfig({ ZETTA_DESKTOP_RUNTIME: "docker", ZETTA_DOCKER_BIN: process.env.ZETTA_DOCKER_BIN, ZETTA_VM_IMAGE: process.env.ZETTA_VM_IMAGE })!;
    const exec = createCliExec(docker.bin);
    const vms = createVmService({ store: memoryStore(), docker, tokenRoot: await mkdtemp(join(tmpdir(), "zetta-vm-real-")), allowPrivate: false });
    const a = await vms.start("alice"), b = await vms.start("bob");
    try {
      expect(a.id).not.toBe(b.id);
      const png = await vms.screenshot("alice", a.id);
      expect(Buffer.from(png, "base64").subarray(1, 4).toString()).toBe("PNG");
      await vms.act("alice", a.id, "agent", { type: "navigate", url: "https://example.com" });
      let text = "";
      for (let i = 0; i < 20 && !/Example Domain/.test(text); i++) { await Bun.sleep(500); text = await vms.read("alice", a.id); }
      expect(text).toContain("Example Domain");
      expect(await vms.read("bob", b.id)).not.toContain("Example Domain");

      // persistence: a file in home survives a stop/start of the same VM
      expect((await exec(["exec", `zetta-vm-${a.id}`, "sh", "-c", "echo kept > /home/agent/marker"])).code).toBe(0);
      await vms.stop("alice", a.id); await vms.start("alice", a.id);
      expect((await exec(["exec", `zetta-vm-${a.id}`, "cat", "/home/agent/marker"])).stdout.trim()).toBe("kept");
    } finally {
      await vms.remove("alice", a.id); await vms.remove("bob", b.id);
    }
    expect((await exec(["volume", "inspect", `zetta-vm-${a.id}`])).code).not.toBe(0);
  }, 240_000);
});
