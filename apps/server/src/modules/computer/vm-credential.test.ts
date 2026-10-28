import { uuidv7 } from "@zetta/core/uuid";
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpCall } from "./desktop";
import type { ComputerError } from "./service";
import { createVmService, type VmRow, type VmStore } from "./vm";

/** fillCredential against a fake spacesd that answers like cua-spacesd 0.8.0 did on a real VM (github.com/login). */
const ELEMENTS = [
  { role: "button", label: "View site information", description: "Secure", enabled: true, frame: { x: 130, y: 51, w: 24, h: 24 } },
  { role: "entry", label: "Address and search bar", enabled: true, frame: { x: 162, y: 51, w: 894, h: 24 } },
  { role: "entry", label: "Username or email address", enabled: true, in_web_content: true, frame: { x: 467, y: 274, w: 353, h: 40 } },
  { role: "password text", label: "Password", enabled: true, in_web_content: true, frame: { x: 467, y: 355, w: 353, h: 40 } },
];
function world(o: { url?: string; elements?: unknown[]; clipboard?: string; inactive?: boolean } = {}) {
  const calls: { tool: string; args: Record<string, unknown> }[] = []; let clipboard = o.clipboard ?? "user's own copy", omnibox = false, active = !o.inactive;
  const call: McpCall = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === "bring_to_front") { active = true; return { text: "ok", isError: false }; }
    if (args.delivery_mode === "foreground" && !active) return { text: "foreground_unavailable: window 0xe0011f did not become the active, focused window within 1.5s", isError: true };
    if (tool === "list_windows") return { text: 'Found 1 windows:\n  window_id=42 pid=7 "Sign in to GitHub · GitHub - Chromium" 1279x799+0+0 app=Chromium', isError: false };
    if (tool === "get_window_state") return { text: "", isError: false, structured: { elements: o.elements ?? ELEMENTS, window_bounds: { x: 0, y: 0, width: 1279, height: 799 } } };
    if (tool === "hotkey" && (args.keys as string[]).join("+") === "ctrl+l") omnibox = true;
    if (tool === "hotkey" && (args.keys as string[]).join("+") === "ctrl+c" && omnibox) clipboard = o.url ?? "https://github.com/login";
    if (tool === "clipboard_read") return { text: "Clipboard read succeeded", isError: false, structured: { text: clipboard } };
    if (tool === "clipboard_write") clipboard = String(args.text);
    return { text: "ok", isError: false };
  };
  const rows: VmRow[] = [];
  const store: VmStore = { list: async () => rows, get: async (_u, id) => rows.find((r) => r.id === id), ensureDefault: async (u) => { if (rows[0]) return rows[0]; const r = { id: uuidv7(), ownerUserId: u, name: "Default", kind: "default", createdByBotId: null, purpose: null, status: "stopped", createdAt: new Date(), lastStartedAt: null, deletedAt: null } as VmRow; rows.push(r); return r; }, create: async () => { throw 0; }, count: async () => rows.length, setStatus: async () => {}, resetRunning: async () => {} };
  return { calls, clip: () => clipboard, deactivate: () => { active = false; }, make: async () => createVmService({ store, docker: { bin: "docker", image: "x", memory: "1g", cpus: "1", pids: 64, shm: "64m" }, exec: async (a) => ({ code: a[0] === "start" ? 1 : 0, stdout: a[0] === "port" ? "127.0.0.1:1\n" : "" }), connect: async () => ({ call, close: async () => {} }), tokenRoot: await mkdtemp(join(tmpdir(), "zetta-vmc-")) }) };
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as ComputerError).code ?? String(e));

describe("vm fillCredential", () => {
  test("reads the real address, clicks the picked input, types the value, restores the clipboard", async () => {
    const w = world(); const vms = await w.make(); const vm = await vms.start("u1"); const seen: string[] = [];
    expect(await vms.fillCredential("u1", vm.id, "password", async (url) => { seen.push(url); return "hunter2"; })).toEqual({ label: "Password" });
    expect(seen).toEqual(["https://github.com/login"]);
    const after = w.calls.slice(w.calls.findIndex((c) => c.tool === "get_window_state"));
    const click = after.find((c) => c.tool === "click")!; expect(click.args).toMatchObject({ x: 644, y: 375 });
    expect(after[after.indexOf(click) + 1]).toMatchObject({ tool: "type_text", args: { text: "hunter2" } });
    expect(w.clip()).toBe("user's own copy");
    expect(after.filter((c) => c.tool === "press_key").map((c) => c.args.key)).toEqual(["Escape"]);
  });
  test("nothing is revealed or typed on an insecure page, without a fitting input, or when the address cannot be read", async () => {
    for (const [o, field, want] of [
      [{ elements: [{ role: "button", label: "Not secure", enabled: true, frame: { x: 1, y: 1, w: 9, h: 9 } }, ...ELEMENTS.slice(1)] }, "password", "INSECURE"],
      [{ elements: ELEMENTS.slice(0, 3) }, "password", "NO_INPUT"],
      [{}, "totp", "NO_INPUT"],
      [{ url: "github.com/login" }, "password", "NO_ADDRESS"],
    ] as const) {
      const w = world(o as never); const vms = await w.make(); const vm = await vms.start("u1"); let revealed = false;
      expect(await code(vms.fillCredential("u1", vm.id, field, async () => { revealed = true; return "x"; }))).toBe(want);
      expect(revealed).toBe(false); expect(w.calls.some((c) => c.tool === "type_text")).toBe(false);
    }
  });
  test("input refused because no window is active is retried once after activating Chromium", async () => {
    const w = world({ inactive: true }); const vms = await w.make(); const vm = await vms.start("u1");
    expect(w.calls.some((c) => c.tool === "bring_to_front")).toBe(true); // a fresh VM has no active window: start activates Chromium
    w.deactivate(); w.calls.length = 0; // focus lost again (e.g. a person closed a window over VNC)
    await vms.act("u1", vm.id, "agent", { type: "navigate", url: "https://example.com" });
    expect(w.calls.map((c) => c.tool)).toEqual(["hotkey", "list_windows", "bring_to_front", "hotkey", "type_text", "press_key"]);
  });
  test("a person in control, another user's VM, or a refused reveal stop it", async () => {
    const w = world(); const vms = await w.make(); const vm = await vms.start("u1");
    expect(await code(vms.fillCredential("u2", vm.id, "password", async () => "x"))).toBe("NOT_FOUND");
    expect(await code(vms.fillCredential("u1", vm.id, "password", async () => { throw new Error("ORIGIN_MISMATCH"); }))).toBe("Error: ORIGIN_MISMATCH");
    expect(w.calls.some((c) => c.tool === "type_text")).toBe(false);
    vms.takeover("u1", vm.id, true);
    expect(await code(vms.fillCredential("u1", vm.id, "password", async () => "x"))).toBe("HUMAN_IN_CONTROL");
  });
});
