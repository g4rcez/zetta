/**
 * Who may read a mailbox through a bot, decided here on the server and nowhere else (never by what the prompt tells a bot).
 *
 * A bot reads a mailbox only when ALL of this holds:
 *   1. The turn is one where the only human who can read the words is the mailbox's owner: the owner's own chat, a goal loop they
 *      approved in it, or a turn Zetta started for them with no outside content in its prompt (a routine run, a resumed run). A room, an
 *      inbound chat (Telegram, WhatsApp, Slack, mail: an outside person writes), a turn whose prompt carries what outsiders sent, and a
 *      call with no conversation (a workflow step) never read mail.
 *   2. The mailbox, the bot and the person the bot acts for are the same person's.
 *   3. The mailbox is not retired, and it belongs to this bot; a mailbox with no owner bot belongs to the Chief. The Chief gets nothing
 *      on a mailbox another bot owns, and no other bot gets anything on one that is unowned or another bot's.
 *
 * Every refusal but `needs_auth` is the same answer, `denied`, so a mailbox of another person, of another bot or a retired one cannot be
 * told apart from one that does not exist.
 */
import type { MailboxState } from "@zetta/db/schema/mail";
import type { PluginTurn } from "../integrations/plugins/turn";

/** The turns whose text only the mailbox's owner can read. */
export const MAIL_TURNS: readonly PluginTurn[] = ["chat", "loop", "server"];

export type MailAccess = "read" | "needs_auth" | "denied";

export type MailAccessInput = {
  /** The person the bot acts for in this call. */
  actorUserId: string;
  bot: { id: string; kind: "chief" | "specialist"; ownerUserId: string };
  mailbox: { ownerUserId: string; botId: string | null; state: MailboxState };
  /** Where the call comes from; absent is "none" and is refused. */
  turn: PluginTurn | undefined;
};

export function mailAccess(i: MailAccessInput): MailAccess {
  if (!i.turn || !MAIL_TURNS.includes(i.turn)) return "denied";
  if (i.mailbox.ownerUserId !== i.actorUserId || i.bot.ownerUserId !== i.actorUserId)
    return "denied";
  if (i.mailbox.state === "retired") return "denied";
  const owns = i.mailbox.botId === i.bot.id || (i.mailbox.botId === null && i.bot.kind === "chief");
  if (!owns) return "denied";
  return i.mailbox.state === "needs_auth" ? "needs_auth" : "read";
}

/**
 * What an MCP client may do with a mailbox. The client is the person's own tool: it acts as the person who signed in and no bot is
 * involved, so the rule is the person's rule (the web app's), not the bot's: the mailbox is theirs and not retired. A bot's owner rule
 * (`mailAccess`) does not apply, since the client is not a bot and has no turn. Another person's mailbox, a retired one and one that
 * does not exist all answer the same, `denied`. Reading needs the read scope, which the person granted on the consent page.
 */
export function personMailAccess(i: {
  actorUserId: string;
  mailbox: { ownerUserId: string; state: MailboxState };
}): MailAccess {
  if (i.mailbox.ownerUserId !== i.actorUserId || i.mailbox.state === "retired") return "denied";
  return i.mailbox.state === "needs_auth" ? "needs_auth" : "read";
}
