import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { app } from "@zetta/db/schema/apps";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { playground } from "@zetta/db/schema/playground";
import { eq } from "@zetta/db/query";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { issueBackgroundActor } from "../identity/access";
import { createPlayground } from "../playground/service";
import { hostRunner } from "../playground/runner-host";
import { createAppAuthor } from "./author";
import { appToolFields } from "./fields";
import { AppError, createApps } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`auth-a-${uuidv7()}`, `auth-b-${uuidv7()}`];

const BACKEND = (greeting = "Hello") => `
import { defineApp, query, t } from "zetta-app";
export default defineApp({ tools: { greet: query({ description: "Say hello", input: t.object({ name: t.string().default("world") }) }, async (_c, { name }) => ({ message: "${greeting}, " + name })) } });
`;
const PAGE = (word = "Hi") =>
  `<!doctype html><html><head><title>${word}</title></head><body><div id="a"></div><script type="module" src="./main.js"></script></body></html>`;
const MAIN = `const r = await window.zetta.call("greet", { name: "page" }); document.getElementById("a").textContent = r.message;`;
const parse = (x: unknown) => appToolFields.parse(x);

suite("bots author apps, against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const playgrounds = createPlayground(db);
  // Two servers: one with no container (backend code would run on the host), one with a container (here the host runner stands in).
  const hostApps = createApps(db);
  const contApps = createApps(db, { runners: { container: hostRunner } });
  const onHost = createAppAuthor({ apps: hostApps, playgrounds });
  const inBox = createAppAuthor({ apps: contApps, playgrounds });
  let a: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let b: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let ctx: { botId: string; conversationId: null };

  const ownedPlaygrounds = () => db.select().from(playground).where(eq(playground.ownerUserId, A));
  const ownedApps = () => db.select().from(app).where(eq(app.ownerUserId, A));
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as AppError;
    }
    throw new Error("expected a failure");
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
    const [row] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        name: "Builder",
        slug: `builder-${uuidv7().slice(-8)}`,
        kind: "specialist",
        visibility: "private",
      })
      .returning({ id: bot.id });
    ctx = { botId: row!.id, conversationId: null };
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("the tool input is checked: an action, a title, files with safe paths", () => {
    expect(() => parse({ action: "create", title: "x", files: [] })).toThrow();
    expect(() =>
      parse({ action: "create", title: "", files: [{ path: "index.ts", content: "" }] }),
    ).toThrow();
    expect(() =>
      parse({ action: "create", title: "x", files: [{ path: "../etc/passwd", content: "" }] }),
    ).toThrow();
    expect(() =>
      parse({ action: "create", title: "x", files: [{ path: "index.ts", content: "" }], extra: 1 }),
    ).toThrow();
    expect(parse({ action: "list" })).toEqual({ action: "list" });
    expect(parse({ action: "update", app: "todo", remove: ["old.ts"] })).toMatchObject({
      app: "todo",
    });
  });

  test("a page-only app is published at once: building a page runs nothing", async () => {
    const r = await onHost.run(
      a,
      parse({
        action: "create",
        title: "Just A Page",
        files: [
          { path: "ui/index.html", content: PAGE() },
          { path: "ui/main.js", content: "document.title='x'" },
        ],
      }),
      ctx,
    );
    expect(r).toMatchObject({ status: "published", page: true, tools: [], version: 1 });
    const p = (await ownedPlaygrounds()).find((x) => x.title === "Just A Page")!;
    expect(p).toMatchObject({ language: "html", runner: "browser", createdByBotId: ctx.botId });
  });

  test("new backend code on the host stops for the person: nothing runs, nothing is written", async () => {
    const before = [(await ownedPlaygrounds()).length, (await ownedApps()).length];
    const r = await onHost.run(
      a,
      parse({
        action: "create",
        title: "Needs A Yes",
        files: [{ path: "index.ts", content: BACKEND() }],
      }),
      ctx,
    );
    expect(r).toMatchObject({
      status: "needs_approval",
      title: "Needs A Yes",
      files: ["index.ts"],
    });
    expect([(await ownedPlaygrounds()).length, (await ownedApps()).length]).toEqual(before);
  });

  test("a code that would crash on the host is not even run before approval, so nothing leaks into the check", async () => {
    // If describe ran, this top-level throw would be reported as an error; behind the gate it must come back as a card.
    const r = await onHost.run(
      a,
      parse({
        action: "create",
        title: "Boom",
        files: [{ path: "index.ts", content: "throw new Error('ran on the host')" }],
      }),
      ctx,
    );
    expect(r.status).toBe("needs_approval");
  });

  test("after the person approves, the same app is published from its playground", async () => {
    const args = parse({
      action: "create",
      title: "Approved Todo",
      description: "Says hello",
      note: "first",
      files: [
        { path: "index.ts", content: BACKEND() },
        { path: "ui/index.html", content: PAGE() },
        { path: "ui/main.js", content: MAIN },
      ],
    });
    const r = await onHost.run(a, args, ctx, true);
    expect(r).toMatchObject({ status: "published", tools: ["greet"], page: true, version: 1 });
    if (r.status !== "published") throw new Error();
    const detail = await hostApps.get(a, r.app.slug);
    expect(detail).toMatchObject({ description: "Says hello", name: "Approved Todo" });
    expect(detail.versions[0]).toMatchObject({ publishedByBotId: ctx.botId });
    expect(
      (await ownedPlaygrounds()).find((x) => x.id === detail.sourcePlaygroundId),
    ).toMatchObject({ runner: "host", language: "typescript" });
  });

  test("with a container the bot publishes backend code at once and the app runs in it", async () => {
    const r = await inBox.run(
      a,
      parse({
        action: "create",
        title: "In A Box",
        files: [{ path: "index.ts", content: BACKEND("Boxed") }],
      }),
      ctx,
    );
    expect(r).toMatchObject({ status: "published", tools: ["greet"], page: false });
    if (r.status !== "published") throw new Error();
    expect((await contApps.get(a, r.app.slug)).settings.runner).toBe("container");
    const called = await contApps.call(a, {
      app: r.app.slug,
      tool: "greet",
      input: { name: "Zetta" },
      source: "bot",
      botId: ctx.botId,
    });
    expect(called).toMatchObject({ status: "ok", value: { message: "Boxed, Zetta" } });
  });

  test("an error comes back to the bot, and a failed create leaves no playground behind", async () => {
    const before = (await ownedPlaygrounds()).length;
    const bad = await fails(
      inBox.run(
        a,
        parse({
          action: "create",
          title: "Bad Import",
          files: [
            { path: "index.ts", content: BACKEND() },
            { path: "ui/index.html", content: PAGE() },
            { path: "ui/main.js", content: 'import React from "react";' },
          ],
        }),
        ctx,
      ),
    );
    expect(bad.code).toBe("INVALID");
    expect(bad.detail).toContain("The page could not be built");
    const broken = await fails(
      inBox.run(
        a,
        parse({
          action: "create",
          title: "No Tools",
          files: [{ path: "index.ts", content: "export default 1" }],
        }),
        ctx,
      ),
    );
    expect(broken.code).toBe("INVALID");
    expect((await ownedPlaygrounds()).length).toBe(before);
    const nothing = await fails(
      inBox.run(
        a,
        parse({ action: "create", title: "Nothing", files: [{ path: "notes.txt", content: "x" }] }),
        ctx,
      ),
    );
    expect(nothing.detail).toContain("index.ts");
  });

  test("an update changes the files it names and keeps the others; a page-only change needs no approval even on the host", async () => {
    const created = await onHost.run(
      a,
      parse({
        action: "create",
        title: "Merge Me",
        files: [
          { path: "index.ts", content: BACKEND() },
          { path: "ui/index.html", content: PAGE("One") },
          { path: "ui/main.js", content: MAIN },
        ],
      }),
      ctx,
      true,
    );
    if (created.status !== "published") throw new Error();
    const r = await onHost.run(
      a,
      parse({
        action: "update",
        app: created.app.slug,
        files: [{ path: "ui/index.html", content: PAGE("Two") }],
        note: "new page",
      }),
      ctx,
    );
    expect(r).toMatchObject({ status: "published", version: 2, page: true });
    const read = await onHost.run(a, parse({ action: "get", app: created.app.slug }), ctx);
    if (read.status !== "read") throw new Error();
    expect(read.files.map((f) => f.path).sort()).toEqual([
      "index.ts",
      "ui/index.html",
      "ui/main.js",
    ]);
    expect(read.files.find((f) => f.path === "ui/index.html")!.content).toContain("Two");
    expect(read.files.find((f) => f.path === "index.ts")!.content).toBe(BACKEND());
    expect(read.tools.map((t) => t.name)).toEqual(["greet"]);
  });

  test("changing the backend of a host app needs approval again; removing a file works", async () => {
    const created = await onHost.run(
      a,
      parse({
        action: "create",
        title: "Guard Me",
        files: [
          { path: "index.ts", content: BACKEND() },
          { path: "extra.ts", content: "export const x = 1;" },
        ],
      }),
      ctx,
      true,
    );
    if (created.status !== "published") throw new Error();
    const held = await onHost.run(
      a,
      parse({
        action: "update",
        app: created.app.slug,
        files: [{ path: "index.ts", content: BACKEND("Changed") }],
      }),
      ctx,
    );
    expect(held).toMatchObject({ status: "needs_approval", files: ["index.ts"] });
    expect((await hostApps.get(a, created.app.slug)).version).toBe(1);
    const ok = await onHost.run(
      a,
      parse({
        action: "update",
        app: created.app.slug,
        files: [{ path: "index.ts", content: BACKEND("Changed") }],
        remove: ["extra.ts"],
      }),
      ctx,
      true,
    );
    expect(ok).toMatchObject({ status: "published", version: 2 });
    const read = await onHost.run(a, parse({ action: "get", app: created.app.slug }), ctx);
    if (read.status !== "read") throw new Error();
    expect(read.files.map((f) => f.path)).toEqual(["index.ts"]);
  });

  test("list shows the person's own apps; archive removes one; another person's app cannot be changed", async () => {
    const list = await onHost.run(a, parse({ action: "list" }), ctx);
    if (list.status !== "listed") throw new Error();
    expect(list.apps.map((x) => x.name)).toEqual(
      expect.arrayContaining(["Just A Page", "Approved Todo"]),
    );
    const target = list.apps.find((x) => x.name === "Just A Page")!;
    expect(
      (
        await fails(
          onHost.run(b, parse({ action: "update", app: target.slug, note: "mine now" }), ctx),
        )
      ).code,
    ).toBe("NOT_FOUND");
    expect(
      (await fails(onHost.run(b, parse({ action: "archive", app: target.slug }), ctx))).code,
    ).toBe("NOT_FOUND");
    expect(await onHost.run(a, parse({ action: "archive", app: target.slug }), ctx)).toEqual({
      status: "archived",
      slug: target.slug,
    });
    const again = await onHost.run(a, parse({ action: "list" }), ctx);
    if (again.status !== "listed") throw new Error();
    expect(again.apps.some((x) => x.slug === target.slug)).toBe(false);
  });
});
