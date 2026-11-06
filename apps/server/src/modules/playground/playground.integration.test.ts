import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createPlaygroundRoutes } from "./routes";
import { createPlayground } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const ids = [`pg-a-${uuidv7()}`, `pg-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const ORIGIN = "http://localhost:5173";

const main = `import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { greet } from "./lib/greet";
const inputs = JSON.parse(readFileSync("inputs.json", "utf8"));
console.log(greet(inputs.name), process.env.ZETTA_INPUTS, process.env.ZETTA_CHAT_TEST_DATABASE_URL ?? "none");
mkdirSync("out", { recursive: true });
writeFileSync("out/report.html", "<h1>" + inputs.name + "</h1>");
`;
const greet = `export const greet = (name: string) => "hello " + name;\n`;
const tsPlayground = {
  title: "Greeter",
  language: "typescript",
  files: [
    { path: "main.ts", content: main },
    { path: "lib/greet.ts", content: greet },
  ],
  inputs: [{ name: "name", type: "string", default: "World" }],
};
const bash = (script: string) => ({
  title: "Shell",
  language: "bash",
  files: [{ path: "main.sh", content: script }],
});

suite("playground", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const app = new Elysia().use(
    createPlaygroundRoutes({ access, playground: createPlayground(db) }, [ORIGIN]),
  );
  async function call(as: string, method: string, path: string, body?: unknown) {
    const res = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: { "x-test-user": as, origin: ORIGIN, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      /* a raw file */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  /** Polls until the run leaves `running`. */
  async function finished(as: string, runId: string) {
    for (let i = 0; i < 100; i++) {
      const r = await call(as, "GET", `/api/playground-runs/${runId}`);
      if (r.json.run.status !== "running") return r.json.run;
      await Bun.sleep(100);
    }
    throw new Error("the run did not end");
  }
  const start = async (as: string, id: string, body: unknown = {}) =>
    call(as, "POST", `/api/playgrounds/${id}/runs`, body);

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db
      .insert(membership)
      .values(
        ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })),
      );
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  test("a TypeScript playground with two files runs on the host: inputs, clean environment, out/ files", async () => {
    const made = await call(A, "POST", "/api/playgrounds", tsPlayground);
    expect(made.status).toBe(201);
    expect(made.json.playground).toMatchObject({
      title: "Greeter",
      runner: "host",
      entry: "main.ts",
      visibility: "private",
      version: 1,
      mine: true,
    });
    const id = made.json.playground.id as string;

    const first = await start(A, id, { inputs: { name: "Ada" } });
    expect(first.status).toBe(202);
    expect(first.json.run.status).toBe("running");
    const run = await finished(A, first.json.run.id);
    expect(run).toMatchObject({
      status: "ok",
      exitCode: 0,
      stderr: "",
      // The run gets the inputs, and not the server's environment.
      stdout: 'hello Ada {"name":"Ada"} none\n',
      inputs: { name: "Ada" },
      runner: "host",
      outputs: [{ path: "report.html", mimeType: "text/html", size: 12 }],
    });
    expect(run.files.map((f: any) => f.path)).toEqual(["lib/greet.ts", "main.ts"]);
    expect(run.runtimeVersion).toMatch(/^\d+\.\d+\.\d+/);

    const file = await call(A, "GET", `/api/playground-runs/${run.id}/outputs/report.html`);
    expect(file.text).toBe("<h1>Ada</h1>");
    expect(file.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(file.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts allow-popups",
    );

    // No input given: the default is used. Both runs stay in the history, newest first.
    const second = await finished(A, (await start(A, id)).json.run.id);
    expect(second.stdout).toBe('hello World {"name":"World"} none\n');
    const history = await call(A, "GET", `/api/playgrounds/${id}/runs`);
    expect(history.json.runs.map((r: any) => r.inputs)).toEqual([
      { name: "World" },
      { name: "Ada" },
    ]);
  });

  test("a script that fails reports its exit code and stderr", async () => {
    const made = await call(A, "POST", "/api/playgrounds", {
      title: "Fails",
      language: "python",
      files: [
        { path: "main.py", content: "import sys\nprint('bad', file=sys.stderr)\nsys.exit(3)\n" },
      ],
    });
    const run = await finished(A, (await start(A, made.json.playground.id)).json.run.id);
    expect(run).toMatchObject({ status: "failed", exitCode: 3, stdout: "", stderr: "bad\n" });
  });

  test("a script over its time limit is stopped, and a running script can be cancelled", async () => {
    const made = await call(A, "POST", "/api/playgrounds", bash("sleep 30\n"));
    const id = made.json.playground.id as string;
    const slow = await finished(A, (await start(A, id, { timeoutMs: 1000 })).json.run.id);
    expect(slow).toMatchObject({ status: "timeout", exitCode: null });

    const going = await start(A, id, { timeoutMs: 60_000 });
    expect(
      (await call(A, "POST", `/api/playground-runs/${going.json.run.id}/cancel`)).json,
    ).toEqual({ cancelled: true });
    expect((await finished(A, going.json.run.id)).status).toBe("cancelled");
  });

  test("a person has two runs at once; the third is refused until one ends", async () => {
    const id = (await call(A, "POST", "/api/playgrounds", bash("sleep 30\n"))).json.playground
      .id as string;
    const one = await start(A, id, { timeoutMs: 60_000 });
    const two = await start(A, id, { timeoutMs: 60_000 });
    const three = await start(A, id);
    expect(three.status).toBe(429);
    expect(three.json.error.code).toBe("BUSY");
    for (const r of [one, two])
      await call(A, "POST", `/api/playground-runs/${r.json.run.id}/cancel`);
    await finished(A, one.json.run.id);
    await finished(A, two.json.run.id);
  });

  test("a private playground is invisible to others; a team playground can be read, run and forked, not edited", async () => {
    const made = await call(A, "POST", "/api/playgrounds", bash("echo shared\n"));
    const id = made.json.playground.id as string;
    expect((await call(B, "GET", `/api/playgrounds/${id}`)).status).toBe(404);
    expect((await start(B, id)).status).toBe(404);
    expect((await call(B, "GET", "/api/playgrounds?scope=team")).json.playgrounds).toEqual([]);

    const shared = await call(A, "PATCH", `/api/playgrounds/${id}`, {
      expectedVersion: 1,
      visibility: "team",
    });
    expect(shared.json.playground).toMatchObject({ visibility: "team", version: 2 });
    expect((await call(B, "GET", `/api/playgrounds/${id}`)).json.playground.mine).toBe(false);
    const run = await finished(B, (await start(B, id)).json.run.id);
    expect(run).toMatchObject({ status: "ok", stdout: "shared\n" });
    // The owner reads a run that someone else started.
    expect((await call(A, "GET", `/api/playground-runs/${run.id}`)).status).toBe(200);

    const edit = await call(B, "PATCH", `/api/playgrounds/${id}`, {
      expectedVersion: 2,
      title: "Mine now",
    });
    expect(edit.status).toBe(403);
    expect((await call(B, "DELETE", `/api/playgrounds/${id}`)).status).toBe(403);

    const fork = await call(B, "POST", `/api/playgrounds/${id}/fork`);
    expect(fork.json.playground).toMatchObject({
      title: "Shell (copy)",
      visibility: "private",
      mine: true,
    });
    expect((await call(A, "GET", `/api/playgrounds/${fork.json.playground.id}`)).status).toBe(404);
  });

  test("an edit with a stale version is refused, and an archived playground leaves the list", async () => {
    const id = (await call(A, "POST", "/api/playgrounds", bash("echo hi\n"))).json.playground
      .id as string;
    await call(A, "PATCH", `/api/playgrounds/${id}`, { expectedVersion: 1, title: "First" });
    const stale = await call(A, "PATCH", `/api/playgrounds/${id}`, {
      expectedVersion: 1,
      title: "Second",
    });
    expect(stale.status).toBe(409);
    expect((await call(A, "GET", `/api/playgrounds/${id}`)).json.playground.title).toBe("First");

    expect((await call(A, "DELETE", `/api/playgrounds/${id}`)).json).toEqual({ removed: true });
    expect((await call(A, "GET", `/api/playgrounds/${id}`)).status).toBe(404);
    expect(
      (await call(A, "GET", "/api/playgrounds")).json.playgrounds.map((p: any) => p.id),
    ).not.toContain(id);
  });

  test("bad playgrounds are refused with a sentence that says what to fix", async () => {
    const bad = async (patch: object) =>
      call(A, "POST", "/api/playgrounds", { ...bash("echo hi\n"), ...patch });
    expect((await bad({ entry: "other.sh" })).json.error.message).toBe(
      "The entry file other.sh is not one of the files.",
    );
    expect((await bad({ files: [{ path: "../escape.sh", content: "x" }] })).status).toBe(400);
    expect((await bad({ files: [{ path: "out/a.txt", content: "x" }] })).status).toBe(400);
    expect((await bad({ runner: "browser" })).json.error.message).toBe(
      "Shell cannot run with the browser runner.",
    );
    expect(
      (await bad({ files: [{ path: "main.sh", content: "KEY=sk-test-0123456789abcdef0123\n" }] }))
        .json.error.code,
    ).toBe("SECRET_REJECTED");
    expect(
      (await bad({ inputs: [{ name: "n", type: "number", default: "x" }] })).json.error.message,
    ).toBe('Input "n" must be a number.');
    expect((await bad({ title: "   " })).status).toBe(400);
  });

  test("a run refuses an input that the playground does not declare, and a browser playground does not run on the server", async () => {
    const id = (await call(A, "POST", "/api/playgrounds", tsPlayground)).json.playground
      .id as string;
    const unknown = await start(A, id, { inputs: { other: 1 } });
    expect(unknown.json.error.message).toBe("The playground has no input named other.");
    const html = await call(A, "POST", "/api/playgrounds", {
      title: "Page",
      language: "html",
      files: [{ path: "index.html", content: "<p>hi</p>" }],
    });
    expect(html.json.playground.runner).toBe("browser");
    expect((await start(A, html.json.playground.id)).status).toBe(400);
  });
  test("a browser playground builds into one page: files inlined, inputs and console capture in place", async () => {
    const made = await call(A, "POST", "/api/playgrounds", {
      title: "Page",
      language: "html",
      files: [
        {
          path: "index.html",
          content:
            '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><p id="out"></p><script type="module" src="src/main.ts"></script></body></html>',
        },
        { path: "style.css", content: "p { color: red }" },
        {
          path: "src/main.ts",
          content:
            'import { say } from "./say";\ndocument.getElementById("out")!.textContent = say(window.ZETTA_INPUTS.who);\n',
        },
        {
          path: "src/say.ts",
          content: "export const say = (who: string): string => `hi ${who}`;\n",
        },
      ],
      inputs: [{ name: "who", type: "string", default: "World" }],
    });
    const id = made.json.playground.id as string;
    const built = await call(A, "POST", `/api/playgrounds/${id}/build`, { inputs: { who: "Ada" } });
    expect(built.json.error?.message).toBeUndefined();
    expect(built.status).toBe(200);
    const html = built.json.html as string;
    expect(html).toContain('window.ZETTA_INPUTS = {"who":"Ada"};');
    expect(html).toContain("<style>p { color: red }</style>");
    expect(html).toContain("hi ${who}");
    expect(html).toContain('<script type="module">');
    expect(html).not.toContain('src="src/main.ts"');
    expect(html).not.toContain('href="style.css"');
    // The page that is on screen is built, not the saved one.
    const draft = await call(A, "POST", `/api/playgrounds/${id}/build`, {
      files: [{ path: "index.html", content: "<p>draft</p>" }],
      entry: "index.html",
    });
    expect(draft.json.html).toContain("<p>draft</p>");
    // Not a server playground.
    const shell = await call(A, "POST", "/api/playgrounds", bash("echo hi\n"));
    expect(
      (await call(A, "POST", `/api/playgrounds/${shell.json.playground.id}/build`, {})).status,
    ).toBe(400);
  });

  test("a build keeps to the playground's own files", async () => {
    const page = (main: string) => ({
      title: "Escape",
      language: "typescript",
      runner: "browser",
      files: [{ path: "main.ts", content: main }],
    });
    const build = async (main: string) => {
      const made = await call(A, "POST", "/api/playgrounds", page(main));
      return call(A, "POST", `/api/playgrounds/${made.json.playground.id}/build`, {});
    };
    expect(
      (await build('import hosts from "/etc/hosts" with { type: "text" };\nconsole.log(hosts);\n'))
        .json.error.message,
    ).toBe("The import /etc/hosts leaves the playground.");
    expect(
      (
        await build(
          'import x from "../../../../etc/hosts" with { type: "text" };\nconsole.log(x);\n',
        )
      ).json.error.code,
    ).toBe("INVALID");
    expect(
      (await build('import _ from "lodash";\nconsole.log(_);\n')).json.error.message,
    ).toContain("Import a library from a URL");
    expect(
      (await build('import { x } from "./m.ts" with { type: "macro" };\nconsole.log(x());\n')).json
        .error.message,
    ).toBe("main.ts uses a macro. Macros run on the server and are not allowed.");
    // A library from a public URL stays a URL for the page to load.
    const cdn = await build(
      'import { h } from "https://cdn.jsdelivr.net/npm/preact/+esm";\nconsole.log(h);\n',
    );
    expect(cdn.status).toBe(200);
    expect(cdn.json.html).toContain("https://cdn.jsdelivr.net/npm/preact/+esm");
  });
});
