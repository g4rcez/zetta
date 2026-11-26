import type { Database } from "@zetta/db";
import { and, desc, eq, gt } from "@zetta/db/query";
import { auditEvent } from "@zetta/db/schema/features";
import {
  dockerConfig,
  harnessCommands,
  harnessHome,
  inspectHarness,
  needsCodeOnHost,
  type NativeHarness,
} from "./harness";

export const HARNESS_LABELS: Record<NativeHarness, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "OMP",
  opencode: "OpenCode",
  cursor: "Cursor",
  hermes: "Hermes",
  deepseek: "DeepSeek",
};
export type HarnessStatus = "ready" | "not_installed" | "needs_login" | "installed";

/**
 * Readiness per harness for one user. "ready" needs an installed executable AND a successful run by this user within 30 days;
 * installed with no successful run yet is "installed"; a recent auth failure is "needs_login". Paths and raw errors are never returned.
 */
export async function harnessReadiness(
  db: Database,
  userId: string,
  resolve?: (n: string) => string | null,
) {
  const out = [];
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  for (const h of Object.keys(harnessCommands) as NativeHarness[]) {
    const info = await inspectHarness(h, resolve);
    // last outcome for this harness by this user: a run records the harness that ran, which is a bot's fallback when the main one was blocked
    const rows = await db
      .select({ outcome: auditEvent.outcome, at: auditEvent.createdAt })
      .from(auditEvent)
      .where(
        and(
          eq(auditEvent.ownerUserId, userId),
          eq(auditEvent.kind, "harness_run"),
          eq(auditEvent.detail, h),
          gt(auditEvent.createdAt, since),
        ),
      )
      .orderBy(desc(auditEvent.createdAt))
      .limit(10);
    const last = rows[0]?.outcome;
    const status: HarnessStatus = !info.installed
      ? "not_installed"
      : last === "auth_required"
        ? "needs_login"
        : rows.some((r) => r.outcome === "ok") && last === "ok"
          ? "ready"
          : "installed";
    out.push({
      harness: h,
      label: HARNESS_LABELS[h],
      installed: info.installed,
      version: info.version,
      status,
      perUserLogin: Boolean(harnessHome(userId, h)),
      guidance:
        (!dockerConfig() && needsCodeOnHost(h)
          ? "On this server it runs only with code access: bots without it, and background work such as summaries, need a fallback engine. "
          : "") +
        (status === "not_installed"
          ? "Ask the administrator to install it on the server."
          : status === "needs_login"
            ? "Sign in to this tool on the server (as the account Zetta runs under), then send a test message."
            : status === "installed"
              ? "Installed. Choose it for a bot to start using it."
              : "Working."),
    });
  }
  return out;
}
