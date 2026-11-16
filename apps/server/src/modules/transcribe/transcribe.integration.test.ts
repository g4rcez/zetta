import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { Elysia } from "elysia";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess, createMembershipLookup } from "../identity/access";
import { createTranscribeRoutes } from "./routes";
import { createTranscribe } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`tr-a-${uuidv7()}`, `tr-b-${uuidv7()}`];
const [A, B] = ids as [string, string];
const ORIGIN = "http://localhost:5173";

suite("the microphone route, for signed-in members", () => {
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
    createMembershipLookup(db),
  );
  const heard: number[] = [];
  const server = new Elysia().use(
    createTranscribeRoutes(
      {
        access,
        transcribe: createTranscribe({
          transcribe: async (pcm) => (heard.push(pcm.length), "hello there"),
        }),
      },
      [ORIGIN],
    ),
  );
  const post = (as: string, body: unknown) =>
    server.handle(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        headers: { "x-test-user": as, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const samples = (n: number) => Buffer.from(new Uint8Array(n * 2)).toString("base64");

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

  test("samples go in, the text comes out", async () => {
    const r = await post(A, { pcmBase64: samples(1600) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ text: "hello there" });
    expect(heard).toEqual([1600]);
  });

  test("something that is not a recording, or one that is too long, is refused in words", async () => {
    expect((await post(A, { pcm: "x" })).status).toBe(400);
    expect((await post(A, {})).status).toBe(400);
    const long = await post(A, { pcmBase64: samples(16_000 * 300 + 2) });
    expect(long.status).toBe(413);
    expect(((await long.json()) as { error: { message: string } }).error.message).toContain(
      "5 minutes",
    );
  });

  test("a person gets a few recordings a minute, and the limit is theirs alone", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await post(B, { pcmBase64: samples(10) })).status);
    expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(statuses.slice(6)).toEqual([429, 429]);
    expect((await post(A, { pcmBase64: samples(10) })).status).toBe(200);
  });
});
