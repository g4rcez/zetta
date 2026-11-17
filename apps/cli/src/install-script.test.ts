import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * install.sh run for real against stand-ins for git, docker, openssl and curl that record what they were asked to do. Nothing is cloned,
 * built or started; what is checked is what the installer decides, writes and says.
 */
const script = join(import.meta.dir, "..", "..", "..", "install.sh");

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zetta-install-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const freePort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  void probe.stop(true);
  return port as number;
};

/** The stand-ins. The docker one reads STUB_* variables to play a running or a stopped server, an old install, a missing volume. */
const STUBS: Record<string, string> = {
  git: `echo "git $*" >> "$STUB_LOG"
case "$1" in
  clone) mkdir -p "$3/.git" "$3/apps/server" "$3/apps/web"; exit 0 ;;
  -C) shift 2
      case "$1" in
        remote) echo "\${STUB_ORIGIN:-https://github.com/g4rcez/zetta.git}" ;;
        rev-parse) echo abc1234 ;;
        log) echo 2026-11-17T00:00:00+00:00 ;;
      esac ;;
esac`,
  openssl: `n=$(cat "$STUB_DIR/n" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "$STUB_DIR/n"
case "$*" in
  "rand -hex 16") echo 0123456789abcdef0123456789abcdef ;;
  *) printf 'secret%02d%s\\n' $n "$(printf 'x%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34)" ;;
esac`,
  docker: `case "$1" in
  info) exit "\${STUB_DOCKER_INFO:-0}" ;;
  volume) echo "docker $*" >> "$STUB_LOG"; exit "\${STUB_VOLUME:-1}" ;;
  cp) echo "docker $*" >> "$STUB_LOG"
      [ -z "\${STUB_CP_FAIL:-}" ] || exit 1
      case "$2" in *:/root/.zetta) mkdir -p "$3"; echo old > "$3/note.txt"; exit 0 ;; *) exit 1 ;; esac ;;
  compose)
    case "$2" in
      version) exit 0 ;;
      ps) if [ "$4" = server ]; then echo "\${STUB_SERVER_ID:-}"; else echo "\${STUB_STACK_ID:-}"; fi; exit 0 ;;
      up) echo "docker $* ZETTA_BUILD_COMMIT=$ZETTA_BUILD_COMMIT ZETTA_BUILD_DATE=$ZETTA_BUILD_DATE ZETTA_AGENTS=[$ZETTA_AGENTS]" >> "$STUB_LOG"; exit 0 ;;
      *) echo "docker $*" >> "$STUB_LOG"; exit 0 ;;
    esac ;;
esac`,
  curl: `echo "curl $*" >> "$STUB_LOG"; exit "\${STUB_CURL_EXIT:-0}"`,
};

/** The agent CLIs a person may already have on this computer. */
const HOST_AGENTS: Record<string, string> = {
  claude: 'echo "2.1.326 (Claude Code)"',
  codex: 'echo "codex-cli 0.163.0"',
};

type Result = {
  code: number;
  out: string;
  err: string;
  log: string[];
  dir: string;
  read: (path: string) => string;
};

function install(
  args: string[] = [],
  options: {
    omit?: string[];
    env?: Record<string, string>;
    setup?: (dir: string) => void;
    /** Agent CLIs this computer already has: "claude" and/or "codex". */
    host?: string[];
  } = {},
): Result {
  const bin = join(root, "bin");
  const state = join(root, "state");
  const dir = join(root, "zetta");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(join(root, "home"), { recursive: true });
  for (const [name, body] of Object.entries(STUBS)) {
    if (options.omit?.includes(name)) continue;
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  for (const name of options.host ?? []) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${HOST_AGENTS[name]}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  options.setup?.(dir);
  const run = Bun.spawnSync(["/bin/bash", script, ...args], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: join(root, "home"),
      ZETTA_DIR: dir,
      STUB_LOG: join(root, "stub.log"),
      STUB_DIR: state,
      ZETTA_INSTALL_WAIT_ATTEMPTS: "2",
      ZETTA_INSTALL_POLL_SECONDS: "0",
      ZETTA_API_PORT: String(freePort()),
      ...options.env,
    },
  });
  const logFile = join(root, "stub.log");
  return {
    code: run.exitCode,
    out: run.stdout.toString(),
    err: run.stderr.toString(),
    log: existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n") : [],
    dir,
    read: (path) => readFileSync(join(dir, path), "utf8"),
  };
}

