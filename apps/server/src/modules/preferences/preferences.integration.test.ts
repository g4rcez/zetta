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
    expect(await read(ids[0]!)).toEqual({
      railMode: "expanded",
      sidebarSide: "left",
      railWidth: 224,
      listWidth: 320,
      timeFormat: "24h",
      approvalMode: "hold",
      theme: null,
      primaryColor: null,
      botOrder: [],
      agentsState: "running",
    });
  });
  test("a change is kept for that person only, and a later change keeps the rest", async () => {
    const first = await call(ids[0]!, "PATCH", { railMode: "collapsed", listWidth: 400 });
    expect(first.status).toBe(200);
    await call(ids[0]!, "PATCH", { railWidth: 260 });
    expect(await read(ids[0]!)).toEqual({
      railMode: "collapsed",
      sidebarSide: "left",
      railWidth: 260,
      listWidth: 400,
      timeFormat: "24h",
      approvalMode: "hold",
      theme: null,
      primaryColor: null,
      botOrder: [],
      agentsState: "running",
    });
    expect(await read(ids[1]!)).toEqual({
      railMode: "expanded",
      sidebarSide: "left",
      railWidth: 224,
      listWidth: 320,
      timeFormat: "24h",
      approvalMode: "hold",
      theme: null,
      primaryColor: null,
      botOrder: [],
      agentsState: "running",
    });
  });
  test("the agents state is shown with the preferences but cannot be set through them", async () => {
    const refused = await call(ids[0]!, "PATCH", { agentsState: "paused" });
    expect(refused.status).toBe(400);
    expect(await read(ids[0]!)).toMatchObject({ agentsState: "running" });
  });
  test("a bot order is kept for that person only, in the order sent", async () => {
    const order = ["00000000-0000-7000-8000-000000000002", "00000000-0000-7000-8000-000000000001"];
    expect((await call(ids[0]!, "PATCH", { botOrder: order })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ railWidth: 260, botOrder: order });
    expect(await read(ids[1]!)).toMatchObject({ botOrder: [] });
  });
  test("the hour format defaults to 24h and a change is kept for that person only", async () => {
    expect(await read(ids[1]!)).toMatchObject({ timeFormat: "24h" });
    expect((await call(ids[0]!, "PATCH", { timeFormat: "12h" })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ timeFormat: "12h", railWidth: 260 });
    expect(await read(ids[1]!)).toMatchObject({ timeFormat: "24h" });
    expect((await call(ids[1]!, "PATCH", { timeFormat: "am/pm" })).status).toBe(400);
  });
  test("approving by press and hold is the default; a person can choose a plain click, for themselves only", async () => {
    expect(await read(ids[1]!)).toMatchObject({ approvalMode: "hold" });
    expect((await call(ids[0]!, "PATCH", { approvalMode: "click" })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ approvalMode: "click", railWidth: 260 });
    expect(await read(ids[1]!)).toMatchObject({ approvalMode: "hold" });
    expect((await call(ids[0]!, "PATCH", { approvalMode: "hold" })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ approvalMode: "hold" });
    expect((await call(ids[1]!, "PATCH", { approvalMode: "tap" })).status).toBe(400);
  });
  test("the sidebar is on the left by default; a person can move it to the right, for themselves only", async () => {
    expect(await read(ids[1]!)).toMatchObject({ sidebarSide: "left" });
    expect((await call(ids[0]!, "PATCH", { sidebarSide: "right" })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ sidebarSide: "right", railWidth: 260 });
    expect(await read(ids[1]!)).toMatchObject({ sidebarSide: "left" });
    expect((await call(ids[0]!, "PATCH", { sidebarSide: "left" })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ sidebarSide: "left" });
    expect((await call(ids[1]!, "PATCH", { sidebarSide: "top" })).status).toBe(400);
  });
  test("a theme and a main color are kept for that person only, and null resets them", async () => {
    expect((await call(ids[0]!, "PATCH", { theme: "nord", primaryColor: "#AA3300" })).status).toBe(
      200,
    );
    expect(await read(ids[0]!)).toMatchObject({ theme: "nord", primaryColor: "#aa3300" });
    expect(await read(ids[1]!)).toMatchObject({ theme: null, primaryColor: null });
    expect((await call(ids[0]!, "PATCH", { theme: null, primaryColor: null })).status).toBe(200);
    expect(await read(ids[0]!)).toMatchObject({ theme: null, primaryColor: null });
    expect((await call(ids[1]!, "PATCH", { theme: "solarized" })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { primaryColor: "red" })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { primaryColor: "#fff" })).status).toBe(400);
  });

  test("widths outside the limits and unknown fields are refused", async () => {
    expect((await call(ids[1]!, "PATCH", { listWidth: 5000 })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { railWidth: 100 })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { railMode: "hidden" })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { fontSize: 14 })).status).toBe(400);
    expect((await call(ids[1]!, "PATCH", { botOrder: ["not-a-bot"] })).status).toBe(400);
    expect(
      (await call(ids[1]!, "PATCH", { botOrder: "00000000-0000-7000-8000-000000000001" })).status,
    ).toBe(400);
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
