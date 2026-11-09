import { okReply, parseBridgeRequest } from "@zetta/core/app-bridge";
import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { appRecord } from "@zetta/db/schema/apps";
import { membership } from "@zetta/db/schema/identity";
import { playground, playgroundFile } from "@zetta/db/schema/playground";
import { eq } from "@zetta/db/query";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { issueBackgroundActor } from "../identity/access";
import { AppError, createApps, type CallResult } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`store-a-${uuidv7()}`, `store-b-${uuidv7()}`];

const TODO = `
import { defineApp, query, mutation, t } from "zetta-app";
const mine = { collections: ["todos"] };
const mineW = { collections: ["todos"], write: true };
export default defineApp({
  tools: {
    todos: {
      add: mutation({ description: "Add a to-do", input: t.object({ id: t.string(), text: t.string() }), approval: "never", storage: mineW },
        async (ctx, { id, text }) => { ctx.storage.put("todos", id, { text, done: false }); return { id }; }),
      done: mutation({ description: "Complete a to-do", input: t.object({ id: t.string() }), approval: "never", storage: mineW },
        async (ctx, { id }) => { const cur = ctx.storage.get("todos", id); if (!cur) throw Object.assign(new Error("No such to-do."), { code: "NOT_FOUND" }); ctx.storage.put("todos", id, { ...cur, done: true }); return cur.text; }),
      remove: mutation({ description: "Remove", input: t.object({ id: t.string() }), approval: "never", storage: mineW },
        async (ctx, { id }) => { ctx.storage.delete("todos", id); return ctx.storage.get("todos", id) === undefined; }),
      list: query({ description: "List", storage: mine }, async (ctx) => ctx.storage.list("todos")),
      addTwice: mutation({ description: "Reads its own write", input: t.object({}), approval: "never", storage: mineW },
        async (ctx) => { ctx.storage.put("todos", "x", 1); const seen = ctx.storage.get("todos", "x"); ctx.storage.put("todos", "x", 2); return { seen, now: ctx.storage.get("todos", "x") }; }),
      failAfterWrite: mutation({ description: "Writes, then fails", input: t.object({}), approval: "never", storage: mineW },
        async (ctx) => { ctx.storage.put("todos", "ghost", 1); throw new Error("it broke"); }),
      wrongOutput: mutation({ description: "Writes, then answers wrongly", input: t.object({}), approval: "never", output: t.object({ n: t.integer() }), storage: mineW },
        async (ctx) => { ctx.storage.put("todos", "ghost2", 1); return { n: "no" }; }),
      undeclared: mutation({ description: "Uses a collection it did not declare", input: t.object({}), approval: "never", storage: mineW },
        async (ctx) => { ctx.storage.put("secrets", "k", 1); return 1; }),
      readerWrites: query({ description: "A query that tries to write", storage: mine },
        async (ctx) => { ctx.storage.put("todos", "q", 1); return 1; }),
      noStorage: query({ description: "Never declared storage" }, async (ctx) => ctx.storage.list("todos")),
      flood: mutation({ description: "Too many writes", input: t.object({ n: t.integer() }), approval: "never", storage: mineW },
        async (ctx, { n }) => { for (let i = 0; i < n; i++) ctx.storage.put("todos", "k" + i, i); return n; }),
      huge: mutation({ description: "A value that is too large", input: t.object({}), approval: "never", storage: mineW },
        async (ctx) => { ctx.storage.put("todos", "big", "x".repeat(70000)); return 1; }),
    },
    settings: {
      set: mutation({ description: "Set a shared setting", input: t.object({ key: t.string(), value: t.json() }), approval: "never", storage: { shared: ["settings"], write: true } },
        async (ctx, { key, value }) => { ctx.storage.put("settings", key, value); return true; }),
      get: query({ description: "Read shared settings", storage: { shared: ["settings"] } }, async (ctx) => ctx.storage.list("settings")),
    },
  },
});
`;

