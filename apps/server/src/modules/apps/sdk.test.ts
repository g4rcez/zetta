import { describe, expect, test } from "bun:test";
import type { AppManifest } from "@zetta/db/schema/apps";
import { hostRunner } from "../playground/runner-host";
import { clashesWithSdk, HARNESS_FILE, RESULT_FILE, sdkFiles } from "./sdk";

/** These run the real SDK and harness in a real `bun` process, through the same host runner the server uses. */
async function exec(files: Record<string, string>, payload: unknown, entry = "index.ts") {
  const r = await hostRunner(
    {
      language: "typescript",
      entry: HARNESS_FILE,
      files: [
        ...Object.entries(files).map(([path, content]) => ({ path, content })),
        ...sdkFiles(entry),
      ],
      inputs: {},
      timeoutMs: 20_000,
      stdin: JSON.stringify(payload),
      resultFile: RESULT_FILE,
    },
    new AbortController().signal,
  );
  return { ...r, json: r.result === undefined ? undefined : JSON.parse(r.result) };
}

const APP = `
import { defineApp, query, mutation, account, t } from "zetta-app";
export default defineApp({
  accounts: { github: account.apiKey({ label: "GitHub token", scope: "user", fields: [{ key: "token", label: "Token", secret: true }] }) },
  tools: {
    greet: query({ description: "Say hello", input: t.object({ name: t.string({ max: 40 }).default("world") }) }, async (_ctx, { name }) => ({ message: "Hello, " + name + "!" })),
    issues: {
      list: query({ description: "List issues", input: t.object({ repo: t.string(), state: t.string({ oneOf: ["open", "closed"] }).default("open"), limit: t.integer({ min: 1, max: 100 }).optional() }), accounts: ["github"] }, async () => []),
      close: mutation({ description: "Close one", input: t.object({ number: t.integer() }), approval: { when: [{ path: "number", op: "gt", value: 100 }] }, output: t.object({ closed: t.integer() }) }, async (_c, { number }) => ({ closed: number })),
    },
    boom: query({ description: "Fails" }, async () => { throw new Error("it broke"); }),
    coded: query({ description: "Fails with a code" }, async () => { const e = new Error("no such repo"); (e as any).code = "NOT_FOUND"; throw e; }),
    nothing: query({ description: "Returns nothing" }, async () => {}),
    secrets: query({ description: "Shows what it can see" }, async (ctx) => ({ token: ctx.accounts.github?.fields?.token ?? null, env: JSON.stringify(process.env) })),
  },
});
`;

