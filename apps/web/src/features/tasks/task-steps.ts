import type { Task } from "./tasks-api";

/**
 * Steps (subtasks) of a task. The server sends them in the same list as the tasks; the board shows only the top-level ones and a
 * "3/5" chip, and the task view shows the steps as a checklist.
 */
export const isStep = (t: Pick<Task, "parentTaskId">) => t.parentTaskId !== null;
export const topLevel = (all: Task[]) => all.filter((t) => !isStep(t));

/** Creation order: steps added in one write share `createdAt`, and the ids (UUID v7) grow, so the id breaks the tie. */
const byCreation = (a: Task, b: Task) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;
export const stepsOf = (all: Task[], id: string) =>
  all.filter((t) => t.parentTaskId === id).sort(byCreation);

export type StepCount = { done: number; total: number };
export function stepCounts(all: Task[]): Map<string, StepCount> {
  const counts = new Map<string, StepCount>();
  for (const t of all) {
    if (!t.parentTaskId) continue;
    const c = counts.get(t.parentTaskId) ?? { done: 0, total: 0 };
    c.total += 1;
    if (t.status === "done") c.done += 1;
    counts.set(t.parentTaskId, c);
  }
  return counts;
}

export type FollowUpView = { label: string; tone: "info" | "warning"; detail: string };
/** How a task's follow-up shows: nothing when nobody follows it, "Following" while the bot is called back, "Paused" with the reason. */
export function followUpView(
  t: Pick<Task, "followUp" | "followUpReason" | "status">,
): FollowUpView | null {
  if (t.followUp === "paused")
    return { label: "Paused", tone: "warning", detail: t.followUpReason ?? "" };
  if (t.followUp === "auto" && (t.status === "backlog" || t.status === "in_progress"))
    return { label: "Following", tone: "info", detail: t.followUpReason ?? "" };
  return null;
}
