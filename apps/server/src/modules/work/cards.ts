import { MANAGER_WORK_KINDS, type WorkCardKind, type WorkData } from "@zetta/core/work-suggestions";
import type { Database } from "@zetta/db";
import { raiseAttention } from "../features/attention";
import { chartManager, chartNote, canReadTask, headsUpText } from "../org/work-note";
import { followKey } from "../tasks/store";
import type { TaskFacts } from "./facts";

/**
 * The words of each work card. Titles and details are also what a desktop notification shows, so they stand alone and use no word of
 * the code: a manager reads "stopped", "blocked", "has not answered".
 */

const title = (t: { title: string }) => `“${t.title.slice(0, 80)}”`;
const who = (f: TaskFacts) => f.worker?.name ?? "Nobody";

/** Why a task stopped, as the task-follow code wrote it, in a manager's words. An unknown reason is kept as a sentence. */
export function plainStop(reason: string): string {
  const r = reason.trim();
  const tries = /^no progress recorded in the last (\d+)/.exec(r);
  if (tries) return `It tried ${tries[1]} times and nothing changed.`;
  const cap = /^(\d+) follow-ups and the task is still open/.exec(r);
  if (cap) return `It came back to the task ${cap[1]} times without finishing it.`;
  const failed = /^failed (\d+) times in a row: (.*)$/s.exec(r);
  if (failed) return `It failed ${failed[1]} times in a row: ${sentence(failed[2]!)}`;
  if (r === "the room is closed") return "The room it was working in was closed.";
  return r ? sentence(r) : "";
}
const sentence = (text: string) => {
  const t = text.trim();
  if (!t) return "";
  const first = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
};

/** "It was on step 3 of 5." Nothing when the task has no steps, or all of them are done. */
export const stepLine = (f: Pick<TaskFacts, "stepsDone" | "stepsTotal">) =>
  f.stepsTotal > 0 && f.stepsDone < f.stepsTotal
    ? `It was on step ${f.stepsDone + 1} of ${f.stepsTotal}.`
    : "";

export type StuckWhy =
  /** The server stopped calling the bot back; `reason` is what the task-follow code wrote. */
  | { kind: "stopped"; reason: string }
  /** A bot task nobody calls the bot back for, with no change for a while. */
  | { kind: "idle" }
  /** A person was asked and has not touched the task. */
  | { kind: "unanswered" }
  /** A person's task went quiet, they were asked about it and did not answer. */
  | { kind: "no_reply" };

export function stuckText(f: TaskFacts, why: StuckWhy): { title: string; detail: string } {
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  if (why.kind === "stopped")
    return {
      title: `${who(f)} stopped on ${title(f.task)}`,
      detail: join(stepLine(f), plainStop(why.reason)),
    };
  if (why.kind === "idle")
    return {
      title: `${who(f)} has not moved ${title(f.task)}`,
      detail: join(stepLine(f), "Nothing changed on it for a while, and it is not finished."),
    };
  if (why.kind === "unanswered")
    return {
      title: `${who(f)} has not answered about ${title(f.task)}`,
      detail: "They were asked and have not started on it or said anything yet.",
    };
  return {
    title: `${who(f)} has not answered about ${title(f.task)}`,
    detail:
      "Nothing changed on it for days, and they did not answer when asked if they are still on it.",
  };
}

export const blockedText = (f: TaskFacts) => ({
  title: `${who(f)} is blocked on ${title(f.task)}`,
  detail: f.task.progress.trim() || "They did not say what is in the way.",
});

export const checkinText = (f: TaskFacts) => ({
  title: `Still working on ${title(f.task)}?`,
  detail: `Nothing changed on it for a few days. One tap is enough: ${f.ownerName} only hears about it if you are blocked or do not answer.`,
});

export const nudgeText = (f: TaskFacts, text: string) => ({
  title: `${f.ownerName} about ${title(f.task)}`,
  detail: text,
});

/** The key of each card: one live card per task and kind. A stopped task keeps the key the task store already closes. */
export const workKey = (kind: WorkCardKind, taskId: string) =>
  kind === "work_stuck" ? followKey(taskId) : `${kind.replace("_", "-")}:${taskId}`;

/** A manager card goes to the owner of the task; a card for the person asked goes to them. */
export const recipientOf = (kind: WorkCardKind, f: TaskFacts) =>
  MANAGER_WORK_KINDS.includes(kind) ? f.task.ownerUserId : (f.task.assigneeUserId ?? "");

export async function raiseWork(
  db: Pick<Database, "insert" | "update" | "select">,
  kind: WorkCardKind,
  f: TaskFacts,
  text: { title: string; detail: string },
  work?: WorkData,
) {
  const to = recipientOf(kind, f);
  if (!to) return undefined;
  // The company chart may name somebody else who should hear. The card stays with the owner, the only one who can act on the task; that
  // person gets a read-only heads-up (see `headsUp`).
  const manager = MANAGER_WORK_KINDS.includes(kind)
    ? await chartManager(db, { ownerUserId: f.task.ownerUserId, worker: f.worker }).catch(
        () => undefined,
      )
    : undefined;
  const note = chartNote(manager, f.worker?.name ?? "It");
  const card = await raiseAttention(db, to, {
    kind,
    subjectId: f.task.id,
    // The bot's face on the card when a bot does the task; a person is named in the title.
    botId: f.worker?.kind === "bot" ? f.worker.id : null,
    title: text.title,
    detail: note ? `${text.detail} ${note}` : text.detail,
    resultLink: `/tasks/${f.task.id}`,
    source: "bot",
    sourceKey: workKey(kind, f.task.id),
    ...(work && { work }),
  });
  if (manager)
    await headsUp(db, kind, f, text.detail, manager).catch(() => {
      // The owner's card is what matters: a heads-up that failed is not worth losing it.
    });
  return card;
}

/** The person the chart puts above whoever does the task hears about it, with no button: only the owner of the task can act on it. */
async function headsUp(
  db: Pick<Database, "insert" | "update" | "select">,
  kind: WorkCardKind,
  f: TaskFacts,
  detail: string,
  manager: { userId: string },
) {
  const canRead = await canReadTask(db, f.task, manager.userId);
  const words = headsUpText(kind, {
    workerName: f.worker?.name ?? "Someone",
    ownerName: f.ownerName,
    taskTitle: f.task.title,
    detail,
    canRead,
  });
  await raiseAttention(db, manager.userId, {
    kind: "work_heads_up",
    subjectId: f.task.id,
    title: words.title,
    detail: words.detail,
    ...(canRead && { resultLink: `/tasks/${f.task.id}` }),
    source: "bot",
    sourceKey: `heads-up:${kind}:${f.task.id}`,
  });
}
