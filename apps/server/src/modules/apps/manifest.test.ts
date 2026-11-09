import { describe, expect, test } from "bun:test";
import type { AppManifest } from "@zetta/db/schema/apps";
import { checkManifest, diffManifests, freeSlug, ManifestError, slugify } from "./manifest";

const tool = (over: Record<string, unknown> = {}) => ({
  name: "issues.list",
  kind: "query",
  description: "List",
  input: { type: "object", properties: {}, additionalProperties: false },
  accounts: [],
  ...over,
});
const raw = (over: Record<string, unknown> = {}) => ({
  sdk: 1,
  accounts: {},
  tools: [tool()],
  ...over,
});
const problems = (v: unknown) => {
  try {
    checkManifest(v);
  } catch (e) {
    return (e as ManifestError).problems;
  }
  return [];
};
const github = {
  label: "GitHub token",
  scope: "user",
  auth: "api_key",
  fields: [{ key: "token", label: "Token", secret: true }],
};

describe("checkManifest", () => {
  test("accepts a good manifest and keeps only what it knows", () => {
    const m = checkManifest(
      raw({
        accounts: { github },
        tools: [tool({ accounts: ["github"], approval: "always", extra: "dropped" })],
        extra: 1,
      }),
    );
    expect(m.sdk).toBe(1);
    expect(m.tools[0]).toEqual(tool({ accounts: ["github"], approval: "always" }) as never);
    expect(m.accounts.github).toEqual(github as never);
    expect("extra" in m).toBe(false);
  });

  test("lists every problem, not just the first", () => {
    const p = problems(
      raw({
        sdk: 9,
        tools: [
          tool({ name: "Bad Name" }),
          tool({ name: "kind.bad", kind: "other" }),
          tool({ name: "input.bad", input: { type: "string", pattern: "x" } }),
          tool({ name: "approval.bad", approval: "maybe" }),
        ],
      }),
    );
    expect(p.length).toBeGreaterThanOrEqual(5);
    expect(p.join("\n")).toContain("SDK 9");
    expect(p.join("\n")).toContain("Bad Name");
    expect(p.join("\n")).toContain("query or a mutation");
    expect(p.join("\n")).toContain('"pattern"');
    expect(p.join("\n")).toContain("approval");
  });

  test("an app with a page may declare no tools, and the manifest says where the page is", () => {
    expect(problems(raw({ tools: [] }))).toEqual(["The app declares no tools."]);
    const m = checkManifest(
      { sdk: 1, tools: [], accounts: {} },
      { entry: "ui/index.html", bytes: 1234 },
    );
    expect(m).toEqual({
      sdk: 1,
      tools: [],
      accounts: {},
      ui: { entry: "ui/index.html", bytes: 1234 },
    });
    // The page does not excuse a tool that is wrong.
    expect(() =>
      checkManifest(raw({ tools: [tool({ name: "Bad Name" })] }), {
        entry: "ui/index.html",
        bytes: 1,
      }),
    ).toThrow(ManifestError);
  });

  test("tools: none, too many, duplicated", () => {
    expect(problems(raw({ tools: [] }))).toEqual(["The app declares no tools."]);
    expect(problems(raw({ tools: [tool(), tool()] })).join()).toContain("declared twice");
    expect(
      problems(
        raw({ tools: Array.from({ length: 101 }, (_, i) => tool({ name: `t${i}` })) }),
      ).join(),
    ).toContain("at most 100");
  });

  test("names: dotted words are fine, anything else is not", () => {
    expect(problems(raw({ tools: [tool({ name: "a.b.c.d" })] }))).toEqual([]);
    expect(problems(raw({ tools: [tool({ name: "a.b.c.d.e" })] })).length).toBe(1);
    expect(problems(raw({ tools: [tool({ name: "1abc" })] })).length).toBe(1);
    expect(problems(raw({ tools: [tool({ name: "a-b" })] })).length).toBe(1);
  });

  test("a tool may only use accounts the app declares", () => {
    expect(problems(raw({ tools: [tool({ accounts: ["github"] })] })).join()).toContain(
      '"github", which the app does not declare',
    );
  });

  test("accounts: api key only, with fields and a scope", () => {
    expect(problems(raw({ accounts: { github: { ...github, auth: "oauth2" } } })).join()).toContain(
      "not supported yet",
    );
    expect(problems(raw({ accounts: { github: { ...github, scope: "team" } } })).join()).toContain(
      "scope",
    );
    expect(problems(raw({ accounts: { github: { ...github, fields: [] } } })).join()).toContain(
      "1 to 10 fields",
    );
    expect(problems(raw({ accounts: { "Bad Name": github } })).join()).toContain("Bad Name");
    expect(
      problems(
        raw({ accounts: { github: { ...github, fields: [{ key: "a b", label: "x" }] } } }),
      ).join(),
    ).toContain("field that is not valid");
  });

  test("not an object, or a description that is too long", () => {
    expect(problems(null)).toEqual(["The app did not describe itself."]);
    expect(problems(raw({ tools: [tool({ description: "x".repeat(501) })] })).join()).toContain(
      "longer than 500",
    );
  });
});