/** An install that is already there: its .env files hold secrets that must survive. */
const existing = (dir: string, url = "http://localhost:3001") => {
  mkdirSync(join(dir, ".git"), { recursive: true });
  mkdirSync(join(dir, "apps", "server"), { recursive: true });
  mkdirSync(join(dir, "apps", "web"), { recursive: true });
  writeFileSync(
    join(dir, "apps", "server", ".env"),
    `BETTER_AUTH_SECRET=old-auth\nZETTA_SERVER_URL=${url}\nZETTA_CONNECTION_KEY=old-connection\nZETTA_SETUP_KEY=old-setup\n`,
  );
  writeFileSync(join(dir, "apps", "web", ".env"), `ZETTA_SERVER_URL=${url}\n`);
};

const value = (text: string, key: string) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];
const upCalls = (log: string[]) => log.filter((line) => line.startsWith("docker compose up"));

describe("a first install", () => {
  test("clones, writes the three .env files with private permissions and starts the containers", () => {
    const port = freePort();
    const run = install(["--port", String(port)]);
    expect(run.code).toBe(0);
    expect(run.log.some((line) => line.startsWith("git clone "))).toBe(true);

    const server = run.read("apps/server/.env");
    expect(value(server, "ZETTA_SERVER_URL")).toBe(`http://localhost:${port}`);
    for (const key of ["BETTER_AUTH_SECRET", "ZETTA_CONNECTION_KEY", "ZETTA_SETUP_KEY"])
      expect(value(server, key)).toMatch(/^secret/);
    expect(run.read("apps/web/.env").trim()).toBe(`ZETTA_SERVER_URL=http://localhost:${port}`);

    const compose = run.read(".env");
    expect(value(compose, "ZETTA_SERVER_URL")).toBe(`http://localhost:${port}`);
    expect(value(compose, "ZETTA_WEB_PORT")).toBe(String(port));
    expect(value(compose, "POSTGRES_PASSWORD")).toBe("0123456789abcdef0123456789abcdef");
    for (const file of [".env", "apps/server/.env", "apps/web/.env"])
      expect(statSync(join(run.dir, file)).mode & 0o777).toBe(0o600);
  });

  test("stamps the version into the build and waits until Zetta answers", () => {
    const run = install(["--port", String(freePort())]);
    expect(upCalls(run.log)).toHaveLength(1);
    expect(upCalls(run.log)[0]).toContain("ZETTA_BUILD_COMMIT=abc1234");
    expect(upCalls(run.log)[0]).toContain("ZETTA_BUILD_DATE=2026-11-17T00:00:00+00:00");
    expect(run.log.some((line) => line.startsWith("curl ") && line.includes("/api/meta"))).toBe(
      true,
    );
  });

  test("prints the address and the setup key, which is not the connection key", () => {
    const port = freePort();
    const run = install(["--port", String(port)]);
    const server = run.read("apps/server/.env");
    expect(run.out).toContain("Zetta is running.");
    expect(run.out).toContain(`Open http://localhost:${port}`);
    expect(run.out).toContain(value(server, "ZETTA_SETUP_KEY")!);
    expect(run.out).not.toContain(value(server, "ZETTA_CONNECTION_KEY")!);
    expect(value(server, "ZETTA_SETUP_KEY")).not.toBe(value(server, "ZETTA_CONNECTION_KEY"));
  });

  test("a public address is used everywhere, without a trailing slash", () => {
    const run = install(["--port", String(freePort()), "--url", "https://zetta.example.invalid/"]);
    for (const file of [".env", "apps/server/.env", "apps/web/.env"])
      expect(value(run.read(file), "ZETTA_SERVER_URL")).toBe("https://zetta.example.invalid");
    expect(run.out).toContain("Open https://zetta.example.invalid");
    expect(run.err).not.toContain("is not https");
  });

  test("an address that is not https and not this computer gets a warning", () => {
    const run = install(["--port", String(freePort()), "--url", "http://zetta.lan"]);
    expect(run.code).toBe(0);
    expect(run.err).toContain("http://zetta.lan is not https");
  });
});

