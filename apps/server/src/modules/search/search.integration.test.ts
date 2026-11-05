import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createSearch } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`srch-a-${uuidv7()}`, `srch-b-${uuidv7()}`];

suite("global search against compose postgres", () => {
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
    search: { access, search: createSearch(db) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const find = async (as: string, q: string, extra = "") => {
    const r = await app.handle(
      new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}${extra}`, {
        headers: { "x-test-user": as },
      }),
    );
    return {
      status: r.status,
      hits:
        (
          (await r.json()) as {
            hits?: {
              kind: string;
              id: string;
              title: string;
              snippet: string;
              conversationId: string | null;
              messageId: string | null;
            }[];
          }
        ).hits ?? [],
    };
  };
  let chatA = "",
    msgA = "";
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [A, B].map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(membership).values(
      [A, B].map((userId) => ({
        userId,
        status: "active" as const,
        joinedAt: now,
        updatedAt: now,
      })),
    );
    const q = (sql: string, p: unknown[]) => db.$client.query(sql, p);
    const botOf = async (owner: string, name: string) =>
      (
        await q(
          "insert into bot (owner_user_id, kind, visibility, name, slug) values ($1, 'custom', 'private', $2, $3) returning id",
          [owner, name, `${name}-${uuidv7().slice(-8)}`],
        )
      ).rows[0].id as string;
    const [botA, botB] = [await botOf(A, "srch-bot-a"), await botOf(B, "srch-bot-b")];
    chatA = (
      await q(
        "insert into conversation (owner_user_id, bot_id, title) values ($1, $2, $3) returning id",
        [A, botA, "Planejamento da Ação de lançamento"],
      )
    ).rows[0].id;
    msgA = (
      await q(
        "insert into message (conversation_id, owner_user_id, seq, role, content) values ($1, $2, 1, 'user', $3) returning id",
        [chatA, A, "Preciso de um resumo sobre o orçamento do projeto Aurora"],
      )
    ).rows[0].id;
    const chatB = (
      await q(
        "insert into conversation (owner_user_id, bot_id, title) values ($1, $2, $3) returning id",
        [B, botB, "Segredo de B"],
      )
    ).rows[0].id;
    await q(
      "insert into message (conversation_id, owner_user_id, seq, role, content) values ($1, $2, 1, 'user', $3)",
      [chatB, B, "orçamento secreto do projeto Aurora de B"],
    );
    await q(
      "insert into memory_item (owner_user_id, slug, title, content, tags) values ($1, $2, 'Launch codename', $3, '{profile}')",
      [A, `codename-${uuidv7().slice(-8)}`, "Aurora is the codename for the launch"],
    );
    await q("insert into task (owner_user_id, title, description) values ($1, $2, $3)", [
      A,
      "Revisar Aurora",
      "checklist final",
    ]);
    await q(
      "insert into artifact (owner_user_id, title, description, file_name, mime_type, kind, size, sha256) values ($1, 'Relatório Aurora', 'trimestral', 'aurora.pdf', 'application/pdf', 'document', 1, $2)",
      [A, `sha-${uuidv7()}`],
    );
  });
  afterAll(async () => {
    await db.$client.query("delete from artifact where owner_user_id = any($1)", [[A, B]]);
    await cleanupTestUsers(db, [A, B]);
  });

  test("finds the user's own chats, messages, memory items, tasks and artifacts, and never another user's", async () => {
    const mine = await find(A, "aurora");
    expect(mine.status).toBe(200);
    expect(mine.hits.map((h) => h.kind).sort()).toEqual(["artifact", "memory", "message", "task"]);
    expect(mine.hits.some((h) => h.snippet.includes("secreto"))).toBe(false);
    const theirs = await find(B, "aurora");
    expect(theirs.hits.map((h) => h.title)).toEqual(["Segredo de B"]);
  });

  test("accents do not matter in either direction, and a message hit opens its conversation", async () => {
    const hit = (await find(A, "orcamento")).hits.find((h) => h.kind === "message");
    expect(hit).toMatchObject({
      id: msgA,
      conversationId: chatA,
      messageId: msgA,
      title: "Planejamento da Ação de lançamento",
    });
    expect((await find(A, "acao lancamento")).hits.map((h) => h.kind)).toEqual(["conversation"]);
    expect((await find(A, "AÇÃO")).hits.map((h) => h.kind)).toEqual(["conversation"]);
  });

  test("marks the matched words, filters by kind, and rejects bad input", async () => {
    expect((await find(A, "orçamento")).hits[0]!.snippet).toContain("[[orçamento]]");
    expect((await find(A, "aurora", "&kinds=task")).hits.map((h) => h.kind)).toEqual(["task"]);
    expect((await find(A, "aurora", "&kinds=bogus")).status).toBe(400);
    expect((await find(A, "x".repeat(201))).status).toBe(400);
    expect((await find(A, "   ")).hits).toEqual([]);
    expect((await find(A, "aurora' or 1=1 --")).status).toBe(200);
    expect((await find("", "aurora")).status).toBe(401);
  });
});
