/**
 * Where a plugin call comes from, as the chat service knows it. A built-in plugin whose content must reach only the person it belongs to
 * (the mailbox) decides on this, on the server, and never on what the bot says it is doing.
 *
 *   chat           the person typed in their own chat with the bot (a retried or queued message of theirs counts)
 *   loop           a step of a goal loop the person approved, in their own chat
 *   server         Zetta started the turn for the person (a routine run, a notice, a resumed run) and its prompt holds no outside content
 *   outside_event  Zetta started the turn, but its prompt carries what outside people or systems sent (a routine started by a webhook)
 *   room           a room or discussion: other people, or other people's bots, can read it
 *   inbound        an outside person wrote to the bot (Telegram, WhatsApp, Slack, mail): every word of the chat may reach them
 *   none           not a conversation turn (a workflow step, a direct call), or a turn that did not say where it came from
 */
export type PluginTurn = "chat" | "loop" | "server" | "outside_event" | "room" | "inbound" | "none";

export type TurnFacts = {
  /** The conversation is an inbound one: an outside person writes to the bot there. */
  inbound: boolean;
  /** The turn answers in a room or discussion. */
  room: boolean;
  /** A step of a goal loop. */
  loop: boolean;
  /** `user_message`: the person's own message started it. `server`: Zetta did. */
  startedBy: "user_message" | "server";
  /** The prompt carries outside content the server was handed (an event payload, a source file of a memory job). */
  outsideInput: boolean;
};

/** The one place that turns the facts of a turn into its origin. Order matters: the most exposed place wins. */
export function pluginTurnOf(f: TurnFacts): PluginTurn {
  if (f.inbound) return "inbound";
  if (f.room) return "room";
  if (f.outsideInput) return "outside_event";
  if (f.loop) return "loop";
  return f.startedBy === "user_message" ? "chat" : "server";
}
