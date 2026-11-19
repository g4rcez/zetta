import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { botLesson } from "@zetta/db/schema/learning";
import { skill } from "@zetta/db/schema/skills";

import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createMemory } from "../memory/service";
import { createSkills } from "../skills/service";
import { createBatch } from "./batch";
import { createFindings } from "./findings";
import { createProgress } from "./progress";
import { createLessons } from "./lessons";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const fakeWorkflow = { ensure: async () => ({ id: "wf-1", created: true as const }) };
const suite = url ? describe : describe.skip;
const A = `lrt-a-${uuidv7()}`;
const B = `lrt-b-${uuidv7()}`;

suite("the lessons API: the person's say over what their bots learned", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const skills = createSkills(db);
  let reply: unknown = { candidates: [] };
  let gate: Promise<void> | undefined;
  const batch = createBatch(db, {
    lessons,
    cli: async () => {
      await gate;
      return JSON.stringify(reply);
    },
  });
  let botId!: string;
  let convId!: string;
  let seq = 0;
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
    lessons: {
      access,
      lessons,
      batch,
      findings: createFindings(db, { lessons, memory }),
      progress: createProgress(db),
      workflow: fakeWorkflow,
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };

  beforeAll(async () => {
    const now = new Date();
    for (const id of [A, B]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
    }
    await db.insert(bot).values({
      ownerUserId: A,
      kind: "chief",
      visibility: "private",
      name: "Chief",
      slug: `chief-${uuidv7().slice(-10)}`,
      harness: "claude-code",
    } as never);
    botId = (
      await db
        .insert(bot)
        .values({
          ownerUserId: A,
          kind: "specialist",
          visibility: "private",
          name: "Da Vinci",
          slug: `dv-${uuidv7().slice(-10)}`,
          harness: "claude-code",
        } as never)
        .returning()
    )[0]!.id;
    convId = (
      await db
        .insert(conversation)
        .values({ ownerUserId: A, botId, title: "t" } as never)
        .returning()
    )[0]!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
    // Close this file's connections: every test file opens its own pool, and the shared test Postgres has a connection limit.
    await db.$client.end();
  });

  const candidate = (text: string) =>
    lessons.propose({
      ownerUserId: A,
      botId,
      text,
      topic: "reports",
      kind: "rule",
      scope: "topic",
    });
  const say = async (role: "user" | "assistant", content: string) =>
    (
      await db
        .insert(message)
        .values({
          conversationId: convId,
          ownerUserId: A,
          seq: ++seq,
          role,
          content,
          status: "complete",
          ...(role === "assistant" ? { botId } : {}),
          createdAt: new Date(Date.now() - 3_600_000),
        } as never)
        .returning()
    )[0]!;

  test("a person accepts, turns down, keeps, drops, restores and edits; every answer is the lesson; nobody else's is theirs", async () => {
    const waiting = await candidate("Send client reports as a table.");
    const accepted = await call(A, "POST", `/api/lessons/${waiting.id}/accept`);
    expect(accepted).toMatchObject({
      status: 200,
      json: { lesson: { status: "trial", basis: "person" } },
    });
    expect((await call(A, "POST", `/api/lessons/${waiting.id}/keep`)).json.lesson.status).toBe(
      "kept",
    );
    expect(
      (
        await call(A, "PATCH", `/api/lessons/${waiting.id}`, {
          text: "Send client reports as a table, with totals.",
        })
      ).json.lesson.text,
    ).toBe("Send client reports as a table, with totals.");
    const dropped = await call(A, "POST", `/api/lessons/${waiting.id}/drop`);
    expect(dropped.json.lesson).toMatchObject({ status: "dropped", dropReason: "person" });
    expect((await call(A, "POST", `/api/lessons/${waiting.id}/restore`)).json.lesson.status).toBe(
      "trial",
    );

    const no = await candidate("Use the old export.");
    expect((await call(A, "POST", `/api/lessons/${no.id}/reject`)).json.lesson.status).toBe(
      "rejected",
    );
    expect((await call(A, "POST", `/api/lessons/${no.id}/keep`)).status).toBe(400); // only a lesson on trial can be kept
    expect(
      (await call(A, "PATCH", `/api/lessons/${waiting.id}`, { text: "x".repeat(301) })).status,
    ).toBe(400);

    // Someone else's lesson is not theirs, and a missing one is not found.
    expect((await call(B, "POST", `/api/lessons/${waiting.id}/drop`)).status).toBe(404);
    expect((await call(B, "GET", `/api/lessons?bot=${botId}`)).json.lessons).toEqual([]);
    expect((await call(A, "POST", `/api/lessons/${uuidv7()}/keep`)).status).toBe(404);
    expect((await call(null, "GET", "/api/lessons")).status).toBe(401);
  });

  test("the list takes the same filters as the page, and refuses what it does not know", async () => {
    const r = await call(A, "GET", `/api/lessons?bot=${botId}&status=trial`);
    expect(r.status).toBe(200);
    expect(r.json.lessons.every((l: { status: string }) => l.status === "trial")).toBe(true);
    expect(r.json.lessons[0]).toMatchObject({
      botId,
      memorySlug: expect.stringMatching(/^lesson-/),
      results: { label: "unclear" }, // started today and nothing has used it yet: new, not unused
    });
    expect((await call(A, "GET", "/api/lessons?status=great")).status).toBe(400);
    expect((await call(A, "GET", "/api/lessons?nonsense=1")).status).toBe(400);
  });

  test("Run now answers at once with the claimed run, the engine finishes in the background, and an hour must pass before the next", async () => {
    await say("user", "From now on, please send the reports as a table, not as text.");
    for (let i = 0; i < 5; i++) await say("user", `Another request about invoices number ${i}`);
    reply = {
      candidates: [
        {
          text: "Send client reports as a table, never as running text.",
          kind: "rule",
          scope: "topic",
          topic: "reports",
          evidence: [{ ref: "#1", quote: "send the reports as a table, not as text" }],
        },
      ],
    };
    let release!: () => void;
    gate = new Promise<void>((res) => (release = res));
    const started = await call(A, "POST", `/api/bots/${botId}/learning/run`);
    expect(started.status).toBe(202);
    expect(started.json.run).toMatchObject({ status: "running", trigger: "manual" });
    const during = await call(A, "GET", `/api/bots/${botId}/learning`);
    expect(during.json.runs[0]).toMatchObject({ status: "running" });
    expect(during.json.runNowAfter).not.toBeNull(); // held back as soon as it started
    release();
    gate = undefined;
    for (let i = 0; i < 100; i++) {
      const o = await call(A, "GET", `/api/bots/${botId}/learning`);
      if (o.json.runs[0].status !== "running") break;
      await Bun.sleep(20);
    }
    const after = await call(A, "GET", `/api/bots/${botId}/learning`);
    expect(after.json.runs[0]).toMatchObject({
      status: "done",
      promoted: 1,
      detail: "1 started on trial",
    });
    expect(after.json.bot).toMatchObject({ id: botId, autoLearn: "auto" });
    expect((await call(A, "POST", `/api/bots/${botId}/learning/run`)).status).toBe(429);
    expect((await call(B, "POST", `/api/bots/${botId}/learning/run`)).status).toBe(404);
    expect((await call(B, "GET", `/api/bots/${botId}/learning`)).status).toBe(404);
  });

  test("what the learning jobs may do: defaults, a change, and a value that is not allowed", async () => {
    expect((await call(A, "GET", "/api/learning/policy")).json.policy).toEqual({
      batch: "daily",
      forget: "on",
      tidy: "weekly",
      strictness: "normal",
    });
    expect(
      (await call(A, "PUT", "/api/learning/policy", { strictness: "strict", tidy: "off" })).json
        .policy,
    ).toEqual({
      batch: "daily",
      forget: "on",
      tidy: "off",
      strictness: "strict",
    });
    expect((await call(A, "PUT", "/api/learning/policy", { strictness: "reckless" })).status).toBe(
      400,
    );
    expect((await call(A, "PUT", "/api/learning/policy", { surprise: "on" })).status).toBe(400);
    expect((await call(B, "GET", "/api/learning/policy")).json.policy.strictness).toBe("normal");
  });

  test("a skill a bot learned before lessons existed becomes a lesson that can be dropped and brought back; running it twice adds nothing", async () => {
    const made = await skills.createLearned(A, botId, {
      name: `old-${uuidv7().slice(-6)}`,
      description: "Use when the user asks for the weekly sales report.",
      body: "Pull the sales table, sort by date, send it as a CSV and say how many rows it has.",
    });
    expect(await lessons.backfillSkills()).toBeGreaterThanOrEqual(1);
    expect(await lessons.backfillSkills()).toBe(0);
    const [l] = await db.select().from(botLesson).where(eq(botLesson.skillId, made.id));
    expect(l).toMatchObject({
      status: "kept",
      basis: "old",
      origin: "backfill",
      kind: "procedure",
      botId,
    });
    const dropped = await call(A, "POST", `/api/lessons/${l!.id}/drop`);
    expect(dropped.json.lesson.status).toBe("dropped");
    expect((await db.select().from(skill).where(eq(skill.id, made.id)))[0]!.status).toBe(
      "archived",
    );
    expect((await call(A, "POST", `/api/lessons/${l!.id}/restore`)).json.lesson.status).toBe(
      "kept",
    );
    expect((await db.select().from(skill).where(eq(skill.id, made.id)))[0]!.status).toBe("active");
    // It is a skill: its words are edited on the Skills page.
    expect((await call(A, "PATCH", `/api/lessons/${l!.id}`, { text: "New words." })).status).toBe(
      400,
    );
  });
});

