import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { playground, playgroundFile } from "@zetta/db/schema/playground";
import { eq } from "@zetta/db/query";
import { BRIDGE_LIMITS, okReply, parseBridgeRequest } from "@zetta/core/app-bridge";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { issueBackgroundActor } from "../identity/access";
import { AppError, createApps, type CallResult } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`app-a-${uuidv7()}`, `app-b-${uuidv7()}`];

const code = (greeting: string, extra = "") => `
import { defineApp, query, mutation, account, t } from "zetta-app";
export default defineApp({
  accounts: { github: account.apiKey({ label: "GitHub", scope: "user", fields: [{ key: "token", label: "Token", secret: true }] }) },
  tools: {
    greet: query({ description: "Say hello to someone", input: t.object({ name: t.string({ max: 20 }).default("world") }) }, async (_c, { name }) => ({ message: "${greeting}, " + name + "!" })),
    items: {
      remove: mutation({ description: "Remove an item", input: t.object({ id: t.string() }) }, async (_c, { id }) => ({ removed: id })),
      peek: mutation({ description: "A harmless write", input: t.object({}), approval: "never" }, async () => "peeked"),
      big: mutation({ description: "Asks only for big numbers", input: t.object({ n: t.integer() }), approval: { when: [{ path: "n", op: "gt", value: 100 }] } }, async (_c, { n }) => n),
    },
    wrong: query({ description: "Answers against its declaration", output: t.object({ n: t.integer() }) }, async () => ({ n: "not a number" })),
    boom: query({ description: "Fails" }, async () => { throw new Error("it broke"); }),
    needsGithub: query({ description: "Needs an account", accounts: ["github"] }, async () => 1),
    ${extra}
  },
});
`;

