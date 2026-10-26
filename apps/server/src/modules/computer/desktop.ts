import { createSerializer } from "./serial";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ComputerError, type Actor } from "./service";

/**
 * Desktop (whole-screen) computer use through Cua Spaces. Each (user, profile) gets its OWN Linux container Space created on this
 * machine (`cua mcp` -> create_space on=local); the desktop is driven only through that Space (`local:zetta-<hash>`), never through
 * the host computer or any `relay:`/`direct:` target. Control/takeover works like browser sessions: agent actions are refused while a
 * person holds control, and an epoch invalidates stale agent turns.
 */
export type McpCall = (tool: string, args: Record<string, unknown>) => Promise<{ text: string; imageBase64?: string; isError: boolean }>;
export type DesktopAction =
  | { type: "click"; x: number; y: number } | { type: "type"; text: string } | { type: "key"; key: string }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number } | { type: "launch"; app: string };

type DSession = { name: string; userId: string; profile: string; control: "agent" | "human"; epoch: number; lastUsed: number; queue: Promise<unknown> };
const SAFE_APP = /^[A-Za-z0-9._ -]{1,60}$/;

/** Production transport: the `cua` CLI's stdio MCP server (one shared connection, restarted on failure). */
export function createCuaCall(command = Bun.which("cua") ?? "cua"): { call: McpCall; close: () => Promise<void> } {
  let client: Promise<Client> | undefined;
  const open = () => { client ??= (async () => { const c = new Client({ name: "zetta-desktop", version: "1" }); await c.connect(new StdioClientTransport({ command, args: ["mcp"], cwd: tmpdir(), env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }, stderr: "ignore" })); return c; })().catch((e) => { client = undefined; throw e; }); return client; };
  return {
    call: async (tool, args) => {
      const c = await open();
      const r = (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: 120_000 })) as { isError?: boolean; content?: { type: string; text?: string; data?: string }[] };
      return { text: (r.content ?? []).filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n"), imageBase64: r.content?.find((x) => x.type === "image")?.data, isError: Boolean(r.isError) };
    },
    close: async () => { const c = await client?.catch(() => undefined); client = undefined; await c?.close().catch(() => {}); },
  };
}

