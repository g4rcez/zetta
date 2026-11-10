// Runs the Postgres that ships inside Zetta: creates the data folder on first start, starts the server, or adopts one that is already
// running (a `bun --hot` reload, or a Zetta process that was killed and left Postgres behind).
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Client } from "pg";

import type { EmbeddedLayout } from "./paths";
import type { Runtime } from "./runtime";

const DATABASE = "zetta";
const USER = "postgres";
const SOCKET_PORT = 5432;
// A unix socket path holds about 104 bytes on macOS and 108 on Linux.
const SOCKET_PATH_LIMIT = 100;
const SETTINGS = "zetta.conf";

/** How the app reaches the embedded server: a private unix socket where the OS has one and the path fits, else loopback with a password. */
export type Transport = "socket" | "tcp";
export type Endpoint =
  | { transport: "socket"; directory: string }
  | { transport: "tcp"; port: number };
export type EmbeddedStart = "started" | "adopted";
/**
 * `process`: Postgres stops when the Zetta process that uses it stops (the server). `detached`: it keeps running until
 * `bun run db:embedded stop`, and servers that use it meanwhile leave it running.
 */
export type Lifetime = "process" | "detached";

export function chooseTransport(
  socketDirectory: string,
  platform: string = process.platform,
): Transport {
  if (platform === "win32") return "tcp";
  return join(socketDirectory, `.s.PGSQL.${SOCKET_PORT}`).length <= SOCKET_PATH_LIMIT
    ? "socket"
    : "tcp";
}

/** `postmaster.pid` lines: pid, data folder, start time, port, socket folder, listen address. */
export function parsePostmasterPid(text: string): Endpoint | undefined {
  const [, , , port, socket, listen] = text.split("\n").map((line) => line.trim());
  if (socket) return { transport: "socket", directory: socket };
  if (listen && Number(port) > 0) return { transport: "tcp", port: Number(port) };
  return undefined;
}

export function connectionUrl(endpoint: Endpoint, password: string, database = DATABASE) {
  if (endpoint.transport === "socket")
    return `postgresql://${USER}@localhost/${database}?host=${encodeURIComponent(endpoint.directory)}`;
  return `postgresql://${USER}:${password}@127.0.0.1:${endpoint.port}/${database}`;
}

const quote = (value: string) => `'${value.replaceAll("\\", "/").replaceAll("'", "''")}'`;

export function settingsFile(endpoint: Endpoint) {
  const lines =
    endpoint.transport === "socket"
      ? [
          "listen_addresses = ''",
          `port = ${SOCKET_PORT}`,
          `unix_socket_directories = ${quote(endpoint.directory)}`,
          "unix_socket_permissions = 0700",
        ]
      : [
          "listen_addresses = '127.0.0.1'",
          `port = ${endpoint.port}`,
          "unix_socket_directories = ''",
        ];
  return `# Written by Zetta on every start. Do not edit.\n${lines.join("\n")}\n`;
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no free port")),
      );
    });
  });
}

function run(command: string[], what: string) {
  // The tools must ignore PGDATA, PGPORT and friends from the user's shell. UTC and the C locale match the container image.
  const inherited = Object.entries(process.env).filter(([name]) => !name.startsWith("PG"));
  const env = { ...Object.fromEntries(inherited), LC_ALL: "C", TZ: "UTC" };
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe", env });
  if (result.exitCode !== 0)
    throw new Error(
      `${what} failed: ${(result.stderr.toString() || result.stdout.toString()).trim().slice(-600)}`,
    );
  return result.stdout.toString();
}

