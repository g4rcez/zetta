/**
 * Brings the mail of bot addresses into Postgres. One pass: list what arrived at the provider after the stored cursor, download each
 * message once, parse it with the shared parser, route it by recipient address, store it (once per provider reference) and, for the
 * few messages that may talk to the owner bot, hand the bot an inbound event.
 *
 * Mail to an address nobody has, or that was retired with its bot, is dropped before it is downloaded and only counted. A removed
 * mailbox is an address nobody has.
 *
 * It runs in the one process that does the server's background work (the ticker in `index.ts`, worker or `all` role), and a database
 * advisory lock makes a second instance that runs it anyway skip the pass. Errors back off (30 s doubling to 15 min), and the cursor
 * moves only past mail that was stored, so a failed pass is repeated from the same place.
 */
import type { Database } from "@zetta/db";
import { and, eq, sql } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";
import { bot } from "@zetta/db/schema/chat";
import { inboundRoute } from "@zetta/db/schema/inbound";
import { hasUniqueViolation } from "../pg-error";
import type { InboundEvent } from "../integrations/plugins/registry";
import { senderAllowed } from "../integrations/plugins/mail";
import { clean } from "../integrations/plugins/untrusted";
import { MailConnectError } from "./imap-connect";
import type { MessageStore } from "./messages";
import { parseMessage, parseThreadHeaders, PARSE_LIMITS } from "./parse";
import type { MailProviderReader } from "./provider-config";
import type { Authentication, MailProvider } from "./providers/provider";
import { htmlToText } from "./sanitize";
import type { Mailbox, MailboxStore } from "./store";

/** The id of the one built-in plugin that carries the reply of a mailbox turn (`integrations/plugins/botmail.ts`). */
export const BOTMAIL_PLUGIN = "botmail";

export const POLL = {
  perPage: 50,
  pagesPerPass: 5,
  backoffStartMs: 30_000,
  backoffMaxMs: 15 * 60_000,
  /** The words of a message handed to the bot. */
  turnChars: 1_700,
  lockKey: "zetta.mail-poll",
} as const;

export type PollStats = {
  stored: number;
  duplicates: number;
  /** Mail to an address on the domain that nobody has (or that was removed). Never stored. */
  droppedUnknown: number;
  /** Mail to an address retired with its bot. Never stored. */
  droppedRetired: number;
  turns: number;
  failed: number;
};
const zero = (): PollStats => ({
  stored: 0,
  duplicates: 0,
  droppedUnknown: 0,
  droppedRetired: 0,
  turns: 0,
  failed: 0,
});

export type PollOutcome =
  | { status: "ran"; stats: PollStats }
  | { status: "skipped" | "off" | "backoff" }
  | { status: "failed"; stats: PollStats; retryInMs: number };

// ---- pure rules (unit tested) ----------------------------------------------------------------------------------------------------

/** The header block of a message source, unfolded, at most 64 KB. */
export function headerBlock(raw: Uint8Array): string {
  const text = Buffer.from(raw.subarray(0, 65_536)).toString("utf8");
  const end = text.search(/\r?\n\r?\n/);
  return (end >= 0 ? text.slice(0, end) : text).replace(/\r?\n[ \t]+/g, " ");
}
export const headerOf = (block: string, name: string): string | undefined => {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(block);
  return m ? m[1]!.trim() : undefined;
};

/** Mail no person wrote: a bounce, a list, an auto-reply. It is stored, but no bot ever answers it, so two machines cannot talk. */
export function isAutomatic(block: string): boolean {
  const auto = headerOf(block, "auto-submitted");
  const precedence = headerOf(block, "precedence") ?? "";
  const returnPath = headerOf(block, "return-path");
  return (
    Boolean(auto && !/^no$/i.test(auto)) ||
    /bulk|list|junk|auto_reply/i.test(precedence) ||
    headerOf(block, "list-id") !== undefined ||
    headerOf(block, "list-unsubscribe") !== undefined ||
    headerOf(block, "x-auto-response-suppress") !== undefined ||
    headerOf(block, "x-autoreply") !== undefined ||
    headerOf(block, "x-autorespond") !== undefined ||
    (returnPath !== undefined && /^<\s*>$/.test(returnPath))
  );
}

/**
 * The provider vouches for the From address: DMARC passed. SPF speaks of the envelope's address, and the provider does not say which
 * domain a DKIM signature that passed is of, so neither alone ties a message to the sender it shows.
 */
export const vouchedBy = (a: Partial<Authentication> | Record<string, string>) =>
  a.dmarc === "pass";

export type TurnFacts = {
  mailbox: Pick<Mailbox, "address" | "state" | "botId" | "allowedSenders">;
  from: string;
  authentication: Partial<Authentication> | Record<string, string>;
  automatic: boolean;
};
/**
 * Whether a received message starts a turn of the owner bot: the mailbox is active and has an owner bot, the sender is on the
 * mailbox's list of allowed senders and is not the mailbox itself, the provider vouches for the sender, and a person wrote it.
 */
