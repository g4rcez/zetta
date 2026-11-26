import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEnvSchema } from "../../../apps/server/src/env-schema";
import production from "../environments/production";
import { type Environment, parseEnvironment } from "./environment";
import { file, quote, script } from "./shell";
import { publicKeyLine } from "./steps/access";
import { SECRET_NAMES } from "./steps/app";
import {
  activateStep,
  backupStep,
  installStep,
  migrateStep,
  NEWEST_BACKUP,
  preflightStep,
  prepareStep,
  pruneStep,
  restartStep,
  rollbackStep,
  statusStep,
} from "./steps/release";
import { adminUserStep, hostSteps, sshdStep } from "./steps";
import { appEnv, backupScript, caddyfile, restoreScript, serviceUnit } from "./templates/app";
import { nftables, SSH_PORTS, sshd } from "./templates/host";
import { majorUpgradeCheck, pgHba, postgresConf } from "./templates/postgres";
import { readVersions, repoRoot } from "./versions";

const values = { DEPLOY_HOST: "203.0.113.7", DEPLOY_DOMAIN: "zetta.example.invalid" };
const environment = parseEnvironment("production", production, values);
const podman: Environment = { ...environment, sandbox: "podman", agents: ["claude-code", "codex"] };
const versions = readVersions();
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample me@example.invalid";
const ID = "20261125T120000Z-0123456789ab";

/** bash reads a script without running it. */
function syntaxError(source: string) {
  const checked = Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(source) });
  return checked.exitCode === 0 ? "" : checked.stderr.toString();
}

const allSteps = (on: Environment) => [
  adminUserStep(on, KEY),
  sshdStep(),
  ...hostSteps(on, versions),
  preflightStep(),
  prepareStep(ID),
  installStep(ID),
  backupStep(),
  migrateStep(ID),
  migrateStep("current"),
  activateStep(ID),
  rollbackStep(),
  rollbackStep("0123456"),
  pruneStep(5),
  restartStep(),
  statusStep(),
];

