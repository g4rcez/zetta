import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { playground, playgroundFile } from "@zetta/db/schema/playground";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createAppsRoutes } from "./routes";
import { createApps } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`appr-a-${uuidv7()}`, `appr-b-${uuidv7()}`];
const ORIGIN = "http://localhost:5173";

const CODE = `
import { defineApp, query, mutation, t } from "zetta-app";
export default defineApp({
  tools: {
    greet: query({ description: "Say hello", input: t.object({ name: t.string().default("world") }) }, async (_c, { name }) => ({ message: "Hello, " + name + "!" })),
    items: { remove: mutation({ description: "Remove an item", input: t.object({ id: t.string() }) }, async (_c, { id }) => ({ removed: id })) },
  },
});
`;

suite("apps routes, against compose postgres", () => {
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
  const server = new Elysia().use(createAppsRoutes({ access, apps: createApps(db) }, [ORIGIN]));
  async function call(
    as: string | null,
    method: string,
    path: string,
    body?: unknown,
    origin: string | null = ORIGIN,
  ) {
    const res = await server.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          ...(origin ? { origin } : {}),
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  }
  let pid: string, botId: string, slug: string;
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
    const [p] = await db
      .insert(playground)
      .values({
        ownerUserId: A,
        title: "Routes App",
        language: "typescript",
        runner: "host",
        entry: "index.ts",
      })
      .returning();
    pid = p!.id;
    await db
      .insert(playgroundFile)
      .values({ playgroundId: pid, path: "index.ts", content: CODE, size: CODE.length });
    botId = (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          name: "Bot",
          slug: `bot-${uuidv7().slice(-8)}`,
          kind: "specialist",
          visibility: "private",
        })
        .returning({ id: bot.id })
    )[0]!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("it needs a signed-in person and a trusted origin for a change", async () => {
    expect((await call(null, "GET", "/api/apps")).status).toBe(401);
    expect(
      (await call(A, "POST", "/api/apps/publish", { playgroundId: pid }, "https://evil.example"))
        .status,
    ).toBe(403);
    expect(
      (await call(A, "POST", "/api/apps/publish", { playgroundId: pid }, null)).status,
    ).toBeGreaterThanOrEqual(400);
  });

  test("publish, list and read an app", async () => {
    const r = await call(A, "POST", "/api/apps/publish", { playgroundId: pid, note: "first" });
    expect(r.status).toBe(201);
    slug = r.json.published.app.slug;
    expect(slug).toBe("routes-app");
    expect(r.json.published.changes.added.length).toBe(2);
    const list = await call(A, "GET", "/api/apps");
    expect(list.json.apps.find((x: any) => x.slug === slug)).toMatchObject({
      version: 1,
      tools: 2,
    });
    const one = await call(A, "GET", `/api/apps/${slug}`);
    expect(one.json.app.policies["items.remove"]).toBe("Asks (changes something)");
    expect(one.json.app.versions).toHaveLength(1);
    expect((await call(B, "GET", `/api/apps/${slug}`)).status).toBe(404);
  });

  test("bad bodies are 400 with the reason", async () => {
    expect((await call(A, "POST", "/api/apps/publish", { playgroundId: "nope" })).status).toBe(400);
    expect(
      (await call(A, "POST", "/api/apps/publish", { playgroundId: pid, extra: 1 })).status,
    ).toBe(400);
    const missing = await call(A, "POST", "/api/apps/publish", { playgroundId: uuidv7() });
    expect(missing.status).toBe(404);
  });

  test("call a tool: a query runs, a wrong input is 400, an unknown tool 404", async () => {
    const ok = await call(A, "POST", `/api/apps/${slug}/call`, {
      tool: "greet",
      input: { name: "Zetta" },
    });
    expect(ok.json.result).toMatchObject({ status: "ok", value: { message: "Hello, Zetta!" } });
    const bad = await call(A, "POST", `/api/apps/${slug}/call`, {
      tool: "greet",
      input: { name: 5 },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toBe("input.name must be string.");
    expect((await call(A, "POST", `/api/apps/${slug}/call`, { tool: "nope" })).status).toBe(404);
  });

  test("a change waits for the person's answer, which only they can give", async () => {
    const asked = await call(A, "POST", `/api/apps/${slug}/call`, {
      tool: "items.remove",
      input: { id: "7" },
    });
    expect(asked.json.result.status).toBe("approval_required");
    const id = asked.json.result.callId;
    expect(
      (await call(B, "POST", `/api/app-calls/${id}/answer`, { action: "accept" })).status,
    ).toBe(404);
    const done = await call(A, "POST", `/api/app-calls/${id}/answer`, { action: "accept" });
    expect(done.json.result).toMatchObject({ status: "ok", value: { removed: "7" } });
    expect(
      (await call(A, "POST", `/api/app-calls/${id}/answer`, { action: "accept" })).status,
    ).toBe(409);
    expect((await call(A, "POST", `/api/app-calls/${id}/answer`, { action: "maybe" })).status).toBe(
      400,
    );
  });

  test("the owner sets a tool policy, and it changes what a call does", async () => {
    const set = await call(A, "PUT", `/api/apps/${slug}/tools/items.remove/policy`, {
      policy: "block",
    });
    expect(set.json.app.policies["items.remove"]).toBe("Blocked");
    const r = await call(A, "POST", `/api/apps/${slug}/call`, {
      tool: "items.remove",
      input: { id: "1" },
    });
    expect(r.json.result.status).toBe("denied");
    expect(
      (await call(A, "PUT", `/api/apps/${slug}/tools/items.remove/policy`, { policy: null })).json
        .app.policies["items.remove"],
    ).toBe("Asks (changes something)");
    expect(
      (await call(A, "PUT", `/api/apps/${slug}/tools/items.remove/policy`, { policy: "sometimes" }))
        .status,
    ).toBe(400);
    expect(
      (await call(B, "PUT", `/api/apps/${slug}/tools/items.remove/policy`, { policy: "auto" }))
        .status,
    ).toBe(404);
  });

  test("tools can be searched, and the calls are listed for the owner", async () => {
    const found = await call(A, "GET", "/api/apps/tools?q=remove");
    expect(found.json.tools.map((t: any) => t.path)).toContain(`apps.${slug}.items.remove`);
    const limited = await call(A, "GET", `/api/apps/tools?q=hello&app=${slug}`);
    expect(limited.json.tools.map((t: any) => t.tool)).toEqual(["greet"]);
    const calls = await call(A, "GET", `/api/apps/${slug}/calls`);
    expect(calls.json.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("publishing again makes version 2; a rollback goes back", async () => {
    const v2 = CODE.replace("Hello, ", "Howdy, ");
    await db.delete(playgroundFile).where(eq(playgroundFile.playgroundId, pid));
    await db
      .insert(playgroundFile)
      .values({ playgroundId: pid, path: "index.ts", content: v2, size: v2.length });
    const second = await call(A, "POST", "/api/apps/publish", {
      playgroundId: pid,
      note: "friendlier",
    });
    expect(second.json.published).toMatchObject({ created: false, version: { n: 2 } });
    expect(
      (await call(A, "POST", `/api/apps/${slug}/call`, { tool: "greet" })).json.result.value
        .message,
    ).toBe("Howdy, world!");
    const back = await call(A, "POST", `/api/apps/${slug}/rollback`, { n: 1 });
    expect(back.json.app.versions.find((v: any) => v.active).n).toBe(1);
    expect(
      (await call(A, "POST", `/api/apps/${slug}/call`, { tool: "greet" })).json.result.value
        .message,
    ).toBe("Hello, world!");
    expect((await call(A, "POST", `/api/apps/${slug}/rollback`, { n: 9 })).status).toBe(404);
    expect((await call(B, "POST", `/api/apps/${slug}/rollback`, { n: 1 })).status).toBe(404);
    expect((await call(A, "POST", `/api/apps/${slug}/rollback`, { n: 0 })).status).toBe(400);
  });

  test("a bot's apps: the owner sets them; someone else cannot", async () => {
    const id = (await call(A, "GET", `/api/apps/${slug}`)).json.app.id;
    expect((await call(A, "PUT", `/api/bots/${botId}/apps`, { appIds: [id] })).json.appIds).toEqual(
      [id],
    );
    expect((await call(A, "GET", `/api/bots/${botId}/apps`)).json.appIds).toEqual([id]);
    expect((await call(B, "PUT", `/api/bots/${botId}/apps`, { appIds: [] })).status).toBe(404);
    expect((await call(A, "PUT", `/api/bots/${botId}/apps`, { appIds: ["x"] })).status).toBe(400);
  });

  test("from the app side: which of my bots may use it", async () => {
    expect(
      (await call(A, "PUT", `/api/apps/${slug}/bots`, { botIds: [botId] })).json.botIds,
    ).toEqual([botId]);
    expect((await call(A, "GET", `/api/apps/${slug}/bots`)).json.botIds).toEqual([botId]);
    expect((await call(A, "PUT", `/api/apps/${slug}/bots`, { botIds: [uuidv7()] })).status).toBe(
      404,
    );
    expect((await call(B, "GET", `/api/apps/${slug}/bots`)).status).toBe(404);
  });

  test("data: an app that keeps nothing says so; scope is checked; a stranger and a missing origin are refused", async () => {
    const d = await call(A, "GET", `/api/apps/${slug}/data`);
    expect(d.status).toBe(200);
    expect(d.json.data).toEqual({ app: slug, collections: [] });
    expect((await call(A, "DELETE", `/api/apps/${slug}/data?scope=everything`)).status).toBe(400);
    expect((await call(A, "DELETE", `/api/apps/${slug}/data`)).json).toEqual({ removed: 0 });
    expect((await call(A, "DELETE", `/api/apps/${slug}/data?scope=all`)).json).toEqual({
      removed: 0,
    });
    expect((await call(B, "GET", `/api/apps/${slug}/data`)).status).toBe(404);
    expect((await call(B, "DELETE", `/api/apps/${slug}/data?scope=all`)).status).toBe(404);
    expect(
      (await call(A, "DELETE", `/api/apps/${slug}/data`, undefined, null)).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await call(null, "GET", `/api/apps/${slug}/data`)).status).toBe(401);
  });

  test("an app without a page has no ui", async () => {
    expect((await call(A, "GET", `/api/apps/${slug}/ui`)).status).toBe(404);
  });

  test("archive removes the app from the list", async () => {
    expect((await call(A, "DELETE", `/api/apps/${slug}`)).json).toEqual({ archived: true });
    expect((await call(A, "GET", "/api/apps")).json.apps.some((x: any) => x.slug === slug)).toBe(
      false,
    );
    expect((await call(A, "GET", `/api/apps/${slug}`)).status).toBe(404);
  });
});
