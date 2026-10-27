import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { createIdentityAccess } from "../identity/access";
import { createFeaturesService } from "./service";
import { computeNextRun, nextDailyRun, previewRuns } from "./schedule";
import { executeGraph, graphSchema } from "./workflow";

describe("schedule policy", () => {
  test("DST gap skips the day, fold runs once", () => {
    // 2026-03-08 02:30 does not exist in New York (spring forward at 02:00 -> 03:00): next run is the following day.
    const afterGap = nextDailyRun(new Date("2026-03-08T05:00:00Z"), "America/New_York", "02:30");
    expect(afterGap.toISOString()).toBe("2026-03-09T06:30:00.000Z");
    // 2026-11-01 01:30 happens twice in New York: only the first (EDT, 05:30Z) is returned.
    expect(
      nextDailyRun(new Date("2026-11-01T04:00:00Z"), "America/New_York", "01:30").toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      nextDailyRun(new Date("2026-11-01T05:30:00Z"), "America/New_York", "01:30").toISOString(),
    ).toBe("2026-11-02T06:30:00.000Z");
  });
  test("preview lists upcoming occurrences; once-routines have exactly one", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(
      previewRuns(now, { timezone: "UTC", dailyAt: "09:00", everyMinutes: null }, 3).map((d) =>
        d.toISOString(),
      ),
    ).toEqual(["2026-06-01T09:00:00.000Z", "2026-06-02T09:00:00.000Z", "2026-06-03T09:00:00.000Z"]);
    expect(
      previewRuns(
        now,
        {
          timezone: "UTC",
          dailyAt: null,
          everyMinutes: null,
          kind: "once",
          onceAt: new Date("2026-06-05T00:00:00Z"),
        },
        3,
      ),
    ).toHaveLength(1);
    expect(
      computeNextRun(now, { timezone: "UTC", dailyAt: null, everyMinutes: 30 })!.toISOString(),
    ).toBe("2026-06-01T00:30:00.000Z");
  });
});

describe("workflow graph validation", () => {
  const bot = crypto.randomUUID();
  test("rejects cycles, unreachable steps, missing end and dangling edges", () => {
    const bad = (nodes: unknown, start = "a") => graphSchema.safeParse({ start, nodes }).success;
    expect(
      bad({ a: { type: "prompt", botId: bot, template: "x", next: "a" }, e: { type: "end" } }),
    ).toBe(false); // cycle + unreachable
    expect(
      bad({
        a: { type: "prompt", botId: bot, template: "x", next: "b" },
        b: { type: "prompt", botId: bot, template: "y" },
      }),
    ).toBe(false); // no end
    expect(
      bad({ a: { type: "prompt", botId: bot, template: "x", next: "zz" }, e: { type: "end" } }),
    ).toBe(false);
    expect(
      bad({
        a: { type: "prompt", botId: bot, template: "x", next: "e" },
        e: { type: "end" },
        orphan: { type: "end" },
      }),
    ).toBe(false);
    expect(
      bad({ a: { type: "prompt", botId: bot, template: "x", next: "e" }, e: { type: "end" } }),
    ).toBe(true);
  });
  test("executor reports progress per step and honours cancellation", async () => {
    const g = graphSchema.parse({
      start: "a",
      nodes: {
        a: { type: "prompt", botId: bot, template: "x", next: "b" },
        b: { type: "prompt", botId: bot, template: "y", next: "e" },
        e: { type: "end" },
      },
    });
    const seen: number[] = [];
    const ac = new AbortController();
    const r = await executeGraph(g, "in", {
      runPrompt: async () => "out",
      onStep: (t) => {
        seen.push(t.length);
        if (t.length === 1) ac.abort();
      },
      signal: ac.signal,
    });
    expect(r.status).toBe("cancelled");
    expect(seen).toEqual([1]);
  });
});

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [
  `feat-w-a-${crypto.randomUUID()}`,
  `feat-w-b-${crypto.randomUUID()}`,
  `feat-w-c-${crypto.randomUUID()}`,
];
const [A, B, C] = ids as [string, string, string];