export function startsTurn(f: TurnFacts): boolean {
  const from = f.from.trim().toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(from) || from === f.mailbox.address.trim().toLowerCase())
    return false;
  if (f.mailbox.state !== "active" || !f.mailbox.botId) return false;
  if (!f.mailbox.allowedSenders.length || !senderAllowed(from, f.mailbox.allowedSenders))
    return false;
  if (f.automatic) return false;
  return vouchedBy(f.authentication);
}

/** The new words of a message: the quoted thread below them is not news. */
export function newWords(text: string): string {
  return text
    .split(/\r?\n(?:On .{5,200} wrote:|-{2,}\s*Original Message\s*-{2,}|_{5,})/i)[0]!
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(">"))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- the poller -----------------------------------------------------------------------------------------------------------------

export type MailPollerDeps = {
  db: Database;
  store: MailboxStore;
  messages: MessageStore;
  reader: Pick<MailProviderReader, "provider" | "enabled">;
  /** The inbound service; without it mail is stored but never starts a turn. */
  inbound?: { ingestMailbox(routeId: string, events: InboundEvent[]): Promise<number> };
  now?: () => number;
  log?: (line: string) => void;
};

export function createMailPoller(deps: MailPollerDeps) {
  const { db, store, messages } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const total = zero();
  let failures = 0;
  let nextAt = 0;
  let running = false;

  async function routeFor(box: Mailbox): Promise<string | undefined> {
    if (!box.botId) return undefined;
    const find = async () => {
      const [r] = await db.select().from(inboundRoute).where(eq(inboundRoute.mailboxId, box.id));
      return r;
    };
    let route = await find();
    if (!route) {
      try {
        const [made] = await db
          .insert(inboundRoute)
          .values({
            ownerUserId: box.ownerUserId,
            botId: box.botId,
            pluginId: BOTMAIL_PLUGIN,
            mailboxId: box.id,
            enabled: true,
            // Never polled through a plugin (the mailbox poller stores its mail), so the due time is far away.
            pollEverySeconds: 3600,
            nextPollAt: new Date(now() + 365 * 86_400_000),
          })
          .returning();
        route = made;
      } catch (e) {
        if (!hasUniqueViolation(e)) throw e;
        route = await find();
      }
    }
    if (route && (!route.enabled || route.botId !== box.botId))
      await db
        .update(inboundRoute)
        .set({ enabled: true, botId: box.botId, updatedAt: new Date() })
        .where(eq(inboundRoute.id, route.id));
    return route?.id;
  }

  async function botReady(botId: string) {
    const [b] = await db
      .select({ archived: bot.archived, onboarded: bot.onboarded })
      .from(bot)
      .where(eq(bot.id, botId));
    return Boolean(b && !b.archived && b.onboarded);
  }

  /** One received message: routed, downloaded once, stored per mailbox, and maybe handed to a bot. */
  async function handle(
    provider: MailProvider,
    item: { ref: string; recipients: string[]; receivedAt: string },
    domain: string,
    stats: PollStats,
  ) {
    const local = item.recipients.filter((r) => r.endsWith(`@${domain}`));
    if (!local.length) return;
    const boxes = await store.provisionedAt(local);
    const known = new Set(boxes.map((b) => b.address.toLowerCase()));
    stats.droppedUnknown += local.filter((r) => !known.has(r)).length;
    const targets: Mailbox[] = [];
    for (const box of boxes) {
      if (box.state === "retired") {
        stats.droppedRetired++;
        continue;
      }
      if (await messages.has(box.id, item.ref)) {
        stats.duplicates++;
        continue;
      }
      targets.push(box);
    }
    if (!targets.length) return;

    const { raw, authentication } = await provider.fetchRaw(item.ref);
    const block = headerBlock(raw);
    const heads = parseThreadHeaders(block);
    const parsed = await parseMessage(raw, { id: item.ref, origin: "received", truncated: false });
    const text = (parsed.text.trim() ? parsed.text : htmlToText(parsed.htmlUnsafe)).slice(
      0,
      PARSE_LIMITS.text,
    );
    const automatic = isAutomatic(block);
    const files = parsed.attachments.filter((a) => a.disposition === "attachment");
    for (const box of targets) {
      const stored = await messages.insert({
        mailboxId: box.id,
        providerRef: item.ref,
        direction: "in",
        messageId: heads.messageId,
        inReplyTo: heads.inReplyTo[0] ?? "",
        references: heads.references.slice(-50),
        fromAddress: parsed.from?.address ?? "",
        fromName: parsed.from?.name ?? "",
        toAddresses: parsed.to.map((t) => t.address),
        subject: parsed.subject,
        date: new Date(parsed.date ?? item.receivedAt),
        textBody: text,
        authentication: { ...authentication },
        attachments: files.length ? "some" : "none",
        raw,
      });
      if (!stored) {
        stats.duplicates++;
        continue;
      }
      stats.stored++;
      const from = parsed.from?.address ?? "";
      if (
        !deps.inbound ||
        !startsTurn({ mailbox: box, from, authentication, automatic }) ||
        !box.botId ||
        !(await botReady(box.botId))
      )
        continue;
      const routeId = await routeFor(box);
      if (!routeId) continue;
      const subject = clean(parsed.subject, 160).trim();
      const body = newWords(text).slice(0, POLL.turnChars);
      const names = files
        .map((a) => clean(a.fileName, 60))
        .filter(Boolean)
        .slice(0, 5);
      const event: InboundEvent = {
        key: clean(`${item.ref}`, 190),
        chat: from.toLowerCase(),
        chatName: clean(parsed.from?.name, 60) || from,
        from: clean(parsed.from?.name, 60) || from,
        text:
          [
            subject ? `Subject: ${subject}` : "",
            body,
            names.length ? `(attachments not opened: ${names.join(", ")})` : "",
          ]
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 2000) || "(empty message)",
        at: new Date(stored.date).getTime(),
        media: files.length > 0,
        group: false,
      };
      if ((await deps.inbound.ingestMailbox(routeId, [event])) > 0) stats.turns++;
    }
  }

  async function writeCursor(from: string | null, to: string | null) {
    if (from === to) return;
    await db
      .update(installationSettings)
      .set({ mailCursor: to })
      .where(
        and(
          eq(installationSettings.id, 1),
          sql`${installationSettings.mailCursor} is not distinct from ${from}`,
        ),
      );
  }

  async function pass(): Promise<PollOutcome> {
    const offer = await deps.reader.enabled();
    if (!offer.on) return { status: "off" };
    const provider = await deps.reader.provider();
    if (!provider) return { status: "off" };
    const [row] = await db
      .select({ cursor: installationSettings.mailCursor })
      .from(installationSettings)
      .where(eq(installationSettings.id, 1));
    let cursor = row?.cursor ?? null;
    const stats = zero();
    try {
      for (let page = 0; page < POLL.pagesPerPass; page++) {
        const got = await provider.poll(cursor, POLL.perPage);
        let last = cursor;
        for (const item of got.items) {
          try {
            await handle(provider, item, offer.domain, stats);
          } catch (e) {
            // A message the provider no longer has cannot be fetched and never will be: it is skipped. Anything else stops the pass here.
            if (!(e instanceof MailConnectError && e.code === "NOT_FOUND")) throw e;
            stats.failed++;
          }
          last = item.ref;
        }
        // The provider's own cursor wins when the page was fully handled (it may know a newer id than the last item).
        const next = got.items.length ? (got.cursor ?? last) : last;
        await writeCursor(cursor, next);
        cursor = next;
        if (!got.more) break;
        if (!got.items.length) break;
      }
    } catch (e) {
      // Where the failed pass got to is kept by the cursor of the last page; the item that failed is repeated.
      failures++;
      const retryInMs = Math.min(POLL.backoffMaxMs, POLL.backoffStartMs * 2 ** (failures - 1));
      nextAt = now() + retryInMs;
      stats.failed++;
      add(stats);
      log(
        `mail: poll failed code=${e instanceof MailConnectError ? e.code : "ERROR"} retry=${retryInMs}ms`,
      );
      return { status: "failed", stats, retryInMs };
    }
    failures = 0;
    nextAt = 0;
    add(stats);
    if (stats.droppedUnknown || stats.droppedRetired)
      log(
        `mail: dropped unknown=${stats.droppedUnknown} retired=${stats.droppedRetired} (mail to addresses nobody has)`,
      );
    return { status: "ran", stats };
  }
  const add = (s: PollStats) => {
    for (const k of Object.keys(total) as (keyof PollStats)[]) total[k] += s[k];
  };

  return {
    /** One pass. Safe to call from a ticker: a pass that is still running, a backoff and another instance's pass all return at once. */
    async tick(): Promise<PollOutcome> {
      if (running) return { status: "skipped" };
      if (now() < nextAt) return { status: "backoff" };
      running = true;
      try {
        // The lock lives as long as this transaction; the work uses the pool, so it needs no connection of its own here.
        return await db.transaction(async (tx) => {
          const res = await tx.execute<{ ok: boolean }>(
            sql`select pg_try_advisory_xact_lock(hashtext(${POLL.lockKey})) as ok`,
          );
          const rows = ((res as unknown as { rows?: { ok: boolean }[] }).rows ??
            (res as unknown as { ok: boolean }[])) as { ok: boolean }[];
          if (!rows[0]?.ok) return { status: "skipped" } as PollOutcome;
          return pass();
        });
      } finally {
        running = false;
      }
    },
    /** Totals since this process started: what was stored, dropped and failed. */
    stats: (): PollStats => ({ ...total }),
  };
}
export type MailPoller = ReturnType<typeof createMailPoller>;
