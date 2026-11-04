import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { HarnessError } from "./harness";
import { createTurnRunner } from "./pipeline";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `chat-retry-a-${uuidv7()}`;

suite("a chat turn that hits a harness failure against compose postgres", () => {
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
  /** What each start of the CLI does, in order. */
  let starts: ("ok" | HarnessError)[] = [];
  let runs = 0;
  /** The harness of each start, in order. */
  let seen: string[] = [];
  const cli = async function* (input: { harness: string }) {
    runs++;
    seen.push(input.harness);
    const next = starts.shift() ?? "ok";
    if (next !== "ok") throw next;
    yield "recovered";
  };
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: {
      access,
      chat: createChatService(db, createTurnRunner(db, (async () => "x") as never, cli as never)),
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const req = (method: string, path: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": A,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  const conversation = async (extra: Record<string, unknown> = {}) => {
    const bot = (
      (await (
        await req("POST", "/api/bots", { name: "RetryBot", harness: "pi", ...extra })
      ).json()) as any
    ).bot.id as string;
    return ((await (await req("POST", "/api/conversations", { botId: bot })).json()) as any)
      .conversation.id as string;
  };
  const answer = async (c: string) => {
    await (await req("POST", `/api/conversations/${c}/stream`, { content: "go" })).text();
    const rows = await db.select().from(message).where(eq(message.conversationId, c));
    return rows.find((m) => m.role === "assistant")!;
  };

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: A,
      email: `${A}@t.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active" as const, joinedAt: now, updatedAt: now });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A]);
  });

  test("a start that fails once is tried again and the user gets the answer", async () => {
    starts = [new HarnessError("failed"), "ok"];
    runs = 0;
    const reply = await answer(await conversation());
    expect(reply).toMatchObject({ status: "complete", content: "recovered" });
    expect(runs).toBe(2);
  });

  test("a bot that is not signed in is not tried again, and the saved reply carries the error code", async () => {
    starts = [new HarnessError("auth_required")];
    runs = 0;
    const reply = await answer(await conversation());
    expect(reply.status).toBe("failed");
    expect(reply.content).toBe(
      "pi is not signed in for you. Sign in to pi on the server, then try again.",
    );
    expect(reply.meta).toMatchObject({ error: "auth_required" });
    expect(runs).toBe(1);
  });

  test("a bot whose main harness hit its limit answers with its fallback harness", async () => {
    starts = [new HarnessError("quota"), "ok"];
    seen = [];
    const reply = await answer(await conversation({ fallbackHarness: "codex" }));
    expect(reply).toMatchObject({ status: "complete", content: "recovered" });
    expect(seen).toEqual(["pi", "codex"]);
  });

  test("the next turn tries the main harness again", async () => {
    const c = await conversation({ fallbackHarness: "codex" });
    starts = [new HarnessError("quota"), "ok", "ok"];
    seen = [];
    await answer(c);
    await (await req("POST", `/api/conversations/${c}/stream`, { content: "again" })).text();
    expect(seen).toEqual(["pi", "codex", "pi"]);
  });

  test("a slow or flaky main harness is retried, not replaced by the fallback", async () => {
    starts = [new HarnessError("failed"), "ok"];
    seen = [];
    const reply = await answer(await conversation({ fallbackHarness: "codex" }));
    expect(reply).toMatchObject({ status: "complete", content: "recovered" });
    expect(seen).toEqual(["pi", "pi"]);
  });

  test("when the fallback is blocked too, the reply names the fallback and the error code", async () => {
    starts = [new HarnessError("auth_required"), new HarnessError("quota")];
    seen = [];
    const reply = await answer(await conversation({ fallbackHarness: "codex" }));
    expect(reply.status).toBe("failed");
    expect(reply.content).toBe(
      "codex has reached its usage limit for the signed-in account. Wait for the limit to reset or switch to an API key.",
    );
    expect(reply.meta).toMatchObject({ error: "quota" });
    expect(seen).toEqual(["pi", "codex"]);
  });
});
