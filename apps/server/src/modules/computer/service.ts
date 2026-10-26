import { createSerializer } from "./serial";
import { lookup } from "node:dns/promises";
import { mkdir } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import { chmod, rm } from "node:fs/promises";
import { connectCdp, type PageLike } from "./cdp";
import { chromium, type BrowserContext } from "playwright-core";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { browserProfile } from "@zetta/db/schema/features";

export class ComputerError extends Error {
  constructor(readonly code: "NOT_FOUND" | "LIMIT" | "BLOCKED_URL" | "HUMAN_IN_CONTROL" | "UNAVAILABLE" | "INVALID" | "REVOKED" | "CANCELLED" | "STALE_CONTROL") { super(code); }
}
export type Actor = "user" | "agent";
export type Action =
  | { type: "open"; url: string } | { type: "click"; x: number; y: number } | { type: "type"; text: string }
  | { type: "key"; key: string } | { type: "scroll"; dy: number } | { type: "click_text"; text: string };

type Session = { container?: string; browserHandle?: { close(): Promise<void> }; id: string; userId: string; profile: string; context?: BrowserContext; page: PageLike; control: "agent" | "human"; epoch: number; lastUsed: number; queue: Promise<unknown> };
// Full special-purpose address table (IANA IPv4/IPv6 special registries): anything not a plain public unicast address is refused.
const blocked = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, prefix, "ipv6");
/** Expands IPv4-mapped/compatible IPv6 forms (::ffff:7f00:1, ::ffff:127.0.0.1) to their IPv4 address, or returns undefined. */
function mappedV4(ip: string): string | undefined {
  const m = /^(?:0{0,4}:){2,5}(?:ffff:)?(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i.exec(ip.replace(/^\[|\]$/g, ""));
  if (!m) return undefined;
  if (m[3]) return m[3];
  const hi = parseInt(m[1]!, 16), lo = parseInt(m[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
export function isBlockedIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").split("%")[0]!;
  const family = isIP(ip);
  if (!family) return true;
  if (family === 6) { const v4 = mappedV4(ip); if (v4) return blocked.check(v4, "ipv4"); if (/^::ffff:/i.test(ip) || /^0*:0*:0*:0*:0*:ffff:/i.test(ip)) return true; return blocked.check(ip, "ipv6"); }
  return blocked.check(ip, "ipv4");
}

/** Web schemes only, regardless of the private-address setting (no file:, ftp:, chrome:, data: navigations). */
export function assertWebScheme(raw: string) { let u: URL; try { u = new URL(raw); } catch { throw new ComputerError("BLOCKED_URL"); } if (u.protocol !== "http:" && u.protocol !== "https:") throw new ComputerError("BLOCKED_URL"); }

/** Blocks non-http(s), localhost/.local/.internal names and anything that resolves to a private or loopback address (SSRF). */
export async function assertPublicUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ComputerError("BLOCKED_URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ComputerError("BLOCKED_URL");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new ComputerError("BLOCKED_URL");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new ComputerError("BLOCKED_URL"); })).map((a) => a.address);
  if (ips.length === 0 || ips.some(isBlockedIp)) throw new ComputerError("BLOCKED_URL");
}

export type DockerBrowser = { bin: string; image: string; memory: string; cpus: string; pids: number };
/** `ZETTA_BROWSER_RUNTIME=docker` runs each browser session in its own hardened container instead of on the host. */
export function dockerBrowserConfig(env: NodeJS.ProcessEnv = process.env): DockerBrowser | undefined {
  if (env.ZETTA_BROWSER_RUNTIME !== "docker") return undefined;
  return { bin: env.ZETTA_DOCKER_BIN ?? "docker", image: env.ZETTA_BROWSER_IMAGE ?? "zetta-browser:latest", memory: env.ZETTA_BROWSER_MEMORY ?? "1g", cpus: env.ZETTA_BROWSER_CPUS ?? "1", pids: Number(env.ZETTA_BROWSER_PIDS ?? 512) };
}
export function browserDockerArgs(d: DockerBrowser, o: { name: string; profileDir: string }) {
  return ["run", "-d", "--rm", "--name", o.name, "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only", "--pids-limit", String(d.pids), "--memory", d.memory, "--cpus", d.cpus, "--shm-size", "512m",
    "--tmpfs", "/tmp:rw,size=256m,uid=10001", "--tmpfs", "/home/agent:rw,size=64m,uid=10001", "-p", "127.0.0.1::9222", "-v", `${o.profileDir}:/profile:rw`, d.image];
}
export type ComputerOptions = { docker?: DockerBrowser; db?: Pick<Database, "select" | "insert" | "update">; root: string; allowPrivate?: boolean; maxPerUser?: number; maxTotal?: number; idleMs?: number; executablePath?: string };

/**
 * Isolated browser sessions for computer use. One persistent Chromium profile per (user, profile name) under
 * `<root>/profiles/<userId>/<profile>`: never shared across users or implicitly across bots. A human can take over a session
 * (agent actions are refused) and hand it back. Sessions are addressed only through the owner's userId.
 */
export function createComputerService({ docker, db, root, allowPrivate = false, maxPerUser = 2, maxTotal = 6, idleMs = 10 * 60_000, executablePath }: ComputerOptions) {
  const sessions = new Map<string, Session>();
  const key = (userId: string, profile: string) => `${userId}\u0000${profile}`;
  const reaper = setInterval(() => { for (const s of sessions.values()) if (Date.now() - s.lastUsed > idleMs) void close(s.userId, s.profile); }, 30_000);
  reaper.unref?.();
  const get = (userId: string, profile: string) => { const s = sessions.get(key(userId, profile)); if (!s) throw new ComputerError("NOT_FOUND"); s.lastUsed = Date.now(); return s; };
  const safeProfile = (p: string) => { if (!/^[A-Za-z0-9_-]{1,64}$/.test(p)) throw new ComputerError("INVALID"); return p; };

  const serial = createSerializer();
  /** One start at a time per user: two concurrent calls can no longer both pass the existing/limit checks and launch two browsers. */
  const start = (userId: string, profileName = "default") => serial(userId, () => startOne(userId, profileName));
  async function startOne(userId: string, profileName = "default") {
    const profile = safeProfile(profileName);
    if (db) {
      const [row] = await db.select().from(browserProfile).where(and(eq(browserProfile.ownerUserId, userId), eq(browserProfile.name, profile)));
      if (row?.revokedAt) throw new ComputerError("REVOKED");
      if (!row) await db.insert(browserProfile).values({ ownerUserId: userId, name: profile, mode: profile.startsWith("b-") ? "dedicated" : "shared" }).onConflictDoNothing();
    }
    const existing = sessions.get(key(userId, profile));
    if (existing) return info(existing);
    if ([...sessions.values()].filter((s) => s.userId === userId).length >= maxPerUser || sessions.size >= maxTotal) throw new ComputerError("LIMIT");
    const dir = join(root, "profiles", userId.replace(/[^A-Za-z0-9_-]/g, "_"), profile);
    await mkdir(dir, { recursive: true });
    let context: BrowserContext | undefined; let cdpPage: PageLike | undefined;
    let container: string | undefined; let browserHandle: Session["browserHandle"];
    try {
      if (docker) {
        await chmod(dir, 0o777).catch(() => {});
        container = `zetta-browser-${crypto.randomUUID()}`;
        const run = Bun.spawn([docker.bin, ...browserDockerArgs(docker, { name: container, profileDir: dir })], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
        if ((await run.exited) !== 0) throw new Error("docker run failed");
        const port = await (async () => { const p = Bun.spawn([docker.bin, "port", container!, "9222/tcp"], { stdout: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } }); const t = await new Response(p.stdout).text(); const m = /:(\d+)\s*$/m.exec(t.trim().split("\n")[0] ?? ""); if (!m) throw new Error("no port"); return m[1]; })();
        let ready = false;
        for (let i = 0; i < 60 && !ready; i++) { ready = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false); if (!ready) await Bun.sleep(250); }
        if (!ready) throw new Error("browser not ready");
        // The DevTools metadata advertises the container-internal address; keep only its path and connect through the published port.
        const meta = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
        const cdp = await connectCdp({ wsUrl: `ws://127.0.0.1:${port}${new URL(meta.webSocketDebuggerUrl).pathname}`, allow: async (u) => { try { if (u === "about:blank") return true; assertWebScheme(u); if (!allowPrivate) await assertPublicUrl(u); return true; } catch { return false; } } });
        cdpPage = cdp.page; browserHandle = { close: cdp.close };
      } else {
        context = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1024, height: 640 }, acceptDownloads: false, serviceWorkers: "block", ...(executablePath ? { executablePath } : {}) });
      }
    } catch {
      if (docker && container) Bun.spawn([docker.bin, "kill", container], { stdout: "ignore", stderr: "ignore" });
      throw new ComputerError("UNAVAILABLE");
    }
    let page: PageLike;
    if (cdpPage) page = cdpPage;
    else {
      const ctx = context!;
      if (!allowPrivate) await ctx.route("**/*", async (route) => {
        try { await assertPublicUrl(route.request().url()); await route.continue(); } catch { await route.abort("blockedbyclient"); }
      });
      const pw = ctx.pages()[0] ?? await ctx.newPage();
      page = { goto: async (u) => { await pw.goto(u, { waitUntil: "domcontentloaded", timeout: 20_000 }); }, click: (x, y) => pw.mouse.click(x, y), type: (t) => pw.keyboard.type(t), press: (k) => pw.keyboard.press(k), wheel: (dy) => pw.mouse.wheel(0, dy),
        clickText: (t) => pw.getByText(t, { exact: false }).first().click({ timeout: 5_000 }), text: async () => pw.innerText("body").catch(() => ""), hasPassword: async () => (await pw.locator("input[type=password]").count().catch(() => 0)) > 0,
        screenshot: () => pw.screenshot({ type: "png" }), url: () => pw.url() };
    }
    const session: Session = { container, browserHandle, id: profile, userId, profile, ...(context ? { context } : {}), page, control: "agent", epoch: 0, lastUsed: Date.now(), queue: Promise.resolve() };
    sessions.set(key(userId, profile), session);
    return info(session);
  }
  const info = (s: Session) => ({ profile: s.profile, control: s.control, epoch: s.epoch, url: s.page.url() });

  /** Actions on one profile are serialized (two bots never interleave on one page). `epoch` guards agents against a takeover that
   * happened after their turn started; `signal` cancels a waiting or running action. */
  function act(userId: string, profile: string, by: Actor, action: Action, opts: { signal?: AbortSignal; epoch?: number } = {}) {
    const s = get(userId, profile);
    const run = s.queue.then(async () => {
      if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
      if (by === "agent" && s.control === "human") throw new ComputerError("HUMAN_IN_CONTROL");
      if (by === "agent" && opts.epoch !== undefined && opts.epoch !== s.epoch) throw new ComputerError("STALE_CONTROL");
      const p = s.page;
      try {
        if (action.type === "open") { assertWebScheme(action.url); if (!allowPrivate) await assertPublicUrl(action.url); await p.goto(action.url); }
        else if (action.type === "click") await p.click(action.x, action.y);
        else if (action.type === "type") await p.type(action.text.slice(0, 2000));
        else if (action.type === "key") await p.press(action.key.slice(0, 30));
        else if (action.type === "click_text") await p.clickText(action.text);
        else if (action.type === "scroll") await p.wheel(Math.max(-2000, Math.min(2000, action.dy)));
      } catch (e) { if (e instanceof ComputerError) throw e; throw new ComputerError("UNAVAILABLE"); }
      const loginRequired = by === "agent" && (await p.hasPassword().catch(() => false));
      return { ...info(s), loginRequired };
    });
    s.queue = run.catch(() => undefined);
    return run;
  }
  /** Boot-time cleanup: containers from a previous server process (they carry our name prefix) are killed; none can be reachable through this process. */
  async function sweep() {
    if (!docker) return 0;
    try {
      const p = Bun.spawn([docker.bin, "ps", "-q", "--filter", "name=zetta-browser-"], { stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
      const ids = (await new Response(p.stdout as ReadableStream).text()).split(/\s+/).filter((x) => /^[0-9a-f]{6,64}$/.test(x));
      for (const id of ids) Bun.spawn([docker.bin, "kill", id], { stdout: "ignore", stderr: "ignore", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } });
      return ids.length;
    } catch { return 0; }
  }
  return {
    sweep,
    start,
    list: (userId: string) => [...sessions.values()].filter((s) => s.userId === userId).map(info),
    act,
    async screenshot(userId: string, profile: string) { const s = get(userId, profile); return (await s.page.screenshot()).toString("base64"); },
    /** Visible page text, bounded, for feeding a bot. */
    async text(userId: string, profile: string) { const s = get(userId, profile); return (await s.page.text().catch(() => "")).slice(0, 20_000); },
    /** Open a URL and return its text in one step (used by workflows and /browse in chat). */
    async read(userId: string, profile: string, url: string, by: Actor = "agent") {
      await start(userId, profile); await act(userId, profile, by, { type: "open", url });
      return (await get(userId, profile).page.text().catch(() => "")).slice(0, 20_000);
    },
    /** Compare-and-swap on control: `expected` is the control state the caller saw; a stale caller gets STALE_CONTROL. Every change bumps the epoch. */
    takeover(userId: string, profile: string, human: boolean, expected?: "agent" | "human") {
      const s = get(userId, profile);
      if (expected && s.control !== expected) throw new ComputerError("STALE_CONTROL");
      if ((s.control === "human") !== human) { s.control = human ? "human" : "agent"; s.epoch++; }
      return info(s);
    },
    epochOf(userId: string, profile: string) { return get(userId, profile).epoch; },
    capabilities: () => ({ browser: true, desktop: false as const, note: "Desktop (whole-screen) control is not available in this installation; only isolated browser sessions are." }),
    /** Deletes the profile's stored state (cookies, logins). The profile can be used again and starts empty. */
    async reset(userId: string, profile: string) {
      safeProfile(profile); await close(userId, profile);
      await rm(join(root, "profiles", userId.replace(/[^A-Za-z0-9_-]/g, "_"), profile), { recursive: true, force: true });
      if (db) await db.update(browserProfile).set({ resetAt: new Date() }).where(and(eq(browserProfile.ownerUserId, userId), eq(browserProfile.name, profile)));
    },
    /** Revokes a profile: closes it, deletes its state and refuses to start it again. */
    async revokeProfile(userId: string, profile: string) {
      await this.reset(userId, profile);
      if (db) await db.update(browserProfile).set({ revokedAt: new Date() }).where(and(eq(browserProfile.ownerUserId, userId), eq(browserProfile.name, profile)));
    },
    async profiles(userId: string) { return db ? (await db.select().from(browserProfile).where(eq(browserProfile.ownerUserId, userId))).map((p) => ({ name: p.name, mode: p.mode, revoked: Boolean(p.revokedAt) })) : []; },
    async close(userId: string, profile: string) { return close(userId, profile); },
    async closeAll() { clearInterval(reaper); await Promise.all([...sessions.values()].map((s) => close(s.userId, s.profile))); },
  };
  async function close(userId: string, profile: string) {
    const s = sessions.get(key(userId, profile));
    if (!s) return;
    sessions.delete(key(userId, profile));
    if (s.browserHandle) await s.browserHandle.close(); else await s.context?.close().catch(() => {});
    if (docker && s.container) { try { Bun.spawn([docker.bin, "kill", s.container], { stdout: "ignore", stderr: "ignore" }); } catch { /* gone */ } }
  }
}
export type ComputerService = ReturnType<typeof createComputerService>;