export function isRunning(runtime: Runtime, layout: EmbeddedLayout) {
  if (!existsSync(join(layout.data, "postmaster.pid"))) return false;
  const status = Bun.spawnSync([runtime.pgCtl, "status", "-D", layout.data], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return status.exitCode === 0;
}

function readPassword(layout: EmbeddedLayout) {
  return readFileSync(layout.password, "utf8").trim();
}

/** The connection string of an embedded server that is running right now, read from its pid file. Starts nothing. */
export function runningUrl(layout: EmbeddedLayout, database = DATABASE) {
  try {
    const endpoint = parsePostmasterPid(readFileSync(join(layout.data, "postmaster.pid"), "utf8"));
    return endpoint ? connectionUrl(endpoint, readPassword(layout), database) : undefined;
  } catch {
    return undefined;
  }
}

function initialize(runtime: Runtime, layout: EmbeddedLayout) {
  mkdirSync(layout.root, { recursive: true });
  if (!existsSync(layout.password)) {
    writeFileSync(layout.password, `${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
    chmodSync(layout.password, 0o600);
  }
  // The builtin C.UTF-8 locale sorts text the same way on every OS; the socket is private to this OS user, loopback asks for the password.
  const auth =
    process.platform === "win32"
      ? ["--auth=scram-sha-256"]
      : ["--auth-local=trust", "--auth-host=scram-sha-256"];
  run(
    [
      runtime.initdb,
      "-D",
      layout.data,
      "-U",
      USER,
      "-E",
      "UTF8",
      "--locale-provider=builtin",
      "--builtin-locale=C.UTF-8",
      "--locale=C",
      `--pwfile=${layout.password}`,
      ...auth,
    ],
    "Creating the database folder",
  );
  const conf = join(layout.data, "postgresql.conf");
  writeFileSync(conf, `${readFileSync(conf, "utf8")}\ninclude_if_exists = '${SETTINGS}'\n`);
}

async function createDatabase(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_database where datname = $1", [DATABASE]);
    if (!found.rowCount) await client.query(`create database ${DATABASE}`);
  } finally {
    await client.end();
  }
}

export type EmbeddedServer = {
  url: string;
  start: EmbeddedStart;
  /** Stops Postgres, unless it was started detached. */
  stop(): void;
  /** Stops Postgres whoever started it, runs `work` on the cold data folder, and starts it again. */
  whileStopped(work: () => void): Promise<void>;
};

export function stopEmbedded(runtime: Runtime, layout: EmbeddedLayout) {
  rmSync(layout.detached, { force: true });
  if (!isRunning(runtime, layout)) return "idle" as const;
  run([runtime.pgCtl, "stop", "-m", "fast", "-w", "-D", layout.data], "Stopping Postgres");
  return "stopped" as const;
}

export async function startEmbedded(
  runtime: Runtime,
  layout: EmbeddedLayout,
  lifetime: Lifetime = "process",
): Promise<EmbeddedServer> {
  if (!existsSync(join(layout.data, "PG_VERSION"))) initialize(runtime, layout);
  if (lifetime === "detached") writeFileSync(layout.detached, "");

  let start: EmbeddedStart = "adopted";
  const boot = async () => {
    const transport = chooseTransport(layout.socket);
    const endpoint: Endpoint =
      transport === "socket"
        ? { transport, directory: layout.socket }
        : { transport, port: await freePort() };
    if (endpoint.transport === "socket") mkdirSync(layout.socket, { recursive: true, mode: 0o700 });
    writeFileSync(join(layout.data, SETTINGS), settingsFile(endpoint));
    // pg_ctl detaches Postgres from this process: it survives hot reloads and is adopted by the next start.
    run(
      [runtime.pgCtl, "start", "-w", "-t", "60", "-D", layout.data, "-l", layout.log],
      "Starting Postgres",
    );
    start = "started";
  };
  const halt = () =>
    run([runtime.pgCtl, "stop", "-m", "fast", "-w", "-D", layout.data], "Stopping Postgres");

  if (!isRunning(runtime, layout)) await boot();
  const admin = runningUrl(layout, "postgres");
  if (!admin)
    throw new Error(
      `Postgres is running but ${join(layout.data, "postmaster.pid")} could not be read.`,
    );
  await createDatabase(admin);

  return {
    get url() {
      const url = runningUrl(layout);
      if (!url) throw new Error("The embedded Postgres is not running.");
      return url;
    },
    get start() {
      return start;
    },
    stop() {
      if (!existsSync(layout.detached) && isRunning(runtime, layout)) halt();
    },
    async whileStopped(work) {
      if (isRunning(runtime, layout)) halt();
      try {
        work();
      } finally {
        await boot();
      }
    },
  };
}