suite("app storage against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const apps = createApps(db);
  let a: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let b: Awaited<ReturnType<typeof issueBackgroundActor>> & {};
  let slug: string;
  let appId: string;

  async function publish(source: string, title: string) {
    const [p] = await db
      .insert(playground)
      .values({ ownerUserId: A, title, language: "typescript", runner: "host", entry: "index.ts" })
      .returning();
    await db
      .insert(playgroundFile)
      .values({ playgroundId: p!.id, path: "index.ts", content: source, size: source.length });
    return apps.publish(a, { playgroundId: p!.id });
  }
  const call = (who: typeof a, tool: string, input: Record<string, unknown> = {}) =>
    apps.call(who, { app: slug, tool, input, source: "ui" });
  const value = (r: CallResult) => {
    if (r.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r.value;
  };
  const failed = (r: CallResult) => {
    if (r.status !== "failed") throw new Error(`expected failed, got ${JSON.stringify(r)}`);
    return r.error;
  };
  const rows = (userId: string | null = A) =>
    db
      .select()
      .from(appRecord)
      .where(eq(appRecord.appId, appId))
      .then((all) => all.filter((r) => r.userId === userId));
  const list = async (who: typeof a) =>
    value(await call(who, "todos.list")) as { key: string; value: any }[];

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
    const r = await publish(TODO, "Store Todo");
    slug = r.app.slug;
    appId = r.app.id;
    await apps.update(a, slug, { visibility: "team" });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("the manifest records what each tool declares", async () => {
    const d = await apps.get(a, slug);
    const tool = (n: string) => d.manifest!.tools.find((t) => t.name === n)!;
    expect(tool("todos.add").storage).toEqual({ collections: ["todos"], shared: [], write: true });
    expect(tool("todos.list").storage).toEqual({
      collections: ["todos"],
      shared: [],
      write: false,
    });
    expect(tool("settings.set").storage).toEqual({
      collections: [],
      shared: ["settings"],
      write: true,
    });
  });

  test("what a tool writes is there on the next call, and a read-modify-write works", async () => {
    value(await call(a, "todos.add", { id: "1", text: "buy milk" }));
    value(await call(a, "todos.add", { id: "2", text: "call mom" }));
    expect(value(await call(a, "todos.done", { id: "1" }))).toBe("buy milk");
    expect(await list(a)).toEqual([
      { key: "1", value: { text: "buy milk", done: true } },
      { key: "2", value: { text: "call mom", done: false } },
    ]);
    expect((await rows()).map((r) => r.bytes)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
  });

  test("a tool sees its own writes inside the call, and the last one wins", async () => {
    expect(value(await call(a, "todos.addTwice"))).toEqual({ seen: 1, now: 2 });
    expect((await list(a)).find((r) => r.key === "x")?.value).toBe(2);
  });

  test("delete removes the record", async () => {
    expect(value(await call(a, "todos.remove", { id: "x" }))).toBe(true);
    expect((await list(a)).some((r) => r.key === "x")).toBe(false);
  });

  test("another person has their own set of records; a shared collection is common to everyone", async () => {
    expect(await list(b)).toEqual([]);
    value(await call(b, "todos.add", { id: "1", text: "mine, not yours" }));
    expect((await list(b)).map((r) => r.value.text)).toEqual(["mine, not yours"]);
    expect((await list(a)).find((r) => r.key === "1")?.value.text).toBe("buy milk");
    value(await call(a, "settings.set", { key: "theme", value: "dark" }));
    value(await call(b, "settings.set", { key: "lang", value: "pt" }));
    const seenByA = value(await call(a, "settings.get")) as { key: string }[];
    const seenByB = value(await call(b, "settings.get")) as { key: string }[];
    expect(seenByA.map((r) => r.key)).toEqual(["lang", "theme"]);
    expect(seenByB.map((r) => r.key)).toEqual(["lang", "theme"]);
    expect((await rows(null)).length).toBe(2);
  });

  test("a call that fails writes nothing, and so does one whose answer does not match its declaration", async () => {
    const before = (await rows()).length;
    expect(failed(await call(a, "todos.failAfterWrite")).message).toContain("it broke");
    expect(failed(await call(a, "todos.wrongOutput")).code).toBe("BAD_RESULT");
    expect((await rows()).length).toBe(before);
    expect((await list(a)).some((r) => r.key.startsWith("ghost"))).toBe(false);
  });

  test("a collection a tool did not declare, a query that writes, and a tool with no storage are all refused", async () => {
    expect(failed(await call(a, "todos.undeclared")).code).toBe("STORAGE_UNDECLARED");
    expect(failed(await call(a, "todos.readerWrites")).code).toBe("STORAGE_READONLY");
    expect(failed(await call(a, "todos.noStorage")).code).toBe("STORAGE_UNDECLARED");
    expect((await rows()).some((r) => r.collection === "secrets" || r.key === "q")).toBe(false);
  });

  test("too many writes in one call and a value that is too large are refused, and nothing is written", async () => {
    const before = (await rows()).length;
    const many = failed(await call(a, "todos.flood", { n: 501 }));
    expect(many.code).toBe("STORAGE_INVALID");
    expect(many.message).toContain("at most 500");
    expect(failed(await call(a, "todos.huge")).code).toBe("STORAGE_INVALID");
    expect((await rows()).length).toBe(before);
  });

  test("a person who would pass their record quota gets the whole call undone", async () => {
    // Fill to the limit through the database (500 a call would be 10 calls), then one more call.
    const have = (await rows(B)).length;
    const fill = 5000 - have;
    await db.insert(appRecord).values(
      Array.from({ length: fill }, (_, i) => ({
        appId,
        userId: B,
        collection: "todos",
        key: `fill${i}`,
        value: 1,
        bytes: 1,
      })),
    );
    const full = failed(await call(b, "todos.add", { id: "one-too-many", text: "x" }));
    expect(full.code).toBe("STORAGE_FULL");
    expect((await rows(B)).some((r) => r.key === "one-too-many")).toBe(false);
    // Replacing an existing record is not a new record.
    value(await call(b, "todos.done", { id: "1" }));
    await db.delete(appRecord).where(eq(appRecord.userId, B));
  });

  test("a snapshot above 1 MB stops the call before it runs", async () => {
    await db.insert(appRecord).values(
      Array.from({ length: 20 }, (_, i) => ({
        appId,
        userId: B,
        collection: "todos",
        key: `heavy${i}`,
        value: "x",
        bytes: 60_000,
      })),
    );
    const e = failed(await call(b, "todos.list"));
    expect(e.code).toBe("STORAGE_TOO_LARGE");
    await db.delete(appRecord).where(eq(appRecord.userId, B));
  });

  test("two calls at the same time both finish; the last write of a key wins and nothing is lost", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => call(a, "todos.add", { id: `par${i}`, text: `n${i}` })),
    );
    for (const r of results) value(r);
    expect((await list(a)).filter((r) => r.key.startsWith("par")).length).toBe(4);
    const same = await Promise.all([
      call(a, "todos.add", { id: "dup", text: "one" }),
      call(a, "todos.add", { id: "dup", text: "two" }),
    ]);
    same.forEach(value);
    const dup = (await rows()).filter((r) => r.key === "dup");
    expect(dup).toHaveLength(1);
  });

  test("a new version and a rollback leave the data alone", async () => {
    const before = (await rows()).length;
    const [p] = await db.select().from(playground).where(eq(playground.ownerUserId, A));
    await db
      .update(playgroundFile)
      .set({ content: TODO + "\n// v2", size: TODO.length + 6 })
      .where(eq(playgroundFile.playgroundId, p!.id));
    await apps.publish(a, { playgroundId: p!.id });
    expect((await rows()).length).toBe(before);
    await apps.rollback(a, slug, 1);
    expect((await rows()).length).toBe(before);
    expect((await list(a)).length).toBeGreaterThan(0);
  });

  test("a page adds a to-do and lists it through the bridge, as the frame would", async () => {
    // The host builds its allow-list from the tools of the version; this app has no page, so the manifest stands in.
    const allowed = new Set((await apps.get(a, slug)).manifest!.tools.map((t) => t.name));
    const send = async (id: number, tool: string, input: Record<string, unknown>) => {
      const parsed = parseBridgeRequest(
        { source: "zetta-app", id, type: "call", tool, input },
        allowed,
      );
      if (parsed.kind !== "request") throw new Error(`not a request: ${JSON.stringify(parsed)}`);
      const r = await apps.call(a, {
        app: slug,
        tool: parsed.request.tool,
        input: parsed.request.input,
        source: "ui",
      });
      if (r.status !== "ok") throw new Error(JSON.stringify(r));
      return okReply(parsed.request.id, r.value);
    };
    expect(await send(1, "todos.add", { id: "page1", text: "from the page" })).toEqual({
      source: "zetta-host",
      id: 1,
      ok: true,
      value: { id: "page1" },
    });
    const listed = await send(2, "todos.list", {});
    expect(listed).toMatchObject({ id: 2, ok: true });
    expect(JSON.stringify(listed)).toContain("from the page");
  });

  describe("the data page", () => {
    test("a person sees their own numbers and the shared ones; the owner also sees how many records other people hold", async () => {
      value(await call(b, "todos.add", { id: "b1", text: "b" }));
      const mine = await apps.data(b, slug);
      expect(mine.collections.find((c) => c.name === "todos")).toMatchObject({
        kind: "personal",
        records: 1,
      });
      expect(mine.collections.find((c) => c.name === "todos")).not.toHaveProperty("otherRecords");
      expect(mine.collections.find((c) => c.name === "settings")).toMatchObject({
        kind: "shared",
        records: 2,
      });
      const owner = await apps.data(a, slug);
      const todos = owner.collections.find((c) => c.name === "todos")!;
      expect(todos.otherRecords).toBe(1);
      expect(todos.records).toBeGreaterThan(1);
    });
    test("deleting my data removes only mine; a person cannot clear everyone's", async () => {
      const r = await apps.clearData(b, slug, "mine");
      expect(r.removed).toBe(1);
      expect(
        (await apps.data(a, slug)).collections.find((c) => c.name === "todos")!.otherRecords,
      ).toBe(0);
      expect(((await fails(apps.clearData(b, slug, "all"))) as AppError).code).toBe("FORBIDDEN");
      expect((await list(a)).length).toBeGreaterThan(0);
    });
    test("the owner can delete everything, shared records included", async () => {
      const r = await apps.clearData(a, slug, "all");
      expect(r.removed).toBeGreaterThan(2);
      expect(await list(a)).toEqual([]);
      expect((await rows(null)).length).toBe(0);
    });
    test("an outsider sees nothing of it", async () => {
      await apps.update(a, slug, { visibility: "private" });
      expect(((await fails(apps.data(b, slug))) as AppError).code).toBe("NOT_FOUND");
    });
  });

  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error("expected a failure");
  };
});