suite("apps against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const apps = createApps(db);
  let a: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let b: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let botA: string;

  async function makePlayground(
    owner: string,
    title: string,
    source: string,
    over: Record<string, unknown> = {},
  ) {
    const [p] = await db
      .insert(playground)
      .values({
        ownerUserId: owner,
        title,
        language: "typescript",
        runner: "host",
        entry: "index.ts",
        ...over,
      })
      .returning();
    await putFiles(p!.id, { "index.ts": source });
    return p!.id;
  }
  async function putFiles(id: string, files: Record<string, string>) {
    await db.delete(playgroundFile).where(eq(playgroundFile.playgroundId, id));
    await db.insert(playgroundFile).values(
      Object.entries(files).map(([path, content]) => ({
        playgroundId: id,
        path,
        content,
        size: content.length,
      })),
    );
  }
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as AppError;
    }
    throw new Error("expected a failure");
  };
  const ok = (r: CallResult) => {
    if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}: ${JSON.stringify(r)}`);
    return r.value;
  };

  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@example.invalid`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active" as const, joinedAt: now, updatedAt: now });
    }
    a = (await issueBackgroundActor(async () => ({ isAdmin: false }), A))!;
    b = (await issueBackgroundActor(async () => ({ isAdmin: false }), B))!;
    [{ id: botA }] = (await db
      .insert(bot)
      .values({
        ownerUserId: A,
        name: "Helper",
        slug: `helper-${uuidv7().slice(-8)}`,
        kind: "specialist",
        visibility: "private",
      })
      .returning({ id: bot.id })) as [{ id: string }];
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  describe("publishing", () => {
    test("a playground becomes an app with a slug, a version and the tools it declares", async () => {
      const pid = await makePlayground(A, "Greeter Tools", code("Hello"));
      const r = await apps.publish(a, { playgroundId: pid, note: "first" });
      expect(r.created).toBe(true);
      expect(r.app.slug).toBe("greeter-tools");
      expect(r.version.n).toBe(1);
      expect(r.manifest.tools.map((t) => t.name).sort()).toEqual([
        "boom",
        "greet",
        "items.big",
        "items.peek",
        "items.remove",
        "needsGithub",
        "wrong",
      ]);
      expect(r.changes.added.length).toBe(7);
      expect(r.app.activeVersionId).toBe(r.version.id);
    });

    test("publishing again from the same playground is a new version of the same app, with a diff", async () => {
      const pid = await makePlayground(A, "Evolving", code("Hello"));
      const first = await apps.publish(a, { playgroundId: pid });
      await putFiles(pid, {
        "index.ts": code("Howdy", `extra: query({ description: "New" }, async () => 1),`),
      });
      const second = await apps.publish(a, { playgroundId: pid, note: "added extra" });
      expect(second.created).toBe(false);
      expect(second.app.id).toBe(first.app.id);
      expect(second.version.n).toBe(2);
      expect(second.changes.added).toEqual(["extra"]);
      expect(second.changes.removed).toEqual([]);
    });

    test("only the owner publishes, only TypeScript or JavaScript on a runner, never the page", async () => {
      const pid = await makePlayground(A, "Private One", code("Hi"));
      expect((await fails(apps.publish(b, { playgroundId: pid }))).code).toBe("NOT_FOUND");
      const py = await makePlayground(A, "Py", "print(1)", {
        language: "python",
        entry: "main.py",
      });
      expect((await fails(apps.publish(a, { playgroundId: py }))).code).toBe("INVALID");
      const html = await makePlayground(A, "Page", code("Hi"), { runner: "browser" });
      expect((await fails(apps.publish(a, { playgroundId: html }))).code).toBe("INVALID");
    });

    test("code that does not describe itself, or declares a bad tool, is refused with the reason", async () => {
      const broken = await makePlayground(A, "Broken", "this is not typescript (((");
      expect((await fails(apps.publish(a, { playgroundId: broken }))).detail).toContain(
        "could not describe itself",
      );
      const notApp = await makePlayground(A, "Not An App", "export default { x: 1 };");
      expect((await fails(apps.publish(a, { playgroundId: notApp }))).detail).toContain(
        "defineApp",
      );
      const badTool = await makePlayground(
        A,
        "Bad Tool",
        `import { defineApp, query, t } from "zetta-app";\nexport default defineApp({ tools: { "Bad Name": query({ description: "x" }, async () => 1) } });`,
      );
      expect((await fails(apps.publish(a, { playgroundId: badTool }))).detail).toContain(
        "Bad Name",
      );
    });

    test("a file that would overwrite the SDK, or that holds a key, is refused", async () => {
      const pid = await makePlayground(A, "Clash", code("Hi"));
      await putFiles(pid, { "index.ts": code("Hi"), "__zetta_run.ts": "x" });
      expect((await fails(apps.publish(a, { playgroundId: pid }))).detail).toContain("reserved");
      await putFiles(pid, {
        "index.ts": code("Hi") + '\nconst k = "sk-ant-api03-abcdefghijklmnopqrstuvwx";',
      });
      expect((await fails(apps.publish(a, { playgroundId: pid }))).detail).toContain(
        "key or a token",
      );
    });

    test("an explicit slug that is taken is a conflict; a clash of titles gets a number", async () => {
      const p1 = await makePlayground(A, "Same Title", code("Hi"));
      const p2 = await makePlayground(A, "Same Title", code("Hi"));
      const one = await apps.publish(a, { playgroundId: p1 });
      const two = await apps.publish(a, { playgroundId: p2 });
      expect(two.app.slug).toBe(`${one.app.slug}-2`);
      const p3 = await makePlayground(A, "Third", code("Hi"));
      expect((await fails(apps.publish(a, { playgroundId: p3, slug: one.app.slug }))).code).toBe(
        "CONFLICT",
      );
    });
  });

  describe("calling", () => {
    let slug: string;
    beforeAll(async () => {
      const pid = await makePlayground(A, "Caller", code("Hello"));
      slug = (await apps.publish(a, { playgroundId: pid })).app.slug;
    });

    test("a query runs, fills the defaults, and is recorded", async () => {
      const r = await apps.call(a, { app: slug, tool: "greet", source: "ui" });
      expect(ok(r)).toEqual({ message: "Hello, world!" });
      expect(
        ok(
          await apps.call(a, {
            app: slug,
            tool: "greet",
            input: { name: "Zetta" },
            source: "bot",
            botId: botA,
          }),
        ),
      ).toEqual({ message: "Hello, Zetta!" });
      const history = await apps.calls(a, slug);
      expect(history.filter((c) => c.tool === "greet" && c.status === "ok").length).toBe(2);
    });

    test("input is checked before anything runs, and the unknown is named", async () => {
      expect(
        (await fails(apps.call(a, { app: slug, tool: "greet", input: { name: 5 }, source: "ui" })))
          .detail,
      ).toBe("input.name must be string.");
      expect(
        (
          await fails(
            apps.call(a, {
              app: slug,
              tool: "greet",
              input: { name: "x".repeat(21) },
              source: "ui",
            }),
          )
        ).detail,
      ).toContain("at most 20");
      expect((await fails(apps.call(a, { app: slug, tool: "nope", source: "ui" }))).code).toBe(
        "NOT_FOUND",
      );
      expect(
        (await fails(apps.call(a, { app: "no-such-app", tool: "greet", source: "ui" }))).code,
      ).toBe("NOT_FOUND");
    });

    test("a tool that throws fails with its message; an answer that breaks its declaration fails too", async () => {
      const boom = await apps.call(a, { app: slug, tool: "boom", source: "ui" });
      expect(boom).toMatchObject({
        status: "failed",
        error: { code: "TOOL_ERROR", message: "it broke" },
      });
      const wrong = await apps.call(a, { app: slug, tool: "wrong", source: "ui" });
      expect(wrong).toMatchObject({ status: "failed", error: { code: "BAD_RESULT" } });
    });

    test("a tool that needs an account cannot run yet, and makes no card", async () => {
      expect(
        (await fails(apps.call(a, { app: slug, tool: "needsGithub", source: "ui" }))).code,
      ).toBe("NEEDS_ACCOUNT");
    });

    test("a mutation waits for approval; yes runs it as asked, no refuses it, and an answer counts once", async () => {
      const asked = await apps.call(a, {
        app: slug,
        tool: "items.remove",
        input: { id: "7" },
        source: "bot",
        botId: botA,
      });
      expect(asked).toMatchObject({
        status: "approval_required",
        tool: "items.remove",
        kind: "mutation",
        input: { id: "7" },
      });
      const id = (asked as { callId: string }).callId;
      expect(ok(await apps.answer(a, id, "accept"))).toEqual({ removed: "7" });
      expect((await fails(apps.answer(a, id, "accept"))).code).toBe("CONFLICT");

      const second = (await apps.call(a, {
        app: slug,
        tool: "items.remove",
        input: { id: "8" },
        source: "ui",
      })) as { callId: string };
      expect(await apps.answer(a, second.callId, "decline")).toMatchObject({ status: "denied" });
      const third = (await apps.call(a, {
        app: slug,
        tool: "items.remove",
        input: { id: "9" },
        source: "ui",
      })) as { callId: string };
      expect((await fails(apps.answer(b, third.callId, "accept"))).code).toBe("NOT_FOUND");
      expect(await apps.answer(a, third.callId, "cancel")).toMatchObject({ status: "denied" });
    });

    test("what the tool declares: never runs a mutation; a condition asks only for matching input", async () => {
      expect(ok(await apps.call(a, { app: slug, tool: "items.peek", source: "ui" }))).toBe(
        "peeked",
      );
      expect(
        ok(await apps.call(a, { app: slug, tool: "items.big", input: { n: 5 }, source: "ui" })),
      ).toBe(5);
      expect(
        (await apps.call(a, { app: slug, tool: "items.big", input: { n: 500 }, source: "ui" }))
          .status,
      ).toBe("approval_required");
    });

    test("the owner's choice beats the code: block, ask and auto", async () => {
      await apps.setToolPolicy(a, slug, "items.peek", "block");
      expect(await apps.call(a, { app: slug, tool: "items.peek", source: "ui" })).toMatchObject({
        status: "denied",
        reason: "The owner blocked this tool.",
      });
      await apps.setToolPolicy(a, slug, "items.peek", "ask");
      expect((await apps.call(a, { app: slug, tool: "items.peek", source: "ui" })).status).toBe(
        "approval_required",
      );
      await apps.setToolPolicy(a, slug, "items.remove", "auto");
      expect(
        ok(
          await apps.call(a, { app: slug, tool: "items.remove", input: { id: "1" }, source: "ui" }),
        ),
      ).toEqual({ removed: "1" });
      await apps.setToolPolicy(a, slug, "items.peek", null);
      await apps.setToolPolicy(a, slug, "items.remove", null);
      expect(ok(await apps.call(a, { app: slug, tool: "items.peek", source: "ui" }))).toBe(
        "peeked",
      );
      expect((await fails(apps.setToolPolicy(a, slug, "nope", "block"))).code).toBe("NOT_FOUND");
      expect((await fails(apps.setToolPolicy(b, slug, "items.peek", "block"))).code).toBe(
        "NOT_FOUND",
      );
    });

    test("a block set while a card waits stops the call when the card is answered", async () => {
      const asked = (await apps.call(a, {
        app: slug,
        tool: "items.remove",
        input: { id: "w" },
        source: "ui",
      })) as { callId: string };
      await apps.setToolPolicy(a, slug, "items.remove", "block");
      expect(await apps.answer(a, asked.callId, "accept")).toMatchObject({
        status: "denied",
        reason: "The owner blocked this tool.",
      });
      await apps.setToolPolicy(a, slug, "items.remove", null);
    });

    test("people outside the account may only run a query that needs no answer", async () => {
      expect(
        ok(await apps.call(a, { app: slug, tool: "greet", source: "bot", outside: true })),
      ).toEqual({ message: "Hello, world!" });
      expect(
        await apps.call(a, { app: slug, tool: "items.peek", source: "bot", outside: true }),
      ).toMatchObject({ status: "denied" });
      await apps.setToolPolicy(a, slug, "items.remove", "auto");
      expect(
        await apps.call(a, {
          app: slug,
          tool: "items.remove",
          input: { id: "o" },
          source: "bot",
          outside: true,
        }),
      ).toMatchObject({ status: "denied" });
      await apps.setToolPolicy(a, slug, "items.remove", null);
    });

    test("a call waiting for approval stays on the version it was asked on", async () => {
      const pid = await makePlayground(A, "Pinned", code("Hello"));
      const first = await apps.publish(a, { playgroundId: pid });
      const asked = (await apps.call(a, {
        app: first.app.slug,
        tool: "items.remove",
        input: { id: "p" },
        source: "ui",
      })) as { callId: string };
      await putFiles(pid, {
        "index.ts": code("Howdy").replace("removed: id", "removed: 'changed'"),
      });
      await apps.publish(a, { playgroundId: pid });
      expect(ok(await apps.answer(a, asked.callId, "accept"))).toEqual({ removed: "p" });
      expect(ok(await apps.call(a, { app: first.app.slug, tool: "greet", source: "ui" }))).toEqual({
        message: "Howdy, world!",
      });
    });

    test("a card nobody answers in time is expired, and answering it later says so", async () => {
      const asked = (await apps.call(a, {
        app: slug,
        tool: "items.remove",
        input: { id: "e" },
        source: "ui",
      })) as { callId: string };
      await db.$client.query(
        "update app_call set created_at = now() - interval '2 days' where id = $1",
        [asked.callId],
      );
      expect((await fails(apps.answer(a, asked.callId, "accept"))).code).toBe("EXPIRED");
      const another = (await apps.call(a, {
        app: slug,
        tool: "items.remove",
        input: { id: "f" },
        source: "ui",
      })) as { callId: string };
      await db.$client.query(
        "update app_call set created_at = now() - interval '2 days' where id = $1",
        [another.callId],
      );
      expect(await apps.expirePending()).toBeGreaterThanOrEqual(1);
      const row = (await apps.calls(a, slug)).find((c) => c.id === another.callId);
      expect(row?.status).toBe("expired");
    });
  });

  describe("versions", () => {
    test("a rollback makes an older version answer again", async () => {
      const pid = await makePlayground(A, "Rolling", code("Hello"));
      const v1 = await apps.publish(a, { playgroundId: pid });
      await putFiles(pid, { "index.ts": code("Howdy") });
      await apps.publish(a, { playgroundId: pid });
      expect(ok(await apps.call(a, { app: v1.app.slug, tool: "greet", source: "ui" }))).toEqual({
        message: "Howdy, world!",
      });
      const back = await apps.rollback(a, v1.app.slug, 1);
      expect(back.versions.find((v) => v.active)?.n).toBe(1);
      expect(ok(await apps.call(a, { app: v1.app.slug, tool: "greet", source: "ui" }))).toEqual({
        message: "Hello, world!",
      });
      expect((await fails(apps.rollback(a, v1.app.slug, 9))).code).toBe("NOT_FOUND");
      expect((await fails(apps.rollback(b, v1.app.slug, 1))).code).toBe("NOT_FOUND");
    });
  });

  describe("who can see and call an app", () => {
    test("a private app is invisible to others; a team app is callable by them, with their own history", async () => {
      const pid = await makePlayground(A, "Shared One", code("Hello"));
      const { app: shared } = await apps.publish(a, { playgroundId: pid });
      expect(
        (await fails(apps.call(b, { app: shared.slug, tool: "greet", source: "ui" }))).code,
      ).toBe("NOT_FOUND");
      expect((await apps.list(b)).some((x) => x.id === shared.id)).toBe(false);
      await apps.update(a, shared.slug, { visibility: "team" });
      expect((await apps.list(b)).some((x) => x.id === shared.id)).toBe(true);
      expect(ok(await apps.call(b, { app: shared.id, tool: "greet", source: "ui" }))).toEqual({
        message: "Hello, world!",
      });
      // Only the owner changes, publishes, rolls back or archives it.
      expect((await fails(apps.setToolPolicy(b, shared.id, "greet", "block"))).code).toBe(
        "FORBIDDEN",
      );
      expect((await fails(apps.update(b, shared.id, { name: "x" }))).code).toBe("FORBIDDEN");
      expect((await fails(apps.archive(b, shared.id))).code).toBe("FORBIDDEN");
      // The owner sees every call; the other person sees their own.
      await apps.call(a, { app: shared.slug, tool: "greet", source: "ui" });
      expect((await apps.calls(a, shared.slug)).some((c) => c.actorUserId === B)).toBe(true);
      expect((await apps.calls(b, shared.id)).every((c) => c.actorUserId === B)).toBe(true);
    });
  });

  describe("reading", () => {
    test("search finds tools by words and says how each is guarded", async () => {
      const pid = await makePlayground(A, "Searchable", code("Hello"));
      const { app: s } = await apps.publish(a, { playgroundId: pid });
      const hits = await apps.search(a, "remove item", [s.id]);
      expect(hits.map((h) => h.path)).toEqual([`apps.${s.slug}.items.remove`]);
      expect(hits[0]).toMatchObject({ kind: "mutation", policy: "Asks (changes something)" });
      expect((await apps.search(a, "zzzz", [s.id])).length).toBe(0);
      expect((await apps.search(a, "greet", [])).length).toBe(0);
      const d = await apps.describe(a, s.slug, "items.big");
      expect(d.policy).toBe("Asks for some inputs");
      expect(d.input).toMatchObject({ type: "object" });
    });
  });

  describe("bot grants", () => {
    test("the bot's owner grants apps they can use; a replace swaps the set; archive removes the grant", async () => {
      const pid = await makePlayground(A, "Granted", code("Hello"));
      const { app: g } = await apps.publish(a, { playgroundId: pid });
      expect(await apps.setBotApps(a, botA, [g.id])).toEqual([g.id]);
      expect(await apps.botApps(a, botA)).toEqual([g.id]);
      expect(await apps.setBotApps(a, botA, [])).toEqual([]);
      expect(await apps.botApps(a, botA)).toEqual([]);
      await apps.setBotApps(a, botA, [g.id]);
      await apps.archive(a, g.slug);
      expect(await apps.botApps(a, botA)).toEqual([]);
      expect((await apps.list(a)).some((x) => x.id === g.id)).toBe(false);
    });
    test("from the app side: the person sets which of their own bots use it, and others' grants stay", async () => {
      const pid = await makePlayground(A, "App Side", code("Hello"));
      const { app: x } = await apps.publish(a, { playgroundId: pid });
      const second = (
        await db
          .insert(bot)
          .values({
            ownerUserId: A,
            name: "Second",
            slug: `second-${uuidv7().slice(-8)}`,
            kind: "specialist",
            visibility: "private",
          })
          .returning({ id: bot.id })
      )[0]!.id;
      expect(await apps.setAppBots(a, x.slug, [botA, second])).toEqual([botA, second]);
      expect((await apps.appBots(a, x.slug)).sort()).toEqual([botA, second].sort());
      expect(await apps.setAppBots(a, x.slug, [second])).toEqual([second]);
      expect(await apps.appBots(a, x.slug)).toEqual([second]);
      expect((await apps.botApps(a, botA)).includes(x.id)).toBe(false);
      // A team member sees and sets only their own bots, and cannot touch the owner's.
      await apps.update(a, x.slug, { visibility: "team" });
      const [botB] = await db
        .insert(bot)
        .values({
          ownerUserId: B,
          name: "B2",
          slug: `b2-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
        })
        .returning({ id: bot.id });
      expect(await apps.setAppBots(b, x.id, [botB!.id])).toEqual([botB!.id]);
      expect(await apps.appBots(a, x.slug)).toEqual([second]);
      expect(await apps.appBots(b, x.id)).toEqual([botB!.id]);
      expect((await fails(apps.setAppBots(b, x.id, [botA]))).code).toBe("NOT_FOUND");
    });
    test("someone else's bot, and an app the person cannot use, are refused", async () => {
      const pid = await makePlayground(A, "Mine Only", code("Hello"));
      const { app: mine } = await apps.publish(a, { playgroundId: pid });
      expect((await fails(apps.setBotApps(b, botA, []))).code).toBe("NOT_FOUND");
      const [botB] = await db
        .insert(bot)
        .values({
          ownerUserId: B,
          name: "B Bot",
          slug: `b-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
        })
        .returning({ id: bot.id });
      expect((await fails(apps.setBotApps(b, botB!.id, [mine.id]))).code).toBe("NOT_FOUND");
    });
  });

  describe("pages", () => {
    const PAGE = `<!doctype html><html><head><title>Hi</title></head><body><div id="app"></div><script type="module" src="./app.js"></script></body></html>`;
    const SCRIPT = (greeting: string) =>
      `const out = await window.zetta.call("greet", { name: "page" });\ndocument.getElementById("app").textContent = "${greeting} " + out.message;`;

    test("backend code and a page publish together; the page is stored on the version, not listed with it", async () => {
      const pid = await makePlayground(A, "With Page", code("Hello"));
      await putFiles(pid, {
        "index.ts": code("Hello"),
        "ui/index.html": PAGE,
        "ui/app.js": SCRIPT("Said"),
      });
      const r = await apps.publish(a, { playgroundId: pid });
      expect(r.manifest.ui).toMatchObject({ entry: "ui/index.html" });
      expect(r.manifest.ui!.bytes).toBeGreaterThan(1000);
      expect(r.manifest.tools.length).toBeGreaterThan(0);
      const page = await apps.page(a, r.app.slug);
      expect(page.version).toBe(1);
      expect(page.html).toContain('http-equiv="Content-Security-Policy"');
      expect(page.html).toContain("window.zetta");
      expect(page.html).toContain("Said ");
      expect(page.tools.map((t) => t.name)).toContain("greet");
      const detail = await apps.get(a, r.app.slug);
      expect(JSON.stringify(detail)).not.toContain("Content-Security-Policy");
      expect((await apps.list(a)).find((x) => x.id === r.app.id)?.ui).toMatchObject({
        entry: "ui/index.html",
      });
    });

    test("an HTML playground is an app with only a page, and no tools", async () => {
      const pid = await makePlayground(A, "Only A Page", "x", {
        language: "html",
        runner: "browser",
        entry: "index.html",
      });
      await putFiles(pid, {
        "index.html": "<!doctype html><html><head></head><body><h1>Static</h1></body></html>",
      });
      const r = await apps.publish(a, { playgroundId: pid });
      expect(r.manifest.tools).toEqual([]);
      expect(r.manifest.ui?.entry).toBe("index.html");
      expect((await apps.page(a, r.app.slug)).html).toContain("<h1>Static</h1>");
      expect(
        (await fails(apps.call(a, { app: r.app.slug, tool: "anything", source: "ui" }))).code,
      ).toBe("NOT_FOUND");
      expect(await apps.search(a, "anything", [r.app.id])).toEqual([]);
    });

    test("an app with no page says so, and a page that cannot be built says why", async () => {
      const none = await makePlayground(A, "No Page", code("Hello"));
      const { app: noPage } = await apps.publish(a, { playgroundId: none });
      expect((await fails(apps.page(a, noPage.slug))).code).toBe("NOT_FOUND");
      const bad = await makePlayground(A, "Bad Page", code("Hello"));
      await putFiles(bad, {
        "index.ts": code("Hello"),
        "ui/index.html": PAGE,
        "ui/app.js": 'import React from "react";',
      });
      const e = await fails(apps.publish(a, { playgroundId: bad }));
      expect(e.code).toBe("INVALID");
      expect(e.detail).toContain("The page could not be built");
      expect(e.detail).toContain("react");
    });

    test("a playground that is neither backend nor a page is refused with what it needs", async () => {
      const py = await makePlayground(A, "Neither", "print(1)", {
        language: "python",
        entry: "main.py",
      });
      expect((await fails(apps.publish(a, { playgroundId: py }))).detail).toContain("backend code");
    });

    test("a private page is invisible to others; a team page can be opened by them", async () => {
      const pid = await makePlayground(A, "Shared Page", code("Hello"));
      await putFiles(pid, {
        "index.ts": code("Hello"),
        "ui/index.html": PAGE,
        "ui/app.js": SCRIPT("Hi"),
      });
      const { app: shared } = await apps.publish(a, { playgroundId: pid });
      expect((await fails(apps.page(b, shared.slug))).code).toBe("NOT_FOUND");
      await apps.update(a, shared.slug, { visibility: "team" });
      expect((await apps.page(b, shared.id)).version).toBe(1);
    });

    test("the page follows the active version: a new publish changes it, a rollback brings the old one back", async () => {
      const pid = await makePlayground(A, "Moving Page", code("Hello"));
      await putFiles(pid, {
        "index.ts": code("Hello"),
        "ui/index.html": PAGE,
        "ui/app.js": SCRIPT("First"),
      });
      const one = await apps.publish(a, { playgroundId: pid });
      await putFiles(pid, {
        "index.ts": code("Hello"),
        "ui/index.html": PAGE,
        "ui/app.js": SCRIPT("Second"),
      });
      await apps.publish(a, { playgroundId: pid });
      expect((await apps.page(a, one.app.slug)).html).toContain("Second ");
      await apps.rollback(a, one.app.slug, 1);
      const back = await apps.page(a, one.app.slug);
      expect(back.version).toBe(1);
      expect(back.html).toContain("First ");
      expect(back.html).not.toContain("Second ");
    });

    test("a message from the frame goes through the bridge check and into a real tool call, and the answer goes back to the frame", async () => {
      const pid = await makePlayground(A, "Bridged", code("Hello"));
      await putFiles(pid, {
        "index.ts": code("Hello"),
        "ui/index.html": PAGE,
        "ui/app.js": SCRIPT("Hi"),
      });
      const { app: br } = await apps.publish(a, { playgroundId: pid });
      const page = await apps.page(a, br.slug);
      const allowed = new Set(page.tools.map((t) => t.name));
      const fromFrame = {
        source: "zetta-app",
        id: 4,
        type: "call",
        tool: "greet",
        input: { name: "frame" },
      };
      const parsed = parseBridgeRequest(fromFrame, allowed);
      if (parsed.kind !== "request") throw new Error("expected a request");
      const result = await apps.call(a, {
        app: br.slug,
        tool: parsed.request.tool,
        input: parsed.request.input,
        source: "ui",
      });
      if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
      expect(okReply(parsed.request.id, result.value)).toEqual({
        source: "zetta-host",
        id: 4,
        ok: true,
        value: { message: "Hello, frame!" },
      });
      // A tool the app does not have never reaches the server.
      expect(parseBridgeRequest({ ...fromFrame, tool: "items.drop" }, allowed)).toMatchObject({
        kind: "reject",
      });
      // A change from the frame still stops for approval on the server; the host shows the prompt.
      const change = await apps.call(a, {
        app: br.slug,
        tool: "items.remove",
        input: { id: "x" },
        source: "ui",
      });
      expect(change.status).toBe("approval_required");
      expect(BRIDGE_LIMITS.inFlight).toBeGreaterThan(0);
    });
  });

  describe("archive", () => {
    test("an archived app frees its slug", async () => {
      const p1 = await makePlayground(A, "Short Lived", code("Hello"));
      const one = await apps.publish(a, { playgroundId: p1 });
      await apps.archive(a, one.app.slug);
      const p2 = await makePlayground(A, "Short Lived", code("Hello"));
      const two = await apps.publish(a, { playgroundId: p2 });
      expect(two.app.slug).toBe(one.app.slug);
    });
  });
});
