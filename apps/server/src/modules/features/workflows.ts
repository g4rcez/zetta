import type { Database } from "@zetta/db";
import { and, desc, eq, isNull, lte, ne, sql } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { configProposal, workflow, workflowRun, workflowVersion } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import { first } from "./first";
import type { ComputerService } from "../computer/service";
import type { DecisionService } from "../decisions/service";
import { insertProposal } from "../chat/proposals";
import { raiseAttention } from "./attention";
import { audit } from "./audit";
import {
  executeGraph,
  graphSchema,
  type Cursor,
  type Graph,
  type GraphNode,
  type RunOutcome,
  type ToolCallSpec,
  type TraceStep,
} from "./workflow";
import { instanceId, recoverable, type RecoveryScope } from "../runtime/instance";
import { topics } from "@zetta/core/live-topics";
import { events } from "../events/bus";
import { AgentsPausedError, assertAgentsRunning } from "../preferences/agents-state";

export class WorkflowError extends Error {
  constructor(
    readonly code: "CONFLICT" | "INVALID" | "BOT_NOT_READY",
    readonly detail?: string,
  ) {
    super(code);
  }
}

type RunTurn = (t: {
  userId: string;
  bot: typeof bot.$inferSelect;
  history: [];
  prompt: string;
}) => Promise<{ text: string }>;

/**
 * What a `tool` step needs from the rest of the server (built in services.ts, where plugins, MCP servers and apps exist): the call, with the
 * bot's grants, and whether the tool only reads or may change something.
 */
export type WorkflowTools = {
  call(userId: string, call: ToolCallSpec): Promise<string>;
  effect(
    userId: string,
    call: Pick<ToolCallSpec, "kind" | "target" | "tool">,
  ): Promise<"read" | "write">;
};

/** A line for the person about a step: what it is and does. */
export function describeStep(n: GraphNode | undefined): string {
  if (!n) return "the end of the workflow";
  switch (n.type) {
    case "tool":
      return `call ${n.tool} of ${n.kind} ${n.target}`;
    case "prompt":
      return "ask a bot";
    case "browse":
      return `read ${n.url}`;
    case "sources":
      return "read your sources";
    case "wait":
      return "wait";
    case "approval":
      return "ask you again";
    case "for_each":
      return "repeat steps for each item";
    case "end":
      return "the end of the workflow";
    default:
      return n.type;
  }
}