const m = (tools: Record<string, unknown>[], accounts: Record<string, unknown> = {}) =>
  checkManifest({ sdk: 1, accounts, tools: tools.map((t) => tool(t)) }) as AppManifest;

describe("diffManifests", () => {
  test("a first version adds everything", () => {
    const d = diffManifests(null, m([{ name: "a" }, { name: "b" }], { github }));
    expect(d.added).toEqual(["a", "b"]);
    expect(d.removed).toEqual([]);
    expect(d.accountsAdded).toEqual(["github"]);
  });
  test("added, removed and changed tools, and what changed", () => {
    const prev = m([{ name: "a" }, { name: "b" }, { name: "c", kind: "query" }]);
    const next = m([
      { name: "a" },
      { name: "c", kind: "mutation", approval: "never" },
      { name: "d" },
    ]);
    const d = diffManifests(prev, next);
    expect(d.added).toEqual(["d"]);
    expect(d.removed).toEqual(["b"]);
    expect(d.changed).toEqual([{ name: "c", what: ["kind", "approval"] }]);
  });
  test("an input schema change and an account change are seen", () => {
    const prev = m([{ name: "a" }], { github });
    const next = m([
      {
        name: "a",
        input: {
          type: "object",
          properties: { x: { type: "string" } },
          additionalProperties: false,
        },
      },
    ]);
    const d = diffManifests(prev, next);
    expect(d.changed).toEqual([{ name: "a", what: ["input"] }]);
    expect(d.accountsRemoved).toEqual(["github"]);
  });
  test("the same manifest changes nothing", () => {
    const x = m([{ name: "a" }]);
    expect(diffManifests(x, x)).toEqual({
      added: [],
      removed: [],
      changed: [],
      accountsAdded: [],
      accountsRemoved: [],
    });
  });
});

describe("slugs", () => {
  test("slugify", () => {
    expect(slugify("GitHub Triage")).toBe("github-triage");
    expect(slugify("  Café & Más!! ")).toBe("cafe-mas");
    expect(slugify("2024 report")).toBe("app-2024-report");
    expect(slugify("???")).toBe("app");
    expect(slugify("a".repeat(80)).length).toBe(40);
    expect(/^[a-z][a-z0-9-]{0,39}$/.test(slugify("9 lives"))).toBe(true);
  });
  test("freeSlug", () => {
    expect(freeSlug("x", new Set())).toBe("x");
    expect(freeSlug("x", new Set(["x"]))).toBe("x-2");
    expect(freeSlug("x", new Set(["x", "x-2", "x-3"]))).toBe("x-4");
    expect(freeSlug("a".repeat(40), new Set(["a".repeat(40)])).length).toBeLessThanOrEqual(40);
  });
});
