import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalServer,
  ensurePort,
  ensureSecrets,
  isPortFree,
  localServerEnv,
  missingResources,
  resourcePaths,
  type SpawnedProcess,
  type SpawnFn,
} from "./local-server";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zetta-local-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A resources folder that has every file the server needs. */
function shippedFiles() {
  const paths = resourcePaths(join(root, "resources"), "/usr/bin/bun", "darwin", "arm64");
  for (const file of [
    paths.serverEntry,
    paths.envSchema,
    paths.pgArchive,
    paths.migrations,
    join(paths.webDist, "index.html"),
  ]) {
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "x");
  }
  return paths;
}

describe("secrets", () => {
  test("are made once, private, and never replaced", () => {
    const file = join(root, "local", "secrets.json");
    let n = 0;
    const long = (n: number) => `secret-${n}`.padEnd(40, "-");
    const first = ensureSecrets(file, () => long(++n));
    expect(first).toEqual({
      betterAuthSecret: long(1),
      connectionKey: long(2),
      setupKey: long(3),
      linkToken: long(4),
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(ensureSecrets(file, () => "other")).toEqual(first);
  });

  test("a file from before the link token keeps every old secret and gains only the new one", () => {
    const file = join(root, "old.json");
    writeFileSync(
      file,
      JSON.stringify({ betterAuthSecret: "a", connectionKey: "b", setupKey: "c" }),
    );
    const made = ensureSecrets(file, () => "x".repeat(40));
    expect(made).toEqual({
      betterAuthSecret: "a",
      connectionKey: "b",
      setupKey: "c",
      linkToken: "x".repeat(40),
    });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(made);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("a file that cannot be read is moved aside, not overwritten", () => {
    const file = join(root, "secrets.json");
    writeFileSync(file, "{ not json");
    const made = ensureSecrets(
      file,
      () => "fresh",
      () => 7,
    );
    expect(made.connectionKey).toBe("fresh");
    expect(readFileSync(`${file}.unreadable-7`, "utf8")).toBe("{ not json");
  });

  test("real ones are long enough for the server (44 base64 characters for the connection key)", () => {
    const secrets = ensureSecrets(join(root, "s.json"));
    expect(secrets.connectionKey).toHaveLength(44);
    expect(secrets.betterAuthSecret.length).toBeGreaterThanOrEqual(32);
  });
});

describe("port", () => {
  test("is kept while free and replaced when something else took it", async () => {
    const file = join(root, "state.json");
    let next = 41000;
    const pick = async () => next++;
    expect(await ensurePort(file, async () => true, pick)).toBe(41000);
    expect(await ensurePort(file, async () => true, pick)).toBe(41000);
    expect(await ensurePort(file, async () => false, pick)).toBe(41001);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ port: 41001 });
  });

  test("a damaged or out-of-range kept port is ignored", async () => {
    const file = join(root, "state.json");
    for (const body of ["nope", '{"port":80}', '{"port":"4100"}', '{"port":70000}']) {
      writeFileSync(file, body);
      expect(
        await ensurePort(
          file,
          async () => true,
          async () => 42000,
        ),
      ).toBe(42000);
    }
  });

  test("the real probe sees a taken port", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      expect(await isPortFree(server.port)).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});

describe("environment", () => {
  const secrets = {
    betterAuthSecret: "a".repeat(40),
    connectionKey: "k".repeat(44),
    setupKey: "s",
    linkToken: "l".repeat(40),
  };
  const dataDir = join(root, "x");

  test("holds the server to this computer and to its own folder", () => {
    const paths = resourcePaths("/app/resources", "/app/bun");
    const env = localServerEnv({ dataDir: "/data/local", paths, secrets, port: 43210, base: {} });
    expect(env.ZETTA_HOST).toBe("127.0.0.1");
    expect(env.ZETTA_SERVER_URL).toBe("http://127.0.0.1:43210");
    expect(env.PORT).toBe("43210");
    expect(env.DATABASE_URL).toBe("");
    expect(env.ZETTA_HOME).toBe("/data/local/home");
    expect(env.ZETTA_HARNESS_HOME_ROOT?.startsWith("/data/local/home/")).toBe(true);
    expect(env.ZETTA_WEB_DIST).toBe(paths.webDist);
    expect(env.ZETTA_UPDATE_CHECK).toBe("off");
  });

  test("nothing else of this process's environment reaches the server", () => {
    const env = localServerEnv({
      dataDir,
      paths: resourcePaths("/r", "/b"),
      secrets,
      port: 43210,
      base: {
        PATH: "/usr/bin",
        HOME: "/var/fake-user-home",
        ANTHROPIC_API_KEY: "sk-test-leak",
        DATABASE_URL: "postgres://elsewhere",
        ZETTA_HOME: "/elsewhere",
        BETTER_AUTH_SECRET: "other",
      },
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/var/fake-user-home");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBe("");
    expect(env.ZETTA_HOME).toBe(join(dataDir, "home"));
    expect(env.BETTER_AUTH_SECRET).toBe(secrets.betterAuthSecret);
  });
});

describe("resources", () => {
  test("reports what is missing", () => {
    const paths = shippedFiles();
    expect(missingResources(paths)).toEqual([]);
    rmSync(paths.pgArchive);
    expect(missingResources(paths)).toEqual(["pgArchive"]);
  });
});

/** A fake server process: listed, killable, and ended on demand. */
function fakeSpawn() {
  const runs: {
    command: string[];
    cwd: string;
    env: Record<string, string>;
    end(code?: number): void;
    killed: boolean;
  }[] = [];
  const spawn: SpawnFn = (command, options) => {
    let end!: (code: number) => void;
    const exited = new Promise<number>((resolve) => (end = resolve));
    const run = {
      command,
      cwd: options.cwd,
      env: options.env,
      killed: false,
      end: (code = 1) => end(code),
    };
    runs.push(run);
    const child: SpawnedProcess = {
      exited,
      kill() {
        run.killed = true;
        end(0);
      },
    };
    return child;
  };
  return { spawn, runs };
}

describe("supervisor", () => {
  const options = (extra: Partial<Parameters<typeof createLocalServer>[0]> = {}) => {
    const fake = fakeSpawn();
    const server = createLocalServer({
      dataDir: join(root, "local"),
      paths: shippedFiles(),
      spawn: fake.spawn,
      probe: async () => true,
      sleep: async () => {},
      isFree: async () => true,
      pick: async () => 44000,
      base: { PATH: "/usr/bin" },
      ...extra,
    });
    return { server, fake };
  };

  test("starts the server in its own folder and reports where to sign in", async () => {
    const { server, fake } = options();
    const state = await server.start();
    expect(state.status).toBe("running");
    expect(state.origin).toBe("http://127.0.0.1:44000");
    expect(state.setupUrl?.startsWith("http://127.0.0.1:44000/onboarding#key=")).toBe(true);
    expect(fake.runs).toHaveLength(1);
    expect(fake.runs[0]!.command[0]).toBe("/usr/bin/bun");
    expect(fake.runs[0]!.cwd).toBe(join(root, "local", "run"));
    expect(existsSync(join(root, "local", "run", ".env.schema"))).toBe(true);
    await server.stop();
    expect(fake.runs[0]!.killed).toBe(true);
    expect(server.state.status).toBe("stopped");
  });

  test("starting twice runs one server", async () => {
    const { server, fake } = options();
    await server.start();
    await server.start();
    expect(fake.runs).toHaveLength(1);
    await server.stop();
  });

  test("a crash restarts it with the same secrets and port, then gives up", async () => {
    const { server, fake } = options({ maxRestarts: 2 });
    await server.start();
    const secrets = readFileSync(join(root, "local", "secrets.json"), "utf8");
    for (let i = 0; i < 3; i++) {
      await Bun.sleep(20);
      fake.runs.at(-1)!.end(1);
    }
    await Bun.sleep(50);
    expect(fake.runs.length).toBe(3);
    expect(new Set(fake.runs.map((run) => run.env.ZETTA_SERVER_URL)).size).toBe(1);
    expect(new Set(fake.runs.map((run) => run.env.ZETTA_CONNECTION_KEY)).size).toBe(1);
    expect(readFileSync(join(root, "local", "secrets.json"), "utf8")).toBe(secrets);
    expect(server.state.status).toBe("failed");
    expect(server.state.error).toBe("CRASHED");
  });

  test("a server that never answers is stopped and reported", async () => {
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const { server, fake } = options({
        probe: async () => false,
        startTimeoutMs: 1_000,
        sleep: async (ms) => void (now += ms),
      });
      const state = await server.start();
      expect(state.status).toBe("failed");
      expect(state.error).toBe("START_TIMEOUT");
      expect(fake.runs[0]!.killed).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  test("missing shipped files fail without starting anything", async () => {
    const paths = shippedFiles();
    rmSync(paths.serverEntry);
    const fake = fakeSpawn();
    const server = createLocalServer({ dataDir: join(root, "local"), paths, spawn: fake.spawn });
    const state = await server.start();
    expect(state.status).toBe("failed");
    expect(state.error).toBe("MISSING_SERVERENTRY");
    expect(fake.runs).toHaveLength(0);
  });

  test("a server left behind by an earlier run is ended before the new one starts, so the address stays the same", async () => {
    const reaped: number[] = [];
    const order: string[] = [];
    mkdirSync(join(root, "local", "run"), { recursive: true });
    writeFileSync(join(root, "local", "run", "server.pid"), "4242");
    writeFileSync(join(root, "local", "state.json"), JSON.stringify({ port: 44000 }));
    let alive = true;
    const { server } = options({
      isFree: async (port) => (order.push(`free:${port}`), !alive),
      reap: async (pid) => void (reaped.push(pid), order.push("reap"), (alive = false)),
      alive: () => alive,
      spawn: (command, o) => (order.push("spawn"), fakeSpawn().spawn(command, o)),
    });
    const state = await server.start();
    expect(reaped).toEqual([4242]);
    expect(order[0]).toBe("reap");
    // The kept port was looked at only after the old server was gone, and was free then: no new port was chosen.
    expect(state.origin).toBe("http://127.0.0.1:44000");
    await server.stop();
  });

  test("stopping while it starts leaves it stopped", async () => {
    const { server, fake } = options({
      probe: async () => false,
      sleep: (ms) => Bun.sleep(Math.min(ms, 5)),
    });
    const started = server.start();
    await Bun.sleep(20);
    await server.stop();
    await started;
    expect(server.state.status).toBe("stopped");
    expect(fake.runs.every((run) => run.killed)).toBe(true);
    expect(readdirSync(join(root, "local")).includes("logs")).toBe(true);
  });
});
