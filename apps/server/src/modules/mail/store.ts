import type { Database } from "@zetta/db";
import { and, asc, eq, inArray, isNull, sql } from "@zetta/db/query";
import { bot, conversation } from "@zetta/db/schema/chat";
import { connection } from "@zetta/db/schema/connections";
import { inboundEvent, inboundRoute, inboundThread } from "@zetta/db/schema/inbound";
import {
  mailbox,
  mailboxMessage,
  type MailboxConfig,
  type MailboxKind,
  type MailboxSending,
  type MailboxState,
} from "@zetta/db/schema/mail";
import { AccessError, type ActiveActor } from "../identity/access";
import { hasUniqueViolation } from "../pg-error";

export type Mailbox = typeof mailbox.$inferSelect;
/** The kinds whose mailbox is an account the person connected in a plugin: no password, no servers, the token stays in the plugin. */
export type AccountKind = Extract<MailboxKind, "google" | "microsoft">;

export const MAILBOX_LIMITS = { address: 320, label: 120, lastError: 500, senders: 200 } as const;
const ADDRESS = /^[^\s<>@]+@[^\s<>@]+$/;

/** Why a mailbox rule refused a change. The message is shown to the person as it is. */
export class MailboxRuleError extends Error {
  constructor(
    readonly code: "BAD_ADDRESS" | "ADDRESS_TAKEN" | "BAD_REFERENCE",
    message: string,
  ) {
    super(message);
    this.name = "MailboxRuleError";
  }
}

export type MailboxCreate = {
  kind: MailboxKind;
  address: string;
  label?: string;
  botId?: string | null;
  connectionId?: string | null;
  config?: MailboxConfig;
  allowedSenders?: string[];
  sending?: MailboxSending;
};
/** What may change after the mailbox exists. The address and the kind never do. */
export type MailboxPatch = {
  label?: string;
  /** The bot that owns the mailbox; null frees it. A different bot clears the chat unless `chatConversationId` names one of the new bot's. */
  botId?: string | null;
  state?: MailboxState;
  /** Safe text only, never a mail server's answer. Left out with `state: "active"`, it is cleared. */
  lastError?: string | null;
  sending?: MailboxSending;
  allowedSenders?: string[];
  config?: MailboxConfig;
  chatConversationId?: string | null;
  connectionId?: string | null;
};

/** Addresses or domains the person allowed: trimmed, lower case, no duplicates, no more than the limit. */
export const normalizeSenders = (list: readonly string[]) =>
  [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))]
    .filter((s) => s.length <= MAILBOX_LIMITS.address)
    .slice(0, MAILBOX_LIMITS.senders);

const normalizeAddress = (raw: string) => {
  const address = raw.trim();
  if (address.length > MAILBOX_LIMITS.address || !ADDRESS.test(address))
    throw new MailboxRuleError("BAD_ADDRESS", "That is not an e-mail address.");
  return address;
};

/**
 * A person's connected mailboxes. Every read and write is scoped to the owner: another person's id is "not found", never "denied". The
 * bot, the sealed password and the chat a mailbox points to must belong to the same person.
 */
