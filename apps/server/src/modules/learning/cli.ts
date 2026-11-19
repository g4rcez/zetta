import type { Database } from "@zetta/db";
import type { TokenUsage } from "../chat/claude-stream";
import type { RunCli } from "../chat/harness";
import { audit } from "../features/audit";

/**
 * Wraps the one-shot engine call so every run of background learning work is written down with its token counts (an `audit_event` of
 * kind `learning_run`, never counted as a bot's run). Token cost is one of the three limits of this work, so it has to be visible:
 * the numbers are what the light-run comparison and the cost line of a bot's learning page read.
 *
 * `label` is a short closed word for what the run was for (`batch`, `screen`...); it is the row's `detail`.
 */
export function withTokenAudit(db: Database, base: RunCli, label: string): RunCli {
  return async (input) => {
    const started = Date.now();
    let usage: TokenUsage | undefined;
    const settle = (outcome: "ok" | "failed") =>
      input.userId
        ? audit(db, input.userId, {
            kind: "learning_run",
            outcome,
            botId: input.botId ?? null,
            detail: label,
            ...(usage ? { usage } : {}),
            durationMs: Date.now() - started,
          })
        : undefined;
    try {
      const out = await base({
        ...input,
        onUsage: (u) => {
          usage = u;
          input.onUsage?.(u);
        },
      });
      void settle("ok");
      return out;
    } catch (e) {
      void settle("failed");
      throw e;
    }
  };
}
