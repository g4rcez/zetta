/**
 * Bot e-mail addresses. A bot gets `<bot slug>-<last characters of a UUID v7>@<domain>` when it is created, but only where the
 * administrator set up a provider, a domain and a key (installation settings). It is best effort and runs after the bot exists, never
 * inside its transaction and never in a trigger: a failure here never stops a bot from being created, and a bot that got none can be
 * given one later ("Give this bot an address", or through the Chief).
 *
 * The address stays with the bot: renaming the bot changes the name on the mail, not the address. Archiving the bot retires the address
 * (it stays reserved, new mail to it is dropped, stored mail stays readable). Removing the mailbox purges its mail (`store.ts`).
 */
import { MAIL_LOCAL_MAX } from "@zetta/core/mail-provision";
import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { AccessError, type ActiveActor } from "../identity/access";
import type { MailProviderReader } from "./provider-config";
import { MailboxRuleError, type Mailbox, type MailboxStore } from "./store";

/** Characters of the random tail, tried in turn when an address is taken. */
export const SUFFIX_LENGTHS = [4, 6, 8] as const;

export class ProvisionError extends Error {
  constructor(
    readonly code: "NOT_OFFERED" | "NOT_A_BOT" | "TAKEN",
    message: string,
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

/** The address of a bot: lower case, only letters, digits and dashes, at most 64 characters before the `@`. */
export function addressFor(slug: string, domain: string, suffixLength: number, random = uuidv7()) {
  const tail = random.replace(/-/g, "").slice(-suffixLength).toLowerCase();
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const local = `${clean.slice(0, Math.max(1, MAIL_LOCAL_MAX - 1 - tail.length))}-${tail}`;
  return `${local}@${domain.toLowerCase()}`;
}

export function createProvisioning(deps: {
  db: Database;
  store: MailboxStore;
  reader: Pick<MailProviderReader, "enabled">;
  /** Test hook: the random text an address is built from. */
  random?: () => string;
}) {
  const { db, store, reader } = deps;

  async function botOf(a: ActiveActor, botId: string) {
    const [row] = await db
      .select({ id: bot.id, name: bot.name, slug: bot.slug, kind: bot.kind })
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId), eq(bot.archived, false)));
    if (!row) throw new AccessError("NOT_FOUND");
    return row;
  }

  return {
    /** Whether a bot can be given an address now, and on which domain. Nothing here is secret. */
    offered: () => reader.enabled(),

    /** The address of this bot's own mailbox, made if the bot has none. Refuses when the installation offers none. */
    async giveAddress(a: ActiveActor, botId: string): Promise<Mailbox> {
      const offer = await reader.enabled();
      if (!offer.on)
        throw new ProvisionError(
          "NOT_OFFERED",
          "This server does not hand out e-mail addresses to bots. An administrator can turn it on in Studio.",
        );
      const b = await botOf(a, botId);
      if (b.kind !== "specialist")
        throw new ProvisionError("NOT_A_BOT", "Only a bot of yours can have an address.");
      const have = await store.provisionedOf(a, botId);
      if (have) return have;
      for (const length of SUFFIX_LENGTHS) {
        try {
          return await store.create(a, {
            kind: "provisioned",
            address: addressFor(b.slug, offer.domain, length, deps.random?.()),
            label: b.name,
            botId,
            sending: "on",
          });
        } catch (e) {
          if (e instanceof MailboxRuleError && e.code === "ADDRESS_TAKEN") continue;
          throw e;
        }
      }
      throw new ProvisionError("TAKEN", "No free address was found. Try again.");
    },

    /** After a bot was created: gives it an address when the installation offers them. Never throws. */
    async forNewBot(a: ActiveActor, botId: string): Promise<Mailbox | undefined> {
      try {
        if (!(await reader.enabled()).on) return undefined;
        return await this.giveAddress(a, botId);
      } catch {
        return undefined;
      }
    },

    /** After a bot was archived: its address is retired. Never throws. */
    async retireForBot(botId: string): Promise<void> {
      await store.retireForBot(botId).catch(() => undefined);
    },
  };
}
export type Provisioning = ReturnType<typeof createProvisioning>;

type ChatLike = {
  createBot(a: ActiveActor, input: never): Promise<{ id: string }>;
  archiveBot(a: ActiveActor, id: string): Promise<unknown>;
};

/**
 * Hooks the chat service so a new bot is given an address and an archived bot's address is retired. The bot's own work finishes first
 * and the hook can never fail it: `forNewBot` and `retireForBot` swallow their errors. Same shape as the page notifications in the
 * chat service (a method replaced by one that calls the original).
 */
export function withProvisioning(chat: object, provisioning: Provisioning) {
  const c = chat as ChatLike;
  const createBot = c.createBot;
  const archiveBot = c.archiveBot;
  c.createBot = async function (this: unknown, ...args: Parameters<ChatLike["createBot"]>) {
    const bot = await createBot.apply(this, args);
    await provisioning.forNewBot(args[0], bot.id);
    return bot;
  };
  c.archiveBot = async function (this: unknown, ...args: Parameters<ChatLike["archiveBot"]>) {
    const result = await archiveBot.apply(this, args);
    await provisioning.retireForBot(args[1]);
    return result;
  };
  return chat;
}