export function createWorkflows(
  db: Database,
  run: RunTurn,
  decisions?: DecisionService,
  computer?: ComputerService,
  sources?: { briefing: (a: { userId: string; isAdmin: boolean }) => Promise<{ prompt: string }> },
) {
  let tools: WorkflowTools | undefined;
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

  /** What a run does with the world: the bots, the decision model, the browser, the sources and the tools of the owner. */
  function effectsFor(
    userId: string,
    onStep: (trace: TraceStep[]) => Promise<void>,
    signal?: AbortSignal,
  ) {
    return {
      signal,
      runPrompt: async (botId: string, prompt: string) => {
        const b = await readyBot(userId, botId);
        return (await run({ userId, bot: b, history: [], prompt })).text;
      },
      decide: decisions
        ? async (subject: string, question: string, options: string[]) => {
            const r = await decisions.choose(subject, question, options, { minConfidence: 0.5 });
            if (r.choice === null)
              throw Object.assign(new Error("uncertain"), { name: "DecisionUncertain" });
            return r.choice;
          }
        : undefined,
      browse: computer ? (url: string) => computer.read(userId, "workflow", url) : undefined,
      sources: sources
        ? async () => (await sources.briefing({ userId, isAdmin: false })).prompt
        : undefined,
      tool: tools
        ? async (call: ToolCallSpec) => {
            await readyBot(userId, call.botId);
            return tools!.call(userId, call);
          }
        : undefined,
      onStep,
    };
  }

  /** Runs (or continues) a graph, then keeps what happened: a pause with its card or time, or the end with its audit and card. */
  async function drive(
    userId: string,
    wf: typeof workflow.$inferSelect,
    runId: string,
    graph: Graph,
    input: string,
    resume?: { trace: TraceStep[]; cursor: Cursor },
    signal?: AbortSignal,
  ) {
    const result: RunOutcome = await executeGraph(
      graph,
      input,
      effectsFor(
        userId,
        async (trace) => {
          await db.update(workflowRun).set({ trace }).where(eq(workflowRun.id, runId));
        },
        signal,
      ),
      undefined,
      undefined,
      resume,
    );
    if (result.status === "waiting") {
      let pending: string | null = null;
      if (result.wait.kind === "approval") {
        const next = result.cursor.at ? graph.nodes[result.cursor.at] : undefined;
        const card = await insertProposal(db, {
          ownerUserId: userId,
          kind: "chief_action",
          baseVersion: 0,
          patch: {
            tool: "workflow_gate",
            title: `Workflow “${wf.name}” needs your yes`,
            runId,
            workflowId: wf.id,
            step: result.wait.node,
          },
          diff: [
            { field: "workflow", from: null, to: wf.name },
            { field: "it asks", from: null, to: result.wait.message },
            { field: "if you approve, next", from: null, to: describeStep(next) },
          ],
          resultLink: `/studio?workflow=${wf.id}`,
        });
        pending = card.id;
      }
      const [saved] = await db
        .update(workflowRun)
        .set({
          status: "waiting",
          trace: result.trace,
          cursor: result.cursor,
          resumeAt: result.wait.kind === "time" ? new Date(result.wait.resumeAt) : null,
          pendingProposalId: pending,
          ownerInstance: null,
        })
        .where(eq(workflowRun.id, runId))
        .returning();
      events.publish([userId], topics.workflows);
      return { run: saved!, output: result.output, replayed: false };
    }
    const visited = new Set(result.trace.map((t) => t.node));
    const skipped: TraceStep[] = Object.entries(graph.nodes)
      .filter(([n]) => !visited.has(n))
      .map(([n, node]) => ({ node: n, type: node.type, skipped: true }));
    const [saved] = await db
      .update(workflowRun)
      .set({
        status: result.status === "cancelled" ? "cancelled" : result.status,
        trace: [...result.trace, ...skipped],
        cursor: null,
        resumeAt: null,
        pendingProposalId: null,
        finishedAt: new Date(),
      })
      .where(eq(workflowRun.id, runId))
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
        kind: "workflow_failed",
        subjectId: wf.id,
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
    events.publish([userId], topics.workflows);
    return { run: saved!, output: result.output, replayed: false };
  }

  async function runFor(
    userId: string,
    wfId: string,
    input: string,
    requestKey?: string,
    signal?: AbortSignal,
    link?: { routineRunId?: string },
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
        input,
        routineRunId: link?.routineRunId ?? null,
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
    return drive(userId, wf, created.id, graph, input, undefined, signal);
  }

  /** The owner's say on a step that waits for approval: on yes the run goes on after it; on no, or when the card ran out, it ends as cancelled. */
  async function resumeRun(row: typeof workflowRun.$inferSelect, approved: boolean | undefined) {
    const [w] = await db.select().from(workflow).where(eq(workflow.id, row.workflowId));
    if (!w) return;
    const [v] = await db
      .select()
      .from(workflowVersion)
      .where(
        and(eq(workflowVersion.workflowId, w.id), eq(workflowVersion.version, row.workflowVersion)),
      );
    const trace = row.trace as TraceStep[];
    if (approved === false) {
      const last = trace.at(-1);
      await db
        .update(workflowRun)
        .set({
          status: "cancelled",
          trace: last
            ? [...trace.slice(0, -1), { ...last, output: `${last.output ?? ""} — not approved` }]
            : trace,
          cursor: null,
          pendingProposalId: null,
          finishedAt: new Date(),
        })
        .where(eq(workflowRun.id, row.id));
      await audit(db, row.ownerUserId, {
        kind: "workflow_run",
        subjectId: w.id,
        outcome: "cancelled",
        detail: "not_approved",
      });
      return;
    }
    const noted =
      approved === true && trace.at(-1)
        ? [
            ...trace.slice(0, -1),
            { ...trace.at(-1)!, output: `${trace.at(-1)!.output ?? ""} — approved` },
          ]
        : trace;
    await drive(row.ownerUserId, w, row.id, parseGraph(v?.graph ?? w.graph), row.input, {
      trace: noted,
      cursor: row.cursor as Cursor,
    });
  }

  /** Claims one waiting row for this instance; false when another process (or a cancel) got there first. */
  async function claim(id: string) {
    const [row] = await db
      .update(workflowRun)
      .set({ status: "running", ownerInstance: instanceId(), resumeAt: null })
      .where(and(eq(workflowRun.id, id), eq(workflowRun.status, "waiting")))
      .returning();
    return row;
  }

  return {
    /** Gives the `tool` step its bridge to plugins, MCP servers and apps (built where those exist). */
    useTools(t: WorkflowTools) {
      tools = t;
    },
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
      const entries = Object.entries(graph.nodes);
      for (const [, n] of entries)
        if (n.type === "prompt" || n.type === "tool") {
          const [b] = await db
            .select()
            .from(bot)
            .where(and(eq(bot.id, n.botId), eq(bot.archived, false)));
          if (!b || (b.ownerUserId !== a.userId && b.visibility !== "team"))
            throw new AccessError("NOT_FOUND");
        }
      // A tool that changes something runs only after the person said yes to that step: every way into it is an approval step.
      for (const [name, n] of entries) {
        if (n.type !== "tool") continue;
        const effect = tools
          ? await tools.effect(a.userId, n).catch(() => "write" as const)
          : "write";
        if (effect === "read") continue;
        const into = entries.filter(([, p]) =>
          p.type === "for_each"
            ? p.body === name || p.next === name
            : p.type === "condition"
              ? p.then === name || p.else === name
              : p.type === "decision"
                ? Object.values(p.choices).includes(name)
                : "next" in p && p.next === name,
        );
        if (name === graph.start || !into.length || into.some(([, p]) => p.type !== "approval"))
          throw new WorkflowError(
            "INVALID",
            `Step "${name}" (${n.tool}) may change something, so an approval step has to come right before it.`,
          );
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
    /** Answers at the first pause or at the end: a run that waits comes back with status "waiting". */
    run: (a: ActiveActor, id: string, input: string, requestKey?: string, signal?: AbortSignal) =>
      runFor(a.userId, id, input, requestKey, signal),
    runForOwner: (userId: string, id: string, input: string, link?: { routineRunId?: string }) =>
      runFor(userId, id, input, undefined, undefined, link),
    async runs(a: ActiveActor, id: string) {
      return db
        .select()
        .from(workflowRun)
        .where(and(eq(workflowRun.workflowId, id), eq(workflowRun.ownerUserId, a.userId)))
        .orderBy(desc(workflowRun.createdAt))
        .limit(20);
    },
    /** Ends a waiting run now. Its approval card, if it is still open, is closed with it. */
    async cancelRun(a: ActiveActor, runId: string) {
      const [row] = await db
        .update(workflowRun)
        .set({ status: "cancelled", cursor: null, resumeAt: null, finishedAt: new Date() })
        .where(
          and(
            eq(workflowRun.id, runId),
            eq(workflowRun.ownerUserId, a.userId),
            eq(workflowRun.status, "waiting"),
          ),
        )
        .returning();
      if (!row) throw new AccessError("NOT_FOUND");
      if (row.pendingProposalId)
        await db
          .update(configProposal)
          .set({ status: "rejected", decidedAt: new Date(), decidedBy: "auto" })
          .where(
            and(eq(configProposal.id, row.pendingProposalId), eq(configProposal.status, "pending")),
          );
      await audit(db, a.userId, {
        kind: "workflow_run",
        subjectId: row.workflowId,
        outcome: "cancelled",
        detail: "cancelled",
      });
      return row;
    },
    /**
     * The 30-second tick: wakes waiting runs whose time came, and the ones whose approval card was decided (yes goes on, no or an
     * expired card cancels). A person's paused agents keep their runs waiting. Each run is claimed before it runs.
     */
    async tick(limit = 5) {
      let woken = 0;
      const candidates = [
        ...(await db
          .select()
          .from(workflowRun)
          .where(
            and(
              eq(workflowRun.status, "waiting"),
              isNull(workflowRun.pendingProposalId),
              lte(workflowRun.resumeAt, new Date()),
            ),
          )
          .orderBy(workflowRun.resumeAt)
          .limit(limit)
          .then((rows) =>
            rows.map((row) => ({ row, approved: undefined as boolean | undefined })),
          )),
        ...(await db
          .select({ row: workflowRun, status: configProposal.status })
          .from(workflowRun)
          .innerJoin(configProposal, eq(configProposal.id, workflowRun.pendingProposalId))
          .where(and(eq(workflowRun.status, "waiting"), ne(configProposal.status, "pending")))
          .limit(limit)
          .then((rows) => rows.map((r) => ({ row: r.row, approved: r.status === "approved" })))),
      ];
      for (const { row, approved } of candidates) {
        try {
          // A rejection or an expiry does not run anything, so it goes through even while agents are paused.
          if (approved !== false) await assertAgentsRunning(db, row.ownerUserId);
        } catch (e) {
          if (e instanceof AgentsPausedError) continue;
          throw e;
        }
        const mine = await claim(row.id);
        if (!mine) continue;
        woken++;
        await resumeRun(mine, approved).catch(async (e) => {
          console.error(
            `workflows: resume failed id=${mine.id} name=${(e as Error | undefined)?.name ?? typeof e}`,
          );
          await db
            .update(workflowRun)
            .set({ status: "failed", finishedAt: new Date(), cursor: null })
            .where(and(eq(workflowRun.id, mine.id), eq(workflowRun.status, "running")));
        });
      }
      return woken;
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
          kind: "workflow_interrupted",
          subjectId: r.workflowId,
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