suite("the suggestions API", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const findings = createFindings(db, { lessons, memory });
  const batch = createBatch(db, { lessons, cli: async () => "{}" });
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
    lessons: {
      access,
      lessons,
      batch,
      findings,
      progress: createProgress(db),
      workflow: fakeWorkflow,
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string | null, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(as ? { "x-test-user": as } : {}),
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const U = `lrs-a-${uuidv7()}`;
  const V = `lrs-b-${uuidv7()}`;
  beforeAll(async () => {
    const now = new Date();
    for (const id of [U, V]) {
      await db.insert(user).values({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .insert(membership)
        .values({ userId: id, status: "active", joinedAt: now, updatedAt: now });
    }
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [U, V]);
    await db.$client.end();
  });

  test("the weekly check is created with a POST, for a signed-in person only", async () => {
    expect((await call(null, "POST", "/api/learning/workflow-template")).status).toBe(401);
    const r = await call(U, "POST", "/api/learning/workflow-template");
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: "wf-1", created: true });
  });

  test("list, accept and dismiss: each is the person's own, and what is already dealt with is refused", async () => {
    const a = (
      await memory.write(
        U,
        { slug: "dup-a", title: "Billing export", content: "x", type: "owner" },
        { by: "user" },
      )
    ).page;
    const b = (
      await memory.write(
        U,
        { slug: "dup-b", title: "Billing export again", content: "y", type: "owner" },
        { by: "user" },
      )
    ).page;
    const made = (await findings.create(U, {
      kind: "duplicate",
      refs: [
        { kind: "memory", id: a.id },
        { kind: "memory", id: b.id },
      ],
      summary: "Two say the same.",
    }))!;
    const other = (
      await memory.write(
        U,
        { slug: "gone-c", title: "Old thing", content: "z", type: "owner" },
        { by: "user" },
      )
    ).page;
    const second = (await findings.create(U, {
      kind: "unused",
      refs: [{ kind: "memory", id: other.id }],
      summary: "Nobody uses it.",
    }))!;

    const list = await call(U, "GET", "/api/learning/findings");
    expect(list.status).toBe(200);
    expect(list.json.findings.map((f: { id: string }) => f.id).sort()).toEqual(
      [made.id, second.id].sort(),
    );
    expect(
      list.json.findings
        .find((f: { id: string }) => f.id === made.id)
        .refs.map((r: { slug: string }) => r.slug),
    ).toEqual(["dup-a", "dup-b"]);
    expect((await call(V, "GET", "/api/learning/findings")).json.findings).toEqual([]);
    expect((await call(V, "POST", `/api/learning/findings/${made.id}/accept`)).status).toBe(404);
    expect((await call(null, "GET", "/api/learning/findings")).status).toBe(401);
    expect((await call(U, "GET", "/api/learning/findings?status=maybe")).status).toBe(400);

    expect((await call(U, "POST", `/api/learning/findings/${made.id}/accept`)).json).toEqual({
      id: made.id,
      status: "accepted",
    });
    expect((await memory.read(U, "dup-b"))!.page.status).toBe("archived");
    expect((await call(U, "POST", `/api/learning/findings/${made.id}/accept`)).status).toBe(400); // already dealt with
    expect((await call(U, "POST", `/api/learning/findings/${second.id}/dismiss`)).json).toEqual({
      id: second.id,
      status: "dismissed",
    });
    expect((await memory.read(U, "gone-c"))!.page.status).toBe("current"); // dismissing changes nothing
    expect(
      (await call(U, "GET", "/api/learning/findings?status=dismissed")).json.findings,
    ).toHaveLength(1);
    expect((await call(U, "GET", "/api/learning/findings")).json.findings).toEqual([]);
  });
});
