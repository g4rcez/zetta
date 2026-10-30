import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../app";
import { createDiscussionStore } from "./discussions/store";
import { createInbound } from "./inbound/service";
import { cleanupTestUsers } from "../test-support/db-cleanup";
import { createChatService } from "./chat/service";
import { createFeaturesService } from "./features/service";
import { createIdentityAccess } from "./identity/access";
import { createMcp } from "./integrations/mcp";
import { createSources } from "./integrations/sources";

/**
 * RFC-066 matrix: user A owns one of every resource type; user B (an active member) and C (a removed member) try to read,
 * change or use each of them. Every cross-user attempt must fail as "not found" (404) or return nothing, never 200 with A's data.
 */
const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`iso-a-${uuidv7()}`, `iso-b-${uuidv7()}`, `iso-c-${uuidv7()}`];
const [A, B, C] = ids as [string, string, string];

suite("cross-user isolation matrix", () => {
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
    async () => {
      return { isAdmin: false };
    },
  );
  // C's membership is removed in the database, so the real membership lookup must deny it.
  const realAccess = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async (id) => {
      const r = await db.$client.query("select status from membership where user_id = $1", [id]);
      return r.rows[0]?.status === "active" ? { isAdmin: false } : null;
    },
  );
  void access;
  const features = createFeaturesService(db);
  const mcp = createMcp(db, undefined, { allowPrivate: true });
  const sources = createSources(db, undefined, {
    allowPrivate: true,
    fetcher: async () => "<rss/>",
  });
  const discussions = createDiscussionStore(db);
  const chat = createChatService(
    db,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { discussions },
  );
  const inbound = createInbound(db, mcp.plugins, chat, async () => ({ isAdmin: false }));
  const app = createApp({
    auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
    chat: { access: realAccess, chat },
    features: { access: realAccess, features },
    integrations: { access: realAccess, mcp, sources },
    discussions: {
      access: realAccess,
      store: discussions,
      worker: { kick: () => {}, tick: async () => {}, drain: async () => {} },
    },
    inbound: { access: realAccess, inbound },
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
    return {
      status: r.status,
      text: await r.clone().text(),
      json: (await r.json().catch(() => ({}))) as any,
    };
  };
  const SECRET = "A-PRIVATE-MARKER-7f3a";
  const owned: Record<string, string> = {};
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
    await db.insert(membership).values([
      { userId: A, status: "active", joinedAt: now, updatedAt: now },
      { userId: B, status: "active", joinedAt: now, updatedAt: now },
      { userId: C, status: "removed", joinedAt: now, removedAt: now, updatedAt: now },
    ]);
    // A creates one of everything
    const bot = (await call(A, "POST", "/api/bots", { name: "IsoBot", visibility: "private" })).json
      .bot.id as string;
    owned.bot = bot;
    const conv = (await call(A, "POST", "/api/conversations", { botId: bot })).json.conversation
      .id as string;
    owned.conv = conv;
    const sent = (
      await call(A, "POST", `/api/conversations/${conv}/messages`, {
        content: `remember that ${SECRET} is mine`,
      })
    ).json;
    owned.msg = sent.user.id;
    owned.att = (
      await call(A, "POST", "/api/attachments", { name: "a.txt", text: SECRET })
    ).json.attachment.id;
    owned.mem = (
      await call(A, "POST", "/api/memories", { content: `fact ${SECRET}` })
    ).json.memory.id;
    owned.ins = (
      await call(A, "POST", "/api/instructions", { title: `proc ${SECRET}`, body: "steps" })
    ).json.instruction.id;
    owned.hook = (
      await call(A, "POST", `/api/bots/${bot}/hooks`, {
        kind: "add_context",
        value: "bot-level behaviour note",
      })
    ).json.hook.id;
    owned.routine = (
      await call(A, "POST", "/api/routines", {
        botId: bot,
        title: "r",
        prompt: SECRET,
        timezone: "UTC",
        everyMinutes: 5,
      })
    ).json.routine.id;
    owned.wf = (
      await call(A, "POST", "/api/workflows", {
        name: "w",
        graph: { start: "e", nodes: { e: { type: "end" } } },
      })
    ).json.workflow.id;
    owned.attn = (
      await call(A, "POST", "/api/attention", { title: `attn ${SECRET}` })
    ).json.item.id;
    owned.mcp = (
      await call(A, "POST", "/api/mcp/servers", {
        name: "iso",
        transport: "http",
        url: "https://mcp.iso.test/mcp",
      })
    ).json.server.id;
    owned.src = (
      await call(A, "POST", "/api/sources", {
        kind: "rss",
        url: "https://iso.example.test/feed",
        label: "iso",
      })
    ).json.source.id;
    await db.$client.query(
      "insert into config_proposal (owner_user_id, kind, bot_id, base_version, patch, diff) values ($1,'config',$2,1,'{\"personality\":\"x\"}','[]')",
      [A, bot],
    );
    owned.prop = (
      await db.$client.query("select id from config_proposal where owner_user_id=$1", [A])
    ).rows[0].id;
    // A group discussion with a second, ready private bot (the queue is not run here).
    const peer = (await call(A, "POST", "/api/bots", { name: "IsoPeer", visibility: "private" }))
      .json.bot.id as string;
    owned.peer = peer;
    await db.$client.query("update bot set onboarded = true where id = $1", [peer]);
    owned.disc = (
      await call(A, "POST", "/api/discussions", {
        title: `disc ${SECRET}`,
        goal: SECRET,
        members: [{ bot: peer }],
        firstMessage: `@IsoPeer ${SECRET}`,
      })
    ).json.discussion.id;
  });
  afterAll(async () => {
    await db.$client
      .query("delete from mcp_server where owner_user_id = any($1)", [ids])
      .catch(() => undefined);
    await db.$client.query("delete from source where owner_user_id = any($1)", [ids]);
    await cleanupTestUsers(db, ids);
  });

  const denied = (r: { status: number; text: string }) => {
    expect([401, 403, 404]).toContain(r.status);
    expect(r.text).not.toContain(SECRET);
  };
  const empty = (r: { status: number; text: string }) => {
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(SECRET);
  };

  for (const who of ["B", "C"] as const) {
    const as = () => (who === "B" ? B : C);
    test(`${who}: cannot read, change or use A's resources`, async () => {
      const u = as(),
        o = owned as Record<string, string>;
      // lists never contain A's data (C, a removed member, is denied outright)
      for (const path of [
        "/api/memories",
        "/api/instructions",
        "/api/routines",
        "/api/workflows",
        "/api/attention",
        "/api/proposals",
        "/api/mcp/servers",
        "/api/sources",
        "/api/conversations",
        "/api/activity",
        "/api/workspaces",
        "/api/discussions",
        "/api/inbound/routes",
      ]) {
        const r = await call(u, "GET", path);
        if (who === "B") empty(r);
        else denied(r);
        if (who === "B" && path !== "/api/attention") expect(r.text).not.toContain(o.bot);
      }
      // B can see A's *team* bots only; this bot is private, so it must not be listed or usable at all
      const bots = await call(u, "GET", "/api/bots");
      if (who === "B") expect(bots.text).not.toContain(o.bot);
      else denied(bots);
      // direct object access by id
      for (const [method, path, body] of [
        ["GET", `/api/conversations/${o.conv}/messages`],
        ["POST", `/api/conversations/${o.conv}/messages`, { content: "hi" }],
        ["POST", `/api/conversations/${o.conv}/stream`, { content: "hi" }],
        ["GET", `/api/conversations/${o.conv}/stream?after=0`],
        ["POST", `/api/conversations/${o.conv}/cancel`],
        ["GET", `/api/conversations/${o.conv}/delegations`],
        ["POST", "/api/conversations", { botId: o.bot }],
        ["PATCH", `/api/bots/${o.bot}`, { expectedVersion: 1, patch: { name: "x" } }],
        ["DELETE", `/api/bots/${o.bot}`],
        ["POST", `/api/messages/${o.msg}/reactions`, { emoji: "👍" }],
        ["GET", `/api/messages/${o.msg}/knowledge`],
        ["DELETE", `/api/attachments/${o.att}`],
        ["PATCH", `/api/memories/${o.mem}`, { expectedVersion: 1, content: "x" }],
        ["DELETE", `/api/memories/${o.mem}`],
        ["PATCH", `/api/instructions/${o.ins}`, { expectedVersion: 1, title: "x" }],
        ["DELETE", `/api/instructions/${o.ins}`],
        ["GET", `/api/bots/${o.bot}/hooks`],
        ["POST", `/api/bots/${o.bot}/hooks`, { kind: "stop", pattern: "x" }],
        ["PATCH", `/api/hooks/${o.hook}`, { enabled: false }],
        ["DELETE", `/api/hooks/${o.hook}`],
        ["POST", `/api/bots/${o.bot}/hooks/dry-run`, { text: "x" }],
        ["GET", `/api/bots/${o.bot}/decision`],
        [
          "PUT",
          `/api/bots/${o.bot}/decision`,
          {
            enabled: true,
            question: "q",
            minConfidencePct: 50,
            options: [
              { label: "a", description: "a", action: "respond" },
              { label: "b", description: "b", action: "respond" },
            ],
          },
        ],
        ["GET", `/api/routines/${o.routine}/summary`],
        ["PATCH", `/api/routines/${o.routine}`, { expectedVersion: 1, title: "x" }],
        ["POST", `/api/routines/${o.routine}/paused`, { paused: false }],
        ["POST", `/api/routines/${o.routine}/run`, { requestKey: "k-isolation-1" }],
        ["GET", `/api/routines/${o.routine}/runs`],
        ["DELETE", `/api/routines/${o.routine}`],
        ["GET", `/api/workflows/${o.wf}`],
        ["POST", `/api/workflows/${o.wf}/run`, { input: "" }],
        ["GET", `/api/workflows/${o.wf}/runs`],
        [
          "POST",
          "/api/workflows",
          {
            id: o.wf,
            name: "x",
            graph: { start: "e", nodes: { e: { type: "end" } } },
            expectedVersion: 1,
          },
        ],
        ["POST", `/api/attention/${o.attn}/action`, { action: "resolve" }],
        ["POST", `/api/proposals/${o.prop}/decision`, { approve: true }],
        ["GET", `/api/mcp/servers/${o.mcp}/tools`],
        ["DELETE", `/api/mcp/servers/${o.mcp}`],
        ["PUT", `/api/bots/${o.bot}/integrations/${o.mcp}`],
        ["DELETE", `/api/sources/${o.src}`],
        ["POST", "/api/snapshots/preview", { conversationId: o.conv }],
        ["GET", `/api/bots/${o.bot}/connections`],
        ["GET", `/api/discussions/${o.disc}`],
        ["PATCH", `/api/discussions/${o.disc}`, { context: "x" }],
        ["POST", `/api/discussions/${o.disc}/messages`, { content: "hi" }],
        ["POST", `/api/discussions/${o.disc}/pause`],
        ["POST", `/api/discussions/${o.disc}/resume`],
        ["POST", `/api/discussions/${o.disc}/cancel`],
        ["POST", `/api/discussions/${o.disc}/resolve`, { summary: "x" }],
        ["PUT", `/api/discussions/${o.disc}/members/${o.peer}`, { requireApproval: false }],
        [
          "POST",
          "/api/discussions",
          { title: "x", members: [{ bot: o.peer }], firstMessage: "hi" },
        ],
        ["GET", `/api/bots/${o.peer}/peers`],
        ["PUT", `/api/bots/${o.peer}/peers`, { peerBotIds: [] }],
        ["PUT", `/api/bots/${o.bot}/peers`, { peerBotIds: [o.peer] }],
        ["GET", `/api/bots/${o.bot}/inbound`],
        [
          "PUT",
          `/api/bots/${o.bot}/inbound/whatsapp`,
          { enabled: false, filter: { direct: true, groups: false, chats: [] } },
        ],
        ["DELETE", `/api/bots/${o.bot}/inbound/whatsapp`],
        ["GET", `/api/conversations/${o.conv}/messages?kind=discussion`],
      ] as [string, string, unknown?][]) {
        const r = await call(u, method, path, body);
        if (method === "GET" && /\/(delegations|runs)$/.test(path) && who === "B") {
          expect(r.status).toBe(200);
          expect(r.json.delegations ?? r.json.runs).toHaveLength(0);
          continue;
        } // list of nothing, not A's data
        try {
          denied(r);
        } catch (e) {
          throw new Error(`${who} ${method} ${path} -> ${r.status}: ${(e as Error).message}`);
        }
      }
      // nothing of A's changed
      const mine = await call(A, "GET", `/api/conversations/${o.conv}/messages`);
      expect(mine.json.messages.map((m: { role: string }) => m.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect((await call(A, "GET", "/api/memories")).json.memories).toHaveLength(2); // the typed fact + "remember that" fact
      expect((await call(A, "GET", "/api/routines")).json.routines[0].paused).toBe(true);
    });
  }

  test("a team-visible bot shares configuration but never chats, memories, accounts or servers", async () => {
    await db.$client.query("update bot set visibility = 'team', onboarded = true where id = $1", [
      owned.bot,
    ]);
    expect((await call(B, "GET", "/api/bots")).text).toContain(owned.bot!); // visible by design
    expect(
      (
        await call(B, "PATCH", `/api/bots/${owned.bot}`, {
          expectedVersion: 1,
          patch: { name: "x" },
        })
      ).status,
    ).toBe(404); // not editable
    const cb = (await call(B, "POST", "/api/conversations", { botId: owned.bot })).json.conversation
      .id;
    const r = await call(B, "POST", `/api/conversations/${cb}/messages`, {
      content: "what do you know?",
    });
    expect(r.status).toBe(201);
    expect(r.text).not.toContain(SECRET); // A's memory and instructions are not in B's prompt (hook text is bot configuration and is shared by design)
    expect((await call(B, "GET", `/api/conversations/${owned.conv}/messages`)).status).toBe(404);
    expect((await call(B, "GET", `/api/bots/${owned.bot}/hooks`)).status).toBe(404); // hook configuration stays with the owner
    expect((await call(B, "GET", "/api/mcp/servers")).json.servers).toHaveLength(0);
  });

  test("published snapshots are the only deliberately shared artifact: text copy, revocable, no source access", async () => {
    const pv = (await call(A, "POST", "/api/snapshots/preview", { conversationId: owned.conv }))
      .json.preview;
    const snap = (
      await call(A, "POST", "/api/snapshots", {
        conversationId: owned.conv,
        previewHash: pv.previewHash,
      })
    ).json.snapshot;
    const view = await call(B, "GET", `/api/snapshots/${snap.id}`);
    expect(view.status).toBe(200);
    expect(view.json.snapshot.sourceConversationId).toBeUndefined();
    expect((await call(B, "GET", `/api/conversations/${owned.conv}/messages`)).status).toBe(404);
    expect((await call(C, "GET", `/api/snapshots/${snap.id}`)).status).toBe(403); // removed members lose even this
  });
});
