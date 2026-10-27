import type { Database } from "@zetta/db";
import { and, desc, eq, gt } from "@zetta/db/query";
import { auditEvent } from "@zetta/db/schema/features";
import { bot } from "@zetta/db/schema/chat";
import { harnessCommands, harnessHome, inspectHarness, type NativeHarness } from "./harness";

export const HARNESS_LABELS: Record<NativeHarness, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "OMP",
  opencode: "OpenCode",
  cursor: "Cursor",
  hermes: "Hermes",
};
export type HarnessStatus = "ready" | "not_installed" | "needs_login" | "unverified";

/**
 * Readiness per harness for one user. "ready" needs an installed executable AND a successful run by this user within 30 days;
 * installed but never verified is "unverified"; a recent auth failure is "needs_login". Paths and raw errors are never returned.
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
    // last outcome for this harness by this user, via the bots that use it
    const rows = await db
      .select({ outcome: auditEvent.outcome, at: auditEvent.createdAt })
      .from(auditEvent)
      .innerJoin(bot, eq(bot.id, auditEvent.botId))
      .where(
        and(
          eq(auditEvent.ownerUserId, userId),
          eq(auditEvent.kind, "harness_run"),
          eq(bot.harness, h),
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
          : "unverified";
    out.push({
      harness: h,
      label: HARNESS_LABELS[h],
      installed: info.installed,
      version: info.version,
      status,
      perUserLogin: Boolean(harnessHome(userId, h)),
      guidance:
        status === "not_installed"
          ? "Ask the administrator to install it on the server."
          : status === "needs_login"
            ? "Sign in to this tool on the server (as the account Zetta runs under), then send a test message."
            : status === "unverified"
              ? "Installed. Send a test message in a bot that uses it to verify it works."
              : "Working.",
    });
  }
  return out;
}
