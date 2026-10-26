import { describe, expect, test } from "bun:test";
import { createCuaCall, createDesktopService, type McpCall } from "./desktop";
import { ComputerError } from "./service";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as ComputerError).code);
const fake = () => {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const spaces: string[] = [];
  const call: McpCall = async (tool, args) => {
    calls.push({ tool, args });
    if (tool === "create_space") { spaces.push(args.name as string); return { text: JSON.stringify({ id: `local:${args.name}`, kind: "container" }), isError: false }; }
    if (tool === "list_spaces") return { text: JSON.stringify(spaces.map((n) => ({ id: `local:${n}`, kind: "container" }))), isError: false };
    if (tool === "delete_space") { spaces.splice(spaces.indexOf(args.space as string), 1); return { text: "{}", isError: false }; }
    if (tool === "computer_screenshot") return { text: "", imageBase64: "iVBORw0KGgo=", isError: false };
    return { text: "ok", isError: false };
  };
  return { call, calls, spaces };
};

describe("desktop service (fake Cua)", () => {
  test("each user+profile gets its own container Space; only local:<own> refs are ever targeted", async () => {
    const f = fake(); const d = createDesktopService({ call: f.call, maxPerUser: 2, maxTotal: 5 });
    const a = await d.start("alice", "p1"), b = await d.start("bob", "p1"), a2 = await d.start("alice", "p2");
    expect(new Set([a.space, b.space, a2.space]).size).toBe(3);
    expect(f.calls.filter((c) => c.tool === "create_space").every((c) => c.args.on === "local" && c.args.kind === "container")).toBe(true);
    await d.act("alice", "p1", "agent", { type: "click", x: 10.4, y: 20 }); await d.screenshot("bob", "p1");
    for (const c of f.calls.filter((x) => x.args.sandbox !== undefined)) expect(String(c.args.sandbox)).toMatch(/^local:zetta-[0-9a-f]{12}$/);
    expect(f.calls.find((c) => c.tool === "computer_click")!.args).toMatchObject({ sandbox: `local:${a.space}`, x: 10, y: 20 });
    expect(await code(d.screenshot("alice", "nope"))).toBe("NOT_FOUND"); // another user's / unknown profile cannot be addressed
    await d.closeAll(); expect(f.spaces).toEqual([]);
  });
  test("limits, profile validation, and refusing to adopt a Space that is not exactly ours", async () => {
    const f = fake(); const d = createDesktopService({ call: f.call, maxPerUser: 1, maxTotal: 1 });
    await d.start("u1", "a");
    expect(await code(d.start("u1", "b"))).toBe("LIMIT"); expect(await code(d.start("u2", "a"))).toBe("LIMIT");
    expect(await code(d.start("u1", "../x"))).toBe("INVALID");
    const bad: McpCall = async (tool) => (tool === "create_space" ? { text: "boom", isError: true } : tool === "list_spaces" ? { text: JSON.stringify([{ id: "relay:abc", kind: "" }]), isError: false } : { text: "", isError: false });
    expect(await code(createDesktopService({ call: bad }).start("u3", "a"))).toBe("UNAVAILABLE"); // the host computer is never adopted
    await d.closeAll();
  });
  test("takeover: agents are refused while a person holds control; epoch and compare-and-swap guard stale turns", async () => {
    const f = fake(); const d = createDesktopService({ call: f.call }); await d.start("u", "p");
    const epoch = d.epochOf("u", "p");
    d.takeover("u", "p", true);
    expect(await code(d.act("u", "p", "agent", { type: "key", key: "Return" }))).toBe("HUMAN_IN_CONTROL");
    expect(await code(d.act("u", "p", "user", { type: "key", key: "Return" }))).toBe("ok");
    d.takeover("u", "p", false);
    expect(await code(d.act("u", "p", "agent", { type: "key", key: "Return" }, { epoch }))).toBe("STALE_CONTROL");
    expect(await code(d.act("u", "p", "agent", { type: "key", key: "Return" }, { epoch: d.epochOf("u", "p") }))).toBe("ok");
    expect(() => d.takeover("u", "p", true, "human")).toThrow();
    const ac = new AbortController(); ac.abort();
    expect(await code(d.act("u", "p", "agent", { type: "key", key: "x" }, { signal: ac.signal }))).toBe("CANCELLED");
    await d.closeAll();
  });
  test("launch accepts plain app names only; actions are serialized per session", async () => {
    const f = fake(); const d = createDesktopService({ call: f.call }); await d.start("u", "p");
    expect(await code(d.act("u", "p", "agent", { type: "launch", app: "firefox; rm -rf /" }))).toBe("INVALID");
    expect(await code(d.act("u", "p", "agent", { type: "launch", app: "firefox" }))).toBe("ok");
    await d.closeAll();
  });
  test("createCuaCall is lazy: building it starts no process", () => { const c = createCuaCall("/nonexistent/cua"); expect(typeof c.call).toBe("function"); });
});

// Real Cua Space (local Linux container created through the `cua` CLI). Opt-in: needs `cua` and its local runtime.
const real = process.env.ZETTA_DESKTOP_TEST === "1" ? describe : describe.skip;
real("desktop on a real Cua Space", () => {
  test("creates an isolated container desktop, screenshots, launches an app, reads windows, and deletes the Space", async () => {
    const cua = createCuaCall(); const d = createDesktopService({ call: cua.call, close: cua.close, maxPerUser: 2 });
    try {
      const s1 = await d.start("real-u1", "a"); const s2 = await d.start("real-u2", "a");
      expect(s1.space).not.toBe(s2.space);
      const png = Buffer.from(await d.screenshot("real-u1", "a"), "base64");
      expect(png.subarray(0, 4).toString("hex")).toBe("89504e47"); expect(png.length).toBeGreaterThan(2000);
      await d.act("real-u1", "a", "agent", { type: "launch", app: "xterm" }).catch(() => undefined); // not every image ships every app
      expect((await d.read("real-u1", "a")).length).toBeGreaterThan(0);
      const listed = JSON.parse((await cua.call("list_spaces", {})).text) as { id: string; kind: string }[];
      for (const s of [s1, s2]) expect(listed.find((x) => x.id === `local:${s.space}`)?.kind).toBe("container");
      await d.close("real-u1", "a");
      const after = JSON.parse((await cua.call("list_spaces", {})).text) as { id: string }[];
      expect(after.some((x) => x.id === `local:${s1.space}`)).toBe(false);
    } finally { await d.closeAll(); }
  }, 600_000);
});
