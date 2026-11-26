import { describe, expect, test } from "bun:test";

import production from "../environments/production";
import { buildEnvironment, releaseName } from "./build";
import * as commands from "./commands";
import { parseEnvironment } from "./environment";
import { RELEASE_ID } from "./layout";
import { rsyncHost, sshOptions, type Remote } from "./ssh";
import { readVersions } from "./versions";

const environment = parseEnvironment("production", production, {
  DEPLOY_HOST: "203.0.113.7",
  DEPLOY_DOMAIN: "zetta.example.invalid",
});

/** A server that records what it is asked. `probes` answers each login check in turn, then yes. */
function fakeServer(options: { probes?: boolean[]; failing?: string; status?: number } = {}) {
  const log: string[] = [];
  const probes = [...(options.probes ?? [])];
  const connect = (user: string): Remote => ({
    user,
    probe: async () => {
      const answer = probes.shift() ?? true;
      log.push(`${user}:probe:${answer}`);
      return answer;
    },
    run: async (step) => {
      log.push(`${user}:${step.id}`);
      return step.id === options.failing ? (options.status ?? 1) : 0;
    },
    capture: async (command) => {
      log.push(`${user}:capture:${command.split(" ")[0]}`);
      return "";
    },
    interactive: async (command) => {
      log.push(`${user}:interactive:${command}`);
      return 0;
    },
    upload: async (_, destination) => void log.push(`${user}:upload:${destination}`),
    download: async () => {},
    close: async () => {},
  });
  const context: commands.Context = {
    environment,
    versions: readVersions(),
    connect,
    mode: "dry-run",
    say: () => {},
  };
  return { log, context };
}

describe("bootstrap", () => {
  test("uses root only until the admin login works, and closes root login after that", async () => {
    const { log, context } = fakeServer({ probes: [false] });
    await commands.bootstrap(context);
    expect(log.slice(0, 5)).toEqual([
      "deploy:probe:false",
      "root:admin",
      "deploy:probe:true",
      "deploy:sshd",
      "deploy:probe:true",
    ]);
    expect(log.filter((line) => line.startsWith("root:"))).toEqual(["root:admin"]);
  });

  test("keeps root login open when the admin login does not work", async () => {
    const { log, context } = fakeServer({ probes: [false, false] });
    await expect(commands.bootstrap(context)).rejects.toThrow(/root login stays open/);
    expect(log).not.toContain("deploy:sshd");
  });

  test("takes the SSH change back when a new login fails after it", async () => {
    const { log, context } = fakeServer({ probes: [true, true, false] });
    await expect(commands.bootstrap(context)).rejects.toThrow(/was removed/);
    expect(log.at(-1)).toBe("deploy:capture:rm");
  });

  test("asks for a restart after a kernel upgrade and stops there", async () => {
    const { log, context } = fakeServer({ failing: "packages", status: 75 });
    await expect(commands.bootstrap(context)).rejects.toThrow(/Restart the server/);
    expect(log.at(-1)).toBe("deploy:packages");
  });
});

describe("deploy", () => {
  test("uploads, installs, migrates, switches and prunes, in that order", async () => {
    const { log, context } = fakeServer();
    await commands.deploy(context);
    expect(
      log.map((line) =>
        line
          .split(":")
          .slice(0, 2)
          .join(":")
          .replace(/\/srv.*/, ""),
      ),
    ).toEqual([
      "deploy:probe",
      "deploy:preflight",
      "deploy:prepare",
      "deploy:upload",
      "deploy:install",
      "deploy:migrate",
      "deploy:activate",
      "deploy:prune",
    ]);
  });

  test.each(["preflight", "install"])("never migrates when %s fails", async (failing) => {
    const { log, context } = fakeServer({ failing });
    await expect(commands.deploy(context)).rejects.toThrow(failing);
    expect(log).not.toContain("deploy:migrate");
    expect(log).not.toContain("deploy:activate");
  });

  test("never switches when a migration fails", async () => {
    const { log, context } = fakeServer({ failing: "migrate" });
    await expect(commands.deploy(context)).rejects.toThrow("migrate");
    expect(log).not.toContain("deploy:activate");
  });

  test("migrate runs only the migration step, which takes its own backup", async () => {
    const { log, context } = fakeServer();
    await commands.migrate(context);
    expect(log).toEqual(["deploy:probe:true", "deploy:migrate"]);
  });
});

describe("signing an agent in", () => {
  test("runs as the zetta user with the pinned CLIs on the PATH", () => {
    const { context } = fakeServer();
    const command = commands.loginCommand(context, "claude-code");
    expect(command).toStartWith("sudo -u zetta -H env -C /var/lib/zetta PATH=/opt/agents/bin:");
    expect(command).toEndWith("claude auth login");
    expect(() => commands.loginCommand(context, "codex")).toThrow(/does not install/);
  });

  test("in the podman sandbox signs one person in, inside the run image", () => {
    const { context } = fakeServer();
    context.environment = { ...environment, sandbox: "podman" };
    expect(() => commands.loginCommand(context, "claude-code")).toThrow(/--account/);
    expect(() => commands.loginCommand(context, "claude-code", "../../x")).toThrow(/--account/);
    const command = commands.loginCommand(context, "claude-code", "user_1");
    expect(command).toContain("/var/lib/zetta/harness-homes/user_1/claude-code");
    expect(command).toContain("zetta-harness:");
    expect(Bun.spawnSync(["bash", "-n", "-c", command]).exitCode).toBe(0);
  });
});

describe("the local side", () => {
  test("a release id sorts by time and names the commit", () => {
    const id = releaseName(new Date("2026-11-25T09:05:07.123Z"), "0123456789abcdef");
    expect(id).toBe("20261125T090507Z-0123456789ab");
    expect(id).toMatch(RELEASE_ID);
  });

  test("the build sees nothing of this machine's own Zetta settings", () => {
    const built = buildEnvironment(
      { NODE_ENV: "production", ZETTA_SERVER_URL: "https://zetta.example.invalid" },
      {
        PATH: "/usr/bin",
        ZETTA_SERVER_URL: "http://localhost:3000",
        ZETTA_CONNECTION_KEY: "x",
        DATABASE_URL: "x",
        BETTER_AUTH_SECRET: "x",
        __VARLOCK_ENV: "{}",
        DEPLOY_HOST: "x",
        NODE_ENV: "development",
      },
    );
    expect(built).toEqual({
      PATH: "/usr/bin",
      NODE_ENV: "production",
      ZETTA_SERVER_URL: "https://zetta.example.invalid",
    });
  });

  test("the public key is looked up next to the private one", () => {
    expect(commands.publicKeyPath("/k/id", "/h")).toBe("/k/id.pub");
    expect(commands.publicKeyPath("/k/id.pub", "/h")).toBe("/k/id.pub");
    expect(commands.publicKeyPath(undefined, "/h")).toBe("/h/.ssh/id_ed25519.pub");
  });

  test("ssh gets the port and the key, rsync an IPv6 address in brackets", () => {
    const options = sshOptions(
      { host: "h", port: 2222, user: "u", identityFile: "/k/id" },
      "/tmp/c",
    );
    expect(options.join(" ")).toContain("-p 2222 -i /k/id");
    expect(rsyncHost("2001:db8::1")).toBe("[2001:db8::1]");
    expect(rsyncHost("203.0.113.7")).toBe("203.0.113.7");
  });
});
