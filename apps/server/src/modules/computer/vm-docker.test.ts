import { uuidv7 } from "@zetta/core/uuid";
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliExec, createVmService, dockerVmConfig, type VmRow, type VmStore } from "./vm";
import { openVncBridge } from "./vnc";

/**
 * Real containers from docker/desktop (build it first: `docker build -t zetta-desktop:latest docker/desktop`).
 * Run with ZETTA_VM_TEST=1; ZETTA_DOCKER_BIN=podman works too. Token files are bind-mounted: when the engine runs in a VM that does not
 * share the system temp folder (Docker on macOS through colima/lima), set ZETTA_VM_TOKEN_ROOT to a shared folder (e.g. under $HOME).
 */
const enabled = process.env.ZETTA_VM_TEST === "1";
function memoryStore(): VmStore {
  const rows: VmRow[] = [];
  const live = (u: string) => rows.filter((r) => r.ownerUserId === u && r.status !== "deleted");
  return {
    list: async (u) => live(u),
    get: async (u, id) => live(u).find((r) => r.id === id),
    ensureDefault: async (u) => {
      const hit = live(u).find((r) => r.kind === "default");
      if (hit) return hit;
      const r: VmRow = {
        id: uuidv7(),
        ownerUserId: u,
        name: "Default",
        kind: "default",
        target: "vm",
        driver: "cua",
        os: "debian",
        createdByBotId: null,
        purpose: null,
        status: "stopped",
        createdAt: new Date(),
        lastStartedAt: null,
        deletedAt: null,
        endpoint: null,
        connectionId: null,
      };
      rows.push(r);
      return r;
    },
    create: async () => {
      throw new Error("unused");
    },
    setDriver: async () => {},
    count: async (u) => live(u).length,
    setStatus: async (id, status) => {
      rows.find((r) => r.id === id)!.status = status;
    },
    resetRunning: async () => {},
  };
}

