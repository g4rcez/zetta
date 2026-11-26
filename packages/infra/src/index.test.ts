import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ENVIRONMENTS } from "../environments";
import production from "../environments/production";
import { environmentName, findEnvironment, infra, InfraError, KINDS } from "./index";

const infraRoot = join(import.meta.dir, "..");

describe("environments", () => {
  test("--env is found wherever it is, and production is the default", () => {
    expect(environmentName(["deploy"])).toBe("production");
    expect(environmentName(["deploy", "--env", "staging", "--dry-run"])).toBe("staging");
    expect(environmentName(["--env=staging", "deploy"])).toBe("staging");
    expect(environmentName(["deploy", "--env"])).toBe("");
  });

  test("an environment name cannot leave the folder, and an unknown one lists the known", () => {
    expect(() => findEnvironment("../src/cli")).toThrow(/not an environment name/);
    expect(() => findEnvironment("")).toThrow(InfraError);
    expect(() => findEnvironment("nowhere")).toThrow(/no environment "nowhere".*production/);
    expect(findEnvironment("production")).toBe(production);
  });

  test("every file of the folder is listed, so the compiled binary carries it", () => {
    const files = readdirSync(join(infraRoot, "environments"))
      .filter((name) => name.endsWith(".ts") && name !== "index.ts")
      .map((name) => name.slice(0, -3));
    expect(Object.keys(ENVIRONMENTS).sort()).toEqual(files.sort());
  });

  test("every environment is of a kind that exists", () => {
    for (const entry of Object.values(ENVIRONMENTS))
      expect(Object.keys(KINDS)).toContain(entry.kind);
  });
});

describe("kinds", () => {
  test("each kind is in the folder of its id and says what it installs", () => {
    for (const [id, kind] of Object.entries(KINDS)) {
      expect<string>(kind.id).toBe(id);
      expect(readdirSync(join(infraRoot, "src"))).toContain(id);
      expect(kind.title.length).toBeGreaterThan(20);
      expect(kind.usage("zetta infra")).toStartWith("Usage: zetta infra <command>");
    }
  });

  test("the shared code depends on no kind", () => {
    const core = join(infraRoot, "src/core");
    for (const name of readdirSync(core)) {
      const imports = readFileSync(join(core, name), "utf8").match(/from "[^"]+"/g) ?? [];
      expect([name, imports.filter((line) => /"\.\.\//.test(line))]).toEqual([name, []]);
    }
  });
});

describe("infra", () => {
  const run = async (argv: string[]) => {
    const said: string[] = [];
    const status = await infra(argv, { program: "zetta infra", say: (line) => said.push(line) });
    return { status, text: said.join("\n") };
  };

  test("a dry run of bootstrap reaches the kind of the environment and changes nothing", async () => {
    const { status, text } = await run(["bootstrap", "--dry-run"]);
    expect(status).toBe(0);
    expect(text).toContain("step accounts");
    expect(text.indexOf("step accounts")).toBeLessThan(text.indexOf("step admin"));
    expect(text).toContain("zetta infra deploy --env production");
    expect(text).not.toContain("bun run infra");
  });

  test("help and a missing command show the usage of that kind", async () => {
    expect(await run(["--help"])).toMatchObject({ status: 0 });
    const none = await run([]);
    expect(none.status).toBe(2);
    expect(none.text).toContain("bootstrap");
  });

  test("an unknown environment is an error the caller shows without a stack", async () => {
    await expect(run(["status", "--env", "nowhere"])).rejects.toThrow(InfraError);
  });
});
