import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createPreferenceStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`pref-a-${uuidv7()}`, `pref-b-${uuidv7()}`];

suite("layout preferences against compose postgres", () => {
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
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    preferences: { access, preferences: createPreferenceStore(db) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = (as: string, method: string, body?: unknown) =>
    app.handle(
      new Request("http://localhost/api/preferences", {
        method,
        headers: {
          "x-test-user": as,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const read = async (as: string) =>
    ((await (await call(as, "GET")).json()) as { preferences: unknown }).preferences;

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

  test("a person who never changed anything gets the defaults", async () => {
    expect(await read(ids[0]!)).toEqual({ railMode: "expanded", railWidth: 224, listWidth: 320 });
  });
  test("a change is kept for that person only, and a later change keeps the rest", async () => {
    const first = await call(ids[0]!, "PATCH", { railMode: "collapsed", listWidth: 400 });
    expect(first.status).toBe(200);
    await call(ids[0]!, "PATCH", { railWidth: 260 });
    expect(await read(ids[0]!)).toEqual({ railMode: "collapsed", railWidth: 260, listWidth: 400 });
    expect(await read(ids[1]!)).toEqual({ railMode: "expanded", railWidth: 224, listWidth: 320 });
  });
  test("widths outside the limits and unknown fields are refused", async () => {
    expect((await call(ids[1]!, "PATCH", { listWidth: 5000 })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { railWidth: 100 })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { railMode: "hidden" })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { theme: "dark" })).status).toBe(400);
  });
  test("saving needs a trusted origin and a signed-in person", async () => {
    const foreign = await app.handle(
      new Request("http://localhost/api/preferences", {
        method: "PATCH",
        headers: {
          "x-test-user": ids[1]!,
          origin: "http://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ railWidth: 300 }),
      }),
    );
    expect(foreign.status).toBe(403);
    const anonymous = await app.handle(new Request("http://localhost/api/preferences"));
    expect(anonymous.status).toBe(401);
  });
});