describe.skipIf(!enabled)("vm service (real containers)", () => {
  test("two users get two desktops; navigation and AT-SPI reads work; home survives stop/start; delete removes the volume", async () => {
    const docker = dockerVmConfig({
      ZETTA_DESKTOP_RUNTIME: "docker",
      ZETTA_DOCKER_BIN: process.env.ZETTA_DOCKER_BIN,
      ZETTA_VM_IMAGE: process.env.ZETTA_VM_IMAGE,
    })!;
    const exec = createCliExec(docker.bin);
    const vms = createVmService({
      store: memoryStore(),
      docker,
      tokenRoot: await mkdtemp(join(process.env.ZETTA_VM_TOKEN_ROOT ?? tmpdir(), "zetta-vm-real-")),
      allowPrivate: false,
    });
    const a = await vms.start("alice"),
      b = await vms.start("bob");
    try {
      expect(a.id).not.toBe(b.id);
      const png = await vms.screenshot("alice", a.id);
      expect(Buffer.from(png, "base64").subarray(1, 4).toString()).toBe("PNG");
      await vms.act("alice", a.id, "agent", { type: "navigate", url: "https://example.com" });
      let text = "";
      for (let i = 0; i < 20 && !/Example Domain/.test(text); i++) {
        await Bun.sleep(500);
        text = await vms.read("alice", a.id);
      }
      expect(text).toContain("Example Domain");
      expect(await vms.read("bob", b.id)).not.toContain("Example Domain");

      // VNC: the server authenticates to x11vnc; a browser-side handshake then gets ServerInit with the 1280x800 screen
      const viewer = vms.vncViewer(vms.vncTicket("alice", a.id), a.id);
      const sent: Buffer[] = [];
      const bridge = await openVncBridge({
        port: viewer.port,
        password: viewer.password,
        viewer: {
          send: (x) => {
            sent.push(Buffer.from(x));
          },
          close: () => {},
        },
      });
      bridge.fromViewer(Buffer.from("RFB 003.008\n"));
      bridge.fromViewer(Uint8Array.of(1));
      bridge.fromViewer(Uint8Array.of(1));
      for (let i = 0; i < 50 && Buffer.concat(sent).length < 12 + 2 + 4 + 24; i++)
        await Bun.sleep(100);
      const init = Buffer.concat(sent).subarray(18);
      expect([init.readUInt16BE(0), init.readUInt16BE(2)]).toEqual([1280, 800]);
      bridge.close();
      viewer.release();

      // persistence: a file in home survives a stop/start of the same VM
      expect(
        (await exec(["exec", `zetta-vm-${a.id}`, "sh", "-c", "echo kept > /home/agent/marker"]))
          .code,
      ).toBe(0);
      await vms.stop("alice", a.id);
      await vms.start("alice", a.id);
      expect(
        (await exec(["exec", `zetta-vm-${a.id}`, "cat", "/home/agent/marker"])).stdout.trim(),
      ).toBe("kept");
    } finally {
      await vms.remove("alice", a.id);
      await vms.remove("bob", b.id);
    }
    expect((await exec(["volume", "inspect", `zetta-vm-${a.id}`])).code).not.toBe(0);
  }, 240_000);

  test("a cold start then navigate lands on the page: the very next read shows it, and a page the browser refuses is NAVIGATION_FAILED with its error", async () => {
    const docker = dockerVmConfig({
      ZETTA_DESKTOP_RUNTIME: "docker",
      ZETTA_DOCKER_BIN: process.env.ZETTA_DOCKER_BIN,
      ZETTA_VM_IMAGE: process.env.ZETTA_VM_IMAGE,
    })!;
    const vms = createVmService({
      store: memoryStore(),
      docker,
      tokenRoot: await mkdtemp(join(process.env.ZETTA_VM_TOKEN_ROOT ?? tmpdir(), "zetta-vm-nav-")),
      allowPrivate: false,
    });
    const vm = await vms.start("dave");
    try {
      // Straight after the start, as a bot does: no waiting, no polling.
      const at = await vms.act("dave", vm.id, "agent", {
        type: "navigate",
        url: "https://example.com/",
      });
      expect(at).toMatchObject({ url: "https://example.com/", loaded: true });
      expect(await vms.read("dave", vm.id)).toContain("Example Domain");
      const e = await vms
        .act("dave", vm.id, "agent", { type: "navigate", url: "https://expired.badssl.com/" })
        .catch((x) => x);
      expect(e).toMatchObject({ code: "NAVIGATION_FAILED", detail: "net::ERR_CERT_DATE_INVALID" });
    } finally {
      await vms.remove("dave", vm.id);
    }
  }, 240_000);

  test("a credential fill reads the real address and types into the right inputs of a real sign-in page", async () => {
    const docker = dockerVmConfig({
      ZETTA_DESKTOP_RUNTIME: "docker",
      ZETTA_DOCKER_BIN: process.env.ZETTA_DOCKER_BIN,
      ZETTA_VM_IMAGE: process.env.ZETTA_VM_IMAGE,
    })!;
    const vms = createVmService({
      store: memoryStore(),
      docker,
      tokenRoot: await mkdtemp(join(process.env.ZETTA_VM_TOKEN_ROOT ?? tmpdir(), "zetta-vm-cred-")),
      allowPrivate: false,
    });
    const vm = await vms.start("carol");
    try {
      await vms.act("carol", vm.id, "agent", { type: "navigate", url: "https://github.com/login" });
      for (
        let i = 0;
        i < 30 && !/password text "Password"/.test(await vms.read("carol", vm.id));
        i++
      )
        await Bun.sleep(1000);
      const urls: string[] = [];
      const reveal = (v: string) => async (url: string) => {
        urls.push(url);
        return v;
      };
      expect(
        await vms.fillCredential("carol", vm.id, "username", reveal("zetta-probe-user")),
      ).toEqual({ label: "Username or email address" });
      expect(
        await vms.fillCredential("carol", vm.id, "password", reveal("not-a-real-password")),
      ).toEqual({ label: "Password" });
      expect(urls).toEqual(["https://github.com/login", "https://github.com/login"]);
      expect(
        await vms.fillCredential("carol", vm.id, "totp", reveal("000000")).catch((e) => e.code),
      ).toBe("NO_INPUT"); // no code box on this page
      // read the username back out of its input (a password input refuses copy): it is in the field the server picked
      // focus is in the password box after the fill: Shift+Tab goes back to the username box, whatever the page layout is
      await vms.act("carol", vm.id, "agent", { type: "key", key: "shift+Tab" });
      await vms.act("carol", vm.id, "agent", { type: "key", key: "ctrl+a" });
      await vms.act("carol", vm.id, "agent", { type: "key", key: "ctrl+c" });
      if (process.env.ZETTA_VM_SHOT)
        await Bun.write(
          process.env.ZETTA_VM_SHOT,
          Buffer.from(await vms.screenshot("carol", vm.id), "base64"),
        );
      const exec = createCliExec(docker.bin);
      expect(
        (
          await exec([
            "exec",
            `zetta-vm-${vm.id}`,
            "sh",
            "-c",
            "DISPLAY=:1 xclip -o -selection clipboard",
          ])
        ).stdout,
      ).toBe("zetta-probe-user");
    } finally {
      await vms.remove("carol", vm.id);
    }
  }, 240_000);
});
