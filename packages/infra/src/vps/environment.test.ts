import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import entry from "../../environments/production";
import { DRY_RUN_VALUES, parseEnvironment, readValues } from "./environment";

const production = entry.define;

const values = { DEPLOY_HOST: "203.0.113.7", DEPLOY_DOMAIN: "zetta.example.invalid" };
const parse = (extra: Record<string, string> = {}) =>
  parseEnvironment("production", production, { ...values, ...extra });

describe("the production environment", () => {
  test("needs only the host and the domain", () => {
    const environment = parse();
    expect(environment.ssh).toEqual({ user: "deploy", port: 22 });
    expect(environment.sandbox).toBe("host");
    expect(environment.postgres.appPool).toBeLessThan(environment.postgres.maxConnections);
  });

  test("says which value is missing", () => {
    expect(() => parseEnvironment("production", production, {})).toThrow(
      /DEPLOY_HOST is missing[\s\S]*DEPLOY_DOMAIN is missing/,
    );
  });

  test("names the file the values go in, which is another one outside a clone", () => {
    expect(() => parseEnvironment("production", production, {})).toThrow(
      "packages/infra/.env.production",
    );
    expect(() =>
      parseEnvironment("production", production, {}, "~/.config/zetta/infra/.env.production"),
    ).toThrow("Set the values in ~/.config/zetta/infra/.env.production:");
  });

  test.each([
    ["DEPLOY_DOMAIN", "https://zetta.example.invalid"],
    ["DEPLOY_DOMAIN", "zetta.example.invalid/app"],
    ["DEPLOY_DOMAIN", "localhost"],
    ["DEPLOY_DOMAIN", "a.example.invalid {\n}"],
    ["DEPLOY_HOST", "-oProxyCommand=id"],
    ["DEPLOY_HOST", "host name"],
    ["DEPLOY_SSH_USER", "root"],
    ["DEPLOY_SSH_USER", "zetta"],
    ["DEPLOY_SSH_USER", "me; rm -rf /"],
    ["DEPLOY_SSH_PORT", "70000"],
    ["DEPLOY_ACME_EMAIL", "not-an-address"],
  ])("refuses %s=%p", (name, value) => {
    expect(() => parse({ [name]: value })).toThrow();
  });

  test("the dry-run placeholders are a valid environment", () => {
    expect(parseEnvironment("production", production, DRY_RUN_VALUES).domain).toContain("invalid");
  });
});

describe("values", () => {
  test("come from .env.<name>, the process environment wins and empty means unset", () => {
    const folder = mkdtempSync(join(tmpdir(), "zetta-values-"));
    writeFileSync(
      join(folder, ".env.staging"),
      '# comment\nDEPLOY_HOST=from-file\nDEPLOY_DOMAIN="file.example.invalid"\nDEPLOY_SSH_USER=\nOTHER=x\n',
    );
    expect(
      readValues("staging", { DEPLOY_HOST: "from-process", DEPLOY_SSH_KEY: "" }, folder),
    ).toEqual({ DEPLOY_HOST: "from-process", DEPLOY_DOMAIN: "file.example.invalid" });
    rmSync(folder, { recursive: true, force: true });
  });
});
