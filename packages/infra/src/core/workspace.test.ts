import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findWorkspace, resolveVersions } from "./workspace";

let folder = "";
beforeEach(() => {
  folder = realpathSync(mkdtempSync(join(tmpdir(), "zetta-workspace-")));
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
  delete (globalThis as { zettaInfraEmbedded?: unknown }).zettaInfraEmbedded;
});

/** A folder that looks like a clone of the repository. */
function clone(name: string) {
  const root = join(folder, name);
  mkdirSync(join(root, "packages/infra"), { recursive: true });
  mkdirSync(join(root, "apps/server/src"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "name": "zetta" }');
  writeFileSync(join(root, "packages/infra/package.json"), "{}");
  return root;
}

// What the compiled binary sees: its own code is in no real folder.
const compiled = { source: "/$bunfs/root", configHome: undefined };

describe("the workspace", () => {
  test("run from source, it is the clone the source is in, whatever the current folder", () => {
    const workspace = findWorkspace({ cwd: folder });
    expect(workspace.mode).toBe("checkout");
    expect(workspace.values).toBe(join(workspace.root!, "packages/infra"));
    expect(workspace.valuesLabel).toBe("packages/infra");
  });

  test("the binary finds a clone from any folder inside it", () => {
    const root = clone("zetta");
    const workspace = findWorkspace({ ...compiled, cwd: join(root, "apps/server/src") });
    expect(workspace).toEqual({
      mode: "checkout",
      root,
      values: join(root, "packages/infra"),
      valuesLabel: "packages/infra",
    });
  });

  test("another project is not a clone", () => {
    const other = join(folder, "other");
    mkdirSync(join(other, "packages/infra"), { recursive: true });
    writeFileSync(join(other, "package.json"), '{ "name": "other" }');
    writeFileSync(join(other, "packages/infra/package.json"), "{}");
    expect(findWorkspace({ ...compiled, cwd: other, home: folder }).mode).toBe("standalone");
  });

  test("with no clone the values are in the person's config folder", () => {
    expect(findWorkspace({ ...compiled, cwd: folder, home: "/people/ana" })).toEqual({
      mode: "standalone",
      values: "/people/ana/.config/zetta/infra",
      valuesLabel: "~/.config/zetta/infra",
    });
    expect(
      findWorkspace({ ...compiled, cwd: folder, home: "/people/ana", configHome: "/cfg" }).values,
    ).toBe("/cfg/zetta/infra");
  });
});

describe("the pinned versions", () => {
  const standalone = findWorkspace({ ...compiled, cwd: tmpdir(), home: "/people/ana" });

  test("come from the clone when there is one", () => {
    expect(resolveVersions(findWorkspace()).bun).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("come from the binary when there is none, and their absence is said plainly", () => {
    expect(() => resolveVersions(standalone)).toThrow(/inside a clone/);
    const versions = resolveVersions(findWorkspace());
    (globalThis as { zettaInfraEmbedded?: unknown }).zettaInfraEmbedded = {
      versions: { ...versions, bun: "9.9.9" },
      commit: "0123456789abcdef",
    };
    expect(resolveVersions(standalone).bun).toBe("9.9.9");
  });
});
