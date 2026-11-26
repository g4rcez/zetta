// What a workspace may use each month, and what it used (docs/decisions/workspaces.md, "Quotas"). Every bot run of every caller is
// admitted and counted here, through the runner (chat/harness.ts, `setRunMeter`): a run is a CLI the server starts for the workspace.
import type { Database } from "@zetta/db";
import { and, eq, sql } from "@zetta/db/query";
import { usageCounter, workspaceQuota } from "@zetta/db/schema/workspaces";
import { HarnessError, type RunMeter } from "../chat/harness";

/** The month a moment falls in, as the counters name it: `YYYY-MM`, in UTC. */
export const periodOf = (at: Date = new Date()) => at.toISOString().slice(0, 7);

export type Usage = { runs: number; runSeconds: number };
export type Quota = { runsPerMonth: number | null; runSecondsPerMonth: number | null };

export function createQuotas(db: Database, now: () => Date = () => new Date()) {
  async function usage(workspaceId: string, period = periodOf(now())): Promise<Usage> {
    const rows = await db
      .select({ metric: usageCounter.metric, value: usageCounter.value })
      .from(usageCounter)
      .where(and(eq(usageCounter.workspaceId, workspaceId), eq(usageCounter.period, period)));
    const of = (metric: string) => rows.find((r) => r.metric === metric)?.value ?? 0;
    return { runs: of("runs"), runSeconds: of("run_seconds") };
  }

  async function quota(workspaceId: string): Promise<Quota> {
    const [row] = await db
      .select({
        runsPerMonth: workspaceQuota.runsPerMonth,
        runSecondsPerMonth: workspaceQuota.runSecondsPerMonth,
      })
      .from(workspaceQuota)
      .where(eq(workspaceQuota.workspaceId, workspaceId));
    return row ?? { runsPerMonth: null, runSecondsPerMonth: null };
  }

  const add = (
    workspaceId: string,
    period: string,
    metric: "runs" | "run_seconds",
    value: number,
  ) =>
    db
      .insert(usageCounter)
      .values({ workspaceId, period, metric, value })
      .onConflictDoUpdate({
        target: [usageCounter.workspaceId, usageCounter.period, usageCounter.metric],
        set: { value: sql`${usageCounter.value} + ${value}` },
      });

  const meter: RunMeter = {
    /** Refuses a run once the workspace has used a limit root gave it. With no limit, every run goes. */
    async admit(workspaceId) {
      const limits = await quota(workspaceId);
      if (limits.runsPerMonth === null && limits.runSecondsPerMonth === null) return;
      const used = await usage(workspaceId);
      if (
        (limits.runsPerMonth !== null && used.runs >= limits.runsPerMonth) ||
        (limits.runSecondsPerMonth !== null && used.runSeconds >= limits.runSecondsPerMonth)
      )
        throw new HarnessError("workspace_quota");
    },
    /** One run more, and its seconds (rounded up), in the month it ended. */
    async record(workspaceId, ms) {
      const period = periodOf(now());
      await add(workspaceId, period, "runs", 1);
      await add(workspaceId, period, "run_seconds", Math.max(1, Math.ceil(ms / 1000)));
    },
  };

  return {
    meter,
    usage,
    quota,
    /** Root's limits for a workspace. An empty value is no limit. */
    async setQuota(workspaceId: string, limits: Quota, by: string) {
      await db
        .insert(workspaceQuota)
        .values({ workspaceId, ...limits, updatedBy: by })
        .onConflictDoUpdate({
          target: workspaceQuota.workspaceId,
          set: { ...limits, updatedBy: by, updatedAt: new Date() },
        });
      return quota(workspaceId);
    },
  };
}
export type Quotas = ReturnType<typeof createQuotas>;
