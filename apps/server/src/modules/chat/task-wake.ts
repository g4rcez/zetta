import type { DecisionService } from "../decisions/service";

export type WakeInput = {
  /** The task the bot assigned to a person. */
  title: string;
  description: string;
  /** What the bot last said in the chat where it asked. */
  botSaid: string;
  /** What the person did, in words: "moved the task to Done", "deleted the task". */
  change: string;
};

const INSTRUCTIONS =
  "A person changed the status of a task. Did the person finish or cancel the task, or only move it along?";
const DESCRIPTIONS = {
  finished: "finished: the task is done, completed, answered, deleted or cancelled",
  moved_along:
    "moved along: the task is only started, in progress, in review, on hold or back in the backlog",
};
/**
 * How sure Laya must be that the person only moved the task along before the bot is spared. Measured on 12 changes in pt, es and en
 * (2026-11-04, both checkpoints, wording tried against three others): a task that is done or deleted scores 0.54 to 0.87 for "finished",
 * a move along 0.08 to 0.56. Skipping at 0.75 never touches the first group; it spares a backlog or review move and some starts.
 * Laya cannot judge "this task needs no reply" (the same done task scored 0.24 to 0.80 with the wording), so that case still runs the bot.
 */
export const NOTE_MIN_CONFIDENCE = 0.75;
/** The longest a change waits for the model. Past it, the bot runs. */
const GUARD_MS = 1500;
const clip = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Laya reads the task, what the bot last said and what the person did, and says whether the person finished it or only moved it along.
 * It never starts a bot: it can only spare a model call when a note in the chat is enough. Anything unsure, off, still loading, busy or slow means "run the bot",
 * because a missed wake leaves the bot waiting for something that is already done.
 */
export function createTaskWake(
  decisions?: Pick<DecisionService, "status" | "choose">,
  guardMs = GUARD_MS,
) {
  return {
    /** The odds that a note is enough, or undefined when Laya cannot say. */
    async noteOdds(input: WakeInput, owner: string): Promise<number | undefined> {
      if (!decisions || decisions.status().state !== "ready") return undefined;
      const subject = [
        `A bot asked a person: “${clip(input.title, 120)}”. ${clip(input.description, 220)}`,
        input.botSaid ? `The bot last said: ${clip(input.botSaid, 220)}` : "",
        `The person ${input.change}.`,
      ]
        .filter(Boolean)
        .join("\n");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const slow = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("slow")), guardMs);
        });
        const { probabilities } = await Promise.race([
          decisions.choose(subject, INSTRUCTIONS, ["finished", "moved_along"], {
            descriptions: DESCRIPTIONS,
            owner,
          }),
          slow,
        ]);
        return probabilities.moved_along;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
    async shouldWake(input: WakeInput, owner: string): Promise<boolean> {
      const note = await this.noteOdds(input, owner);
      return note === undefined || note < NOTE_MIN_CONFIDENCE;
    },
  };
}
export type TaskWakeService = ReturnType<typeof createTaskWake>;
