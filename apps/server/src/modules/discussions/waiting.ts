import type { DecisionService } from "../decisions/service";

/** Why a bot's reply ends the conversation: it waits for the user, has nothing to say, or the task is done. */
export type StopReason = "waiting_user" | "nothing_to_do" | "finished";
const STOPS: readonly StopReason[] = ["waiting_user", "nothing_to_do", "finished"];

const INSTRUCTIONS =
  "A bot posted this message in a team room. What does the bot say about its own work: does it keep working or hand work on, wait for the user, say it has nothing to do or will stay silent, or say the task is finished?";
const DESCRIPTIONS: Record<"working" | StopReason, string> = {
  working:
    "keeps working: gives a task, asks someone a question, reports progress with a next step, or says what it will do now",
  waiting_user:
    "waits for the user: needs the user's message, approval, OK or decision before anything else happens",
  nothing_to_do:
    "nothing to do, nothing changed, nothing new to add, or will stay silent and asks others not to reply",
  finished: "the task is done and delivered, nothing is left to do",
};
/**
 * Measured on 30 pt, es and en bot messages (2026-11-03, multilingual model): of the replies that say "stop", all five long ones from a
 * real room and every short status line score 0.94 or more except one at 0.85; two replies that keep working score 0.90 or more
 * (a bot announcing its own next step). 0.9 keeps false stops rare; what it misses, the NO_REPLY rule and the repeat guard catch.
 */
export const STOP_MIN_CONFIDENCE = 0.9;
/** The longest a turn waits for the model. Past it, the reply counts as working, as before. */
const GUARD_MS = 1500;
const MAX_CHARS = 600;

/**
 * Laya reads a bot's room reply in the languages the administrator chose (Laya languages setting, multilingual model) and says
 * whether the reply ends the conversation. Such a reply stays in the room but wakes nobody; the room wakes again when a person posts.
 * Anything unsure, off, still loading, busy or slow counts as "keeps working".
 */
export function createWaiting(
  decisions?: Pick<DecisionService, "status" | "choose">,
  guardMs = GUARD_MS,
) {
  return {
    async stopReason(text: string, owner: string): Promise<StopReason | undefined> {
      if (!decisions || decisions.status().state !== "ready") return undefined;
      // A mention token is `[@Name](bot:id)`: only the label is words.
      const subject = text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim()
        .slice(0, MAX_CHARS);
      if (!subject) return undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const slow = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("slow")), guardMs);
        });
        const { probabilities } = await Promise.race([
          decisions.choose(subject, INSTRUCTIONS, ["working", ...STOPS], {
            descriptions: DESCRIPTIONS,
            owner,
          }),
          slow,
        ]);
        // The three stop options split one meaning, so they count together; the likeliest one names the reason.
        if (1 - (probabilities.working ?? 1) < STOP_MIN_CONFIDENCE) return undefined;
        return STOPS.reduce((best, s) =>
          (probabilities[s] ?? 0) > (probabilities[best] ?? 0) ? s : best,
        );
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export type WaitingService = ReturnType<typeof createWaiting>;
