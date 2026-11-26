/**
 * What a turn may do when a bot that someone else owns takes part. Such a bot follows its owner's instructions while the turn runs with
 * the authority of the person asking, so it does not get that person's consent, bots, computers or accounts. Pure: the chat service
 * says who takes part.
 *
 * - `bot`: the answering bot is someone else's.
 * - `nearby`: the answering bot is the person's own, in a conversation or room where someone else's bot posts. That bot's words may be
 *   steering it, so it runs no commands there and its lasting writes wait for the person.
 */
export type SharedBot = "bot" | "nearby";

/** The end of the line the person reads when a call was refused. */
export const SHARED_REFUSED: Record<SharedBot, string> = {
  bot: "not allowed for a bot someone else owns.",
  nearby: "not allowed in a conversation with a bot someone else owns.",
};

/**
 * `refuse`: never. `card`: the call makes its own card, as it would after outside content (it is never approved without a click).
 * `hold`: it waits in one card with the turn's other held calls and runs on Approve. `allow`: it only reads, or only speaks.
 */
export type SharedVerdict = "refuse" | "card" | "hold" | "allow";

/** What runs on the person's computers or signed-in accounts, which no click can hand over one action at a time. */
const REACH = new Set(["desktop", "machine", "browser", "credential", "mcp"]);
/** What changes the person's existing bots. */
const THEIR_BOTS = new Set([
  "config",
  "permission",
  "bot_claude",
  "add_to_team",
  "create_team",
  "next_wave",
]);
/** Calls that make a card of their own for every lasting change. */
const OWN_CARD = new Set([
  "create_bot",
  "create_routine",
  "create_workflow",
  "goal",
  "team_goals",
  "memory",
]);
/** Calls that only speak, report on the turn's own loop, or show a card whose button is the person's. */
const HARMLESS = new Set([
  "chats",
  "poll",
  "goal_progress",
  "goal_done",
  "goal_stop",
  "setup",
  "inbound",
]);
const READS: Record<string, readonly string[]> = {
  memory: ["search", "read", "links", "list", "checks"],
  task: ["list", "get"],
  agenda: ["list"],
  my_routine: ["list"],
  playground: ["get", "list"],
  app: ["get", "list", "guide"],
  skills: ["search"],
};

export type SharedCall = {
  kind: string;
  args: unknown;
  /** A plugin tool's declared effect. A tool that declares none counts as a write. */
  effect?: "read" | "write" | "send" | undefined;
  /** A kind only the Chief handles: it has its own owner check and its own card. */
  chief?: boolean;
};

export function sharedVerdict(c: SharedCall, who: SharedBot): SharedVerdict {
  const args = (c.args ?? {}) as { action?: string; plugin?: string };
  if (REACH.has(c.kind)) return "refuse";
  if (READS[c.kind]?.includes(args.action ?? "") || HARMLESS.has(c.kind)) return "allow";
  if (c.chief) return "allow";
  if (c.kind === "plugin") {
    // The GitHub plugin is the person's token, as the one handed to a run is.
    if (who === "bot" && args.plugin === "github") return "refuse";
    return c.effect === "read" ? "allow" : "hold";
  }
  if (who === "bot") {
    if (THEIR_BOTS.has(c.kind) || c.kind === "create_vm") return "refuse";
    if (c.kind === "skills") return "refuse";
  } else if (THEIR_BOTS.has(c.kind) || c.kind === "create_vm" || c.kind === "skills")
    // The person's own bot may still ask: each of these makes a card the person reads.
    return c.kind === "add_to_team" || c.kind === "create_team" ? "hold" : "card";
  // A suggested memory item is saved at once, so it waits with the rest.
  if (OWN_CARD.has(c.kind) && args.action !== "suggest") return "card";
  return "hold";
}
