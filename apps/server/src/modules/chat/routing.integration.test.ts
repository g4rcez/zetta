import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createRouting } from "./routing";
import { createTurnRunner } from "./pipeline";
import { bot } from "@zetta/db/schema/chat";
import { eq } from "@zetta/db/query";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`chat-route-a-${uuidv7()}`, `chat-route-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("decision routing against compose postgres", () => {
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
  let next: { choice: string | null; uncertain?: boolean; confidence?: number } | Error = {
    choice: "billing",
    confidence: 0.9,
  };
  const decisions = {
    status: () => ({ state: "ready", model: "laya" }),
    warm: async () => {},
    decide: async () => ({}),
    close: async () => {},
    choose: async () => {
      if (next instanceof Error) throw next;
      return {
        choice: next.choice,
        uncertain: next.uncertain ?? next.choice === null,
        probabilities: {},
        confidence: next.confidence ?? 0.9,
        provenance: { model: "laya", at: "", ms: 1 },
      };
    },
  };
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: {
      access,
      chat: createChatService(db, undefined, undefined, undefined, decisions as never),
    },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          "x-test-user": as,
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

  test("options map to respond / ask_user / stop / delegate; uncertain and failures fall back to a normal answer", async () => {
    const front = (await call(A, "POST", "/api/bots", { name: "Front" })).json.bot.id as string;
    const billing = (await call(A, "POST", "/api/bots", { name: "Billing" })).json.bot.id as string;
    await db.$client.query("update bot set onboarded = true where id = $1", [billing]);
    const cfg = {
      enabled: true,
      question: "What is this about?",
      minConfidencePct: 60,
      options: [
        {
          label: "billing",
          description: "payments and refunds",
          action: "delegate",
          targetBotId: billing,
        },
        {
          label: "unclear",
          description: "not enough information",
          action: "ask_user",
          reply: "Which invoice?",
        },
        {
          label: "abuse",
          description: "abusive content",
          action: "stop",
          reply: "I can't help with that.",
        },
        { label: "general", description: "anything else", action: "respond" },
      ],
    };
    expect((await call(B, "PUT", `/api/bots/${front}/decision`, cfg)).status).toBe(404);
    expect(
      (
        await call(A, "PUT", `/api/bots/${front}/decision`, {
          ...cfg,
          options: [{ ...cfg.options[0], targetBotId: uuidv7() }, cfg.options[1]],
        })
      ).status,
    ).toBe(404); // foreign/unknown target
    expect((await call(A, "PUT", `/api/bots/${front}/decision`, cfg)).status).toBe(200);
    const conv = (await call(A, "POST", "/api/conversations", { botId: front })).json.conversation
      .id as string;
    const say = (t: string) =>
      call(A, "POST", `/api/conversations/${conv}/messages`, { content: t });

    next = { choice: "billing" };
    const d = await say("refund please");
    // The target never answers in this chat: the front bot says it passed the work on (the target answers in a room).
    expect(d.json.assistant.botId).toBe(front);
    expect(d.json.assistant.content).toContain("Billing");
    expect(d.json.assistant.meta.decision.action).toBe("delegate");
    next = { choice: "unclear" };
    expect((await say("help")).json.assistant.content).toBe("Which invoice?");
    next = { choice: "abuse" };
    expect((await say("rude")).json.assistant.content).toBe("I can't help with that.");
    next = { choice: "general" };
    expect((await say("hello")).json.assistant.content).toContain("Front received");
    next = { choice: null, uncertain: true, confidence: 0.4 };
    expect((await say("hmm")).json.assistant.content).toContain("Front received"); // uncertain -> normal reply
    next = new Error("model down");
    expect((await say("again")).json.assistant.content).toContain("Front received"); // unavailable -> normal reply (fails open)
    next = { choice: "abuse" };
    expect(
      (await call(A, "POST", `/api/bots/${front}/decision/preview`, { text: "x" })).json.route,
    ).toMatchObject({ action: "stop" });
    expect(
      (await call(B, "POST", `/api/bots/${front}/decision/preview`, { text: "x" })).status,
    ).toBe(404);
  });

  test("a decision-only bot sends the chosen option's reply and never runs an AI", async () => {
    const sorter = (
      await call(A, "POST", "/api/bots", { name: "Sorter", harness: "decision", model: "laya" })
    ).json.bot.id as string;
    const cfg = {
      enabled: false,
      question: "What is this about?",
      minConfidencePct: 60,
      options: [
        { label: "hours", description: "opening hours", action: "respond", reply: "We open at 9." },
        {
          label: "abuse",
          description: "abusive content",
          action: "stop",
          reply: "I can't help with that.",
        },
      ],
    };
    const noReply = { ...cfg, options: [{ ...cfg.options[0], reply: undefined }, cfg.options[1]] };
    expect((await call(A, "PUT", `/api/bots/${sorter}/decision`, noReply)).status).toBe(400);
    expect((await call(A, "PUT", `/api/bots/${sorter}/decision`, cfg)).status).toBe(200);
    const conv = (await call(A, "POST", "/api/conversations", { botId: sorter })).json.conversation
      .id as string;
    const say = (t: string) =>
      call(A, "POST", `/api/conversations/${conv}/messages`, { content: t });

    next = { choice: "hours" };
    expect((await say("when do you open?")).json.assistant.content).toBe("We open at 9.");
    next = { choice: "abuse" };
    expect((await say("rude")).json.assistant.content).toBe("I can't help with that.");
    next = { choice: null, uncertain: true, confidence: 0.4 };
    expect((await say("hmm")).json.assistant.content).toBe(
      "I'm not sure how to help with that. Could you rephrase it?",
    );
    next = new Error("model down");
    expect((await say("again")).json.assistant.content).toBe(
      "I'm not sure how to help with that. Could you rephrase it?",
    );

    // The model "jev" asks Jev, not Laya.
    const jev = {
      choose: async () => ({
        choice: "hours",
        uncertain: false,
        probabilities: {},
        confidence: 0.9,
        provenance: { model: "jev", at: "", ms: 1 },
      }),
    };
    const laya = {
      choose: async () => {
        throw new Error("laya must not run");
      },
    };
    expect(
      await createRouting(db, laya as never, jev as never).reply(
        { id: sorter, harness: "decision", model: "jev" },
        "when do you open?",
        { userId: A, isAdmin: false },
      ),
    ).toBe("We open at 9.");

    // A turn through the shared runner (mention, routine, workflow) answers the same way and calls no AI.
    const [row] = await db.select().from(bot).where(eq(bot.id, sorter));
    const noAi = async () => {
      throw new Error("no AI for a decision bot");
    };
    const run = createTurnRunner(
      db,
      noAi as never,
      noAi as never,
      undefined,
      undefined,
      (b, t, userId) =>
        createRouting(db, laya as never, jev as never).reply(
          { id: b.id, harness: b.harness, model: "jev" },
          t,
          userId ? { userId, isAdmin: false } : undefined,
        ),
    );
    expect(await run({ userId: A, bot: row!, history: [], prompt: "when do you open?" })).toEqual({
      text: "We open at 9.",
      stopped: false,
    });
  });
});
