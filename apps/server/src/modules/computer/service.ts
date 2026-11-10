import { browserPlacement, ownBrowserPlacement, validCdpPort, type InstallMode } from "./placement";
import { uuidv7 } from "@zetta/core/uuid";
import { containerUser, engineOf, tmpfsOwner, type Engine } from "../container-user";
import { createSerializer } from "./serial";
import { lookup } from "node:dns/promises";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { browserProfile } from "@zetta/db/schema/features";
import {
  abBin,
  dockerRunner,
  firstError,
  hostRunner,
  sessionName,
  type AbResult,
  type AbRun,
} from "./agent-browser";
import { createEgressProxy } from "./egress";
import { FOCUSED_JS, type FocusedInput } from "./page-scripts";

export class ComputerError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "LIMIT"
      | "BLOCKED_URL"
      | "HUMAN_IN_CONTROL"
      | "UNAVAILABLE"
      | "INVALID"
      | "REVOKED"
      | "CANCELLED"
      | "STALE_CONTROL"
      | "NO_ADDRESS"
      | "NO_INPUT"
      | "INSECURE"
      | "DISCONNECTED"
      | "SLOW"
      | "NO_ELEMENT"
      | "UNSUPPORTED"
      | "HOST_KEY_CHANGED"
      | "AUTH_FAILED"
      | "UNREACHABLE"
      | "NAVIGATION_FAILED",
    /** Safe text for the bot and the user, e.g. Chromium's `net::ERR_*` code. Never a URL or a secret. */
    readonly detail?: string,
  ) {
    super(code);
  }
}
export type Actor = "user" | "agent";
export type Action =
  | { type: "open"; url: string }
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; dy: number }
  | { type: "click_text"; text: string }
  /** A ref from the last `snapshot` (`@e3` or `e3`). */
  | { type: "click_ref"; ref: string }
  | { type: "fill"; ref: string; text: string };

