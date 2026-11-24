/**
 * The chat of a mailbox: the person's own conversation with the bot that owns the mailbox, or with their Chief (Zetta) when no bot does.
 * It is an ordinary conversation of the person, so it also shows in their chat list under a title that names the mailbox. It is made on
 * first use and kept in `mailbox.chat_conversation_id`; when the owner bot changes the store clears the pointer, the old chat stays in
 * the chat list and the next call makes a new one with the new owner.
 */
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot, conversation } from "@zetta/db/schema/chat";
import type { ActiveActor } from "../identity/access";
import { MailboxRuleError, type MailboxStore } from "./store";

export type MailChat = { conversationId: string; botId: string; botKind: "chief" | "specialist" };

export type MailChatDeps = {
  db: Database;
  store: MailboxStore;
  /** The person's Chief, made when there is none yet. */
  chiefOf: (a: ActiveActor) => Promise<{ id: string }>;
  /** Called when a chat was made, so the person's chat list refreshes. */
  created?: (a: ActiveActor) => void;
};

export const mailChatTitle = (m: { label: string; address: string }) =>
  `Mail: ${m.label.trim() || m.address}`.slice(0, 120);

export function createMailChat({ db, store, chiefOf, created }: MailChatDeps) {
  const answeringBot = async (a: ActiveActor, botId: string | null) => {
    const [row] = botId
      ? await db
          .select({ id: bot.id, kind: bot.kind })
          .from(bot)
          .where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId), eq(bot.archived, false)))
      : [];
    if (botId) {
      if (!row) throw new MailboxRuleError("BAD_REFERENCE", "That bot is not available.");
      return row;
    }
    const chief = await chiefOf(a);
    return { id: chief.id, kind: "chief" as const };
  };
  /** The chat of this mailbox, made when there is none (or when the one it points to is gone, archived or with another bot). */
  async function chatFor(a: ActiveActor, mailboxId: string): Promise<MailChat> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = await store.get(a, mailboxId);
      const who = await answeringBot(a, box.botId);
      if (box.chatConversationId) {
        const [c] = await db
          .select({ id: conversation.id, botId: conversation.botId })
          .from(conversation)
          .where(
            and(
              eq(conversation.id, box.chatConversationId),
              eq(conversation.ownerUserId, a.userId),
              eq(conversation.kind, "chat"),
              eq(conversation.archived, false),
            ),
          );
        if (c && c.botId === who.id)
          return { conversationId: c.id, botId: who.id, botKind: who.kind };
      }
      const [made] = await db
        .insert(conversation)
        .values({
          ownerUserId: a.userId,
          botId: who.id,
          title: mailChatTitle(box),
          titleSource: "manual",
        })
        .returning({ id: conversation.id });
      const won = await store
        .claimChat(a, box.id, box.chatConversationId, made!.id)
        .catch(async (e) => {
          await db.delete(conversation).where(eq(conversation.id, made!.id));
          throw e;
        });
      if (won) {
        created?.(a);
        return { conversationId: made!.id, botId: who.id, botKind: who.kind };
      }
      // Another request made the chat first (or the owner changed): this one is empty, drop it and read again.
      await db.delete(conversation).where(eq(conversation.id, made!.id));
    }
    throw new MailboxRuleError(
      "BAD_REFERENCE",
      "The chat of this mailbox could not be opened. Try again.",
    );
  }
  return { chatFor };
}
export type MailChatService = ReturnType<typeof createMailChat>;
