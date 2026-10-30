import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createTurnRunner, type Used } from "../chat/pipeline";
import { issueBackgroundActor } from "../identity/access";
import type { PluginContext } from "../integrations/plugins/registry";
import { readableType } from "../integrations/plugins/google/drive";
import type { Embedder } from "./embed";
import { createKnowledge, type Drive } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`know-a-${uuidv7()}`, `know-b-${uuidv7()}`];
const DOC = "application/vnd.google-apps.document";

/** A bag-of-words embedder: texts that share words get close vectors, so retrieval can be tested without downloading the model. */
const bagOfWords: Embedder = {
  async embed(texts) {
    return texts.map((t) => {
      const v = Array.from({ length: 384 }, () => 0);
      for (const w of t
        .toLowerCase()
        .replace(/^(query|passage): /, "")
        .match(/\p{L}+/gu) ?? []) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
        v[h % 384]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
  },
};

/** One user's pretend Drive: the files they can open, a queue of changes, and which files they may still open. */
function fakeDrive() {
  const files = new Map<string, { name: string; text: string; version: string }>();
  const changes: { fileId: string; removed: boolean; id?: string }[] = [];
  const blocked = new Set<string>();
  const meta = (id: string) => ({
    id,
    name: files.get(id)!.name,
    mimeType: DOC,
    version: files.get(id)!.version,
    modifiedAt: null,
    webViewLink: `https://docs.example.invalid/${id}`,
    size: 0,
  });
  const drive: Drive = {
    needIndexScope: () => {},
    indexable: (f) => readableType(f.mimeType),
    startPageToken: async () => "start-1",
    listFiles: async () => ({ files: [...files.keys()].map(meta), next: null }),
    listChanges: async () => {
      const batch = changes.splice(0);
      return {
        changes: batch.map((c) => ({
          fileId: c.fileId,
          removed: c.removed,
          file: c.removed ? null : meta(c.fileId),
        })),
        next: null,
        newStart: "start-2",
      };
    },
    readText: async (_c, f) => files.get(f.id)!.text,
    canOpen: async (_c, id) => !blocked.has(id),
  };
  return { files, changes, blocked, drive };
}

suite("company knowledge against compose postgres with pgvector", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const lookup = async () => ({ isAdmin: false });
  const driveA = fakeDrive(),
    driveB = fakeDrive();
  const make = (d: Drive) =>
    createKnowledge(db, {
      plugins: { contextFor: async () => ({}) as PluginContext },
      lookup,
      embedder: bagOfWords,
      drive: d,
    });
  const kA = make(driveA.drive),
    kB = make(driveB.drive);
  let answerId = "";
  let a: Awaited<ReturnType<typeof issueBackgroundActor>> & {}, b: typeof a;
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
    a = (await issueBackgroundActor(lookup, A))!;
    b = (await issueBackgroundActor(lookup, B))!;
    driveA.files.set("f-budget", {
      name: "Aurora budget",
      version: "1",
      text: "The Aurora launch budget is four hundred thousand euros for the second quarter.",
    });
    driveA.files.set("f-hiring", {
      name: "Hiring plan",
      version: "1",
      text: "We will hire three engineers and one designer before autumn.",
    });
    driveB.files.set("f-secret", {
      name: "B secret",
      version: "1",
      text: "The Aurora launch budget of company B is confidential and huge.",
    });
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
  });

  test("indexes the user's Drive in the background and reports progress", async () => {
    expect(await kA.status(a)).toMatchObject({ enabled: false, docs: 0 });
    expect(await kA.enable(a)).toMatchObject({ enabled: true, status: "idle" });
    await kB.enable(b);
    expect(await kA.syncUser(a)).toMatchObject({
      status: "idle",
      docs: 2,
      pending: 0,
      lastError: null,
    });
    expect((await kA.status(a)).chunks).toBe(2);
    await kB.syncUser(b);
  });

  test("answers from the asker's own documents only, by keywords and by meaning", async () => {
    const byWords = await kA.retrieve(A, "Aurora launch budget");
    expect(byWords.map((h) => h.name)).toEqual(["Aurora budget"]);
    expect(byWords[0]).toMatchObject({ link: "https://docs.example.invalid/f-budget" });
    // Not every word is in the text, so keywords find nothing: the vector match alone brings it back.
    expect(
      (
        await kA.retrieve(A, "we will hire three engineers and one designer before autumn soon")
      ).map((h) => h.name),
    ).toEqual(["Hiring plan"]);
    expect((await kA.retrieve(A, "recipe for chocolate cake")).length).toBe(0);
    // B has a similar document; neither user ever sees the other's.
    expect((await kB.retrieve(B, "Aurora launch budget")).map((h) => h.name)).toEqual(["B secret"]);
    expect((await kA.retrieve(A, "company B confidential huge")).length).toBe(0);
  });

  test("a changed file is read again, a deleted file leaves the index", async () => {
    driveA.files.set("f-hiring", {
      name: "Hiring plan",
      version: "2",
      text: "The hiring plan now needs two data scientists in winter.",
    });
    driveA.changes.push(
      { fileId: "f-hiring", removed: false },
      { fileId: "f-budget", removed: true },
    );
    expect(await kA.syncUser(a)).toMatchObject({ docs: 1, pending: 0 });
    expect((await kA.retrieve(A, "data scientists winter")).map((h) => h.name)).toEqual([
      "Hiring plan",
    ]);
    expect((await kA.retrieve(A, "three engineers one designer")).length).toBe(0);
    expect((await kA.retrieve(A, "Aurora launch budget")).length).toBe(0);
  });

  test("the bot gets the asker's documents as numbered untrusted data, and the answer lists them as sources", async () => {
    const q = (sql: string, p: unknown[]) => db.$client.query(sql, p);
    const botId = (
      await q(
        "insert into bot (owner_user_id, kind, visibility, name, slug, harness) values ($1, 'custom', 'private', 'Doc bot', $2, 'claude-code') returning id",
        [A, `doc-bot-${uuidv7().slice(-8)}`],
      )
    ).rows[0].id as string;
    const [row] = await db.select().from(bot).where(eq(bot.id, botId));
    const prompts: string[] = [];
    let used: Used | undefined;
    const runner = createTurnRunner(
      db,
      async (i) => {
        prompts.push(i.prompt);
        return "ok";
      },
      undefined,
      kA,
    );
    await runner({
      userId: A,
      bot: row!,
      history: [],
      prompt: "data scientists winter",
      onUsed: (u) => {
        used = u;
      },
    });
    expect(prompts[0]).toContain("UNTRUSTED DATA");
    expect(prompts[0]).toContain(
      `[1] Hiring plan (doc:${used?.docs?.[0]?.docId})\nThe hiring plan now needs two data scientists in winter.`,
    );
    expect(used?.docs).toHaveLength(1);
    await runner({ userId: B, bot: row!, history: [], prompt: "data scientists winter" }); // B asking never gets A's text
    expect(prompts[1]).not.toContain("Hiring plan");
    const chat = (
      await q(
        "insert into conversation (owner_user_id, bot_id, title) values ($1, $2, 'Docs') returning id",
        [A, botId],
      )
    ).rows[0].id as string;
    answerId = (
      await q(
        "insert into message (conversation_id, owner_user_id, seq, role, content, meta) values ($1, $2, 1, 'assistant', 'Two data scientists [1]', $3) returning id",
        [chat, A, JSON.stringify({ used })],
      )
    ).rows[0].id as string;
    expect(await kA.cited(a, answerId)).toEqual([
      {
        n: 1,
        docId: used!.docs![0]!.docId,
        name: "Hiring plan",
        link: "https://docs.example.invalid/f-hiring",
        snippet: "The hiring plan now needs two data scientists in winter.",
      },
    ]);
    expect(await kB.cited(b, answerId)).toEqual([]); // not B's message
  });

  test("a document the user can no longer open is dropped when its citation is checked", async () => {
    const [hit] = await kA.retrieve(A, "data scientists winter");
    expect((await kA.stillAccessible(a, [hit!.docId])).map((d) => d.name)).toEqual(["Hiring plan"]);
    driveA.blocked.add("f-hiring");
    expect(await kA.stillAccessible(a, [hit!.docId])).toEqual([]);
    expect((await kA.retrieve(A, "data scientists winter")).length).toBe(0);
    expect(await kB.stillAccessible(b, [hit!.docId])).toEqual([]); // not B's document
    expect(await kA.cited(a, answerId)).toEqual([]); // the earlier answer no longer lists it
  });

  test("turning it off deletes every copy", async () => {
    await kA.disable(a);
    expect(await kA.status(a)).toMatchObject({ enabled: false, chunks: 0 });
    expect((await kB.status(b)).chunks).toBe(1);
  });
});