describe("what stops an install before anything is changed", () => {
  const nothingStarted = (run: Result) => {
    expect(run.code).not.toBe(0);
    expect(upCalls(run.log)).toEqual([]);
    expect(run.log.some((line) => line.startsWith("git clone"))).toBe(false);
  };

  test("no docker or podman: says to install one", () => {
    const run = install([], { omit: ["docker"] });
    nothingStarted(run);
    expect(run.err).toContain("docker or podman is not installed");
    expect(run.err).toContain("Docker Desktop");
  });

  test("docker installed but not running: says to start it", () => {
    const run = install([], { env: { STUB_DOCKER_INFO: "1" } });
    nothingStarted(run);
    expect(run.err).toContain("installed but not running");
    expect(run.err).toContain("podman machine start");
  });

  test("not enough free space: says how much and where", () => {
    const run = install([], { env: { ZETTA_INSTALL_MIN_FREE_MB: "999999999" } });
    nothingStarted(run);
    expect(run.err).toMatch(/only \d+ MB are free in/);
    expect(run.err).toContain("ZETTA_DIR");
  });

  test("the web port is taken: names the port and the way out", () => {
    const taken = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    try {
      const run = install(["--port", String(taken.port)]);
      nothingStarted(run);
      expect(run.err).toContain(`port ${taken.port} is already in use`);
      expect(run.err).toContain("--port");
    } finally {
      void taken.stop(true);
    }
  });

  test("a folder that is not a Zetta clone is never touched", () => {
    const run = install([], {
      setup: (dir) => mkdirSync(dir, { recursive: true }),
      env: { STUB_ORIGIN: "https://example.invalid/other.git" },
    });
    nothingStarted(run);
    expect(run.err).toContain("is not a Zetta clone");
  });

  test("an address or a port that makes no sense is refused", () => {
    expect(install(["--url", "ftp://zetta"]).err).toContain("is not an address Zetta can use");
    expect(install(["--url", "https://zetta.example.invalid/app"]).err).toContain("no path");
    expect(install(["--port", "abc"]).err).toContain("is not a port number");
    expect(install(["--wat"]).err).toContain("unknown option");
  });

  test("when Zetta never answers it says so and where to look, and does not claim success", () => {
    const run = install(["--port", String(freePort())], { env: { STUB_CURL_EXIT: "22" } });
    expect(run.code).toBe(1);
    expect(run.err).toContain("did not answer");
    expect(run.err).toContain("compose logs");
    expect(run.out).not.toContain("Zetta is running");
  });
});

describe("running it again to update", () => {
  const setup = (dir: string) => existing(dir);

  test("pulls the code and keeps every secret and the data", () => {
    const run = install(["--port", String(freePort())], { setup });
    expect(run.code).toBe(0);
    expect(run.log.some((line) => line.startsWith("git clone"))).toBe(false);
    expect(run.log.some((line) => line.includes("pull --ff-only"))).toBe(true);
    const server = run.read("apps/server/.env");
    expect(value(server, "BETTER_AUTH_SECRET")).toBe("old-auth");
    expect(value(server, "ZETTA_CONNECTION_KEY")).toBe("old-connection");
    expect(value(server, "ZETTA_SETUP_KEY")).toBe("old-setup");
  });

  test("an older install keeps the default database password, because the database already exists", () => {
    const run = install(["--port", String(freePort())], { setup });
    const compose = run.read(".env");
    expect(value(compose, "POSTGRES_PASSWORD")).toBeUndefined();
    expect(value(compose, "ZETTA_SERVER_URL")).toBe("http://localhost:3001");
  });

  test("does not print the setup key again, and says where it is", () => {
    const run = install(["--port", String(freePort())], { setup });
    expect(run.out).toContain("were kept");
    expect(run.out).toContain("grep ZETTA_SETUP_KEY");
    expect(run.out).not.toContain("old-setup");
  });

  test("--url changes the address in all three files and leaves the rest alone", () => {
    const run = install(["--port", String(freePort()), "--url", "https://zetta.example.invalid"], {
      setup,
    });
    for (const file of ["apps/server/.env", "apps/web/.env", ".env"])
      expect(value(run.read(file), "ZETTA_SERVER_URL")).toBe("https://zetta.example.invalid");
    const server = run.read("apps/server/.env");
    expect(value(server, "BETTER_AUTH_SECRET")).toBe("old-auth");
    expect(value(server, "ZETTA_CONNECTION_KEY")).toBe("old-connection");
    expect(server.match(/ZETTA_SERVER_URL/g)).toHaveLength(1);
    expect(upCalls(run.log)).toHaveLength(1);
  });

  test("a port that a running Zetta holds is not reported as taken", () => {
    const taken = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    try {
      const run = install(["--port", String(taken.port)], {
        setup,
        env: { STUB_STACK_ID: "abc123" },
      });
      expect(run.code).toBe(0);
      expect(upCalls(run.log)).toHaveLength(1);
    } finally {
      void taken.stop(true);
    }
  });
});

