/**
 * When a bot's lasting write (a memory item, a configuration change, a new routine, bot or goal loop) applies at once and when it waits
 * for the person's approval. Pure: the chat service gathers the facts.
 *
 * The rule: the person's own chat message is consent for what they asked the bot to do, so its writes apply (each is shown as a receipt,
 * and kept as a revision or an archivable row). A card is for a turn the person did not start, or one in which outside content is in
 * play that the server saw: a file, a tool result, a message from outside. A bot with code access or MCP servers can also read things
 * the server does not see; that alone no longer turns every write into a card, because it made bots ask for nearly everything
 * (see docs/security/plan.md for the trade-off).
 *
 * This decides only the mode. Which kinds may apply without a click stays with `AUTO_APPLY` (chief/kinds.ts): grants (rm, sudo, mail),
 * skills from outside and host code are cards in every mode.
 */
export type WriteFacts = {
  /** The server saw outside content in this turn: an attachment, a tool result, an inbound message, an outside event. */
  seenOutside: boolean;
  /** The bot runs with code access or MCP servers, so it may have read content the server did not see. */
  reach: boolean;
  /** Where the turn runs. A missing or unknown scope is treated as the strictest place. */
  place: "chat" | "loop" | "room" | "inbound";
  /**
   * What started the turn. "user_message": the person typed it (a queued message counts). "server": anything Zetta started itself
   * (a routine run, a notice, a resumed or retried run).
   */
  startedBy: "user_message" | "server";
  /** The prompt asks to keep something ("remember", "from now on", "always"): see intent.ts. */
  askedToKeep: boolean;
};

export function writeMode(f: WriteFacts): "apply" | "ask" {
  if (f.seenOutside) return "ask";
  // Without code access or MCP the server sees everything the bot reads: nothing unseen can have steered it.
  if (!f.reach) return "apply";
  // Loops and rooms run turn after turn without the person; outside people write the inbound chats.
  if (f.place !== "chat") return "ask";
  if (f.startedBy === "user_message") return "apply";
  // A turn Zetta started in a chat (a routine run): only what its own prompt asks to keep.
  return f.askedToKeep ? "apply" : "ask";
}
