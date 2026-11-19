import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretBox, macKeychain, type KeyVault } from "./secret-box";
import { createTokenStore } from "./token-store";

let root = "";
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), "zetta-box-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));
const memoryVault = (): KeyVault & { value: string | null } => ({
  value: null,
  get() {
    return this.value;
  },
  set(v) {
    this.value = v;
    return true;
  },
});
const tokens = {
  accessToken: "access-secret-xyz",
  refreshToken: "refresh-secret-xyz",
  expiresAt: 9e15,
  scope: "x",
};

describe("secret box", () => {
  test("seals and opens, and a changed or foreign payload does not open", () => {
    const box = createSecretBox(memoryVault());
    const sealed = box.seal("hello")!;
    expect(sealed).not.toContain("hello");
    expect(box.open(sealed)).toBe("hello");
    expect(box.open(`${sealed.slice(0, -4)}AAAA`)).toBeNull();
    expect(createSecretBox(memoryVault()).open(sealed)).toBeNull();
  });
  test("no vault, or a vault that refuses, offers nothing", () => {
    expect(createSecretBox(null).seal("x")).toBeNull();
    expect(createSecretBox({ get: () => null, set: () => false }).available()).toBe(false);
  });
  test("the key is made once and kept in the vault", () => {
    const vault = memoryVault();
    const a = createSecretBox(vault);
    const sealed = a.seal("x")!;
    expect(createSecretBox(vault).open(sealed)).toBe("x");
  });
  test("the Keychain wrapper reads and writes through `security`", () => {
    const calls: string[][] = [];
    const kc = macKeychain(
      (args) => (
        calls.push(args),
        args[0] === "find-generic-password" ? { code: 0, out: "k\n" } : { code: 0, out: "" }
      ),
    );
    expect(kc.get()).toBe("k");
    expect(kc.set("v")).toBe(true);
    expect(calls[1]).toContain("-U");
    expect(macKeychain(() => ({ code: 44, out: "" })).get()).toBeNull();
  });
});

describe("token file with a box", () => {
  test("holds no token in clear text, survives a restart, and an old plain file is still read and then sealed", () => {
    const file = join(root, "t.json");
    const vault = memoryVault();
    writeFileSync(
      file,
      JSON.stringify({ version: 1, links: { s1: { tokens, connectedAt: "x" } }, devices: {} }),
    );
    const first = createTokenStore(file, undefined, createSecretBox(vault));
    expect(first.get("s1")?.tokens.accessToken).toBe("access-secret-xyz");
    first.set("s2", tokens);
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain("access-secret-xyz");
    expect(createTokenStore(file, undefined, createSecretBox(vault)).ids().sort()).toEqual([
      "s1",
      "s2",
    ]);
  });
  test("a sealed file whose key is gone is moved aside, never overwritten", () => {
    const file = join(root, "t.json");
    createTokenStore(file, undefined, createSecretBox(memoryVault())).set("s1", tokens);
    const store = createTokenStore(file, () => new Date(7), createSecretBox(memoryVault()));
    expect(store.ids()).toEqual([]);
    expect(readFileSync(`${file}.unreadable-7`, "utf8")).toContain("sealed");
  });
});