suite("feature wave against compose postgres", () => {
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
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access, chat: createChatService(db) },
    features: { access, features },
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
  const newBot = async (
    as: string,
    name: string,
    ready = true,
    visibility: "team" | "private" = "team",
  ) => {
    const b = (await call(as, "POST", "/api/bots", { name, visibility })).json.bot as {
      id: string;
      version: number;
    };
    if (ready) await db.$client.query("update bot set onboarded = true where id = $1", [b.id]);
    return b;
  };
  const sql = (q: string, p: unknown[] = []) => db.$client.query(q, p);

  test("attention: a repeating situation is one card; read/ack/resolve/cancel are separate actions; summary counts unread", async () => {
    const b = await newBot(A, "Flaky");
    const raise = () =>
      features.addAttention({ userId: A, isAdmin: false } as never, { title: "x" });
    void raise; // manual cards are not deduplicated
    const r = (
      await call(A, "POST", "/api/routines", {
        botId: b.id,
        title: "Dup",
        prompt: "p",
        timezone: "UTC",
        everyMinutes: 5,
      })
    ).json.routine.id as string;
    await sql("update bot set harness = 'cursor' where id = $1", [b.id]); // cursor-agent is not installed here -> the run fails the same way each time
    for (const k of ["k1", "k2", "k3"])
      await call(A, "POST", `/api/routines/${r}/run`, { requestKey: `request-${k}-aaaa` });
    const items = (await call(A, "GET", "/api/attention")).json.items as {
      title: string;
      occurrences: number;
      id: string;
      status: string;
    }[];
    const dup = items.filter((i) => i.title.includes('"Dup" failed'));
    expect(dup).toHaveLength(1);
    expect(dup[0]!.occurrences).toBe(3);
    expect(
      (await call(A, "GET", "/api/attention/summary")).json.summary.unread,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await call(A, "POST", `/api/attention/${dup[0]!.id}/action`, { action: "read" })).json.item
        .status,
    ).toBe("open"); // reading is not resolving
    expect(
      (await call(A, "POST", `/api/attention/${dup[0]!.id}/action`, { action: "cancel" })).json.item
        .status,
    ).toBe("cancelled");
    expect(
      (await call(B, "POST", `/api/attention/${dup[0]!.id}/action`, { action: "resolve" })).status,
    ).toBe(404);
  });

  test("routines: idempotent run-now, occurrence uniqueness across workers, PATCH CAS, summary, owner_inactive and restart recovery", async () => {
    const b = await newBot(A, "Reporter");
    const rid = (
      await call(A, "POST", "/api/routines", {
        botId: b.id,
        title: "Daily",
        prompt: "report",
        timezone: "UTC",
        everyMinutes: 5,
      })
    ).json.routine.id as string;
    const key = { requestKey: "same-key-1234" };
    const r1 = await call(A, "POST", `/api/routines/${rid}/run`, key),
      r2 = await call(A, "POST", `/api/routines/${rid}/run`, key);
    expect(r1.json.run.id).toBe(r2.json.run.id);
    expect((await call(A, "GET", `/api/routines/${rid}/runs`)).json.runs).toHaveLength(1);
    const summary = (await call(A, "GET", `/api/routines/${rid}/summary`)).json.summary;
    expect(summary).toMatchObject({
      bot: "Reporter",
      timezone: "UTC",
      contextMode: "Each run starts a new chat",
    });
    expect(summary.nextRuns).toHaveLength(3);
    expect(
      (await call(A, "PATCH", `/api/routines/${rid}`, { expectedVersion: 1, title: "Daily v2" }))
        .json.routine.version,
    ).toBe(2);
    expect(
      (await call(A, "PATCH", `/api/routines/${rid}`, { expectedVersion: 1, title: "stale" }))
        .status,
    ).toBe(409);
    expect(
      (
        await call(A, "POST", "/api/routines/preview", {
          timezone: "Europe/Lisbon",
          dailyAt: "08:00",
        })
      ).json.nextRuns,
    ).toHaveLength(3);
    // two workers racing for the same scheduled occurrence: exactly one runs it
    await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
    const future = new Date(Date.now() + 6 * 60_000);
    const [w1, w2] = await Promise.all([features.runDue(future), features.runDue(future)]);
    expect(w1 + w2).toBe(1);
    // an owner whose membership is no longer active is blocked, not run
    await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
    await sql("update membership set status='removed', removed_at=now() where user_id=$1", [A]);
    expect(await features.runDue(new Date(Date.now() + 30 * 60_000))).toBe(1);
    const runs = (await call(B, "GET", `/api/routines/${rid}/runs`)).json.runs;
    expect(runs).toHaveLength(0);
    const last = await sql(
      "select status, reason_code from routine_run where routine_id=$1 order by started_at desc limit 1",
      [rid],
    );
    expect(last.rows[0]).toMatchObject({ status: "blocked", reason_code: "owner_inactive" });
    await sql("update membership set status='active', removed_at=null where user_id=$1", [A]);
    // crash recovery: a run left "running" becomes interrupted with a card
    await sql(
      "insert into routine_run (routine_id, owner_user_id, status, output, occurrence_key, started_at) values ($1,$2,'running','', 'sched:crashed', now())",
      [rid, A],
    );
    expect(await features.routines.recoverInterrupted()).toBeGreaterThanOrEqual(1);
    expect(
      (await sql("select status from routine_run where occurrence_key='sched:crashed'")).rows[0]
        .status,
    ).toBe("interrupted");
  });

  test("workflows: immutable versions with CAS, durable idempotent runs, readiness admission, skipped nodes, interrupted recovery", async () => {
    const ready = await newBot(A, "Ready"),
      unready = await newBot(A, "Unready", false);
    const graph = (botId: string) => ({
      start: "a",
      nodes: {
        a: { type: "prompt", botId, template: "go {{input}}", next: "c" },
        // oxlint-disable-next-line unicorn/no-thenable
        c: { type: "condition", contains: "go", then: "e", else: "x" } as any,
        e: { type: "end" },
        x: { type: "end" },
      },
    });
    const wf = (await call(A, "POST", "/api/workflows", { name: "wf", graph: graph(ready.id) }))
      .json.workflow;
    expect(
      (
        await call(A, "POST", "/api/workflows", {
          id: wf.id,
          name: "wf2",
          graph: graph(ready.id),
          expectedVersion: 1,
        })
      ).json.workflow.version,
    ).toBe(2);
    expect(
      (
        await call(A, "POST", "/api/workflows", {
          id: wf.id,
          name: "stale",
          graph: graph(ready.id),
          expectedVersion: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await sql("select count(*)::int as n from workflow_version where workflow_id=$1", [wf.id]))
        .rows[0].n,
    ).toBe(2);
    const body = { input: "hello", requestKey: "wf-request-001" };
    const a1 = await call(A, "POST", `/api/workflows/${wf.id}/run`, body),
      a2 = await call(A, "POST", `/api/workflows/${wf.id}/run`, body);
    expect(a1.json.run.id).toBe(a2.json.run.id);
    expect(a2.json.replayed).toBe(true);
    expect(a1.json.run.workflowVersion).toBe(2);
    expect(a1.json.run.status).toBe("succeeded");
    expect(
      a1.json.run.trace
        .filter((t: { skipped?: boolean }) => t.skipped)
        .map((t: { node: string }) => t.node),
    ).toEqual(["x"]);
    const bad = (
      await call(A, "POST", "/api/workflows", { name: "needs-ready", graph: graph(unready.id) })
    ).json.workflow;
    const blocked = await call(A, "POST", `/api/workflows/${bad.id}/run`, { input: "x" });
    expect(blocked.json.run.status).toBe("failed"); // an unready bot is never run
    expect(
      (await call(A, "GET", "/api/attention")).json.items.some(
        (i: { title: string; completed: string }) => i.title.includes('"needs-ready" failed'),
      ),
    ).toBe(true);
    await sql(
      "insert into workflow_run (workflow_id, owner_user_id, workflow_version, status, trace) values ($1,$2,1,'running','[]')",
      [wf.id, A],
    );
    expect(await features.workflows.recoverInterrupted()).toBeGreaterThanOrEqual(1);
  });

  test("snapshots: safe text-only copy, preview hash, idempotency, revoke, DB-level immutability, no credentials", async () => {
    const b = await newBot(A, "Writer");
    const conv = (await call(A, "POST", "/api/conversations", { botId: b.id })).json.conversation
      .id as string;
    const send = (content: string, extra: object = {}) =>
      call(A, "POST", `/api/conversations/${conv}/messages`, { content, ...extra });
    const first = await send("hello team");
    await send("a thread reply", { parentMessageId: first.json.user.id });
    await call(A, "POST", `/api/messages/${first.json.user.id}/reactions`, { emoji: "👍" });
    const up = (
      await call(A, "POST", "/api/attachments", {
        name: "notes.txt",
        text: "PRIVATE ATTACHMENT BODY",
      })
    ).json.attachment.id;
    await send("see attached", { attachmentIds: [up] });
    const pv = (await call(A, "POST", "/api/snapshots/preview", { conversationId: conv })).json
      .preview;
    expect(JSON.stringify(pv.parts)).not.toContain("PRIVATE ATTACHMENT BODY");
    expect(
      pv.parts.some((p: { attachments?: string[] }) => p.attachments?.includes("notes.txt")),
    ).toBe(true);
    expect(pv.parts.some((p: { thread?: number }) => p.thread === 1)).toBe(true);
    expect(JSON.stringify(pv.parts)).toContain("[attachment content omitted]");
    expect(
      (
        await call(A, "POST", "/api/snapshots", {
          conversationId: conv,
          previewHash: "0".repeat(64),
        })
      ).status,
    ).toBe(409);
    const key = "snap-request-1";
    const s1 = await call(A, "POST", "/api/snapshots", {
      conversationId: conv,
      previewHash: pv.previewHash,
      requestKey: key,
    });
    const s2 = await call(A, "POST", "/api/snapshots", {
      conversationId: conv,
      previewHash: pv.previewHash,
      requestKey: key,
    });
    expect(s1.status).toBe(201);
    expect(s2.json.snapshot.id).toBe(s1.json.snapshot.id);
    await send("after publication");
    expect(
      JSON.stringify((await call(B, "GET", `/api/snapshots/${s1.json.snapshot.id}`)).json),
    ).not.toContain("after publication");
    await expect(
      sql("update snapshot set content = '[]'::jsonb where id = $1", [s1.json.snapshot.id]),
    ).rejects.toThrow(/immutable/);
    expect((await call(A, "DELETE", `/api/snapshots/${s1.json.snapshot.id}`)).status).toBe(200);
    expect((await call(B, "GET", `/api/snapshots/${s1.json.snapshot.id}`)).status).toBe(404); // revoked: unavailable to the team
    expect(
      (await call(A, "GET", `/api/snapshots/${s1.json.snapshot.id}`)).json.snapshot.revokedAt,
    ).toBeTruthy();
    expect(
      (await call(B, "GET", "/api/snapshots")).json.snapshots.some(
        (s: { id: string }) => s.id === s1.json.snapshot.id,
      ),
    ).toBe(false);
    // a message that looks like a credential blocks publication with a reason
    const c2 = (await call(A, "POST", "/api/conversations", { botId: b.id })).json.conversation.id;
    await call(A, "POST", `/api/conversations/${c2}/messages`, {
      content: "my key is sk-abcdefghijklmnopqrstuvwxyz123456",
    });
    const unsafe = await call(A, "POST", "/api/snapshots/preview", { conversationId: c2 });
    expect(unsafe.status).toBe(422);
  });

  test("hooks: ordered, invalid or risky patterns rejected, dry-run, stop is evaluated on redacted text, toggles and owner-only", async () => {
    const b = await newBot(A, "Hooked");
    const add = (v: object) => call(A, "POST", `/api/bots/${b.id}/hooks`, v);
    expect((await add({ kind: "redact", pattern: "(a+)+$" })).status).toBe(400);
    expect((await add({ kind: "stop", pattern: "[" })).status).toBe(400);
    const red = (await add({ kind: "redact", pattern: "secret-\\d+", value: "[X]" })).json.hook;
    await add({ kind: "stop", pattern: "\\[X\\]", value: "Blocked after redaction." }); // matches only the REDACTED text
    const dry = (
      await call(A, "POST", `/api/bots/${b.id}/hooks/dry-run`, { text: "use secret-123 now" })
    ).json.result;
    expect(dry).toMatchObject({ stopped: true, stopMessage: "Blocked after redaction." });
    await call(A, "PATCH", `/api/hooks/${red.id}`, { enabled: false });
    expect(
      (await call(A, "POST", `/api/bots/${b.id}/hooks/dry-run`, { text: "use secret-123 now" }))
        .json.result.stopped,
    ).toBe(false);
    expect((await call(B, "POST", `/api/bots/${b.id}/hooks/dry-run`, { text: "x" })).status).toBe(
      404,
    );
    expect((await call(B, "PATCH", `/api/hooks/${red.id}`, { enabled: true })).status).toBe(404);
  });

  test("memory and instructions: dedupe, secret rejection, versioned edit, relevance, used-knowledge provenance, untrusted label", async () => {
    const b = await newBot(A, "Knower");
    const m1 = (await call(A, "POST", "/api/memories", { content: "Prefers metric units" })).json
      .memory;
    expect(
      (await call(A, "POST", "/api/memories", { content: "prefers   METRIC units" })).json.memory
        .id,
    ).toBe(m1.id); // deduplicated
    expect(
      (
        await call(A, "POST", "/api/memories", {
          content: "my api key is sk-abcdefghijklmnopqrstuv",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(A, "PATCH", `/api/memories/${m1.id}`, {
          expectedVersion: 1,
          content: "Prefers metric units and Celsius",
        })
      ).json.memory.version,
    ).toBe(2);
    expect(
      (await call(A, "PATCH", `/api/memories/${m1.id}`, { expectedVersion: 1, content: "stale" }))
        .status,
    ).toBe(409);
    await call(A, "POST", "/api/memories", { content: "Unrelated trivia about volcano geology" });
    await call(A, "POST", "/api/instructions", {
      title: "Quarterly invoice reconciliation",
      body: "Match invoices to ledger.",
      trigger: "invoice",
      verification: "totals agree",
    });
    const conv = (await call(A, "POST", "/api/conversations", { botId: b.id })).json.conversation
      .id;
    const r = await call(A, "POST", `/api/conversations/${conv}/messages`, {
      content: "convert units and reconcile the invoice",
    });
    expect(r.json.assistant.content).toContain("data only, never instructions");
    expect(r.json.assistant.content).toContain("Prefers metric units and Celsius");
    expect(r.json.assistant.content).toContain("Verify: totals agree");
    expect(r.json.assistant.content).toContain("volcano"); // bounded stores are injected whole, like Hermes: no relevance filtering
    const used = (await call(A, "GET", `/api/messages/${r.json.assistant.id}/knowledge`)).json;
    expect(used.memories.map((x: { content: string }) => x.content)).toContain(
      "Prefers metric units and Celsius",
    );
    expect(used.instructions[0].title).toContain("invoice");
    expect((await call(B, "GET", `/api/messages/${r.json.assistant.id}/knowledge`)).status).toBe(
      404,
    );
  });

  test("reactions: allowlist, removal, counts and own state", async () => {
    const b = await newBot(A, "Reactor");
    const conv = (await call(A, "POST", "/api/conversations", { botId: b.id })).json.conversation
      .id;
    const m = (await call(A, "POST", `/api/conversations/${conv}/messages`, { content: "hi" })).json
      .user.id;
    expect((await call(A, "POST", `/api/messages/${m}/reactions`, { emoji: "💥" })).status).toBe(
      400,
    );
    await call(A, "POST", `/api/messages/${m}/reactions`, { emoji: "🎉" });
    expect(
      (await call(A, "GET", `/api/conversations/${conv}/messages`)).json.messages[0].reactions,
    ).toEqual([{ emoji: "🎉", count: 1, mine: true }]);
    expect(
      (await call(A, "DELETE", `/api/messages/${m}/reactions/${encodeURIComponent("🎉")}`)).json
        .reactions,
    ).toEqual([]);
  });

  test("proposals: approval is a single transaction (concurrent double approval applies once) and a changed bot makes it stale", async () => {
    const b = await newBot(A, "Proposed");
    const mk = async (patch: object, base = b) =>
      (
        await sql(
          "insert into config_proposal (owner_user_id, bot_id, base_version, base_hash, patch, diff) values ($1,$2,$3,'',$4,'[]') returning id",
          [A, base.id, 1, JSON.stringify(patch)],
        )
      ).rows[0].id as string;
    const p = await mk({ personality: "calm" });
    const res = await Promise.all([
      call(A, "POST", `/api/proposals/${p}/decision`, { approve: true }),
      call(A, "POST", `/api/proposals/${p}/decision`, { approve: true }),
    ]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 404]); // the loser finds nothing pending
    expect(
      (await sql("select version, personality from bot where id=$1", [b.id])).rows[0],
    ).toMatchObject({ version: 2, personality: "calm" });
    expect(
      (
        await sql("select count(*)::int as n from bot_revision where bot_id=$1 and version=2", [
          b.id,
        ])
      ).rows[0].n,
    ).toBe(1);
    const stale = await mk({ personality: "later" }); // base_version 1 but the bot is now version 2
    expect(
      (await call(A, "POST", `/api/proposals/${stale}/decision`, { approve: true })).json.status,
    ).toBe("stale");
    expect((await sql("select personality from bot where id=$1", [b.id])).rows[0].personality).toBe(
      "calm",
    );
  });

  test("delegations are recorded per mention and summarized", async () => {
    const lead = await newBot(A, "Captain", false),
      helper = await newBot(A, "Mate");
    const conv = (await call(A, "POST", "/api/conversations", { botId: lead.id })).json.conversation
      .id;
    const r = await call(A, "POST", `/api/conversations/${conv}/messages`, {
      content: "@Mate please check",
    });
    expect(r.json.replies).toHaveLength(2);
    const d = (await call(A, "GET", `/api/conversations/${conv}/delegations`)).json.delegations;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ botId: helper.id, status: "succeeded" });
    expect(
      (await call(C, "GET", `/api/conversations/${conv}/delegations`)).json.delegations,
    ).toHaveLength(0);
  });

  test("routine calendar lists upcoming occurrences and past runs for the owner only", async () => {
    const b = await newBot(A, "Calbot");
    const rid = (
      await call(A, "POST", "/api/routines", {
        botId: b.id,
        title: "CalRoutine",
        prompt: "p",
        timezone: "UTC",
        dailyAt: "09:00",
      })
    ).json.routine.id as string;
    await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
    await call(A, "POST", `/api/routines/${rid}/run`, { requestKey: "calendar-run-001" });
    const from = new Date(Date.now() - 3600_000).toISOString(),
      to = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
    const items = (await call(A, "POST", "/api/routines/calendar", { from, to })).json.items as {
      title: string;
      kind: string;
    }[];
    expect(
      items.filter((i) => i.title === "CalRoutine" && i.kind === "scheduled").length,
    ).toBeGreaterThanOrEqual(4);
    expect(items.some((i) => i.title === "CalRoutine" && i.kind === "ran")).toBe(true);
    expect(
      (await call(B, "POST", "/api/routines/calendar", { from, to })).json.items.some(
        (i: { title: string }) => i.title === "CalRoutine",
      ),
    ).toBe(false);
    expect(
      (
        await call(A, "POST", "/api/routines/calendar", {
          from,
          to: new Date(Date.now() + 200 * 24 * 3600_000).toISOString(),
        })
      ).status,
    ).toBe(400);
  });

  test("routine timeline lists recent runs with their chat for the owner only", async () => {
    const b = await newBot(A, "Timebot");
    const rid = (
      await call(A, "POST", "/api/routines", {
        botId: b.id,
        title: "TimeRoutine",
        prompt: "p",
        timezone: "UTC",
        dailyAt: "09:00",
      })
    ).json.routine.id as string;
    await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
    await call(A, "POST", `/api/routines/${rid}/run`, { requestKey: "timeline-run-001" });
    const from = new Date(Date.now() - 3600_000).toISOString(),
      to = new Date(Date.now() + 60_000).toISOString();
    const runs = (await call(A, "POST", "/api/routines/timeline", { from, to })).json.runs as {
      title: string;
      conversationId: string | null;
      startedAt: string;
    }[];
    const mine = runs.filter((r) => r.title === "TimeRoutine");
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(typeof mine[0]!.startedAt).toBe("string");
    expect(
      (await call(B, "POST", "/api/routines/timeline", { from, to })).json.runs.some(
        (r: { title: string }) => r.title === "TimeRoutine",
      ),
    ).toBe(false);
    expect(
      (
        await call(A, "POST", "/api/routines/timeline", {
          from,
          to: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
        })
      ).status,
    ).toBe(400);
  });

  describe("routine status and recovery", () => {
    const failingBot = async (name: string) => {
      const b = await newBot(A, name);
      await sql("update bot set harness = 'cursor' where id = $1", [b.id]); // cursor-agent is not installed here -> every run fails
      return b;
    };
    const create = async (botId: string, title: string) =>
      (
        await call(A, "POST", "/api/routines", {
          botId,
          title,
          prompt: "do the thing",
          timezone: "UTC",
          everyMinutes: 60,
        })
      ).json.routine.id as string;
    const status = async (rid: string) =>
      (await sql("select status from routine where id=$1", [rid])).rows[0].status as string;
    const waitFor = async (check: () => Promise<boolean>) => {
      for (let i = 0; i < 40; i++) {
        if (await check()) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    };

    test("a routine is paused when created, scheduled once activated, failed after a failed run and paused again on request", async () => {
      const rid = await create((await failingBot("StatusBot")).id, "StatusRoutine");
      expect(await status(rid)).toBe("paused");
      await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
      expect(await status(rid)).toBe("scheduled");
      await call(A, "POST", `/api/routines/${rid}/run`, { requestKey: "status-run-0001" });
      expect(await status(rid)).toBe("failed");
      expect(
        (await call(A, "GET", "/api/routines")).json.routines.find(
          (r: { id: string }) => r.id === rid,
        ).status,
      ).toBe("failed");
      await call(A, "POST", `/api/routines/${rid}/paused`, { paused: true });
      expect(await status(rid)).toBe("paused");
    });

    test("a routine run by hand while paused goes back to paused once the run finishes", async () => {
      const rid = await create((await newBot(A, "ManualBot")).id, "ManualWhilePaused");
      features.routines.useChat(async () => ({ ok: true, text: "done" })); // a bot that answers, so the run succeeds
      try {
        await call(A, "POST", `/api/routines/${rid}/run`, { requestKey: "manual-paused-01" });
      } finally {
        features.routines.useChat(undefined as never);
      }
      expect(
        (await sql("select status from routine_run where routine_id=$1", [rid])).rows[0].status,
      ).toBe("succeeded");
      expect(await status(rid)).toBe("paused");
    });

    test("a restart leaves a running routine interrupted, and its run from the last hour is run again once in the same chat", async () => {
      const rid = await create((await failingBot("RecoverBot")).id, "RecoverRoutine");
      await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
      const conv = (
        await sql(
          "insert into conversation (owner_user_id, bot_id, title) select $1, bot_id, 'old' from routine where id=$2 returning id",
          [A, rid],
        )
      ).rows[0].id as string;
      await sql(
        "insert into routine_run (routine_id, owner_user_id, status, output, occurrence_key, conversation_id, started_at) values ($1,$2,'running','half done','sched:died',$3, now() - interval '20 minutes')",
        [rid, A, conv],
      );
      await sql("update routine set status='running' where id=$1", [rid]);
      await features.routines.recoverInterrupted();
      expect(await status(rid)).toBe("interrupted");

      expect(await features.recoverRecent(new Date(), undefined, A)).toBe(1);
      const retry = (
        await sql(
          "select trigger, conversation_id from routine_run where routine_id=$1 and occurrence_key like 'retry:%'",
          [rid],
        )
      ).rows;
      expect(retry).toEqual([{ trigger: "recovery", conversation_id: conv }]);
      expect(await status(rid)).toBe("failed");
      expect(await features.recoverRecent(new Date(), undefined, A)).toBe(0); // one retry per run, and a retry is never retried
    });

    test("a restart does not call a routine interrupted when none of its runs was in flight", async () => {
      const rid = await create((await failingBot("StaleBot")).id, "StaleLabel");
      await sql("update routine set status='running' where id=$1", [rid]); // a label left over, with no run behind it
      await features.routines.recoverInterrupted();
      expect(await status(rid)).toBe("running");
    });

    test("runs older than an hour, and routines whose latest run succeeded, are not run again", async () => {
      const bot = await failingBot("QuietBot");
      const old = await create(bot.id, "OldFailure"),
        fixed = await create(bot.id, "AlreadyFixed");
      await sql(
        "insert into routine_run (routine_id, owner_user_id, status, output, occurrence_key, started_at) values ($1,$2,'failed','','sched:old', now() - interval '3 hours')",
        [old, A],
      );
      await sql(
        "insert into routine_run (routine_id, owner_user_id, status, output, occurrence_key, started_at) values ($1,$2,'failed','','sched:f1', now() - interval '40 minutes'), ($1,$2,'succeeded','','sched:f2', now() - interval '10 minutes')",
        [fixed, A],
      );
      expect(await features.recoverRecent(new Date(), undefined, A)).toBe(0);
    });

    test("activating a routine whose time has passed runs it without waiting for a polling tick", async () => {
      const rid = await create((await failingBot("TimerBot")).id, "TimerRoutine");
      await call(A, "POST", `/api/routines/${rid}/paused`, { paused: false });
      await sql("update routine set next_run_at = now() - interval '1 minute' where id=$1", [rid]);
      await features.routines.start();
      expect(
        await waitFor(
          async () =>
            (
              await sql("select 1 from routine_run where routine_id=$1 and trigger='schedule'", [
                rid,
              ])
            ).rows.length === 1,
        ),
      ).toBe(true);
      await waitFor(
        async () =>
          (await sql("select 1 from audit_event where subject_id=$1", [rid])).rows.length === 1,
      ); // let the run finish before the users are removed
    });
  });
});