describe("moving the files of an older install onto the data volume", () => {
  const setup = (dir: string) => existing(dir);

  test("copies them out of the running server before it is replaced, and back in once the new one answers", () => {
    const run = install(["--port", String(freePort())], {
      setup,
      env: { STUB_SERVER_ID: "abc123" },
    });
    expect(run.code).toBe(0);
    const at = (needle: string) => run.log.findIndex((line) => line.includes(needle));
    expect(at("docker cp abc123:/root/.zetta")).toBeGreaterThan(-1);
    expect(at("docker cp abc123:/root/.zetta")).toBeLessThan(at("docker compose up"));
    expect(at("compose cp")).toBeGreaterThan(at("docker compose up"));
    expect(run.log.join("\n")).toContain("server:/data/home/.zetta");
    expect(
      readFileSync(join(run.dir, ".zetta-old-files", "home", ".zetta", "note.txt"), "utf8").trim(),
    ).toBe("old");
    expect(run.out).toContain("saved copy stays in");
  });

  test("does nothing when the volume already exists, when no server is running, or on a first install", () => {
    const hasVolume = install(["--port", String(freePort())], {
      setup,
      env: { STUB_SERVER_ID: "abc123", STUB_VOLUME: "0" },
    });
    expect(hasVolume.log.some((line) => line.startsWith("docker cp"))).toBe(false);
    expect(existsSync(join(hasVolume.dir, ".zetta-old-files"))).toBe(false);

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "zetta-install-"));
    const noServer = install(["--port", String(freePort())], { setup });
    expect(noServer.log.some((line) => line.startsWith("docker cp"))).toBe(false);

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "zetta-install-"));
    const fresh = install(["--port", String(freePort())], { env: { STUB_SERVER_ID: "abc123" } });
    expect(fresh.log.some((line) => line.startsWith("docker cp"))).toBe(false);
  });

  test("when nothing could be copied it still updates, leaves no empty folder and moves nothing back", () => {
    const run = install(["--port", String(freePort())], {
      setup,
      env: { STUB_SERVER_ID: "abc123", STUB_CP_FAIL: "1" },
    });
    expect(run.code).toBe(0);
    expect(upCalls(run.log)).toHaveLength(1);
    expect(existsSync(join(run.dir, ".zetta-old-files"))).toBe(false);
    expect(run.log.some((line) => line.startsWith("docker compose cp"))).toBe(false);
    expect(run.out).not.toContain("saved copy stays in");
  });
});

