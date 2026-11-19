import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir, isIsolated, zettaHome } from "./zetta-home";

describe("zettaHome and dataDir", () => {
  test("without ZETTA_HOME, state stays where it always was", () => {
    expect(zettaHome({})).toBe(join(homedir(), ".zetta"));
    expect(isIsolated({})).toBe(false);
    expect(dataDir("artifacts", undefined, {})).toBe(join(homedir(), ".zetta", "artifacts"));
    expect(dataDir("files", "/cwd/.zetta-files", {})).toBe("/cwd/.zetta-files");
  });

  test("with ZETTA_HOME, every kind of state lives inside it, whatever its old default was", () => {
    const env = { ZETTA_HOME: "/data/zetta" };
    expect(isIsolated(env)).toBe(true);
    expect(dataDir("artifacts", undefined, env)).toBe("/data/zetta/artifacts");
    expect(dataDir("files", "/cwd/.zetta-files", env)).toBe("/data/zetta/files");
    expect(dataDir("cache/models", join(homedir(), ".cache"), env)).toBe(
      "/data/zetta/cache/models",
    );
  });

  test("a blank ZETTA_HOME is not isolation", () => {
    expect(isIsolated({ ZETTA_HOME: "  " })).toBe(false);
  });
});
