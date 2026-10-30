import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { conversation } from "@zetta/db/schema/chat";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { createLoopDriver, createLoopStore, type LoopTurn } from "./loops";
import { createChatService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const A = `loop-a-${uuidv7()}`;

suite("goal loops that retry failed steps against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const loops = createLoopStore(db);
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
  const fakeRun = Object.assign(async () => ({ text: "ok", stopped: false }), {
    stream: async function* () {
      yield "ok";
    },
  });
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: createChatService(db, fakeRun as never) },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  let botId = "";
  /** What the next steps do, in order; the last one repeats. Every call records its prompt. */
  let script: LoopTurn[] = [];
  const prompts: string[] = [];
  const driver = createLoopDriver(loops, async (loop, label, prompt, key) => {
    prompts.push(prompt);
    const step = script.length > 1 ? script.shift()! : script[0]!;
    return step(loop, label, prompt, key);
  });
  loops.onStart = driver.kick;

  const newLoop = async (request?: string) => {
    const [conv] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId, title: "loop test" })
      .returning();
    return loops.start(A, {
      conversationId: conv!.id,
      botId,
      goal: "Collect the report",
      doneWhen: "The report is saved",
      ...(request ? { request } : {}),
    });
  };
  const waitFor = async <T>(read: () => Promise<T>, ok: (v: T) => boolean) => {
    for (let i = 0; i < 100; i++) {
      const v = await read();
      if (ok(v)) return v;
      await Bun.sleep(30);
    }
    return read();
  };
  const row = (id: string) => () => loops.get(id).then((l) => l!);
  const due = (id: string) =>
    db.$client.query("update goal_loop set retry_at = now() - interval '1 second' where id = $1", [
      id,
    ]);

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
    const created = await app.handle(
      new Request("http://localhost/api/bots", {
        method: "POST",
        headers: {
          "x-test-user": A,
          origin: "http://web.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "LoopBot" }),
      }),
    );
    botId = ((await created.json()) as { bot: { id: string } }).bot.id;
  });
  afterAll(async () => {
    await db.$client.query("delete from goal_loop where owner_user_id = $1", [A]);
    await db.$client.query("delete from conversation where owner_user_id = $1", [A]);
    await cleanupTestUsers(db, [A]);
  });

  test("a step that times out waits, then runs again with the error in its prompt and finishes", async () => {
    prompts.length = 0;
    script = [
      async () => ({ status: "failed", error: "timeout", detail: "took too long" }),
      async (loop) => {
        await loops.report(loop.id, "done", "report saved");
        return { status: "complete" };
      },
    ];
    const loop = await newLoop();
    const waiting = await waitFor(row(loop.id), (l) => l.failures === 1);
    expect(waiting.status).toBe("running");
    expect(waiting.iterations).toBe(1);
    expect(waiting.lastError).toBe("timeout: took too long");
    expect(waiting.reason).toBe("Retrying: the bot took too long");
    expect(waiting.retryAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);

    await driver.tick(); // the wait is not over: nothing runs
    expect(prompts).toHaveLength(1);

    await due(loop.id);
    await driver.tick();
    const done = await waitFor(row(loop.id), (l) => l.status === "done");
    expect(done).toMatchObject({ failures: 0, retryAt: null, lastError: null, iterations: 2 });
    expect(prompts[1]).toContain("Your previous step failed: timeout: took too long");
  });

  test("a bot that is not signed in pauses the loop at once and says why", async () => {
    script = [async () => ({ status: "failed", error: "auth_required" })];
    const loop = await newLoop();
    const paused = await waitFor(row(loop.id), (l) => l.status === "paused");
    expect(paused.reason).toBe("the bot is not signed in, or an account it needs is not connected");
    expect(paused.failures).toBe(1);
  });

  test("a usage limit waits at least 15 minutes", async () => {
    script = [async () => ({ status: "failed", error: "quota" })];
    const loop = await newLoop();
    const waiting = await waitFor(row(loop.id), (l) => l.failures === 1);
    expect(waiting.status).toBe("running");
    expect(waiting.reason).toBe("Retrying: the usage limit is reached");
    expect(waiting.retryAt!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    await loops.setStatus(A, loop.id, "cancelled");
  });

  test("the eleventh failure in a row pauses the loop", async () => {
    script = [async () => ({ status: "failed", error: "timeout" })];
    const loop = await newLoop();
    for (let n = 1; n <= 10; n++) {
      await waitFor(row(loop.id), (l) => l.failures === n);
      await due(loop.id);
      await driver.tick();
    }
    const paused = await waitFor(row(loop.id), (l) => l.status === "paused");
    expect(paused.failures).toBe(11);
    expect(paused.reason).toBe("failed 11 times in a row: the bot took too long");
  });

  test("a lesson the bot reports is in the prompt of the next step", async () => {
    prompts.length = 0;
    script = [
      async (loop) => {
        await loops.report(loop.id, "progress", "found the API", "the export API needs ?v=2");
        return { status: "complete" };
      },
      async (loop) => {
        await loops.report(loop.id, "done", "saved");
        return { status: "complete" };
      },
    ];
    const loop = await newLoop();
    await waitFor(row(loop.id), (l) => l.status === "done");
    expect(prompts[1]).toContain("Lessons so far:\n- the export API needs ?v=2");
  });

  test("every step reads the user's request", async () => {
    prompts.length = 0;
    script = [
      async (loop) => {
        await loops.report(loop.id, "progress", "read r/neovim");
        return { status: "complete" };
      },
      async (loop) => {
        await loops.report(loop.id, "done", "saved");
        return { status: "complete" };
      },
    ];
    const loop = await newLoop("Top posts of r/neovim today. Use only Reddit.");
    await waitFor(row(loop.id), (l) => l.status === "done");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Top posts of r/neovim today. Use only Reddit.");
    expect(prompts[1]).toContain("Top posts of r/neovim today. Use only Reddit.");
  });

  test("a refused goal_done keeps the loop going with the reason, counts as a stall, and the stall limit pauses it", async () => {
    prompts.length = 0;
    let n = 0;
    script = [
      async (loop) => {
        n++;
        // The bot reports new progress and then claims done; the check refuses it every time.
        await loops.report(loop.id, "progress", `digest draft ${n}`);
        await loops.refuseDone(loop.id, "the posts came from Arctic Shift, not Reddit");
        return { status: "complete" };
      },
    ];
    const loop = await newLoop("Top posts of r/neovim today. Use only Reddit.");
    const paused = await waitFor(row(loop.id), (l) => l.status === "paused");
    expect(paused.reason).toBe("no new progress in the last 5 steps");
    expect(paused.stalls).toBe(5);
    expect(prompts[1]).toContain(
      "Your previous step failed: step 1: your goal_done was refused by the done check: the posts came from Arctic Shift, not Reddit",
    );
    expect(prompts[2]).toContain(
      "Your previous step failed: step 2: your goal_done was refused by the done check: the posts came from Arctic Shift, not Reddit",
    );
  });

  test("resuming a paused loop clears its failures", async () => {
    script = [async () => ({ status: "failed", error: "auth_required" })];
    const loop = await newLoop();
    await waitFor(row(loop.id), (l) => l.status === "paused");
    script = [async () => ({ status: "failed", error: "timeout" })];
    await loops.setStatus(A, loop.id, "running");
    const again = await waitFor(row(loop.id), (l) => l.lastError === "timeout");
    expect(again.failures).toBe(1);
    expect(again.status).toBe("running");
    await loops.setStatus(A, loop.id, "cancelled");
  });
});
