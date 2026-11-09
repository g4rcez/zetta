import { describe, expect, test } from "bun:test";
import { checkManifest, diffManifests, ManifestError } from "./manifest";
import { checkOps, STORAGE_LIMITS, StorageError } from "./storage";

const decl = { collections: ["todos"], shared: ["settings"], write: true };
const put = (collection: string, key: string, value: unknown = 1) => ({
  op: "put",
  collection,
  key,
  value,
});
const problem = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as StorageError).message;
  }
  throw new Error("expected a failure");
};

describe("checkOps", () => {
  test("no writes is fine for any tool", () => {
    expect(checkOps(undefined, undefined)).toEqual([]);
    expect(checkOps(null, decl)).toEqual([]);
    expect(checkOps([], undefined)).toEqual([]);
  });
  test("a put is kept with its size; a delete is kept", () => {
    expect(
      checkOps(
        [put("todos", "a", { n: 1 }), { op: "delete", collection: "settings", key: "x" }],
        decl,
      ),
    ).toEqual([
      { op: "put", collection: "todos", key: "a", value: { n: 1 }, bytes: 7 },
      { op: "delete", collection: "settings", key: "x" },
    ]);
  });
  test("only the last write of a key counts", () => {
    const ops = checkOps(
      [
        put("todos", "a", 1),
        put("todos", "a", 2),
        { op: "delete", collection: "todos", key: "b" },
        put("todos", "b", 3),
      ],
      decl,
    );
    expect(ops).toEqual([
      { op: "put", collection: "todos", key: "a", value: 2, bytes: 1 },
      { op: "put", collection: "todos", key: "b", value: 3, bytes: 1 },
    ]);
  });
  test("a tool that did not declare write access cannot write, even if the harness let it", () => {
    expect(
      problem(() =>
        checkOps([put("todos", "a")], { collections: ["todos"], shared: [], write: false }),
      ),
    ).toContain("did not declare write");
    expect(problem(() => checkOps([put("todos", "a")], undefined))).toContain(
      "did not declare write",
    );
  });
  test("a collection the tool did not declare is refused", () => {
    expect(problem(() => checkOps([put("secrets", "a")], decl))).toContain('"secrets"');
  });
  test("odd shapes, keys and sizes are refused with a reason", () => {
    expect(problem(() => checkOps("x", decl))).toContain("wrong shape");
    expect(
      problem(() => checkOps([{ op: "wipe", collection: "todos", key: "a" }], decl)),
    ).toContain("cannot read");
    expect(problem(() => checkOps([put("todos", "")], decl))).toContain("key");
    expect(
      problem(() => checkOps([put("todos", "k".repeat(STORAGE_LIMITS.keyChars + 1))], decl)),
    ).toContain("key");
    expect(
      problem(() => checkOps([put("todos", "a", "x".repeat(STORAGE_LIMITS.valueBytes))], decl)),
    ).toContain("at most");
    const many = Array.from({ length: STORAGE_LIMITS.opsPerCall + 1 }, (_, i) =>
      put("todos", `k${i}`),
    );
    expect(problem(() => checkOps(many, decl))).toContain("at most");
  });
  test("a put without a value stores null", () => {
    expect(checkOps([{ op: "put", collection: "todos", key: "a" }], decl)).toEqual([
      { op: "put", collection: "todos", key: "a", value: null, bytes: 4 },
    ]);
  });
});

describe("storage in a manifest", () => {
  const manifest = (tool: Record<string, unknown>) => ({
    sdk: 1,
    accounts: {},
    tools: [
      {
        name: "t",
        kind: "mutation",
        description: "",
        input: { type: "object", properties: {} },
        accounts: [],
        ...tool,
      },
    ],
  });
  test("collections, shared collections and write are read", () => {
    const m = checkManifest(
      manifest({ storage: { collections: ["todos", "todos"], shared: ["settings"], write: true } }),
    );
    expect(m.tools[0]!.storage).toEqual({
      collections: ["todos"],
      shared: ["settings"],
      write: true,
    });
  });
  test("a tool with no collections has no storage", () => {
    expect(checkManifest(manifest({ storage: {} })).tools[0]!.storage).toBeUndefined();
    expect(checkManifest(manifest({})).tools[0]!.storage).toBeUndefined();
  });
  test("a query cannot write", () => {
    expect(() =>
      checkManifest(manifest({ kind: "query", storage: { collections: ["a"], write: true } })),
    ).toThrow(/cannot write storage/);
  });
  test("bad names, both scopes at once and too many are refused", () => {
    const bad = (storage: unknown) => {
      try {
        checkManifest(manifest({ storage }));
      } catch (e) {
        if (e instanceof ManifestError) return e.problems.join(" ");
      }
      throw new Error("expected a failure");
    };
    expect(bad({ collections: ["Bad Name"] })).toContain("lowercase");
    expect(bad({ collections: ["a"], shared: ["a"] })).toContain("both personal and shared");
    expect(bad({ collections: Array.from({ length: 11 }, (_, i) => `c${i}`) })).toContain(
      "at most 10",
    );
    expect(bad("todos")).toContain("not valid");
  });
});

describe("a new version that changes storage", () => {
  const v = (storage?: unknown) =>
    checkManifest({
      sdk: 1,
      accounts: {},
      tools: [
        {
          name: "t",
          kind: "mutation",
          description: "",
          input: { type: "object", properties: {} },
          accounts: [],
          storage,
        },
      ],
    });
  test("is shown in the diff, because what a tool can keep is part of what the person agrees to", () => {
    const before = v({ collections: ["todos"], write: true });
    expect(diffManifests(before, v({ collections: ["todos"], write: true })).changed).toEqual([]);
    expect(
      diffManifests(before, v({ collections: ["todos"], shared: ["all"], write: true })).changed,
    ).toEqual([{ name: "t", what: ["storage"] }]);
    expect(diffManifests(before, v()).changed).toEqual([{ name: "t", what: ["storage"] }]);
  });
});
