import type { Database } from "@zetta/db";
import { and, desc, eq, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { workflow, workflowRun, workflowVersion } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import type { ComputerService } from "../computer/service";
import type { DecisionService } from "../decisions/service";
import { raiseAttention } from "./attention";
import { audit } from "./audit";
import { executeGraph, graphSchema, type Graph, type TraceStep } from "./workflow";
import { instanceId, recoverable, type RecoveryScope } from "../runtime/instance";
import { assertAgentsRunning } from "../preferences/agents-state";

export class WorkflowError extends Error {
  constructor(
    readonly code: "CONFLICT" | "INVALID" | "BOT_NOT_READY",
    readonly detail?: string,
  ) {
    super(code);
  }
}
const first = <T>(rows: T[]): T => {
  if (!rows[0]) throw new AccessError("NOT_FOUND");
  return rows[0];
};

type RunTurn = (t: {
  userId: string;
  bot: typeof bot.$inferSelect;
  history: [];
  prompt: string;
}) => Promise<{ text: string }>;
export function createWorkflows(
  db: Database,
  run: RunTurn,
  decisions?: DecisionService,
  computer?: ComputerService,
  sources?: { briefing: (a: { userId: string; isAdmin: boolean }) => Promise<{ prompt: string }> },
) {
  /** A bot may be used in a workflow only if it is visible to the user AND ready (onboarded). */
  async function readyBot(userId: string, botId: string) {
    const [b] = await db
      .select()
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.archived, false)));
    if (!b || (b.ownerUserId !== userId && b.visibility !== "team"))
      throw new AccessError("NOT_FOUND");
    if (!b.onboarded) throw new WorkflowError("BOT_NOT_READY", b.name);
    // Scheduled/automated runs have no per-run account injection yet: a bot that needs the user's own accounts fails closed instead of running on the server's login.
    if (b.requiredConnections.length) throw new WorkflowError("BOT_NOT_READY", b.name);
    return b;
  }
  function parseGraph(raw: unknown): Graph {
    const r = graphSchema.safeParse(raw);
    if (!r.success)
      throw new WorkflowError("INVALID", r.error.issues.map((i) => i.message).join(" "));
    return r.data;
  }

  async function runFor(
    userId: string,
    wfId: string,
    input: string,
    requestKey?: string,
    signal?: AbortSignal,
  ) {
    // Workflow nodes run bots directly (not through a chat turn), so "pause everything" has to be checked here too.
    await assertAgentsRunning(db, userId);
    const [w] = await db
      .select()
      .from(workflow)
      .where(and(eq(workflow.id, wfId), eq(workflow.ownerUserId, userId)));
    const wf = first(w ? [w] : []);
    if (requestKey) {
      const [prior] = await db
        .select()
        .from(workflowRun)
        .where(and(eq(workflowRun.workflowId, wf.id), eq(workflowRun.requestKey, requestKey)));
      if (prior)
        return {
          run: prior,
          output: (prior.trace as TraceStep[]).findLast((t) => t.output)?.output ?? "",
          replayed: true,
        };
    }
    const [v] = await db
      .select()
      .from(workflowVersion)
      .where(and(eq(workflowVersion.workflowId, wf.id), eq(workflowVersion.version, wf.version)));
    const graph = parseGraph(v?.graph ?? wf.graph);
    const [created] = await db
      .insert(workflowRun)
      .values({
        workflowId: wf.id,
        ownerUserId: userId,
        workflowVersion: wf.version,
        status: "running",
        ownerInstance: instanceId(),
        trace: [],
        requestKey: requestKey ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const [prior] = await db
        .select()
        .from(workflowRun)
        .where(and(eq(workflowRun.workflowId, wf.id), eq(workflowRun.requestKey, requestKey!)));
      return { run: prior!, output: "", replayed: true };
    }
    const result = await executeGraph(graph, input, {
      signal,
      runPrompt: async (botId, prompt) => {
        const b = await readyBot(userId, botId);
        return (await run({ userId, bot: b, history: [], prompt })).text;
      },
      decide: decisions
        ? async (subject, question, options) => {
            const r = await decisions.choose(subject, question, options, { minConfidence: 0.5 });
            if (r.choice === null)
              throw Object.assign(new Error("uncertain"), { name: "DecisionUncertain" });
            return r.choice;
          }
        : undefined,
      browse: computer ? (url) => computer.read(userId, "workflow", url) : undefined,
      sources: sources
        ? async () => (await sources.briefing({ userId, isAdmin: false })).prompt
        : undefined,
      onStep: async (trace) => {
        await db.update(workflowRun).set({ trace }).where(eq(workflowRun.id, created.id));
      },
    });
    const visited = new Set(result.trace.map((t) => t.node));
    const skipped: TraceStep[] = Object.entries(graph.nodes)
      .filter(([n]) => !visited.has(n))
      .map(([n, node]) => ({ node: n, type: node.type, skipped: true }));
    const [saved] = await db
      .update(workflowRun)
      .set({
        status: result.status === "cancelled" ? "cancelled" : result.status,
        trace: [...result.trace, ...skipped],
        finishedAt: new Date(),
      })
      .where(eq(workflowRun.id, created.id))
      .returning();
    await audit(db, userId, {
      kind: "workflow_run",
      subjectId: wf.id,
      outcome:
        result.status === "succeeded"
          ? "ok"
          : result.status === "cancelled"
            ? "cancelled"
            : "failed",
      detail: result.status,
    });
    if (result.status === "failed") {
      const failedStep = result.trace.findLast((t) => t.error);
      await raiseAttention(db, userId, {
        title: `Workflow "${wf.name}" failed`,
        detail: failedStep
          ? `Step "${failedStep.node}" (${failedStep.type}) could not finish.`
          : "A step could not finish.",
        nextAction: "Open the run, fix the failing step, then run again.",
        resultLink: `/studio?workflow=${wf.id}`,
        source: "workflow",
        sourceKey: `workflow:${wf.id}:failed`,
        completed: result.trace
          .filter((t) => !t.error)
          .map((t) => t.node)
          .join(", "),
        remaining: Object.keys(graph.nodes)
          .filter((n) => !visited.has(n))
          .join(", "),
      });
    }
    return { run: saved!, output: result.output, replayed: false };
  }

  return {
    list: (a: ActiveActor) =>
      db
        .select()
        .from(workflow)
        .where(eq(workflow.ownerUserId, a.userId))
        .orderBy(desc(workflow.createdAt)),
    async get(a: ActiveActor, id: string) {
      const [w] = await db
        .select()
        .from(workflow)
        .where(and(eq(workflow.id, id), eq(workflow.ownerUserId, a.userId)));
      return first(w ? [w] : []);
    },
    /** Creating makes version 1. Updating needs `expectedVersion`; every save appends an immutable version, runs use the latest. */
    async save(
      a: ActiveActor,
      v: { id?: string; name: string; graph: unknown; expectedVersion?: number },
    ) {
      const graph = parseGraph(v.graph);
      for (const n of Object.values(graph.nodes))
        if (n.type === "prompt") {
          const [b] = await db
            .select()
            .from(bot)
            .where(and(eq(bot.id, n.botId), eq(bot.archived, false)));
          if (!b || (b.ownerUserId !== a.userId && b.visibility !== "team"))
            throw new AccessError("NOT_FOUND");
        }
      if (!v.id) {
        const w = first(
          await db
            .insert(workflow)
            .values({ ownerUserId: a.userId, name: v.name, graph })
            .returning(),
        );
        await db.insert(workflowVersion).values({ workflowId: w.id, version: 1, graph });
        return w;
      }
      const [row] = await db
        .update(workflow)
        .set({ name: v.name, graph, version: sql`${workflow.version} + 1` })
        .where(
          and(
            eq(workflow.id, v.id),
            eq(workflow.ownerUserId, a.userId),
            eq(workflow.version, v.expectedVersion ?? -1),
          ),
        )
        .returning();
      if (!row) {
        const [exists] = await db
          .select({ id: workflow.id })
          .from(workflow)
          .where(and(eq(workflow.id, v.id), eq(workflow.ownerUserId, a.userId)));
        if (!exists) throw new AccessError("NOT_FOUND");
        throw new WorkflowError("CONFLICT");
      }
      await db.insert(workflowVersion).values({ workflowId: row.id, version: row.version, graph });
      return row;
    },
    validate: (graph: unknown) => {
      const r = graphSchema.safeParse(graph);
      return r.success
        ? { ok: true as const }
        : { ok: false as const, problems: r.error.issues.map((i) => i.message) };
    },
    run: (a: ActiveActor, id: string, input: string, requestKey?: string, signal?: AbortSignal) =>
      runFor(a.userId, id, input, requestKey, signal),
    runForOwner: (userId: string, id: string, input: string) => runFor(userId, id, input),
    async runs(a: ActiveActor, id: string) {
      return db
        .select()
        .from(workflowRun)
        .where(and(eq(workflowRun.workflowId, id), eq(workflowRun.ownerUserId, a.userId)))
        .orderBy(desc(workflowRun.createdAt))
        .limit(20);
    },
    async recoverInterrupted(scope?: RecoveryScope) {
      const rows = await db
        .update(workflowRun)
        .set({ status: "interrupted", finishedAt: new Date() })
        .where(
          and(eq(workflowRun.status, "running"), recoverable(workflowRun.ownerInstance, scope)),
        )
        .returning();
      for (const r of rows)
        await raiseAttention(db, r.ownerUserId, {
          title: "A workflow run was interrupted by a restart",
          detail: "The server stopped while it was running; completed steps are in the trace.",
          nextAction: "Open the run and run the workflow again if needed.",
          resultLink: `/studio?workflow=${r.workflowId}`,
          source: "workflow",
          sourceKey: `workflow:${r.workflowId}:interrupted`,
        });
      return rows.length;
    },
  };
}
export type Workflows = ReturnType<typeof createWorkflows>;