type Session = {
  container?: string;
  run: AbRun;
  id: string;
  userId: string;
  profile: string;
  url: string;
  control: "agent" | "human";
  epoch: number;
  lastUsed: number;
  queue: Promise<unknown>;
  /** The person's own browser: closing only closes the bot's tab and disconnects. */
  own?: boolean;
};
// Full special-purpose address table (IANA IPv4/IPv6 special registries): anything not a plain public unicast address is refused.
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(net, prefix, "ipv6");
/** Expands IPv4-mapped/compatible IPv6 forms (::ffff:7f00:1, ::ffff:127.0.0.1) to their IPv4 address, or returns undefined. */
function mappedV4(ip: string): string | undefined {
  const m =
    /^(?:0{0,4}:){2,5}(?:ffff:)?(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i.exec(
      ip.replace(/^\[|\]$/g, ""),
    );
  if (!m) return undefined;
  if (m[3]) return m[3];
  const hi = parseInt(m[1]!, 16),
    lo = parseInt(m[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}
export function isBlockedIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "").split("%")[0]!;
  const family = isIP(ip);
  if (!family) return true;
  if (family === 6) {
    const v4 = mappedV4(ip);
    if (v4) return blocked.check(v4, "ipv4");
    if (/^::ffff:/i.test(ip) || /^0*:0*:0*:0*:0*:ffff:/i.test(ip)) return true;
    return blocked.check(ip, "ipv6");
  }
  return blocked.check(ip, "ipv4");
}

/** Web schemes only, regardless of the private-address setting (no file:, ftp:, chrome:, data: navigations). */
export function assertWebScheme(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ComputerError("BLOCKED_URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ComputerError("BLOCKED_URL");
}

/** Blocks non-http(s), localhost/.local/.internal names and anything that resolves to a private or loopback address (SSRF). */
export async function assertPublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ComputerError("BLOCKED_URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ComputerError("BLOCKED_URL");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw new ComputerError("BLOCKED_URL");
  const ips = isIP(host)
    ? [host]
    : (
        await lookup(host, { all: true }).catch(() => {
          throw new ComputerError("BLOCKED_URL");
        })
      ).map((a) => a.address);
  if (ips.length === 0 || ips.some(isBlockedIp)) throw new ComputerError("BLOCKED_URL");
}

export type DockerBrowser = {
  bin: string;
  image: string;
  memory: string;
  cpus: string;
  pids: number;
  /** Unset means Docker. Set from the binary when the config is built (see engineOf). */
  engine?: Engine;
};
/** `ZETTA_BROWSER_RUNTIME=docker` runs each browser session in its own hardened container instead of on the host. */
export function dockerBrowserConfig(
  env: NodeJS.ProcessEnv = process.env,
): DockerBrowser | undefined {
  if (env.ZETTA_BROWSER_RUNTIME !== "docker") return undefined;
  const bin = env.ZETTA_DOCKER_BIN ?? "docker";
  return {
    bin,
    engine: engineOf(bin, env),
    image: env.ZETTA_BROWSER_IMAGE ?? "zetta-browser:latest",
    memory: env.ZETTA_BROWSER_MEMORY ?? "1g",
    cpus: env.ZETTA_BROWSER_CPUS ?? "1",
    pids: Number(env.ZETTA_BROWSER_PIDS ?? 512),
  };
}
/**
 * The container has no network (`--network none`). Its only way out is the egress proxy: the server listens on a unix socket in
 * `egressDir`, which is mounted read-only, and the image bridges it to 127.0.0.1:3128 for Chromium. With `isolated: false` (private
 * addresses allowed by the operator) the container gets Docker's default network and no proxy.
 */
export function browserDockerArgs(
  d: DockerBrowser,
  o: { name: string; profileDir: string; egressDir: string; isolated: boolean },
) {
  return [
    "run",
    "-d",
    "--rm",
    "--init",
    "--name",
    o.name,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--pids-limit",
    String(d.pids),
    "--memory",
    d.memory,
    "--cpus",
    d.cpus,
    "--shm-size",
    "512m",
    "--user",
    containerUser().user,
    "--tmpfs",
    `/tmp:rw,size=256m${tmpfsOwner(d.engine)}`,
    "--tmpfs",
    `/home/agent:rw,size=64m${tmpfsOwner(d.engine)}`,
    ...(o.isolated ? ["--network", "none"] : []),
    "-v",
    `${o.profileDir}:/profile:rw`,
    ...(o.isolated ? ["-v", `${o.egressDir}:/run/zetta/egress:ro`] : []),
    d.image,
  ];
}
/** Where agent-browser finds its config inside the container image. */
const CONTAINER_CONFIG = "/etc/zetta/agent-browser.json";
const EGRESS_PORT = 3128;
const CHROMIUM_IN_IMAGE = "/usr/bin/chromium";

/**
 * Launch options of one session. agent-browser relaunches the browser when they change, so the same list is sent with every call.
 * The proxy applies to loopback names too (`<-loopback>`), and WebRTC cannot send UDP around it.
 */
export function launchFlags(o: {
  profileDir: string;
  executablePath?: string | undefined;
  proxy?: string | undefined;
  sandbox: boolean;
  idleMs: number;
}): string[] {
  const args = [
    "--disable-dev-shm-usage",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
  if (!o.sandbox) args.push("--no-sandbox");
  if (o.proxy) args.push("--proxy-bypass-list=<-loopback>");
  return [
    "--profile",
    o.profileDir,
    ...(o.executablePath ? ["--executable-path", o.executablePath] : []),
    ...(o.proxy ? ["--proxy", o.proxy] : []),
    "--args",
    args.join(","),
    // A backstop if this server dies: the daemon stops itself after the sessions' own idle time plus a margin.
    "--idle-timeout",
    String(o.idleMs + 300_000),
  ];
}

export type ComputerOptions = {
  docker?: DockerBrowser;
  db?: Pick<Database, "select" | "insert" | "update">;
  root: string;
  allowPrivate?: boolean;
  maxPerUser?: number;
  maxTotal?: number;
  idleMs?: number;
  executablePath?: string;
  /** "network": a server open to the network never runs a browser on itself (see placement.ts). Default "local". */
  install?: InstallMode;
};

const PASSWORD_INPUTS = "input[type=password]";
const REF = /^@?e\d{1,5}$/;
const refOf = (r: string) => {
  if (!REF.test(r)) throw new ComputerError("INVALID");
  return r.startsWith("@") ? r : `@${r}`;
};
/** The agent-browser commands of one action. Text goes through stdin with the rest, never on argv. */
function commandsOf(action: Action): string[][] {
  switch (action.type) {
    case "open":
      return [["open", action.url]];
    case "click":
      return [
        ["mouse", "move", String(action.x), String(action.y)],
        ["mouse", "down"],
        ["mouse", "up"],
      ];
    case "type":
      return [["keyboard", "type", action.text.slice(0, 2000)]];
    case "key":
      return [["press", action.key.slice(0, 30)]];
    case "click_text":
      return [["find", "text", action.text.slice(0, 200), "click"]];
    case "click_ref":
      return [["click", refOf(action.ref)]];
    case "fill":
      return [["fill", refOf(action.ref), action.text.slice(0, 2000)]];
    case "scroll": {
      const dy = Math.max(-2000, Math.min(2000, action.dy));
      return [["scroll", dy < 0 ? "up" : "down", String(Math.abs(Math.round(dy)))]];
    }
  }
}
/** A command failed because the page changed or the target is not there: the bot should read the page again. */
const missingTarget = (e: string | undefined) =>
  /unknown ref|no element|not found|detached/i.test(e ?? "");

/**
 * Isolated browser sessions for computer use, driven through agent-browser. One persistent Chromium profile per (user, profile name)
 * under `<root>/profiles/<userId>/<profile>`: never shared across users or implicitly across bots. A human can take over a session
 * (agent actions are refused) and hand it back. Sessions are addressed only through the owner's userId. Every request of the browser
 * goes through the egress proxy, so the address policy holds for redirects and sub-resources too.
 */
export function createComputerService({
  docker,
  db,
  root,
  allowPrivate = false,
  maxPerUser = 2,
  maxTotal = 6,
  idleMs = 10 * 60_000,
  executablePath,
  install = "local",
}: ComputerOptions) {
  const placement = browserPlacement(install, docker ? "docker" : "host");
  const sessions = new Map<string, Session>();
  const key = (userId: string, profile: string) => `${userId}\u0000${profile}`;
  const reaper = setInterval(() => {
    for (const s of sessions.values())
      if (Date.now() - s.lastUsed > idleMs) void close(s.userId, s.profile);
  }, 30_000);
  reaper.unref?.();
  const get = (userId: string, profile: string) => {
    const s = sessions.get(key(userId, profile));
    if (!s) throw new ComputerError("NOT_FOUND");
    s.lastUsed = Date.now();
    return s;
  };
  const safeProfile = (p: string) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(p)) throw new ComputerError("INVALID");
    return p;
  };
  const profileDir = (userId: string, profile: string) =>
    join(root, "profiles", userId.replace(/[^A-Za-z0-9_-]/g, "_"), profile);

  const egress = createEgressProxy({ isBlockedIp });
  const config = join(root, "agent-browser.json");
  let configured: Promise<unknown> | undefined;
  /** An empty config replaces the operator's own ~/.agent-browser/config.json, so nothing there (headed mode, extensions) applies. */
  const ensureConfig = () =>
    (configured ??= mkdir(root, { recursive: true }).then(() => writeFile(config, "{}\n")));

  const serial = createSerializer();
  /** One start at a time per user: two concurrent calls can no longer both pass the existing/limit checks and launch two browsers. */
  const start = (userId: string, profileName = "default") =>
    serial(userId, () => startOne(userId, profileName));
  async function startOne(userId: string, profileName = "default") {
    const profile = safeProfile(profileName);
    let ownRow: { kind: string; cdpPort: number | null } | undefined;
    if (db) {
      const [row] = await db
        .select()
        .from(browserProfile)
        .where(and(eq(browserProfile.ownerUserId, userId), eq(browserProfile.name, profile)));
      if (row?.revokedAt) throw new ComputerError("REVOKED");
      ownRow = row;
      if (!row)
        await db
          .insert(browserProfile)
          .values({
            ownerUserId: userId,
            name: profile,
            mode: profile.startsWith("b-") ? "dedicated" : "shared",
          })
          .onConflictDoNothing();
    }
    const existing = sessions.get(key(userId, profile));
    if (existing) return info(existing);
    if (ownRow?.kind === "own") return startOwn(userId, profile, ownRow.cdpPort);
    if (!placement.ok) throw new ComputerError("UNSUPPORTED", placement.reason);
    if (
      [...sessions.values()].filter((s) => s.userId === userId).length >= maxPerUser ||
      sessions.size >= maxTotal
    )
      throw new ComputerError("LIMIT");
    const dir = profileDir(userId, profile);
    await mkdir(dir, { recursive: true });
    const name = sessionName(userId, profile);
    let container: string | undefined;
    let run: AbRun;
    try {
      if (docker) {
        await chmod(dir, 0o700).catch(() => {});
        const egressDir = join(root, "egress");
        await mkdir(egressDir, { recursive: true });
        if (!allowPrivate) await egress.listenUnix(join(egressDir, "proxy.sock"));
        container = `zetta-browser-${uuidv7()}`;
        const started = Bun.spawn(
          [
            docker.bin,
            ...browserDockerArgs(docker, {
              name: container,
              profileDir: dir,
              egressDir,
              isolated: !allowPrivate,
            }),
          ],
          {
            stdout: "pipe",
            stderr: "pipe",
            env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
          },
        );
        if ((await started.exited) !== 0) throw new Error("docker run failed");
        run = dockerRunner({
          docker: docker.bin,
          container,
          config: CONTAINER_CONFIG,
          session: name,
          launch: launchFlags({
            profileDir: "/profile",
            executablePath: CHROMIUM_IN_IMAGE,
            proxy: allowPrivate ? undefined : `http://127.0.0.1:${EGRESS_PORT}`,
            sandbox: false,
            idleMs,
          }),
        });
      } else {
        await ensureConfig();
        run = hostRunner({
          bin: await abBin(),
          config,
          session: name,
          namespace: "zetta",
          launch: launchFlags({
            profileDir: dir,
            executablePath,
            proxy: allowPrivate ? undefined : `http://127.0.0.1:${await egress.listenTcp()}`,
            sandbox: true,
            idleMs,
          }),
        });
      }
      const boot = await run([
        ["set", "viewport", "1024", "640"],
        ["open", "about:blank"],
      ]);
      if (firstError(boot)) throw new Error("browser did not start");
    } catch {
      if (docker && container)
        Bun.spawn([docker.bin, "kill", container], { stdout: "ignore", stderr: "ignore" });
      throw new ComputerError("UNAVAILABLE");
    }
    const session: Session = {
      container,
      run: run!,
      id: profile,
      userId,
      profile,
      url: "about:blank",
      control: "agent",
      epoch: 0,
      lastUsed: Date.now(),
      queue: Promise.resolve(),
    };
    sessions.set(key(userId, profile), session);
    return info(session);
  }
  /**
   * Attaches to the person's running browser on its DevTools port (127.0.0.1 only) and pins the session to a new tab, so the bot never
   * touches the person's other tabs. No container, no egress proxy and no separate profile: it is the person's browser, signed in as
   * they are, and this is allowed only on a local install.
   */
  async function startOwn(userId: string, profile: string, port: number | null) {
    const allowed = ownBrowserPlacement(install);
    if (!allowed.ok) throw new ComputerError("UNSUPPORTED", allowed.reason);
    if (!validCdpPort(port)) throw new ComputerError("INVALID");
    await ensureConfig();
    const run = hostRunner({
      bin: await abBin(),
      config,
      session: sessionName(userId, profile),
      namespace: "zetta",
      launch: ["--cdp", String(port), "--pin-tab"],
    });
    const boot = await run([["open", "about:blank"]]).catch(() => undefined);
    if (!boot || firstError(boot) !== undefined || boot.some((r) => !r.success))
      throw new ComputerError(
        "UNAVAILABLE",
        `Could not reach your browser on port ${port}. Start it with remote debugging on that port (for example --remote-debugging-port=${port}, or turn it on at chrome://inspect/#remote-debugging), then try again.`,
      );
    const session: Session = {
      run,
      id: profile,
      userId,
      profile,
      url: "about:blank",
      control: "agent",
      epoch: 0,
      lastUsed: Date.now(),
      queue: Promise.resolve(),
      own: true,
    };
    sessions.set(key(userId, profile), session);
    return info(session);
  }
  const info = (s: Session) => ({
    profile: s.profile,
    control: s.control,
    epoch: s.epoch,
    url: s.url,
  });
  /** Runs commands on a session and keeps its url current. A command that failed becomes an error the caller can act on. */
  async function exec(
    s: Session,
    cmds: string[][],
    opts: { signal?: AbortSignal | undefined } = {},
  ): Promise<AbResult[]> {
    const tail: string[][] = [
      ["get", "url"],
      ["get", "count", PASSWORD_INPUTS],
    ];
    let res: AbResult[];
    try {
      res = await s.run([...cmds, ...tail], { signal: opts.signal });
    } catch (e) {
      if (e instanceof ComputerError) throw e;
      throw new ComputerError("UNAVAILABLE");
    }
    const failed = firstError(res);
    if (failed !== undefined || res.some((r) => !r.success))
      throw new ComputerError(missingTarget(failed) ? "NO_ELEMENT" : "UNAVAILABLE");
    const url = res[cmds.length]?.result?.url;
    if (typeof url === "string") s.url = url;
    return res;
  }

  /** Actions on one profile are serialized (two bots never interleave on one page). `epoch` guards agents against a takeover that
   * happened after their turn started; `signal` cancels a waiting or running action. */
  function act(
    userId: string,
    profile: string,
    by: Actor,
    action: Action,
    opts: { signal?: AbortSignal; epoch?: number } = {},
  ) {
    const s = get(userId, profile);
    const run = s.queue.then(async () => {
      if (opts.signal?.aborted) throw new ComputerError("CANCELLED");
      if (by === "agent" && s.control === "human") throw new ComputerError("HUMAN_IN_CONTROL");
      if (by === "agent" && opts.epoch !== undefined && opts.epoch !== s.epoch)
        throw new ComputerError("STALE_CONTROL");
      if (action.type === "open") {
        assertWebScheme(action.url);
        if (!allowPrivate) await assertPublicUrl(action.url);
      }
      const cmds = commandsOf(action);
      const res = await exec(s, cmds, { signal: opts.signal });
      const loginRequired = by === "agent" && Number(res[cmds.length + 1]?.result?.count ?? 0) > 0;
      return { ...info(s), loginRequired };
    });
    s.queue = run.catch(() => undefined);
    return run;
  }
  /** Reads through the same queue as actions, so a read never lands in the middle of one. */
  function queued<T>(s: Session, work: () => Promise<T>): Promise<T> {
    const run = s.queue.then(work);
    s.queue = run.catch(() => undefined);
    return run;
  }
  const textOf = (res: AbResult[], at: number) => String(res[at]?.result?.text ?? "");
  /** Boot-time cleanup: containers from a previous server process (they carry our name prefix) are killed; none can be reachable through this process.
   * Host mode closes every agent-browser session in the `zetta` namespace. */
  async function sweep() {
    if (!docker) {
      try {
        await ensureConfig();
        const p = Bun.spawn([await abBin(), "--config", config, "close", "--all"], {
          stdout: "ignore",
          stderr: "ignore",
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? "",
            AGENT_BROWSER_NAMESPACE: "zetta",
          },
        });
        await p.exited;
      } catch {
        /* no agent-browser installed: nothing to sweep */
      }
      return 0;
    }
    try {
      const p = Bun.spawn([docker.bin, "ps", "-q", "--filter", "name=zetta-browser-"], {
        stdout: "pipe",
        stderr: "ignore",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      });
      const ids = (await new Response(p.stdout as ReadableStream).text())
        .split(/\s+/)
        .filter((x) => /^[0-9a-f]{6,64}$/.test(x));
      for (const id of ids)
        Bun.spawn([docker.bin, "kill", id], {
          stdout: "ignore",
          stderr: "ignore",
          env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
        });
      return ids.length;
    } catch {
      return 0;
    }
  }
  return {
    sweep,
    start,
    list: (userId: string) => [...sessions.values()].filter((s) => s.userId === userId).map(info),
    act,
    async screenshot(userId: string, profile: string) {
      const s = get(userId, profile);
      return queued(s, async () => {
        const id = uuidv7();
        const path = docker ? `/tmp/${id}.png` : join(root, "tmp", `${id}.png`);
        if (!docker) await mkdir(join(root, "tmp"), { recursive: true });
        const res = await s.run([["screenshot", path]]);
        if (firstError(res) !== undefined) throw new ComputerError("UNAVAILABLE");
        if (!docker || !s.container) {
          const png = Buffer.from(await Bun.file(path).arrayBuffer());
          await rm(path, { force: true });
          return png.toString("base64");
        }
        const cat = Bun.spawn([docker.bin, "exec", s.container, "cat", path], {
          stdout: "pipe",
          stderr: "ignore",
          env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
        });
        const png = Buffer.from(await new Response(cat.stdout).arrayBuffer());
        if ((await cat.exited) !== 0 || png.length === 0) throw new ComputerError("UNAVAILABLE");
        return png.toString("base64");
      });
    },
    /** Where the session is and which input has focus (no values): what a credential fill is checked against. */
    async focus(userId: string, profile: string) {
      const s = get(userId, profile);
      return queued(s, async () => {
        const res = await s
          .run([
            ["get", "url"],
            ["eval", FOCUSED_JS],
          ])
          .catch(() => [] as AbResult[]);
        const url = res[0]?.result?.url;
        if (typeof url === "string") s.url = url;
        const focused = res[1]?.result?.result;
        return { url: s.url, focused: (focused ?? null) as FocusedInput | null };
      });
    },
    /** Visible page text, bounded, for feeding a bot. */
    async text(userId: string, profile: string) {
      const s = get(userId, profile);
      return queued(s, async () => {
        const res = await s.run([["get", "text", "body"]]).catch(() => [] as AbResult[]);
        return textOf(res, 0).slice(0, 20_000);
      });
    },
    /** The page as the accessibility tree with refs (`@e1`) that `click_ref` and `fill` accept; links carry their addresses. */
    async snapshot(userId: string, profile: string) {
      const s = get(userId, profile);
      return queued(s, async () => {
        const res = await s.run([
          ["get", "url"],
          ["snapshot", "-i", "-c", "-u"],
        ]);
        if (firstError(res) !== undefined) throw new ComputerError("UNAVAILABLE");
        const url = res[0]?.result?.url;
        if (typeof url === "string") s.url = url;
        return `url: ${s.url}\n${String(res[1]?.result?.snapshot ?? "")}`.slice(0, 20_000);
      });
    },
    /** Open a URL and return its text in one step (used by workflows and /browse in chat). */
    async read(userId: string, profile: string, url: string, by: Actor = "agent") {
      await start(userId, profile);
      await act(userId, profile, by, { type: "open", url });
      return this.text(userId, profile);
    },
    /** Compare-and-swap on control: `expected` is the control state the caller saw; a stale caller gets STALE_CONTROL. Every change bumps the epoch. */
    takeover(userId: string, profile: string, human: boolean, expected?: "agent" | "human") {
      const s = get(userId, profile);
      if (expected && s.control !== expected) throw new ComputerError("STALE_CONTROL");
      if ((s.control === "human") !== human) {
        s.control = human ? "human" : "agent";
        s.epoch++;
      }
      return info(s);
    },
    epochOf(userId: string, profile: string) {
      return get(userId, profile).epoch;
    },
    capabilities: () => ({
      browser: true,
      /** A local install may point a profile at the person's own running browser. */
      ownBrowser: ownBrowserPlacement(install).ok,
      desktop: false as const,
      note: "Desktop (whole-screen) control is not available in this installation; only isolated browser sessions are.",
    }),
    /** Deletes the profile's stored state (cookies, logins). The profile can be used again and starts empty. */
    async reset(userId: string, profile: string) {
      safeProfile(profile);
      await close(userId, profile);
      await rm(profileDir(userId, profile), { recursive: true, force: true });
      if (db)
        await db
          .update(browserProfile)
          .set({ resetAt: new Date() })
          .where(and(eq(browserProfile.ownerUserId, userId), eq(browserProfile.name, profile)));
    },
    /** Revokes a profile: closes it, deletes its state and refuses to start it again. */
    async revokeProfile(userId: string, profile: string) {
      await this.reset(userId, profile);
      if (db)
        await db
          .update(browserProfile)
          .set({ revokedAt: new Date() })
          .where(and(eq(browserProfile.ownerUserId, userId), eq(browserProfile.name, profile)));
    },
    async profiles(userId: string) {
      return db
        ? (
            await db.select().from(browserProfile).where(eq(browserProfile.ownerUserId, userId))
          ).map((p) => ({
            name: p.name,
            mode: p.mode,
            kind: p.kind,
            cdpPort: p.cdpPort,
            revoked: Boolean(p.revokedAt),
          }))
        : [];
    },
    /** Whether a local install may offer "Your own browser". */
    ownBrowser: () => ownBrowserPlacement(install),
    /**
     * Points a profile at the person's own browser (`port`) or back to an isolated one (`null`). A running session of the profile is
     * closed so the next start uses the new kind.
     */
    async setOwnBrowser(userId: string, profile: string, port: number | null) {
      safeProfile(profile);
      if (port !== null) {
        const allowed = ownBrowserPlacement(install);
        if (!allowed.ok) throw new ComputerError("UNSUPPORTED", allowed.reason);
        if (!validCdpPort(port)) throw new ComputerError("INVALID");
      }
      if (!db) throw new ComputerError("UNAVAILABLE");
      await close(userId, profile);
      const values = {
        kind: port === null ? ("isolated" as const) : ("own" as const),
        cdpPort: port,
      };
      await db
        .insert(browserProfile)
        .values({
          ownerUserId: userId,
          name: profile,
          mode: profile.startsWith("b-") ? "dedicated" : "shared",
          ...values,
        })
        .onConflictDoUpdate({
          target: [browserProfile.ownerUserId, browserProfile.name],
          set: values,
        });
      return values;
    },
    async close(userId: string, profile: string) {
      return close(userId, profile);
    },
    async closeAll() {
      clearInterval(reaper);
      await Promise.all([...sessions.values()].map((s) => close(s.userId, s.profile)));
      egress.close();
    },
  };
  async function close(userId: string, profile: string) {
    const s = sessions.get(key(userId, profile));
    if (!s) return;
    sessions.delete(key(userId, profile));
    // The person's own browser: close the bot's tab and disconnect; the browser and its other tabs stay.
    await s.run(s.own ? [["tab", "close"], ["close"]] : [["close"]]).catch(() => {});
    if (docker && s.container) {
      try {
        Bun.spawn([docker.bin, "kill", s.container], { stdout: "ignore", stderr: "ignore" });
      } catch {
        /* gone */
      }
    }
  }
}
export type ComputerService = ReturnType<typeof createComputerService>;