describe("describe mode", () => {
  test("lists every tool with its kind, schemas, approval and accounts; nested names are dotted", async () => {
    const r = await exec({ "index.ts": APP }, { mode: "describe" });
    expect(r.status).toBe("ok");
    const m = r.json as AppManifest;
    expect(m.sdk).toBe(1);
    expect(m.tools.map((x) => x.name).sort()).toEqual([
      "boom",
      "coded",
      "greet",
      "issues.close",
      "issues.list",
      "nothing",
      "secrets",
    ]);
    const list = m.tools.find((x) => x.name === "issues.list")!;
    expect(list.kind).toBe("query");
    expect(list.accounts).toEqual(["github"]);
    expect(list.input).toEqual({
      type: "object",
      properties: {
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed"], default: "open" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["repo"],
      additionalProperties: false,
    });
    const close = m.tools.find((x) => x.name === "issues.close")!;
    expect(close.kind).toBe("mutation");
    expect(close.approval).toEqual({ when: [{ path: "number", op: "gt", value: 100 }] });
    expect(close.output).toEqual({
      type: "object",
      properties: { closed: { type: "integer" } },
      required: ["closed"],
      additionalProperties: false,
    });
    expect(m.tools.find((x) => x.name === "boom")!.input).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(m.accounts.github).toEqual({
      label: "GitHub token",
      scope: "user",
      auth: "api_key",
      fields: [{ key: "token", label: "Token", secret: true }],
    });
  });
});

describe("call mode", () => {
  test("runs the handler with the input and returns its value", async () => {
    const r = await exec(
      { "index.ts": APP },
      { mode: "call", tool: "greet", input: { name: "Zetta" } },
    );
    expect(r.json).toEqual({ ok: true, value: { message: "Hello, Zetta!" } });
  });
  test("a nested tool and a return of nothing", async () => {
    expect(
      (
        await exec(
          { "index.ts": APP },
          { mode: "call", tool: "issues.close", input: { number: 7 } },
        )
      ).json,
    ).toEqual({ ok: true, value: { closed: 7 } });
    expect((await exec({ "index.ts": APP }, { mode: "call", tool: "nothing" })).json).toEqual({
      ok: true,
      value: null,
    });
  });
  test("a thrown error becomes a failure with its message; a code is kept", async () => {
    expect((await exec({ "index.ts": APP }, { mode: "call", tool: "boom" })).json).toEqual({
      ok: false,
      error: { code: "TOOL_ERROR", message: "it broke" },
    });
    expect((await exec({ "index.ts": APP }, { mode: "call", tool: "coded" })).json).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "no such repo" },
    });
  });
  test("an unknown tool is named", async () => {
    const r = await exec({ "index.ts": APP }, { mode: "call", tool: "nope" });
    expect(r.json.error.code).toBe("UNKNOWN_TOOL");
  });
  test("the accounts arrive in ctx, and the payload is NOT in the process environment", async () => {
    const r = await exec(
      { "index.ts": APP },
      {
        mode: "call",
        tool: "secrets",
        accounts: { github: { fields: { token: "ghp_exampleSecret123" } } },
      },
    );
    expect(r.json.value.token).toBe("ghp_exampleSecret123");
    expect(r.json.value.env).not.toContain("ghp_exampleSecret123");
    expect(r.stdout + r.stderr).not.toContain("ghp_exampleSecret123");
  });
});

describe("shape of the app", () => {
  test("the entry may be in a folder and import its neighbours", async () => {
    const r = await exec(
      {
        "src/app.ts": `import { defineApp, query } from "zetta-app";\nimport { hi } from "./util";\nexport default defineApp({ tools: { hi: query({ description: "x" }, async () => hi()) } });`,
        "src/util.ts": `export const hi = () => "from util";`,
      },
      { mode: "call", tool: "hi" },
      "src/app.ts",
    );
    expect(r.json).toEqual({ ok: true, value: "from util" });
  });
  test("an entry that does not export an app says so", async () => {
    const r = await exec({ "index.ts": "export default { hello: 1 };" }, { mode: "describe" });
    expect(r.json.error.code).toBe("NOT_AN_APP");
  });
  test("code that does not load leaves no result, and the run failed", async () => {
    const r = await exec({ "index.ts": "this is not typescript (((" }, { mode: "describe" });
    expect(r.status).toBe("failed");
    expect(r.result).toBeUndefined();
  });
  test("a tool that is not a function is refused when the app loads", async () => {
    const r = await exec(
      {
        "index.ts": `import { defineApp } from "zetta-app";\nexport default defineApp({ tools: { x: 5 } });`,
      },
      { mode: "describe" },
    );
    expect(r.status).toBe("failed");
    expect(r.stderr).toContain("is not a tool");
  });
});

describe("what may be published", () => {
  test("an app file may not overwrite the SDK, the harness or the result", () => {
    expect(clashesWithSdk(HARNESS_FILE)).toBe(true);
    expect(clashesWithSdk(RESULT_FILE)).toBe(true);
    expect(clashesWithSdk("node_modules/zetta-app/index.js")).toBe(true);
    expect(clashesWithSdk("node_modules/other/index.js")).toBe(false);
    expect(clashesWithSdk("index.ts")).toBe(false);
  });
  test("the harness imports the entry relative to the folder", () => {
    const h = sdkFiles("src/app.ts").find((f) => f.path === HARNESS_FILE)!;
    expect(h.content).toContain('from "./src/app.ts"');
  });
});
