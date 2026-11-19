import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

/** The server this app runs on this computer: its own data, secrets and port, reachable only from this computer. */
export const LOCAL_HOST = "127.0.0.1";

export type LocalPaths = {
  /** The Bun that runs the server (the app's own). */
  bun: string;
  /** `apps/server/dist/index.mjs` as shipped. */
  serverEntry: string;
  /** The server's `.env.schema`: the server validates its settings against it from the folder it runs in. */
  envSchema: string;
  /** The built web app. */
  webDist: string;
  /** The Postgres runtime archive for this platform. */
  pgArchive: string;
  /** `migrations.json`: every migration's name and SQL. */
  migrations: string;
};

/** Where the shipped files are, relative to the folder holding the app's resources. */
export function resourcePaths(
  root: string,
  bun: string,
  platform = process.platform,
  arch = process.arch,
): LocalPaths {
  return {
    bun,
    serverEntry: join(root, "server", "dist", "index.mjs"),
    envSchema: join(root, "server", ".env.schema"),
    webDist: join(root, "web"),
    pgArchive: join(root, "pg", `pg-runtime-${platform}-${arch}.tar.zst`),
    migrations: join(root, "db", "migrations.json"),
  };
}

/** What is missing from a set of shipped files (empty when the server can start). */
export const missingResources = (paths: LocalPaths): string[] =>
  Object.entries(paths)
    .filter(([key, value]) => key !== "bun" && !existsSync(value))
    .map(([key]) => key);

// ---- secrets ------------------------------------------------------------------------------------------------------------------------

/** `linkToken` is what the app and its server share for the link to remote servers; an older file without it gets one added. */
export type Secrets = {
  betterAuthSecret: string;
  connectionKey: string;
  setupKey: string;
  linkToken: string;
};

const secretKeys = ["betterAuthSecret", "connectionKey", "setupKey"] as const;
const random32 = () => randomBytes(32).toString("base64");

/**
 * The server's three secrets, made once and kept in a private file. An existing file is never replaced: the connection key seals every
 * saved connection, so a new one would lock them all. A file that cannot be read is moved aside, not overwritten.
 */
export function ensureSecrets(
  file: string,
  make: () => string = random32,
  now = () => Date.now(),
): Secrets {
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Secrets>;
      if (secretKeys.every((key) => typeof parsed[key] === "string" && parsed[key])) {
        if (typeof parsed.linkToken === "string" && parsed.linkToken.length >= 32)
          return parsed as Secrets;
        // Only the new secret is made: the others seal data and sign sessions that already exist.
        const upgraded = { ...parsed, linkToken: make() } as Secrets;
        const temp = `${file}.tmp`;
        writeFileSync(temp, `${JSON.stringify(upgraded, null, 2)}\n`, { mode: 0o600 });
        renameSync(temp, file);
        return upgraded;
      }
    } catch {}
    renameSync(file, `${file}.unreadable-${now()}`);
  }
  const secrets: Secrets = {
    betterAuthSecret: make(),
    connectionKey: make(),
    setupKey: make(),
    linkToken: make(),
  };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
  return secrets;
}

// ---- port ---------------------------------------------------------------------------------------------------------------------------

/** True when nothing listens on this port of the loopback address. */
export const isPortFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, LOCAL_HOST, () => probe.close(() => resolve(true)));
  });

/** An unused port the system picks. */
export const pickFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, LOCAL_HOST, () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address === "object"
          ? resolve(address.port)
          : reject(new Error("NO_PORT")),
      );
    });
  });

/**
 * The port is chosen once and kept: the address is the web origin, and cookies and local storage belong to it. A new one is chosen only
 * when the kept one is taken by something else.
 */
export async function ensurePort(
  file: string,
  isFree: (port: number) => Promise<boolean> = isPortFree,
  pick: () => Promise<number> = pickFreePort,
): Promise<number> {
  try {
    const kept = (JSON.parse(readFileSync(file, "utf8")) as { port?: unknown }).port;
    if (
      typeof kept === "number" &&
      Number.isInteger(kept) &&
      kept > 1023 &&
      kept < 65536 &&
      (await isFree(kept))
    )
      return kept;
  } catch {}
  const port = await pick();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ port })}\n`, { mode: 0o600 });
  return port;
}

// ---- environment --------------------------------------------------------------------------------------------------------------------

/** Only what a program needs to find its tools and its locale. Nothing else of this process's environment reaches the server. */
const PASS_THROUGH = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TERM",
] as const;

export function localServerEnv(options: {
  dataDir: string;
  paths: LocalPaths;
  secrets: Secrets;
  port: number;
  base?: Record<string, string | undefined>;
}): Record<string, string> {
  const { dataDir, paths, secrets, port, base = process.env } = options;
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) if (base[key]) env[key] = base[key]!;
  const origin = `http://${LOCAL_HOST}:${port}`;
  return {
    ...env,
    NODE_ENV: "production",
    PORT: String(port),
    ZETTA_HOST: LOCAL_HOST,
    ZETTA_SERVER_URL: origin,
    BETTER_AUTH_SECRET: secrets.betterAuthSecret,
    ZETTA_CONNECTION_KEY: secrets.connectionKey,
    ZETTA_SETUP_KEY: secrets.setupKey,
    ZETTA_DESKTOP_LINK_TOKEN: secrets.linkToken,
    // Empty: the server runs the Postgres that ships with it, inside ZETTA_HOME. With ZETTA_HOME set, every other folder it uses is inside too.
    DATABASE_URL: "",
    ZETTA_HOME: join(dataDir, "home"),
    ZETTA_HARNESS_HOME_ROOT: join(dataDir, "home", "cli-homes"),
    ZETTA_ROLE: "all",
    ZETTA_UPDATE_CHECK: "off",
    ZETTA_LAYA_PRELOAD: "0",
    // The page and the API share one origin, so the session cookie is first party.
    ZETTA_COOKIE_SAMESITE: "lax",
    ZETTA_WEB_DIST: paths.webDist,
    ZETTA_PG_ARCHIVE: paths.pgArchive,
    ZETTA_MIGRATIONS_DIR: paths.migrations,
  };
}

