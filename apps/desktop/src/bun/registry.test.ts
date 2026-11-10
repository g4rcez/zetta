import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRegistry, sharesCookiesWith } from "./registry";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zetta-registry-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const remote = {
  kind: "remote",
  webOrigin: "https://zetta.example.invalid/app",
  apiOrigin: "https://api.example.invalid",
} as const;

describe("registry", () => {
  test("adds a server with a v7 id, a name from the host and the origins normalized", () => {
    const registry = createRegistry(join(dir, "servers.json"));
    const entry = registry.add(remote);
    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(entry.name).toBe("zetta.example.invalid");
    expect(entry.webOrigin).toBe("https://zetta.example.invalid");
    expect(entry.lastOpenedAt).toBeNull();
  });

  test("the same web origin is one server: adding it again keeps the id and the name", () => {
    const registry = createRegistry(join(dir, "servers.json"));
    const first = registry.add({ ...remote, name: "Work" });
    const again = registry.add({ ...remote, apiOrigin: "https://api2.example.invalid" });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Work");
    expect(again.apiOrigin).toBe("https://api2.example.invalid");
    expect(registry.list()).toHaveLength(1);
  });

  test("survives a restart and keeps the file private", () => {
    const file = join(dir, "servers.json");
    const id = createRegistry(file).add(remote).id;
    expect(createRegistry(file).get(id)?.webOrigin).toBe("https://zetta.example.invalid");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("finds a server by either of its origins", () => {
    const registry = createRegistry(join(dir, "servers.json"));
    const entry = registry.add(remote);
    expect(registry.findByOrigin("https://api.example.invalid/x")?.id).toBe(entry.id);
    expect(registry.findByOrigin("https://zetta.example.invalid")?.id).toBe(entry.id);
    expect(registry.findByOrigin("https://other.invalid")).toBeUndefined();
    expect(registry.findByOrigin("javascript:1")).toBeUndefined();
  });

  test("touch, rename and remove", () => {
    const registry = createRegistry(
      join(dir, "servers.json"),
      () => new Date("2026-11-09T10:00:00Z"),
    );
    const { id } = registry.add(remote);
    registry.touch(id);
    expect(registry.get(id)?.lastOpenedAt).toBe("2026-11-09T10:00:00.000Z");
    expect(registry.rename(id, "  Home  ")).toBe(true);
    expect(registry.get(id)?.name).toBe("Home");
    expect(registry.rename(id, "   ")).toBe(false);
    expect(registry.remove(id)).toBe(true);
    expect(registry.remove(id)).toBe(false);
  });

  test("rejects a server that is not http(s)", () => {
    const registry = createRegistry(join(dir, "servers.json"));
    expect(() => registry.add({ ...remote, webOrigin: "file:///etc" })).toThrow("INVALID_SERVER");
    expect(() => registry.add({ ...remote, kind: "other" as never })).toThrow("INVALID_SERVER");
  });

  test("a file that cannot be read is moved aside, never overwritten", () => {
    const file = join(dir, "servers.json");
    writeFileSync(file, "{ not json");
    const registry = createRegistry(file, () => new Date(5));
    expect(registry.list()).toEqual([]);
    const aside = readdirSync(dir).find((name) => name.startsWith("servers.json.corrupt-"));
    expect(aside).toBeDefined();
    expect(readFileSync(join(dir, aside!), "utf8")).toBe("{ not json");
  });

  test("drops a stored row that is not valid and keeps the others", () => {
    const file = join(dir, "servers.json");
    const good = {
      id: "a",
      name: "A",
      kind: "remote",
      webOrigin: "https://a.invalid",
      apiOrigin: "https://a.invalid",
      lastOpenedAt: null,
    };
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        servers: [good, { ...good, id: "b", webOrigin: "javascript:1" }, 7],
      }),
    );
    expect(
      createRegistry(file)
        .list()
        .map((entry) => entry.id),
    ).toEqual(["a"]);
  });
});

describe("sharesCookiesWith", () => {
  test("finds servers on the same host, whatever the port", () => {
    const registry = createRegistry(join(dir, "servers.json"));
    const a = registry.add({
      kind: "dev",
      webOrigin: "https://localhost:3000",
      apiOrigin: "https://localhost:3000",
    });
    const b = registry.add({
      kind: "local",
      webOrigin: "http://localhost:6100",
      apiOrigin: "http://localhost:6100",
    });
    const c = registry.add({
      kind: "remote",
      webOrigin: "https://zetta.example.invalid",
      apiOrigin: "https://api.example.invalid",
    });
    expect(sharesCookiesWith(registry.list(), a).map((entry) => entry.id)).toEqual([b.id]);
    expect(sharesCookiesWith(registry.list(), c)).toEqual([]);
  });

  test("counts the API host too", () => {
    const registry = createRegistry(join(dir, "servers.json"));
    const a = registry.add({
      kind: "remote",
      webOrigin: "https://one.example.invalid",
      apiOrigin: "https://api.example.invalid",
    });
    const b = registry.add({
      kind: "remote",
      webOrigin: "https://two.example.invalid",
      apiOrigin: "https://api.example.invalid",
    });
    expect(sharesCookiesWith(registry.list(), a).map((entry) => entry.id)).toEqual([b.id]);
  });
});