export type DesktopOptions = { call: McpCall; maxPerUser?: number; maxTotal?: number; idleMs?: number; close?: () => Promise<void> };
export function createDesktopService({ call, maxPerUser = 1, maxTotal = 3, idleMs = 15 * 60_000, close: closeTransport }: DesktopOptions) {
  const sessions = new Map<string, DSession>();
  const key = (u: string, p: string) => `${u}\u0000${p}`;
  const nameFor = (u: string, p: string) => `zetta-${createHash("sha256").update(`${u}\u0000${p}`).digest("hex").slice(0, 12)}`;
  const safeProfile = (p: string) => { if (!/^[A-Za-z0-9_-]{1,64}$/.test(p)) throw new ComputerError("INVALID"); return p; };
  const get = (u: string, p: string) => { const s = sessions.get(key(u, p)); if (!s) throw new ComputerError("NOT_FOUND"); s.lastUsed = Date.now(); return s; };
  const ref = (s: DSession) => `local:${s.name}`; // the ONLY target we ever send: a Space this service created
  const info = (s: DSession) => ({ profile: s.profile, control: s.control, epoch: s.epoch, space: s.name });
  const reaper = setInterval(() => { for (const s of sessions.values()) if (Date.now() - s.lastUsed > idleMs) void closeSession(s.userId, s.profile); }, 60_000); reaper.unref?.();

  const serial = createSerializer();
  const start = (userId: string, profileName = "default") => serial(userId, () => startOne(userId, profileName));
  async function startOne(userId: string, profileName = "default") {
    const profile = safeProfile(profileName);
    const existing = sessions.get(key(userId, profile));
    if (existing) return info(existing);
    if ([...sessions.values()].filter((s) => s.userId === userId).length >= maxPerUser || sessions.size >= maxTotal) throw new ComputerError("LIMIT");
    const name = nameFor(userId, profile);
    const created = await call("create_space", { on: "local", name, kind: "container", wait: true, timeout: 600 }).catch(() => undefined);
    if (!created || created.isError) {
      // the Space may already exist from an earlier run of this service: accept it only if it is exactly ours (local, container)
      const listed = await call("list_spaces", {}).catch(() => undefined);
      let ok = false; try { ok = (JSON.parse(listed?.text ?? "[]") as { id: string; kind: string }[]).some((s) => s.id === `local:${name}` && s.kind === "container"); } catch { ok = false; }
      if (!ok) throw new ComputerError("UNAVAILABLE");
    }
    const s: DSession = { name, userId, profile, control: "agent", epoch: 0, lastUsed: Date.now(), queue: Promise.resolve() };
    sessions.set(key(userId, profile), s);
    return info(s);
  }

  function act(userId: string, profile: string, by: Actor, action: DesktopAction, opts: { signal?: AbortSignal; epoch?: number } = {}) {
    const s = get(userId, profile);
    const run = s.queue.then(async () => {
      if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
      if (by === "agent" && s.control === "human") throw new ComputerError("HUMAN_IN_CONTROL");
      if (by === "agent" && opts.epoch !== undefined && opts.epoch !== s.epoch) throw new ComputerError("STALE_CONTROL");
      const sandbox = ref(s);
      let r;
      if (action.type === "click") r = await call("computer_click", { sandbox, x: Math.round(action.x), y: Math.round(action.y) });
      else if (action.type === "type") r = await call("computer_type", { sandbox, text: action.text.slice(0, 2000) });
      else if (action.type === "key") r = await call("computer_key", { sandbox, key: action.key.slice(0, 40) });
      else if (action.type === "scroll") r = await call("computer_scroll", { sandbox, direction: action.direction, amount: Math.max(1, Math.min(20, action.amount ?? 3)) });
      else { if (!SAFE_APP.test(action.app)) throw new ComputerError("INVALID"); r = await call("computer_launch", { sandbox, app: action.app }); }
      if (r.isError) throw new ComputerError("UNAVAILABLE");
      return info(s);
    });
    s.queue = run.catch(() => undefined);
    return run;
  }

  async function closeSession(userId: string, profile: string) {
    const s = sessions.get(key(userId, profile));
    if (!s) return;
    sessions.delete(key(userId, profile));
    await call("delete_space", { space: ref(s) }).catch(() => undefined);
  }

  return {
    /** Boot-time cleanup: Spaces named by this service's scheme (zetta-<12 hex>) that no live session owns are deleted. */
    async sweep() {
      try {
        const listed = await call("list_spaces", {});
        const spaces = (JSON.parse(listed?.text ?? "[]") as { id: string; kind: string }[]).filter((x) => x.kind === "container" && /^local:zetta-[0-9a-f]{12}$/.test(x.id) && ![...sessions.values()].some((s) => ref(s) === x.id));
        for (const x of spaces) await call("delete_space", { space: x.id }).catch(() => undefined);
        return spaces.length;
      } catch { return 0; }
    },
    start, act, list: (u: string) => [...sessions.values()].filter((s) => s.userId === u).map(info),
    async screenshot(userId: string, profile: string) {
      const s = get(userId, profile);
      const r = await call("computer_screenshot", { sandbox: ref(s) });
      if (r.isError || !r.imageBase64) throw new ComputerError("UNAVAILABLE");
      return r.imageBase64;
    },
    /** Text view for bots that cannot see images: the Space's accessibility/window snapshot. */
    async read(userId: string, profile: string) {
      const s = get(userId, profile);
      const r = await call("call_tool", { space: ref(s), tool: "get_accessibility_tree", arguments: {} });
      if (r.isError) throw new ComputerError("UNAVAILABLE");
      return r.text.slice(0, 8000);
    },
    takeover(userId: string, profile: string, human: boolean, expected?: "agent" | "human") {
      const s = get(userId, profile);
      if (expected && s.control !== expected) throw new ComputerError("STALE_CONTROL");
      if ((s.control === "human") !== human) { s.control = human ? "human" : "agent"; s.epoch++; }
      return info(s);
    },
    epochOf: (u: string, p: string) => get(u, p).epoch,
    close: closeSession,
    async closeAll() { clearInterval(reaper); await Promise.all([...sessions.values()].map((s) => closeSession(s.userId, s.profile))); await closeTransport?.(); },
  };
}
export type DesktopService = ReturnType<typeof createDesktopService>;