// ---- supervisor ---------------------------------------------------------------------------------------------------------------------

export type LocalStatus = "stopped" | "starting" | "running" | "failed";
export type LocalState = {
  status: LocalStatus;
  /** Why it failed (a short code or message, never a secret). */
  error: string | null;
  origin: string | null;
  logFile: string;
  /** The address that signs the first person in as the owner. Only until an account exists. */
  setupUrl: string | null;
};

export type SpawnedProcess = { pid?: number; exited: Promise<number>; kill(): void };
export type SpawnFn = (
  command: string[],
  options: { cwd: string; env: Record<string, string>; logFile: string },
) => SpawnedProcess;

export const bunSpawn: SpawnFn = (command, { cwd, env, logFile }) => {
  // Appended to, so the app's own lines and the server's stay in order and an earlier run's are not overwritten.
  const log = openSync(logFile, "a");
  const child = Bun.spawn(command, { cwd, env, stdin: "ignore", stdout: log, stderr: log });
  void child.exited.finally(() => closeSync(log));
  return { pid: child.pid, exited: child.exited, kill: () => child.kill() };
};

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export type LocalServerOptions = {
  /** `<userData>/local`: the folder this server owns. */
  dataDir: string;
  paths: LocalPaths;
  spawn?: SpawnFn;
  /** Resolves true when the server answers `/api/meta`. */
  probe?: (origin: string) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  isFree?: (port: number) => Promise<boolean>;
  pick?: () => Promise<number>;
  /** How long a start may take (the first one unpacks Postgres and applies every migration). */
  startTimeoutMs?: number;
  /** How many times a crash is retried before the server is shown as failed. */
  maxRestarts?: number;
  base?: Record<string, string | undefined>;
  /** Settings added on top of the ones the app sets. For tests and operators (for example a private-network remote); never for secrets. */
  extraEnv?: Record<string, string>;
  /** Ends a server this app started in an earlier run and left behind (the app was killed). Gets the pid kept in `run/server.pid`. */
  reap?: (pid: number, serverEntry: string) => Promise<void>;
  /** Whether a process still runs (replaceable for tests). */
  alive?: (pid: number) => boolean;
};

