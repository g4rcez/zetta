/**
 * Limits of the task follow-up: the heartbeat (heartbeat.ts) calls a bot back while a task it follows is open. These numbers are shared by
 * the store (what a bot may ask for), the heartbeat (when it acts) and the tool text (what the bot is told).
 */

/** A check waits until the bot's chat has been quiet this long, so a follow-up never lands on top of the user typing. */
export const QUIET_MS = 2 * 60_000;
/** The furthest a bot may schedule its own next check (`checkAt`): "look at the deploy again in an hour", not "next month". */
export const MAX_CHECK_AHEAD_MS = 7 * 24 * 60 * 60_000;
/** Follow-up turns for one task before it pauses and asks the user whether to go on. */
export const MAX_CHECKS = 40;
/** Checks in a row where nothing on the task changed before the task pauses. */
export const STALL_PAUSE = 3;
/** Subtasks of one task, and the most one `add` block may create. */
export const MAX_SUBTASKS = 30;
export const MAX_SUBTASKS_PER_ADD = 20;
/** The progress note a bot keeps on a task. */
export const PROGRESS_MAX = 2000;

/** The statuses in which a task is still open work. */
export const OPEN_STATUSES = ["backlog", "in_progress"] as const;

/** Why a task rule refused a change. The message is written for the bot: it goes back as the tool result. */
export class TaskRuleError extends Error {
  constructor(
    readonly code:
      | "SUBTASK_OF_SUBTASK"
      | "TOO_MANY_SUBTASKS"
      | "OPEN_SUBTASKS"
      | "SUBTASK_FOLLOW_UP"
      | "BAD_CHECK_TIME",
    message: string,
  ) {
    super(message);
    this.name = "TaskRuleError";
  }
}