describe("remote scripts", () => {
  test.each([
    ["host", environment],
    ["podman", podman],
  ] as const)("every script of the %s sandbox is valid bash", (_, on) => {
    for (const step of allSteps(on))
      expect([step.id, syntaxError(step.script)]).toEqual([step.id, ""]);
  });

  test("the scripts written to the server are valid bash", () => {
    for (const source of [
      backupScript(environment),
      restoreScript(),
      majorUpgradeCheck(),
      NEWEST_BACKUP,
    ])
      expect(syntaxError(source)).toBe("");
  });

  test("a script cannot be eaten by a command that reads stdin", () => {
    const text = script("cat\necho after");
    expect(text.startsWith("{\n")).toBe(true);
    expect(text.trimEnd().endsWith("} </dev/null")).toBe(true);
    const run = Bun.spawnSync(["bash", "-s"], { stdin: new TextEncoder().encode(text) });
    expect(run.stdout.toString()).toContain("after");
  });

  test("a quoted word is passed as it is", () => {
    const word = `a 'b' $(id) "c" \\d`;
    const run = Bun.spawnSync(["bash", "-c", `printf %s ${quote(word)}`]);
    expect(run.stdout.toString()).toBe(word);
  });

  test("a file that holds the heredoc marker is refused", () => {
    expect(() => file({ path: "/x", content: "a\n__FILE__\nrm -rf /" })).toThrow();
  });

  test("a release name or a commit cannot carry a command", () => {
    for (const bad of ["x", `${ID};id`, "../current", "$(id)"]) {
      expect(() => activateStep(bad)).toThrow();
      expect(() => prepareStep(bad)).toThrow();
      expect(() => migrateStep(bad)).toThrow();
      expect(() => rollbackStep(bad)).toThrow();
    }
  });

  test("packages come first, caddy and the units last", () => {
    const order = hostSteps(environment, versions).map((step) => step.id);
    expect(order.indexOf("packages")).toBe(0);
    expect(order.indexOf("app-user")).toBeGreaterThan(order.indexOf("postgres"));
    expect(order.slice(-2)).toEqual(["caddy", "services"]);
    expect(order).not.toContain("podman");
    expect(hostSteps(podman, versions).map((step) => step.id)).toContain("podman");
  });

  test("a migration stops Zetta and backs up before the role is a superuser, and always takes that back", () => {
    const text = migrateStep(ID).script;
    const at = (line: string) => {
      const found = text.indexOf(line);
      expect([line, found > -1]).toEqual([line, true]);
      return found;
    };
    const trap = at("trap close EXIT");
    const stop = at("systemctl stop zetta");
    const backup = at("zetta-backup deploy");
    const grant = at("ALTER ROLE zetta SUPERUSER");
    expect([trap, stop, backup, grant]).toEqual(
      [trap, stop, backup, grant].toSorted((a, b) => a - b),
    );
    expect(at("\n  migrator\n")).toBeGreaterThan(grant);
    expect(text).toMatch(/close\(\) \{\s+sql -c 'ALTER ROLE zetta NOSUPERUSER'/);
  });
});

describe("files on the server", () => {
  test("Postgres listens on no network and trusts only the Linux user", () => {
    expect(postgresConf(environment)).toContain("listen_addresses = ''");
    expect(pgHba()).not.toMatch(/^host/m);
    expect(pgHba()).toMatch(/^local\s+zetta\s+zetta\s+peer$/m);
  });

  test("the firewall opens SSH and the web, and nothing of Zetta or Postgres", () => {
    const rules = nftables();
    expect(rules).toContain("policy drop");
    expect(rules).toContain(`tcp dport { ${SSH_PORTS} } accept`);
    expect(rules).toContain("tcp dport { 80, 443 } accept");
    expect(rules).not.toMatch(/dport.*\b(3000|5432)\b/);
    expect(rules).not.toContain("flush ruleset");
  });

  test("the firewall asks the server which ports SSH uses, whatever you connect to", () => {
    const forwarded = { ...environment, ssh: { ...environment.ssh, port: 2222 } };
    const firewall = hostSteps(forwarded, versions).find((step) => step.id === "firewall")!;
    expect(firewall.script).toContain("sshd -T");
    expect(firewall.script).not.toContain("2222");
  });

  test("sshd takes keys only", () => {
    expect(sshd()).toContain("PermitRootLogin no");
    expect(sshd()).toContain("PasswordAuthentication no");
  });

  test("the proxy does not buffer or compress the live stream", () => {
    const config = caddyfile(environment);
    expect(config).toContain("zetta.example.invalid {");
    expect(config).toContain("flush_interval -1");
    expect(config).toContain("@page not path /api/*");
    expect(config).not.toContain("email");
    expect(caddyfile({ ...environment, acmeEmail: "ops@example.invalid" })).toContain(
      "email ops@example.invalid",
    );
  });

  test("the unit is closed down on the host and open to Podman's needs in that sandbox", () => {
    const unit = serviceUnit(environment);
    expect(unit).toContain("User=zetta");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("OOMPolicy=continue");
    const sandboxed = serviceUnit(podman);
    expect(sandboxed).not.toContain("NoNewPrivileges");
    expect(sandboxed).not.toContain("PrivateTmp");
    expect(sandboxed).toContain("EnvironmentFile=/etc/zetta/sandbox.env");
  });

  test("the sign-in key is kept as a key, without the comment that names a person", () => {
    expect(publicKeyLine(KEY)).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample zetta-deploy");
    expect(() => publicKeyLine("-----BEGIN OPENSSH PRIVATE KEY-----")).toThrow();
    expect(() => publicKeyLine("ssh-ed25519 abc\nssh-ed25519 def")).toThrow();
  });
});

describe("the settings match the server's schema", () => {
  const schema = new Map(
    parseEnvSchema(readFileSync(join(repoRoot, "apps/server/.env.schema"), "utf8")).map((entry) => [
      entry.name,
      entry,
    ]),
  );
  const written = [environment, podman].flatMap((on) =>
    [...appEnv(on).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((found) => found[1]!),
  );

  test("every required setting is written or generated", () => {
    const missing = [...schema.values()]
      .filter((entry) => entry.required)
      .map((entry) => entry.name)
      .filter((name) => !written.includes(name) && !SECRET_NAMES.includes(name));
    expect(missing).toEqual([]);
  });

  test("every Zetta setting written is one the server declares", () => {
    expect(written.filter((name) => name.startsWith("ZETTA_") && !schema.has(name))).toEqual([]);
  });

  // The server refuses to send any response that holds the value of a secret setting. A short value such as "lax" marked secret
  // breaks every answer that contains those letters.
  test("no plain setting of the file is treated as a secret by the server", () => {
    const secret = written.filter((name) => schema.get(name)?.secret && name !== "DATABASE_URL");
    expect(secret).toEqual([]);
  });

  test("no secret is in the file that the repository renders", () => {
    for (const name of SECRET_NAMES) expect(written).not.toContain(name);
  });
});