/** Kills `pid` only when it is a process running this server file (a pid can be reused by anything). Unix only: elsewhere it does nothing. */
export async function reapStaleServer(pid: number, serverEntry: string): Promise<void> {
  if (process.platform === "win32" || !Number.isInteger(pid) || pid <= 1) return;
  try {
    const ps = Bun.spawn(["ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const command = (await new Response(ps.stdout as ReadableStream).text()).trim();
    if (command.includes(serverEntry)) process.kill(pid, "SIGTERM");
  } catch {}
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const defaultProbe = async (origin: string) => {
  try {
    const res = await fetch(`${origin}/api/meta`, { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
};

export function createLocalServer(options: LocalServerOptions) {
  const {
    dataDir,
    paths,
    spawn = bunSpawn,
    probe = defaultProbe,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    startTimeoutMs = 180_000,
    maxRestarts = 3,
  } = options;
  const logFile = join(dataDir, "logs", "server.log");
  const state: LocalState = {
    status: "stopped",
    error: null,
    origin: null,
    logFile,
    setupUrl: null,
  };
  const listeners = new Set<(next: LocalState) => void>();
  let child: SpawnedProcess | null = null;
  let linkToken: string | null = null;
  let wanted = false;
  let generation = 0;

  const set = (patch: Partial<LocalState>) => {
    Object.assign(state, patch);
    for (const listener of listeners) listener({ ...state });
  };

  const log = (line: string) => {
    try {
      appendFileSync(logFile, `[desktop ${new Date().toISOString()}] ${line}\n`);
    } catch {}
  };

  /**
   * A server this app started in an earlier run and left behind (the app was killed) still holds the port and the database. It is ended
   * before anything else, so the address stays the same and two servers never share one data folder.
   */
  async function reapPrevious() {
    let old = 0;
    try {
      old = Number(readFileSync(join(dataDir, "run", "server.pid"), "utf8"));
    } catch {
      return;
    }
    if (!old) return;
    await (options.reap ?? reapStaleServer)(old, paths.serverEntry);
    // Postgres and the port are released a moment after the process ends.
    for (let i = 0; i < 20 && (options.alive ?? isAlive)(old); i++) await sleep(250);
  }

  /** Runs the server once; resolves with how it ended. */
  async function runOnce(
    env: Record<string, string>,
    origin: string,
    mine: number,
  ): Promise<"stopped" | "crashed" | "never-ready"> {
    const cwd = join(dataDir, "run");
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    // The server validates its settings against .env.schema from the folder it runs in, and writes its type file there.
    copyFileSync(paths.envSchema, join(cwd, ".env.schema"));
    const process_ = spawn([paths.bun, paths.serverEntry], { cwd, env, logFile });
    child = process_;
    if (process_.pid) writeFileSync(join(cwd, "server.pid"), String(process_.pid), { mode: 0o600 });
    let ended: number | null = null;
    void process_.exited.then((code) => (ended = code));
    const deadline = Date.now() + startTimeoutMs;
    while (mine === generation && ended === null && Date.now() < deadline) {
      if (await probe(origin)) {
        set({ status: "running", error: null });
        await process_.exited;
        return mine === generation && wanted ? "crashed" : "stopped";
      }
      await sleep(500);
    }
    if (mine !== generation || !wanted) {
      process_.kill();
      return "stopped";
    }
    if (ended === null) {
      process_.kill();
      return "never-ready";
    }
    return "crashed";
  }

  async function supervise(mine: number) {
    mkdirSync(join(dataDir, "logs"), { recursive: true, mode: 0o700 });
    try {
      if (statSync(logFile).size > MAX_LOG_BYTES) truncateSync(logFile, 0);
    } catch {}
    const missing = missingResources(paths);
    if (missing.length) {
      log(`missing files: ${missing.join(", ")}`);
      set({ status: "failed", error: `MISSING_${missing[0]!.toUpperCase()}` });
      return;
    }
    await reapPrevious();
    const secrets = ensureSecrets(join(dataDir, "secrets.json"));
    linkToken = secrets.linkToken;
    let restarts = 0;
    while (mine === generation && wanted) {
      const port = await ensurePort(join(dataDir, "state.json"), options.isFree, options.pick);
      const origin = `http://${LOCAL_HOST}:${port}`;
      const env = {
        ...localServerEnv({ dataDir, paths, secrets, port, base: options.base }),
        ...options.extraEnv,
      };
      set({
        status: "starting",
        error: null,
        origin,
        setupUrl: `${origin}/onboarding#key=${encodeURIComponent(secrets.setupKey)}`,
      });
      log(`starting on ${origin}`);
      const outcome = await runOnce(env, origin, mine);
      if (outcome === "stopped" || mine !== generation || !wanted) break;
      if (outcome === "never-ready") {
        log("did not answer in time");
        set({ status: "failed", error: "START_TIMEOUT" });
        return;
      }
      restarts += 1;
      log(`exited unexpectedly (restart ${restarts} of ${maxRestarts})`);
      if (restarts > maxRestarts) {
        set({ status: "failed", error: "CRASHED" });
        return;
      }
      set({ status: "starting", error: null });
      await sleep(Math.min(1_000 * 2 ** restarts, 15_000));
    }
    if (mine === generation) set({ status: "stopped" });
  }

  return {
    get state(): LocalState {
      return { ...state };
    },
    /** The secret the app uses to talk to its own server's link routes; null until the server has been started once. Never sent to a page. */
    get linkToken(): string | null {
      return linkToken;
    },
    onChange(listener: (next: LocalState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Starts the server (or restarts a failed one). Resolves when it answers, fails or stops. */
    async start(): Promise<LocalState> {
      if (wanted && (state.status === "starting" || state.status === "running"))
        return { ...state };
      wanted = true;
      generation += 1;
      const run = supervise(generation);
      // Resolves once it has settled into a state a caller can act on.
      await new Promise<void>((resolve) => {
        const off = this.onChange((next) => {
          if (next.status === "running" || next.status === "failed" || next.status === "stopped") {
            off();
            resolve();
          }
        });
        void run.then(() => {
          off();
          resolve();
        });
      });
      return { ...state };
    },
    /** Stops the server; Postgres inside it stops with it. */
    async stop(): Promise<void> {
      wanted = false;
      generation += 1;
      const running = child;
      child = null;
      if (running) {
        running.kill();
        await Promise.race([running.exited, sleep(10_000)]);
      }
      set({ status: "stopped" });
    },
  };
}

export type LocalServer = ReturnType<typeof createLocalServer>;