describe("the agent CLIs", () => {
  const lastUp = (log: string[]) => upCalls(log).at(-1) ?? "";

  test("none is put in the image by default, and it says so and how to add one", () => {
    const run = install(["--port", String(freePort())]);
    expect(run.code).toBe(0);
    expect(run.out).toContain("Claude Code is not installed on this computer");
    expect(run.out).toContain("Codex is not installed on this computer");
    expect(run.out).toContain("holds no agent CLI");
    expect(run.out).toContain("--agents claude-code");
    expect(lastUp(run.log)).toContain("ZETTA_AGENTS=[]");
    expect(value(run.read(".env"), "ZETTA_AGENTS")).toBe("");
  });

  test("copies already on this computer are reported, with their version, and not used or copied", () => {
    const run = install(["--port", String(freePort())], { host: ["claude", "codex"] });
    expect(run.code).toBe(0);
    expect(run.out).toContain("Claude Code is installed on this computer (2.1.326 (Claude Code))");
    expect(run.out).toContain("Codex is installed on this computer (codex-cli 0.163.0)");
    expect(run.out).toContain("does not use those copies or their sign-in");
    expect(lastUp(run.log)).toContain("ZETTA_AGENTS=[]");
    expect(run.log.some((line) => line.startsWith("docker cp"))).toBe(false);
  });

  test("a mix is reported for each one", () => {
    const run = install(["--port", String(freePort())], { host: ["codex"] });
    expect(run.out).toContain("Claude Code is not installed on this computer");
    expect(run.out).toContain("Codex is installed on this computer");
  });

  test("--agents puts the engines you name in the image and remembers them", () => {
    const run = install(["--port", String(freePort()), "--agents", "claude-code"]);
    expect(lastUp(run.log)).toContain("ZETTA_AGENTS=[claude-code]");
    expect(run.out).toContain("Including in the server image: claude-code");
    expect(run.out).not.toContain("holds no agent CLI");
    expect(value(run.read(".env"), "ZETTA_AGENTS")).toBe("claude-code");
  });

  test("a list is accepted with commas or spaces, without repeats, and none means none", () => {
    expect(
      lastUp(
        install(["--port", String(freePort()), "--agents", "claude-code,codex,claude-code"]).log,
      ),
    ).toContain("ZETTA_AGENTS=[claude-code codex]");
    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "zetta-install-"));
    expect(lastUp(install(["--port", String(freePort()), "--agents", "none"]).log)).toContain(
      "ZETTA_AGENTS=[]",
    );
  });

  test("the environment variable works and the option wins over it", () => {
    const viaEnv = install(["--port", String(freePort())], { env: { ZETTA_AGENTS: "codex" } });
    expect(lastUp(viaEnv.log)).toContain("ZETTA_AGENTS=[codex]");
    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "zetta-install-"));
    const both = install(["--port", String(freePort()), "--agents", "claude-code"], {
      env: { ZETTA_AGENTS: "codex" },
    });
    expect(lastUp(both.log)).toContain("ZETTA_AGENTS=[claude-code]");
  });

  test("an update keeps the choice, and --agents none clears it", () => {
    const first = install(["--port", String(freePort()), "--agents", "codex"]);
    expect(value(first.read(".env"), "ZETTA_AGENTS")).toBe("codex");

    const again = install(["--port", String(freePort())]);
    expect(lastUp(again.log)).toContain("ZETTA_AGENTS=[codex]");
    expect(again.out).toContain("Including in the server image: codex");

    const cleared = install(["--port", String(freePort()), "--agents", "none"]);
    expect(lastUp(cleared.log)).toContain("ZETTA_AGENTS=[]");
    expect(value(cleared.read(".env"), "ZETTA_AGENTS")).toBe("");
  });

  test("a name that is not an agent is refused before anything is changed", () => {
    for (const bad of ["--agents bogus", "--agents claude-code,bogus"]) {
      const run = install(["--port", String(freePort()), ...bad.split(" ")]);
      expect(run.code).not.toBe(0);
      expect(run.err).toContain("is not a list Zetta can use");
      expect(upCalls(run.log)).toEqual([]);
    }
    expect(install(["--agents"]).err).toContain("--agents needs a list");
    expect(install([], { env: { ZETTA_AGENTS: "bogus" } }).err).toContain('ZETTA_AGENTS="bogus"');
  });
});

describe("the server image's agents stage", () => {
  const read = (path: string) =>
    readFileSync(join(import.meta.dir, "..", "..", "..", path), "utf8");
  const dockerfile = read("apps/server/Dockerfile");
  const stage = dockerfile.match(/FROM node:22-slim AS agents\n([\s\S]*?)\n\nFROM oven/)![1]!;
  const block = stage.match(/RUN ([\s\S]*)$/)![1]!.replace(/\\\n/g, "\n");

  /** Runs the stage's shell with a fake npm and cp, in a folder standing for /out. */
  function runStage(agents: string) {
    const out = join(root, "out");
    const log = join(root, "stage.log");
    rmSync(log, { force: true });
    const fakes = [
      `npm() { echo "npm $*" >> "${log}"; }`,
      `cp() { echo "cp $*" >> "${log}"; : > "${out}/bin/node"; }`,
    ].join("\n");
    const run = Bun.spawnSync(["sh", "-c", `${fakes}\n${block.replaceAll("/out", out)}`], {
      env: {
        PATH: "/usr/bin:/bin",
        ZETTA_AGENTS: agents,
        CLAUDE_CODE_VERSION: "2.1.312",
        CODEX_VERSION: "0.163.0",
      },
    });
    return {
      code: run.exitCode,
      err: run.stderr.toString(),
      log: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
      hasNode: existsSync(join(out, "bin", "node")),
      hasBin: existsSync(join(out, "bin")),
    };
  }

  test("with no agent it installs nothing and copies no node, but leaves the folder the image copies from", () => {
    for (const agents of ["", "none"]) {
      rmSync(join(root, "out"), { recursive: true, force: true });
      const run = runStage(agents);
      expect(run.code).toBe(0);
      expect(run.log).toEqual([]);
      expect(run.hasNode).toBe(false);
      expect(run.hasBin).toBe(true);
    }
  });

  test("an agent is installed at its pinned version and brings the node binary it runs on", () => {
    const claude = runStage("claude-code");
    expect(claude.log[0]).toMatch(
      /^npm install -g --prefix .*\/out @anthropic-ai\/claude-code@2\.1\.312$/,
    );
    expect(claude.hasNode).toBe(true);

    rmSync(join(root, "out"), { recursive: true, force: true });
    const both = runStage("claude-code codex");
    expect(both.log[0]).toContain("@anthropic-ai/claude-code@2.1.312 @openai/codex@0.163.0");
  });

  test("an unknown agent stops the build with the list of valid ones", () => {
    const run = runStage("claude-code bogus");
    expect(run.code).not.toBe(0);
    expect(run.err).toContain("unknown agent: bogus (use claude-code, codex or none)");
  });

  test("the runtime image copies the stage's folder, and compose passes nothing by default", () => {
    expect(dockerfile).toContain("COPY --from=agents /out /opt/agents");
    expect(dockerfile).toContain('ENV PATH="/opt/agents/bin:${PATH}"');
    expect(dockerfile).toContain('ARG ZETTA_AGENTS=""');
    expect(read("docker-compose.yml")).toContain("ZETTA_AGENTS: ${ZETTA_AGENTS:-}");
  });
});

