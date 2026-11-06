import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { HarnessError } from "../chat/harness";
import { createTurnRunner } from "../chat/pipeline";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { agentsState } from "./agents-state";
import { createPreferenceStore } from "./store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`pause-a-${uuidv7()}`, `pause-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("pause everything", () => {
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
  /** Turns that reached the harness. A paused person's turn must never get here. */
  const started: string[] = [];
  /** While set, a turn waits for its abort signal, the way a long run waits for work. */
  const hold = { on: false };
  const cli = async function* (opts: { prompt: string; signal?: AbortSignal }) {
    started.push(opts.prompt);
    if (hold.on) {
      yield "working ";
      await new Promise<void>((resolve) => {
        opts.signal?.addEventListener("abort", () => resolve());
        setTimeout(resolve, 8_000);
      });
      if (opts.signal?.aborted) throw new HarnessError("cancelled");
    }
    yield "ok";
  };
  const chat = createChatService(
    db,
    createTurnRunner(db, (async () => "x") as never, cli as never),
  );
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat },
    preferences: { access, preferences: createPreferenceStore(db) },
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
    const text = await r.text();
    return { status: r.status, text, json: safeJson(text) as any };
  };
  const safeJson = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return {};
    }
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

  const newChat = async (as: string) => {
    const bot = (await call(as, "POST", "/api/bots", { name: "Napper", harness: "pi" })).json.bot;
    const conversation = (await call(as, "POST", "/api/conversations", { botId: bot.id })).json
      .conversation;
    return conversation.id as string;
  };
  const say = (as: string, conversationId: string) =>
    call(as, "POST", `/api/conversations/${conversationId}/stream`, { content: "go" });

  test("agents run by default, and the state cannot be changed through the preferences patch", async () => {
    expect((await call(A, "GET", "/api/preferences")).json.preferences.agentsState).toBe("running");
    // The state has its own route, which also stops running turns: the generic patch must not be a way around it.
    const patched = await call(A, "PATCH", "/api/preferences", { agentsState: "paused" });
    expect(patched.status).toBe(400);
    expect(await agentsState(db, A)).toBe("running");
  });

  test("a paused person's new turn answers 409 and never reaches the harness; resuming brings it back", async () => {
    const conversationId = await newChat(A);
    const paused = await call(A, "PUT", "/api/agents/state", { state: "paused" });
    expect(paused.status).toBe(200);
    expect(paused.json.agentsState).toBe("paused");
    expect((await call(A, "GET", "/api/preferences")).json.preferences.agentsState).toBe("paused");
    const before = started.length;
    const blocked = await say(A, conversationId);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error?.code ?? blocked.json.code).toBe("AGENTS_PAUSED");
    expect(started.length).toBe(before);
    // Only the person who paused is affected.
    const otherChat = await newChat(B);
    expect((await say(B, otherChat)).status).toBe(200);
    expect(started.length).toBe(before + 1);
    const resumed = await call(A, "PUT", "/api/agents/state", { state: "running" });
    expect(resumed.json.agentsState).toBe("running");
    expect((await say(A, conversationId)).status).toBe(200);
  });

  test("pausing stops a turn that is running now, as a stop and not as a failure", async () => {
    const actor = (await access.requireActive(new Headers({ "x-test-user": A })))!;
    const conversationId = await newChat(A);
    hold.on = true;
    try {
      const seen = started.length;
      const { rec } = await chat.startTurn(actor, conversationId, { content: "long job" });
      // Wait until the harness has the turn and is holding it.
      for (let i = 0; i < 400 && started.length === seen; i++) await Bun.sleep(5);
      expect(started.length).toBe(seen + 1);
      expect(rec.done).toBe(false);
      const result = await chat.setAgentsState(actor, "paused");
      expect(result.stopped).toBeGreaterThanOrEqual(1);
      await rec.finished;
      expect(rec.abort.signal.aborted).toBe(true);
      const rows = (
        await db.$client.query(
          "select status from message where conversation_id = $1 and role = 'assistant' order by created_at desc limit 1",
          [conversationId],
        )
      ).rows as { status: string }[];
      expect(rows[0]?.status).not.toBe("complete");
      expect(rows[0]?.status).not.toBe("failed");
    } finally {
      hold.on = false;
      await chat.setAgentsState(actor, "running");
    }
  });

  test("a message that waited in the queue is not failed by the pause", async () => {
    const actor = (await access.requireActive(new Headers({ "x-test-user": A })))!;
    const conversationId = await newChat(A);
    await chat.setAgentsState(actor, "paused");
    try {
      const queued = await call(A, "POST", `/api/conversations/${conversationId}/queue`, {
        content: "answer me later",
      });
      expect(queued.status).toBe(201);
      await chat.drainQueues();
      const rows = (
        await db.$client.query("select status from chat_queue where conversation_id = $1", [
          conversationId,
        ])
      ).rows as { status: string }[];
      expect(rows.map((r) => r.status)).toEqual(["pending"]);
    } finally {
      await chat.setAgentsState(actor, "running");
    }
    // Resuming answers it: the queue row is removed once its turn has ended. Waiting here also keeps the turn's audit rows from
    // arriving after the cleanup.
    let left = 1;
    for (let i = 0; i < 200 && left > 0; i++) {
      left = (
        await db.$client.query(
          "select count(*)::int as n from chat_queue where conversation_id = $1",
          [conversationId],
        )
      ).rows[0].n as number;
      if (left > 0) await Bun.sleep(25);
    }
    expect(left).toBe(0);
    await Bun.sleep(100);
  });
});
