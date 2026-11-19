import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fake, installElectrobunFake } from "../test-support/electrobun-fake";
import { resourcePaths, type LocalState, type SpawnFn } from "./local-server";
import { createRegistry } from "./registry";

installElectrobunFake();
const { attachLocalServer, localServerEnabled, resourcesRoot } = await import("./local");

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zetta-attach-"));
  fake.reset();
  fake.userData = root;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const shipped = () => {
  const paths = resourcePaths(join(root, "res"), "/bin/bun", "darwin", "arm64");
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
};

const spawnForever: SpawnFn = () => ({ exited: new Promise<number>(() => {}), kill() {} });

describe("switch and folders", () => {
  test("ZETTA_DESKTOP_LOCAL=off turns it off, anything else leaves it on", () => {
    expect(localServerEnabled({ ZETTA_DESKTOP_LOCAL: "off" })).toBe(false);
    expect(localServerEnabled({ ZETTA_DESKTOP_LOCAL: " OFF " })).toBe(false);
    expect(localServerEnabled({})).toBe(true);
    expect(localServerEnabled({ ZETTA_DESKTOP_LOCAL: "on" })).toBe(true);
  });

  test("the shipped files are next to the app's code unless a folder is named", () => {
    expect(resourcesRoot({}, "/app/Resources/app/bun")).toBe("/app/Resources/app");
    expect(resourcesRoot({ ZETTA_DESKTOP_RESOURCES: "/stage" }, "/x/bun")).toBe("/stage");
  });
});

describe("attached to the server list", () => {
  test("off: nothing is attached", () => {
    const registry = createRegistry(join(root, "servers.json"));
    expect(
      attachLocalServer({ registry, changed() {}, env: { ZETTA_DESKTOP_LOCAL: "off" } }),
    ).toBeNull();
    expect(registry.list()).toEqual([]);
  });

  test("its address becomes the entry 'This computer', and every change is passed on", async () => {
    const registry = createRegistry(join(root, "servers.json"));
    const seen: LocalState[] = [];
    const attached = attachLocalServer({
      registry,
      changed: (state) => seen.push(state),
      paths: shipped(),
      env: {},
      server: {
        spawn: spawnForever,
        probe: async () => true,
        sleep: async () => {},
        isFree: async () => true,
        pick: async () => 44100,
      },
    })!;
    const state = await attached.server.start();
    expect(state.status).toBe("running");
    const entry = attached.entry()!;
    expect(entry).toMatchObject({
      name: "This computer",
      kind: "local",
      webOrigin: "http://127.0.0.1:44100",
    });
    expect(seen.map((s) => s.status)).toContain("running");
    // The page it opens is the onboarding page with the setup key in the fragment (never sent to the server).
    const path = attached.openPath();
    expect(path.startsWith("/onboarding#key=")).toBe(true);
    await attached.server.stop();
  });

  test("a changed port moves the same entry, it does not add another", async () => {
    const registry = createRegistry(join(root, "servers.json"));
    const first = registry.setLocal({
      webOrigin: "http://127.0.0.1:44100",
      apiOrigin: "http://127.0.0.1:44100",
    });
    const second = registry.setLocal({
      webOrigin: "http://127.0.0.1:44200",
      apiOrigin: "http://127.0.0.1:44200",
    });
    expect(second.id).toBe(first.id);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.webOrigin).toBe("http://127.0.0.1:44200");
  });
});