describe("the helper functions", () => {
  const call = (body: string, ...args: string[]) =>
    Bun.spawnSync(["/bin/bash", "-c", `source "${script}"; ${body}`, "_", ...args], {
      env: { PATH: "/usr/bin:/bin", ZETTA_INSTALL_SOURCE_ONLY: "1" },
    });

  test("normalize_url keeps an origin and refuses the rest", () => {
    const check = (input: string) => {
      const run = call('normalize_url "$1"', input);
      return run.exitCode === 0 ? run.stdout.toString().trim() : null;
    };
    expect(check("https://zetta.example.invalid")).toBe("https://zetta.example.invalid");
    expect(check("https://zetta.example.invalid/")).toBe("https://zetta.example.invalid");
    expect(check("http://localhost:3001")).toBe("http://localhost:3001");
    for (const bad of [
      "zetta.example.invalid",
      "ftp://x",
      "https://",
      "https://x/path",
      "https://x?y=1",
      "https://x y",
    ])
      expect(check(bad)).toBeNull();
  });

  test("normalize_agents keeps the known names once, in order, and refuses the rest", () => {
    const check = (input: string) => {
      const run = call('normalize_agents "$1"', input);
      return run.exitCode === 0 ? run.stdout.toString().trim() : null;
    };
    expect(check("claude-code")).toBe("claude-code");
    expect(check("codex,claude-code")).toBe("codex claude-code");
    expect(check("claude-code claude-code")).toBe("claude-code");
    expect(check("none")).toBe("");
    expect(check("")).toBe("");
    for (const bad of ["claude", "Codex", "claude-code;rm", "gemini"])
      expect(check(bad)).toBeNull();
  });

  test("set_env replaces the line of a key, adds a missing one and keeps the file private", () => {
    const file = join(root, "x.env");
    writeFileSync(file, "A=1\nB=2\nC=3\n");
    expect(call(`set_env "${file}" B 20; set_env "${file}" D 4`).exitCode).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("A=1\nB=20\nC=3\nD=4\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const created = join(root, "new.env");
    call(`set_env "${created}" K v`);
    expect(readFileSync(created, "utf8")).toBe("K=v\n");
  });

  test("env_value reads a key, drops quotes and answers nothing for a missing file", () => {
    const file = join(root, "y.env");
    writeFileSync(file, 'A="quoted"\nB=plain\nB2=other\n');
    expect(call(`env_value "${file}" A`).stdout.toString().trim()).toBe("quoted");
    expect(call(`env_value "${file}" B`).stdout.toString().trim()).toBe("plain");
    expect(
      call(`env_value "${join(root, "missing")}" A`)
        .stdout.toString()
        .trim(),
    ).toBe("");
  });

  test("port_busy sees a listener", () => {
    const listener = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    try {
      expect(call(`port_busy ${listener.port}`).exitCode).toBe(0);
    } finally {
      void listener.stop(true);
    }
    expect(call(`port_busy ${freePort()}`).exitCode).not.toBe(0);
  });
});
