import { workingDaysBetween } from "./working-days";

/**
 * How a project stands, in one word and one sentence a manager can read without knowing the product. The word is the state; the web app
 * shows it as a label ("Needs you", "Quiet", "On track", "Done", "On hold") and the sentence next to it.
 */
export const PROJECT_HEALTH_STATES = ["needs_you", "quiet", "on_track", "done", "on_hold"] as const;
export type ProjectHealthState = (typeof PROJECT_HEALTH_STATES)[number];
export type ProjectHealth = { state: ProjectHealthState; sentence: string };

export const PROJECT_HEALTH_LABELS: Record<ProjectHealthState, string> = {
  needs_you: "Needs you",
  quiet: "Quiet",
  on_track: "On track",
  done: "Done",
  on_hold: "On hold",
};

/** Working days with no change before a project with open work reads as quiet. */
export const QUIET_PROJECT_DAYS = 3;

export type ProjectHealthInput = {
  status: "active" | "paused" | "done" | "archived";
  /** Top-level tasks of the project. */
  total: number;
  done: number;
  inProgress: number;
  /** Things waiting on the person who reads it. A person who is not the owner always gets 0. */
  needsYou: number;
  /** The newest change on any task of the project. */
  lastChange: Date | null;
  now: Date;
  timeZone?: string;
};

const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

export function projectHealth(p: ProjectHealthInput): ProjectHealth {
  const progress = p.total ? `${p.done} of ${p.total} done.` : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  if (p.status === "archived") return { state: "done", sentence: join("Archived.", progress) };
  if (p.status === "done") return { state: "done", sentence: join("Finished.", progress) };
  if (p.status === "paused")
    return { state: "on_hold", sentence: join("Nobody is working on it for now.", progress) };
  if (p.needsYou > 0)
    return {
      state: "needs_you",
      sentence: join(
        `${tasks(p.needsYou)} ${p.needsYou === 1 ? "is" : "are"} waiting on you.`,
        progress,
      ),
    };
  if (!p.total) return { state: "quiet", sentence: "Nothing has been asked for yet." };
  if (p.done === p.total)
    return {
      state: "on_track",
      sentence: `All ${tasks(p.total)} ${p.total === 1 ? "is" : "are"} done.`,
    };
  const idle = p.lastChange ? workingDaysBetween(p.lastChange, p.now, p.timeZone) : 0;
  if (idle >= QUIET_PROJECT_DAYS)
    return {
      state: "quiet",
      sentence: join(`Nothing has moved in ${idle} working days.`, progress),
    };
  return {
    state: "on_track",
    sentence: join(p.inProgress ? `${p.inProgress} in progress.` : "", progress),
  };
}
