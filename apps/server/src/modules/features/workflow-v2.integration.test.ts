import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { configProposal, workflowRun } from "@zetta/db/schema/features";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createLoopStore } from "../chat/loops";
import { createChatService } from "../chat/service";
import { createDiscussionStore } from "../discussions/store";
import { createIdentityAccess } from "../identity/access";
import { createTaskStore } from "../tasks/store";
import type { ToolCallSpec } from "./workflow";
import { createWorkflows, WorkflowError, type WorkflowTools } from "./workflows";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`wf2-a-${uuidv7()}`, `wf2-b-${uuidv7()}`];
const [A, B] = ids as [string, string];

suite("workflows that wait, ask and call tools, against a real database", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const asked: string[] = [];
  const toolCalls: ToolCallSpec[] = [];
  let effects: Record<string, "read" | "write"> = {
    "plugin:gmail:gmail_search": "read",
    "plugin:gmail:gmail_send": "write",
  };
  const tools: WorkflowTools = {
    call: async (_u, c) => (toolCalls.push(c), `result of ${c.tool}`),
    effect: async (_u, c) => effects[`${c.kind}:${c.target}:${c.tool}`] ?? "write",
  };
  const wf = createWorkflows(
    db,
    async ({ prompt }) => (asked.push(prompt), { text: `answer to ${prompt}` }),
  );
  wf.useTools(tools);
  const actor = (userId: string) => ({ userId, isAdmin: false }) as never;
  let botId = "";

  // The real chat service and app: the approval card of a workflow is decided through the same route as every other card.
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
  let app: ReturnType<typeof createApp>;
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
    const fakeRun = Object.assign(async () => ({ text: "ok", stopped: false }), {
      stream: async function* () {
        yield "ok";
      },
    });
    const svc = createChatService(
      db,
      fakeRun as never,
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
      {
        tasks: createTaskStore(db),
        discussions: createDiscussionStore(db, undefined, createLoopStore(db)),
      },
    );
    app = createApp({
      auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never,
      chat: { access, chat: svc },
      webOrigin: "http://web.test",
      desktopOrigins: [],
      drain: () => {},
    });
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
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name: `Flow ${uuidv7().slice(-6)}`,
        slug: `flow-${uuidv7().slice(-10)}`,
        harness: "codex",
        onboarded: true,
      } as never)
      .returning();
    botId = b!.id;
  });
  afterAll(async () => {
    await cleanupTestUsers(db, ids);
  });

  const save = (graph: unknown, name = `WF ${uuidv7().slice(-5)}`) =>
    wf.save(actor(A), { name, graph });
  const runRow = (id: string) =>
    db
      .select()
      .from(workflowRun)
      .where(eq(workflowRun.id, id))
      .then((r) => r[0]!);
  const goDue = (id: string) =>
    db
      .update(workflowRun)
      .set({ resumeAt: new Date(Date.now() - 1000) })
      .where(eq(workflowRun.id, id));

  test("a run that waits is kept, wakes when its time comes, and finishes", async () => {
    const w = await save({
      start: "a",
      nodes: {
        a: { type: "prompt", botId, template: "morning", next: "w" },
        w: { type: "wait", seconds: 3600, next: "b" },
        b: { type: "prompt", botId, template: "after {{prev}}", next: "e" },
        e: { type: "end" },
      },
    });
    asked.length = 0;
    const first = await wf.run(actor(A), w.id, "go");
    expect(first.run.status).toBe("waiting");
    expect(first.run.resumeAt).toBeTruthy();
    expect(first.run.input).toBe("go");
    expect(asked).toEqual(["morning"]);
    // Not yet: the time has not come.
    expect(await wf.tick()).toBe(0);
    expect((await runRow(first.run.id)).status).toBe("waiting");
    await goDue(first.run.id);
    expect(await wf.tick()).toBeGreaterThanOrEqual(1);
    const done = await runRow(first.run.id);
    expect(done.status).toBe("succeeded");
    expect(done.finishedAt).toBeTruthy();
    expect(done.cursor).toBeNull();
    expect(asked).toEqual(["morning", "after answer to morning"]);
    expect((done.trace as { node: string }[]).map((t) => t.node)).toEqual(["a", "w", "b", "e"]);
    // Once only: another tick finds nothing to wake.
    expect(await wf.tick()).toBe(0);
  });

  test("a restart does not touch a waiting run", async () => {
    const w = await save({
      start: "w",
      nodes: { w: { type: "wait", seconds: 7200, next: "e" }, e: { type: "end" } },
    });
    const r = await wf.run(actor(A), w.id, "");
    expect(r.run.status).toBe("waiting");
    await wf.recoverInterrupted();
    expect((await runRow(r.run.id)).status).toBe("waiting");
    await wf.cancelRun(actor(A), r.run.id);
  });

  test("an approval step makes a card; the run goes on after Approve, and the tool runs once with the arguments filled in", async () => {
    const w = await save({
      start: "draft",
      nodes: {
        draft: { type: "prompt", botId, template: "write the mail", next: "ok" },
        ok: { type: "approval", message: "Send this mail?", next: "send" },
        send: {
          type: "tool",
          botId,
          kind: "plugin",
          target: "gmail",
          tool: "gmail_send",
          args: { body: "{{prev}}", to: "ana@example.invalid" },
          next: "e",
        },
        e: { type: "end" },
      },
    });
    toolCalls.length = 0;
    const paused = await wf.run(actor(A), w.id, "");
    expect(paused.run.status).toBe("waiting");
    expect(paused.run.pendingProposalId).toBeTruthy();
    expect(toolCalls).toEqual([]);
    const [card] = (await call(A, "GET", "/api/proposals")).json.proposals.filter(
      (p: { id: string }) => p.id === paused.run.pendingProposalId,
    );
    expect(card).toMatchObject({ kind: "chief_action", patch: { tool: "workflow_gate" } });
    expect(card.diff.map((d: { field: string; to: string }) => [d.field, d.to])).toEqual([
      ["workflow", expect.stringContaining("WF ")],
      ["it asks", "Send this mail?"],
      ["if you approve, next", "call gmail_send of plugin gmail"],
    ]);
    // Still pending: nothing to wake.
    expect(await wf.tick()).toBe(0);
    expect(toolCalls).toEqual([]);
    // The click goes through the same route as any card, "Always allow" never keeps it, and the run wakes on its next tick.
    const decided = await call(A, "POST", `/api/proposals/${card.id}/decision`, {
      approve: true,
      remember: "bot",
    });
    expect(decided.json.status).toBe("approved");
    expect(await wf.tick()).toBeGreaterThanOrEqual(1);
    expect(toolCalls).toEqual([
      {
        botId,
        kind: "plugin",
        target: "gmail",
        tool: "gmail_send",
        args: { body: "answer to write the mail", to: "ana@example.invalid" },
      },
    ]);
    const done = await runRow(paused.run.id);
    expect(done.status).toBe("succeeded");
    expect(
      (done.trace as { node: string; output?: string }[]).find((t) => t.node === "ok")?.output,
    ).toContain("approved");
    expect(await wf.tick()).toBe(0);
    expect(toolCalls).toHaveLength(1);
  });

  test("Decline, or letting the card expire, ends the run as cancelled and the tool never runs", async () => {
    const graph = {
      start: "ok",
      nodes: {
        ok: { type: "approval", message: "Delete it?", next: "send" },
        send: {
          type: "tool",
          botId,
          kind: "plugin",
          target: "gmail",
          tool: "gmail_send",
          next: "e",
        },
        e: { type: "end" },
      },
    };
    toolCalls.length = 0;
    const w = await save(graph);
    const no = await wf.run(actor(A), w.id, "");
    expect(
      (
        await call(A, "POST", `/api/proposals/${no.run.pendingProposalId}/decision`, {
          approve: false,
        })
      ).json.status,
    ).toBe("rejected");
    await wf.tick();
    const declined = await runRow(no.run.id);
    expect(declined.status).toBe("cancelled");
    expect((declined.trace as { output?: string }[])[0]?.output).toContain("not approved");

    const late = await wf.run(actor(A), w.id, "");
    await db
      .update(configProposal)
      .set({ status: "expired" })
      .where(eq(configProposal.id, late.run.pendingProposalId!));
    await wf.tick();
    expect((await runRow(late.run.id)).status).toBe("cancelled");
    expect(toolCalls).toEqual([]);
  });

  test("stopping a waiting run closes its card; a run of somebody else cannot be stopped", async () => {
    const w = await save({
      start: "ok",
      nodes: { ok: { type: "approval", message: "Go?", next: "e" }, e: { type: "end" } },
    });
    const r = await wf.run(actor(A), w.id, "");
    await expect(wf.cancelRun(actor(B), r.run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const stopped = await wf.cancelRun(actor(A), r.run.id);
    expect(stopped.status).toBe("cancelled");
    const [card] = await db
      .select()
      .from(configProposal)
      .where(eq(configProposal.id, r.run.pendingProposalId!));
    expect(card!.status).toBe("rejected");
    await expect(wf.cancelRun(actor(A), r.run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a tool that changes something is only saved with an approval step right before it", async () => {
    const send = {
      type: "tool",
      botId,
      kind: "plugin",
      target: "gmail",
      tool: "gmail_send",
      next: "e",
    };
    const bad = (nodes: object, start: string) =>
      save({ start, nodes: { ...nodes, e: { type: "end" } } });
    await expect(bad({ send }, "send")).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      bad({ p: { type: "prompt", botId, template: "x", next: "send" }, send }, "p"),
    ).rejects.toThrow(WorkflowError);
    await expect(
      bad(
        {
          c: // oxlint-disable-next-line unicorn/no-thenable
            { type: "condition", contains: "x", then: "send", else: "e" },
          send,
        },
        "c",
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
    // A read tool needs nothing; a write behind an approval is fine; a tool the server does not know is treated as a change.
    await save({ start: "r", nodes: { r: { ...send, tool: "gmail_search" }, e: { type: "end" } } });
    await save({
      start: "q",
      nodes: { q: { type: "approval", message: "ok?", next: "send" }, send, e: { type: "end" } },
    });
    await expect(
      bad(
        { m: { type: "tool", botId, kind: "mcp", target: "notion", tool: "append", next: "e" } },
        "m",
      ),
    ).rejects.toMatchObject({ code: "INVALID" });
    // A tool step names a bot of the owner's, like a prompt step.
    await expect(
      save({
        start: "r",
        nodes: { r: { ...send, botId: uuidv7(), tool: "gmail_search" }, e: { type: "end" } },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a loop of read tool calls runs to the end in one go", async () => {
    const w = await save({
      start: "src",
      nodes: {
        src: { type: "prompt", botId, template: "names", next: "each" },
        each: { type: "for_each", items: "lines", body: "look", next: "e" },
        look: {
          type: "tool",
          botId,
          kind: "plugin",
          target: "gmail",
          tool: "gmail_search",
          args: { query: "{{item}}" },
          retry: { max: 1, delayMs: 0 },
          next: "pe",
        },
        pe: { type: "item_end" },
        e: { type: "end" },
      },
    });
    const solo = createWorkflows(db, async () => ({ text: "ana\nbo" }));
    solo.useTools(tools);
    toolCalls.length = 0;
    const r = await solo.run(actor(A), w.id, "");
    expect(r.run.status).toBe("succeeded");
    expect(toolCalls.map((c) => c.args)).toEqual([{ query: "ana" }, { query: "bo" }]);
    expect(r.output).toBe("[1] result of gmail_search\n\n[2] result of gmail_search");
  });
});
