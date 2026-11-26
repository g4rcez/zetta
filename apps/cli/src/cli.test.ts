import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { main, USAGE, version } from "./cli";

afterEach(() => {
  delete (globalThis as { zettaInfraEmbedded?: unknown }).zettaInfraEmbedded;
});

const run = async (argv: string[]) => {
  const said: string[] = [];
  const status = await main(argv, (line) => said.push(line));
  return { status, text: said.join("\n") };
};

/** The program as a person starts it. */
function zetta(...argv: string[]) {
  const done = Bun.spawnSync([process.execPath, join(import.meta.dir, "index.ts"), ...argv], {
    stdin: "ignore",
  });
  return {
    status: done.exitCode,
    out: done.stdout.toString(),
    err: done.stderr.toString(),
  };
}

describe("zetta", () => {
  test("with no command, or one it does not have, shows the commands and fails", async () => {
    expect(await run([])).toEqual({ status: 1, text: USAGE });
    expect(await run(["nothing"])).toEqual({ status: 1, text: USAGE });
    expect(await run(["--help"])).toEqual({ status: 0, text: USAGE });
  });

  test("infra reaches the infra package, and its hints name this program", async () => {
    const { status, text } = await run(["infra", "bootstrap", "--dry-run"]);
    expect(status).toBe(0);
    expect(text).toContain("step accounts");
    expect(text).toContain("2. zetta infra deploy --env production");
    expect((await run(["infra", "--help"])).text).toStartWith("Usage: zetta infra <command>");
  });

  test("the version is the commit the binary was built from", async () => {
    expect(version()).toBe("zetta, run from a clone of the repository");
    (globalThis as { zettaInfraEmbedded?: unknown }).zettaInfraEmbedded = {
      commit: "0123456789abcdef0123",
    };
    expect(await run(["version"])).toEqual({ status: 0, text: "zetta 0123456789ab" });
  });
});

describe("the program", () => {
  test("a problem the person can fix is one line, with no stack", () => {
    const { status, err } = zetta("infra", "status", "--env", "nowhere");
    expect(status).toBe(1);
    expect(err).toContain('error: There is no environment "nowhere"');
    expect(err).not.toContain("    at ");
  });

  test("setup keeps its own usage and its own errors", () => {
    const help = zetta("setup", "--help");
    expect(help.status).toBe(0);
    expect(help.out).toStartWith("Usage: zetta setup");
    const bad = zetta("setup", "--mode", "everywhere");
    expect(bad).toMatchObject({ status: 1, err: 'Unknown mode "everywhere". Use local or lan.\n' });
  });
});
