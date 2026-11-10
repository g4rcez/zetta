import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createFeaturesService } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`ract-a-${uuidv7()}`];
const [A] = ids as [string];

suite("a routine stays on: created active, and only a missing account blocks it", () => {
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
  const features = createFeaturesService(db);
  // The state of the person's own binding for each account the bot needs, as connections.status reports it.
  let bound: Record<string, "ready" | "missing" | "unusable"> = {};
  let finishRun: ((how?: { ok: boolean; status: string; error?: string }) => void) | undefined;
  const turns: string[] = [];
  const stopped: string[] = [];
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: createChatService(db) },
    features: { access, features },
    webOrigin: "http://web.test",
    desktopOrigins: [],
    drain: () => {},
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await app.handle(
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
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const sql = (q: string, p: unknown[] = []) => db.$client.query(q, p);
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
    // Same shape as services.ts: a run is a chat turn as the owner, and the account check reads the owner's own bindings.
    features.routines.useChat(async (_userId, _conversationId, prompt) => {
      turns.push(prompt);
      const how = await new Promise<{ ok: boolean; status: string; error?: string } | undefined>(
        (done) => (finishRun = done),
      );
      finishRun = undefined;
      return {
        ok: how?.ok ?? true,
        text: "done",
        status: how?.status ?? "complete",
        error: how?.error,
      };
    });
    features.routines.useStop(async (_userId, conversationId) => {
      stopped.push(conversationId);
      finishRun?.({ ok: false, status: "cancelled" });
    });
    features.routines.useAccounts(async (_userId, botId) => {
      const { rows } = await sql("select required_connections as r from bot where id = $1", [
        botId,
      ]);
      return (rows[0].r as { key: string }[]).map((r) => ({
        key: r.key,
        status: bound[r.key] ?? "missing",
      }));
    });
  });
  afterAll(async () => {
    features.routines.useChat(undefined as never);
    features.routines.useStop(undefined as never);
    features.routines.useAccounts(undefined as never);
    await cleanupTestUsers(db, ids);
  });

  const newBot = async (name: string, accounts: string[] = []) => {
    const b = (await call("POST", "/api/bots", { name })).json.bot as { id: string };
    await sql("update bot set onboarded = true, required_connections = $2::jsonb where id = $1", [
      b.id,
      JSON.stringify(accounts.map((key) => ({ key, provider: "github" }))),
    ]);
    return b;
  };
  const routine = (botId: string, extra: object = {}) =>
    call("POST", "/api/routines", {
      botId,
      title: "Digest",
      prompt: "Summarize",
      timezone: "UTC",
      everyMinutes: 60,
      ...extra,
    });

  test('created with activate "on", a ready routine is scheduled at once', async () => {
    const b = await newBot("Ready");
    const r = (await routine(b.id, { activate: "on" })).json.routine;
    expect(r).toMatchObject({ paused: false, status: "scheduled" });
    expect(new Date(r.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("without it a routine is created paused, as before", async () => {
    const b = await newBot("Careful");
    const r = (await routine(b.id)).json.routine;
    expect(r).toMatchObject({ paused: true, nextRunAt: null });
  });

  test("a bot whose account is connected can run routines; only a missing account blocks them", async () => {
    const b = await newBot("Needs GitHub", ["GITHUB"]);
    bound = {};
    // Not connected: created, but paused, and the checklist names the account.
    const waiting = (await routine(b.id, { activate: "on" })).json.routine;
    expect(waiting.paused).toBe(true);
    const off = await call("POST", `/api/routines/${waiting.id}/paused`, { paused: false });
    expect(off.status).toBe(409);
    expect(JSON.stringify(off.json)).toContain("GITHUB");
    // Connected: the same routine activates, and a new one is switched on when it is created.
    bound = { GITHUB: "ready" };
    const on = await call("POST", `/api/routines/${waiting.id}/paused`, { paused: false });
    expect(on.status).toBe(200);
    expect(on.json.routine.nextRunAt).toBeTruthy();
    expect((await routine(b.id, { activate: "on" })).json.routine.paused).toBe(false);
    // A binding that stopped working (revoked, expired) blocks again and is named.
    bound = { GITHUB: "unusable" };
    expect((await routine(b.id, { activate: "on" })).json.routine.paused).toBe(true);
  });

  test("of two accounts, only the one that is not connected is named", async () => {
    const b = await newBot("Two accounts", ["GITHUB", "LINEAR"]);
    bound = { GITHUB: "ready" };
    const r = (await routine(b.id)).json.routine;
    const off = await call("POST", `/api/routines/${r.id}/paused`, { paused: false });
    expect(off.status).toBe(409);
    expect(JSON.stringify(off.json.error ?? off.json)).toContain("LINEAR");
    expect(JSON.stringify(off.json.error ?? off.json)).not.toContain("GITHUB");
  });

  test("a workflow routine still fails closed for a bot that needs accounts", async () => {
    const b = await newBot("Flow bot", ["GITHUB"]);
    bound = { GITHUB: "ready" };
    const r = (await routine(b.id)).json.routine;
    // A workflow run has no account injection, so the routine's own bot is checked the strict way even with the account connected.
    const flowBot = await newBot("Plain");
    const flow = await call("POST", "/api/workflows", {
      name: "One step",
      graph: {
        start: "a",
        nodes: {
          a: { type: "prompt", botId: flowBot.id, template: "go {{input}}", next: "z" },
          z: { type: "end" },
        },
      },
    });
    expect(flow.status).toBe(201);
    const flowId = flow.json.workflow.id as string;
    await sql("update routine set workflow_id = $2 where id = $1", [r.id, flowId]);
    const off = await call("POST", `/api/routines/${r.id}/paused`, { paused: false });
    expect(off.status).toBe(409);
    expect(JSON.stringify(off.json)).toContain("GITHUB");
  });

  test('"Run now" with wait "start" answers before the bot is done; the default waits for the run', async () => {
    const b = await newBot("Runner");
    const r = (await routine(b.id, { activate: "on" })).json.routine;
    turns.length = 0;
    const started = await call("POST", `/api/routines/${r.id}/run`, {
      requestKey: `k-${uuidv7()}`,
      wait: "start",
    });
    expect(started.status).toBe(200);
    expect(started.json.run.status).toBe("running");
    for (let i = 0; i < 100 && !finishRun; i++) await Bun.sleep(10);
    expect(turns).toHaveLength(1);
    finishRun!();
    let last: { status: string } | undefined;
    for (let i = 0; i < 100; i++) {
      last = (await call("GET", `/api/routines/${r.id}/runs`)).json.runs[0];
      if (last?.status === "succeeded") break;
      await Bun.sleep(10);
    }
    expect(last?.status).toBe("succeeded");
    // Run by hand while switched on: the routine stays scheduled.
    const { rows } = await sql("select paused, status from routine where id = $1", [r.id]);
    expect(rows[0]).toMatchObject({ paused: false, status: "scheduled" });
  });

  const waitFor = async (check: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await Bun.sleep(10);
    }
    throw new Error("timed out");
  };
  /** `runDue` runs every due routine in the database: leave only this one on, so earlier tests' routines stay out of it. */
  const only = (rid: string) =>
    sql(
      "update routine set paused = true, next_run_at = null where owner_user_id = $1 and id <> $2",
      [A, rid],
    );
  const runsOf = async (rid: string) =>
    (await call("GET", `/api/routines/${rid}/runs`)).json.runs as {
      id: string;
      status: string;
      reasonCode: string | null;
    }[];
  const nextRunAt = async (rid: string) =>
    new Date(
      (await sql("select next_run_at from routine where id = $1", [rid])).rows[0].next_run_at,
    );

  test('"Skip next" records the next occurrence as skipped, and the one after it runs', async () => {
    const b = await newBot("Skipper");
    const r = (await routine(b.id, { activate: "on" })).json.routine;
    await only(r.id);
    expect((await call("POST", `/api/routines/${r.id}/skip-next`)).status).toBe(200);
    const first = await nextRunAt(r.id);
    turns.length = 0;
    expect(await features.routines.runDue(new Date(first.getTime() + 1000))).toBe(0);
    expect(turns).toHaveLength(0);
    expect((await runsOf(r.id))[0]).toMatchObject({
      status: "skipped",
      reasonCode: "skipped_by_you",
    });
    const second = await nextRunAt(r.id);
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    void features.routines.runDue(new Date(second.getTime() + 1000));
    await waitFor(() => turns.length === 1);
    finishRun!();
    await waitFor(async () => (await runsOf(r.id))[0]?.status === "succeeded");
  });

  test("an occurrence that comes while the last run still works is skipped, not piled up", async () => {
    const b = await newBot("Overlap");
    const r = (await routine(b.id, { activate: "on" })).json.routine;
    await only(r.id);
    turns.length = 0;
    await call("POST", `/api/routines/${r.id}/run`, { requestKey: `k-${uuidv7()}`, wait: "start" });
    await waitFor(() => turns.length === 1);
    const due = await nextRunAt(r.id);
    expect(await features.routines.runDue(new Date(due.getTime() + 1000))).toBe(0);
    expect(turns).toHaveLength(1);
    expect((await runsOf(r.id)).map((x) => [x.status, x.reasonCode])).toContainEqual([
      "skipped",
      "still_running",
    ]);
    finishRun!();
    await waitFor(async () => (await runsOf(r.id)).some((x) => x.status === "succeeded"));
  });

  test("Stop on a running run ends it as cancelled, stops its chat, and does not retry it or pause the routine", async () => {
    const b = await newBot("Stoppable");
    const r = (await routine(b.id, { activate: "on" })).json.routine;
    await only(r.id);
    stopped.length = 0;
    const run = (
      await call("POST", `/api/routines/${r.id}/run`, {
        requestKey: `k-${uuidv7()}`,
        wait: "start",
      })
    ).json.run;
    await waitFor(() => Boolean(finishRun));
    const res = await call("POST", `/api/routine-runs/${run.id}/stop`);
    expect(res.json.run.status).toBe("cancelled");
    expect(stopped).toHaveLength(1);
    await waitFor(async () => {
      const { rows } = await sql("select status, retry_at from routine_run where id = $1", [
        run.id,
      ]);
      return rows[0].status === "cancelled" && rows[0].retry_at === null;
    });
    const { rows } = await sql("select paused, status from routine where id = $1", [r.id]);
    expect(rows[0]).toMatchObject({ paused: false });
  });

  test("after its limit of failures in a row a routine pauses itself with one card; a success in between resets the count", async () => {
    const b = await newBot("Flaky");
    const r = (await routine(b.id, { activate: "on", maxFailures: 2 })).json.routine;
    await only(r.id);
    const fail = async () => {
      await call("POST", `/api/routines/${r.id}/run`, {
        requestKey: `k-${uuidv7()}`,
        wait: "start",
      });
      await waitFor(() => Boolean(finishRun));
      finishRun!({ ok: false, status: "failed", error: "auth_required" });
      await waitFor(async () => (await runsOf(r.id))[0]?.status === "failed");
    };
    await fail();
    // A success resets the count.
    await call("POST", `/api/routines/${r.id}/run`, { requestKey: `k-${uuidv7()}`, wait: "start" });
    await waitFor(() => Boolean(finishRun));
    finishRun!();
    await waitFor(async () => (await runsOf(r.id))[0]?.status === "succeeded");
    await fail();
    let row = (await sql("select paused, failures from routine where id = $1", [r.id])).rows[0];
    expect(row).toMatchObject({ paused: false, failures: 1 });
    await fail();
    row = (await sql("select paused, status, status_reason from routine where id = $1", [r.id]))
      .rows[0];
    expect(row).toMatchObject({
      paused: true,
      status: "blocked",
      status_reason: "too_many_failures",
    });
    const cards = await sql(
      "select title from attention_item where owner_user_id = $1 and source_key = $2 and status = 'open'",
      [A, `routine:${r.id}:failed`],
    );
    expect(cards.rows.map((c) => c.title)).toEqual([
      'Routine "Digest" paused after 2 failures in a row',
    ]);
  });

  test("a routine paused because its account was missing switches itself back on once the account is connected", async () => {
    const b = await newBot("Comes back", ["NOTION"]);
    bound = { NOTION: "ready" };
    const r = (await routine(b.id, { activate: "on" })).json.routine;
    await only(r.id);
    expect(r.paused).toBe(false);
    // The account goes away: the next occurrence is blocked and the routine pauses.
    bound = {};
    void features.routines.runDue(new Date((await nextRunAt(r.id)).getTime() + 1000));
    await waitFor(async () => {
      const { rows } = await sql("select status from routine where id = $1", [r.id]);
      return rows[0].status === "blocked";
    });
    expect(await features.routines.reviveBlocked()).toBe(0);
    bound = { NOTION: "ready" };
    expect(await features.routines.reviveBlocked()).toBe(1);
    const { rows } = await sql("select paused, status from routine where id = $1", [r.id]);
    expect(rows[0]).toMatchObject({ paused: false, status: "scheduled" });
  });
});