export function createMailboxStore(db: Database) {
  // A provisioned mailbox the person removed stays in the table (its address is never handed out again) and is invisible everywhere.
  const mine = (a: ActiveActor, id: string) =>
    and(eq(mailbox.id, id), eq(mailbox.ownerUserId, a.userId), isNull(mailbox.removedAt));
  const ownsBot = async (a: ActiveActor, botId: string) => {
    const [row] = await db
      .select({ id: bot.id })
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId)));
    if (!row) throw new MailboxRuleError("BAD_REFERENCE", "That bot is not yours.");
  };
  const ownsConnection = async (a: ActiveActor, connectionId: string) => {
    const [row] = await db
      .select({ id: connection.id })
      .from(connection)
      .where(and(eq(connection.id, connectionId), eq(connection.ownerUserId, a.userId)));
    if (!row) throw new MailboxRuleError("BAD_REFERENCE", "That saved password is not yours.");
  };
  /**
   * The chat must be the person's own and the owner bot's: a chat with another bot would show this mailbox to it. A mailbox with no
   * owner bot is answered by the person's Chief, so its chat is the one with that Chief.
   */
  const ownsChat = async (a: ActiveActor, chatId: string, botId: string | null) => {
    const [row] = await db
      .select({ botId: conversation.botId, kind: bot.kind, botOwner: bot.ownerUserId })
      .from(conversation)
      .innerJoin(bot, eq(bot.id, conversation.botId))
      .where(and(eq(conversation.id, chatId), eq(conversation.ownerUserId, a.userId)));
    const fits =
      row && (botId ? row.botId === botId : row.kind === "chief" && row.botOwner === a.userId);
    if (!fits)
      throw new MailboxRuleError("BAD_REFERENCE", "That chat is not with this mailbox's bot.");
  };
  const get = async (a: ActiveActor, id: string) => {
    const [row] = await db.select().from(mailbox).where(mine(a, id));
    if (!row) throw new AccessError("NOT_FOUND");
    return row;
  };
  return {
    get,
    /** Oldest first, so the list does not move when one is edited. */
    list: (a: ActiveActor, f: { botId?: string } = {}) =>
      db
        .select()
        .from(mailbox)
        .where(
          and(
            eq(mailbox.ownerUserId, a.userId),
            isNull(mailbox.removedAt),
            f.botId ? eq(mailbox.botId, f.botId) : undefined,
          ),
        )
        .orderBy(asc(mailbox.createdAt), asc(mailbox.id)),
    async create(a: ActiveActor, v: MailboxCreate) {
      const address = normalizeAddress(v.address);
      if (v.botId) await ownsBot(a, v.botId);
      if (v.connectionId) await ownsConnection(a, v.connectionId);
      try {
        const [row] = await db
          .insert(mailbox)
          .values({
            ownerUserId: a.userId,
            kind: v.kind,
            address,
            label: (v.label ?? "").trim().slice(0, MAILBOX_LIMITS.label),
            botId: v.botId ?? null,
            connectionId: v.connectionId ?? null,
            config: v.config ?? {},
            allowedSenders: normalizeSenders(v.allowedSenders ?? []),
            ...(v.sending ? { sending: v.sending } : {}),
          })
          .returning();
        return row!;
      } catch (e) {
        if (hasUniqueViolation(e))
          throw new MailboxRuleError("ADDRESS_TAKEN", "That address is already connected.");
        throw e;
      }
    },
    /**
     * The row of a connected account of a plugin (`google`, `microsoft`), made on first need. One statement, `insert ... on conflict do
     * nothing` against the unique index of owner, kind and lower(address): two requests that both find no row cannot make two, and the one
     * that lost reads the winner's row. The row holds no secret (the token stays in the plugin).
     */
    async ensureAccount(
      a: ActiveActor,
      kind: AccountKind,
      address: string,
      o: { sending: MailboxSending },
    ) {
      const clean = normalizeAddress(address);
      const [made] = await db
        .insert(mailbox)
        .values({ ownerUserId: a.userId, kind, address: clean, sending: o.sending })
        .onConflictDoNothing()
        .returning();
      if (made) return made;
      const [row] = await db
        .select()
        .from(mailbox)
        .where(
          and(
            eq(mailbox.ownerUserId, a.userId),
            eq(mailbox.kind, kind),
            sql`lower(${mailbox.address}) = ${clean.toLowerCase()}`,
          ),
        );
      if (!row) throw new AccessError("NOT_FOUND");
      return row;
    },
    async update(a: ActiveActor, id: string, p: MailboxPatch) {
      const current = await get(a, id);
      const set: Partial<typeof mailbox.$inferInsert> = { updatedAt: new Date() };
      if (p.label !== undefined) set.label = p.label.trim().slice(0, MAILBOX_LIMITS.label);
      if (p.sending !== undefined) set.sending = p.sending;
      if (p.config !== undefined) set.config = p.config;
      if (p.allowedSenders !== undefined) set.allowedSenders = normalizeSenders(p.allowedSenders);
      if (p.state !== undefined) set.state = p.state;
      if (p.lastError !== undefined)
        set.lastError =
          p.lastError === null ? null : p.lastError.slice(0, MAILBOX_LIMITS.lastError);
      else if (p.state === "active") set.lastError = null;
      if (p.connectionId !== undefined) {
        if (p.connectionId) await ownsConnection(a, p.connectionId);
        set.connectionId = p.connectionId;
      }
      const botId = p.botId === undefined ? current.botId : p.botId;
      if (p.botId !== undefined && p.botId !== current.botId) {
        if (p.botId) await ownsBot(a, p.botId);
        set.botId = p.botId;
        // The chat was with the old owner.
        set.chatConversationId = null;
      }
      if (p.chatConversationId !== undefined) {
        if (p.chatConversationId) await ownsChat(a, p.chatConversationId, botId);
        set.chatConversationId = p.chatConversationId;
      }
      const [row] = await db.update(mailbox).set(set).where(mine(a, id)).returning();
      if (!row) throw new AccessError("NOT_FOUND");
      return row;
    },
    /**
     * Points the mailbox at a chat only while it still points at `expected` (null: at none), so two requests that both made a chat
     * cannot both win. Undefined when another request got there first.
     */
    async claimChat(a: ActiveActor, id: string, expected: string | null, chatId: string) {
      const current = await get(a, id);
      await ownsChat(a, chatId, current.botId);
      const [row] = await db
        .update(mailbox)
        .set({ chatConversationId: chatId, updatedAt: new Date() })
        .where(
          and(
            mine(a, id),
            expected === null
              ? isNull(mailbox.chatConversationId)
              : eq(mailbox.chatConversationId, expected),
            current.botId === null ? isNull(mailbox.botId) : eq(mailbox.botId, current.botId),
          ),
        )
        .returning();
      return row;
    },
    /** The provisioned mailbox of a bot, whatever its state, or undefined. A person's own check: never another person's. */
    async provisionedOf(a: ActiveActor, botId: string) {
      const [row] = await db
        .select()
        .from(mailbox)
        .where(
          and(
            eq(mailbox.ownerUserId, a.userId),
            eq(mailbox.botId, botId),
            eq(mailbox.kind, "provisioned"),
            isNull(mailbox.removedAt),
          ),
        );
      return row;
    },
    /** For the poller, with no signed-in person: the provisioned mailboxes at these addresses (lower case). Removed ones are not found. */
    async provisionedAt(addresses: string[]) {
      if (!addresses.length) return [];
      return db
        .select()
        .from(mailbox)
        .where(
          and(
            eq(mailbox.kind, "provisioned"),
            isNull(mailbox.removedAt),
            inArray(sql`lower(${mailbox.address})`, addresses),
          ),
        );
    },
    /** The addresses of the provisioned mailboxes of one bot become `retired`: no more incoming mail, no sending; stored mail stays. */
    async retireForBot(botId: string) {
      const rows = await db
        .update(mailbox)
        .set({ state: "retired", lastError: null, updatedAt: new Date() })
        .where(
          and(
            eq(mailbox.botId, botId),
            eq(mailbox.kind, "provisioned"),
            isNull(mailbox.removedAt),
            sql`${mailbox.state} <> 'retired'`,
          ),
        )
        .returning({ id: mailbox.id });
      return rows.length;
    },
    /**
     * Removes a provisioned mailbox for good: its stored mail, its route and the outside chats' records of it are purged in one step,
     * and the row stays hidden so the address is never handed out again. The conversations the bot held with outside people stay in
     * the owner's chats.
     */
    async removeProvisioned(a: ActiveActor, id: string) {
      const current = await get(a, id);
      await db.transaction(async (tx) => {
        const routes = await tx
          .select({ id: inboundRoute.id })
          .from(inboundRoute)
          .where(eq(inboundRoute.mailboxId, current.id));
        const ids = routes.map((r) => r.id);
        if (ids.length) {
          await tx.delete(inboundEvent).where(inArray(inboundEvent.routeId, ids));
          await tx.delete(inboundThread).where(inArray(inboundThread.routeId, ids));
          await tx.delete(inboundRoute).where(inArray(inboundRoute.id, ids));
        }
        await tx.delete(mailboxMessage).where(eq(mailboxMessage.mailboxId, current.id));
        await tx
          .update(mailbox)
          .set({
            state: "retired",
            botId: null,
            chatConversationId: null,
            allowedSenders: [],
            lastError: null,
            removedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(mailbox.id, current.id));
      });
    },
    async delete(a: ActiveActor, id: string) {
      const rows = await db.delete(mailbox).where(mine(a, id)).returning({ id: mailbox.id });
      if (!rows.length) throw new AccessError("NOT_FOUND");
    },
  };
}
export type MailboxStore = ReturnType<typeof createMailboxStore>;
