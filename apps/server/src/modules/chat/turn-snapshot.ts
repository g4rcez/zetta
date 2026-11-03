import type { ProcessInfo } from "./processes";
import type { ChatEvent } from "./service";

const TIMELINE_SHOWN = 6;

/** What one running answer of a turn is doing, read from the turn's events. */
export type AnswerState = {
  messageId: string;
  botId: string;
  botName: string;
  /** The current step: the last activity label ("Thinking", or the tool the bot runs). */
  step?: string | undefined;
  /** When the current step began (ms since epoch). */
  stepSince?: number | undefined;
  plan?: { done: number; total: number; active?: string | undefined } | undefined;
  /** What the bot does on its computer right now. */
  computer?: string | undefined;
  /** The latest steps before the current one, oldest first ("Thinking" is left out). */
  timeline: { at: number; label: string }[];
};

/** One entry for each answer that started and has not produced its message yet. */
export function answersOf(events: readonly ChatEvent[]): AnswerState[] {
  const open = new Map<string, AnswerState>();
  for (const ev of events) {
    if (ev.type === "start")
      open.set(ev.messageId, {
        messageId: ev.messageId,
        botId: ev.botId,
        botName: ev.botName,
        timeline: [],
      });
    else if (ev.type === "message") open.delete(ev.message.id);
    else if (ev.type === "activity") {
      const a = open.get(ev.messageId);
      if (!a) continue;
      if (a.step && a.step !== "Thinking" && a.stepSince !== undefined)
        a.timeline.push({ at: a.stepSince, label: a.step });
      a.step = ev.label;
      a.stepSince = ev.at;
    } else if (ev.type === "plan") {
      const a = open.get(ev.messageId);
      if (a)
        a.plan = {
          done: ev.steps.filter((s) => s.status === "done").length,
          total: ev.steps.length,
          active: ev.steps.find((s) => s.status === "active")?.title,
        };
    } else if (ev.type === "computer") {
      const a = open.get(ev.messageId);
      if (a) a.computer = ev.step;
    }
  }
  return [...open.values()].map((a) => ({ ...a, timeline: a.timeline.slice(-TIMELINE_SHOWN) }));
}

export type SlowAnswer = AnswerState & {
  /** The bot's CLI first, then what it runs. Empty when the host could not list them. */
  processes: ProcessInfo[];
};

const minutesSince = (at: number, now: number) => Math.max(1, Math.round((now - at) / 60_000));

/** The text of the Inbox notification: the silence, then for each running answer the bot, its step and the commands it runs. */
export function slowDetail(idleMin: number, answers: readonly SlowAnswer[], now = Date.now()) {
  const lines = [`No new output for ${idleMin} min.`];
  for (const a of answers) {
    let line = `${a.botName}: ${a.step ?? "starting"}`;
    if (a.stepSince !== undefined) line += ` for ${minutesSince(a.stepSince, now)} min`;
    const below = a.processes.slice(1, 4).map((p) => `${p.command} (PID ${p.pid})`);
    if (below.length) line += `. Running: ${below.join("; ")}`;
    else if (a.processes.length) line += ". No child process: the CLI waits on its model";
    lines.push(`${line}.`);
  }
  if (!answers.length) lines.push("It may wait on a slow command or job.");
  return lines.join(" ").slice(0, 1000);
}
