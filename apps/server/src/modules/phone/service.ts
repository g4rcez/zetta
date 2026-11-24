/**
 * Phone numbers of bots: asking for one, the operator's approval, review at the provider, release, the hold after a bot is archived, the
 * owner's own number and keypad PIN, and the installation-wide do-not-call list. Calls are a later step (docs/decisions/voice-and-phone.md).
 *
 * Money rules: a number costs every month, so a number is bought only when the owner asks, never for every bot, and never more than the
 * installation's limit. A request that waits for an administrator costs nothing. Nothing here runs in a trigger or a database function.
 */
import {
  PHONE_HOLD_DAYS,
  PHONE_OPEN_STATUSES,
  countryList,
  isPhoneProviderId,
  isCountryCode,
  isE164,
  normalizeE164,
  reviewNotice,
  type PhoneInboundMode,
  type PhoneNumberStatus,
  type PhoneOptoutReason,
  type PhoneOutboundMode,
  type PhoneProviderId,
} from "@zetta/core/phone";
import { uuidv7 } from "@zetta/core/uuid";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { voiceCall } from "@zetta/db/schema/voice";
import { phoneNumber, phoneOptout } from "@zetta/db/schema/phone";
import { AccessError, type ActiveActor } from "../identity/access";
import type { PhoneOffer, PhoneProviderReader } from "./config";
import { decidePin, hashPin, isPin } from "./pin";
import { PhoneProviderError, type PhoneProvider } from "./provider";

export class PhoneError extends Error {
  constructor(
    readonly code:
      | "NOT_OFFERED"
      | "COUNTRY"
      | "LIMIT"
      | "HAVE_ONE"
      | "NO_NUMBER"
      | "PROVIDER"
      | "BAD_INPUT"
      | "WRONG_STATE"
      | "LOCKED"
      | "NOT_AVAILABLE",
    /** A sentence for the person. */
    readonly safe: string,
  ) {
    super(code);
    this.name = "PhoneError";
  }
}

type Row = typeof phoneNumber.$inferSelect;

/** What a list of calls shows. No transcript: the words are in the call's own chat. */
export type PhoneCallView = {
  id: string;
  botId: string;
  botName: string;
  direction: "in" | "out";
  peer: string | null;
  status: string;
  outcome: string | null;
  endReason: string | null;
  durationSeconds: number | null;
  startedAt: string;
  conversationId: string | null;
};

/** What a page shows of a number. Never the PIN hash, the provider's id or its words. */
export type PhoneNumberView = {
  id: string;
  botId: string;
  /** Which provider holds the number. */
  provider: PhoneProviderId;
  number: string | null;
  country: string;
  areaCode: string | null;
  status: PhoneNumberStatus;
  /** A sentence for the owner about where the number stands. */
  note: string;
  inbound: PhoneInboundMode;
  outbound: PhoneOutboundMode;
  ownerNumber: string | null;
  pinSet: boolean;
  pinLockedUntil: string | null;
  heldUntil: string | null;
  createdAt: string;
};
/** A bot an administrator may give a number to: its owner's display name is shown so two bots with one name can be told apart. */
export type AssignableBot = {
  id: string;
  name: string;
  kind: "chief" | "specialist";
  ownerUserId: string;
  ownerName: string;
  /** Whether it has a number or a request now (it cannot be given a second). */
  hasNumber: boolean;
};
export type PhoneRequestView = PhoneNumberView & { ownerUserId: string; botName: string };

const noteFor = (r: Row): string => {
  switch (r.status) {
    case "requested":
      return "Waiting for an administrator to approve this number.";
    case "pending_review":
      return reviewNotice(r.country);
    case "active":
      return "Ready.";
    case "held":
      return "This bot is archived. The number is kept for a while and answers that it is not in service.";
    case "released":
      return "Released.";
    default:
      return "The number could not be set up.";
  }
};

/** The provider of a row: a legacy `off` reads as Telnyx, the only provider those rows could have had. */
export const providerOf = (r: Pick<Row, "provider">): PhoneProviderId =>
  isPhoneProviderId(r.provider) ? r.provider : "telnyx";
const PROVIDER_NAME: Record<PhoneProviderId, string> = { telnyx: "Telnyx", twilio: "Twilio" };

export const viewOf = (r: Row): PhoneNumberView => ({
  id: r.id,
  botId: r.botId,
  provider: providerOf(r),
  number: r.e164,
  country: r.country,
  areaCode: r.areaCode,
  status: r.status,
  note: noteFor(r),
  inbound: r.inbound,
  outbound: r.outbound,
  ownerNumber: r.ownerNumber,
  pinSet: r.pinHash !== null,
  pinLockedUntil:
    r.pinLockedUntil && r.pinLockedUntil > new Date() ? r.pinLockedUntil.toISOString() : null,
  heldUntil: r.heldUntil ? r.heldUntil.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

const HOLD_MS = PHONE_HOLD_DAYS * 86_400_000;
/** Statuses that count against the installation's limit of numbers: each one costs money. */
const COSTING = ["pending_review", "active", "held"] as const;

export function createPhoneService(deps: {
  db: Database;
  reader: Pick<PhoneProviderReader, "offer" | "provider" | "settings">;
  now?: () => Date;
  /** Writes one closed line to the audit trail. */
  audit?: (event: {
    actor: string | null;
    kind: string;
    botId: string | null;
  }) => Promise<void> | void;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const audit = async (actor: string | null, kind: string, botId: string | null) => {
    try {
      await deps.audit?.({ actor, kind, botId });
    } catch {
      // the trail never stops the work
    }
  };

  async function ownedBot(a: ActiveActor, botId: string) {
    const [b] = await db
      .select({ id: bot.id, name: bot.name, kind: bot.kind, archived: bot.archived })
      .from(bot)
      .where(and(eq(bot.id, botId), eq(bot.ownerUserId, a.userId)));
    if (!b) throw new AccessError("NOT_FOUND");
    return b;
  }
  const requireAdmin = (a: ActiveActor) => {
    if (!a.isAdmin) throw new AccessError("ACCESS_DENIED");
  };

  async function currentRow(botId: string): Promise<Row | undefined> {
    const [row] = await db
      .select()
      .from(phoneNumber)
      .where(and(eq(phoneNumber.botId, botId), ne(phoneNumber.status, "released")))
      .orderBy(desc(phoneNumber.createdAt))
      .limit(1);
    // A failed order stays visible once, so the owner reads what happened; a new request replaces it.
    return row;
  }
  async function rowOf(id: string): Promise<Row> {
    const [row] = await db.select().from(phoneNumber).where(eq(phoneNumber.id, id));
    if (!row) throw new AccessError("NOT_FOUND");
    return row;
  }
  async function ownedRow(a: ActiveActor, botId: string): Promise<Row> {
    await ownedBot(a, botId);
    const row = await currentRow(botId);
    if (!row || row.ownerUserId !== a.userId) throw new AccessError("NOT_FOUND");
    return row;
  }

  /** A bot an administrator gives a number to: it exists, is not archived and has no number or request. */
  async function assignTarget(botId: string) {
    const [b] = await db
      .select({ id: bot.id, ownerUserId: bot.ownerUserId, archived: bot.archived })
      .from(bot)
      .where(eq(bot.id, botId));
    if (!b) throw new AccessError("NOT_FOUND");
    if (b.archived) throw new PhoneError("BAD_INPUT", "An archived bot cannot have a number.");
    const [open] = await db
      .select({ id: phoneNumber.id })
      .from(phoneNumber)
      .where(
        and(eq(phoneNumber.botId, botId), inArray(phoneNumber.status, [...PHONE_OPEN_STATUSES])),
      );
    if (open)
      throw new PhoneError("HAVE_ONE", "That bot already has a number or a request for one.");
    return b;
  }
  /** Phone calls of this number that are ringing or talking now (rows older than a call can last are a lost hangup, as in calls.ts). */
  async function openCallsOf(numberId: string): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(voiceCall)
      .where(
        and(
          eq(voiceCall.numberId, numberId),
          eq(voiceCall.channel, "phone"),
          or(
            and(
              eq(voiceCall.status, "ringing"),
              gt(voiceCall.startedAt, sql`now() - interval '2 minutes'`),
            ),
            and(
              eq(voiceCall.status, "active"),
              gt(voiceCall.startedAt, sql`now() - interval '35 minutes'`),
            ),
          ),
        ),
      );
    return r?.n ?? 0;
  }

  async function countCosting(): Promise<number> {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(phoneNumber)
      .where(inArray(phoneNumber.status, [...COSTING]));
    return r?.n ?? 0;
  }

  async function checkAllowed(offer: PhoneOffer, country: string) {
    if (!offer.on || offer.mode === "off")
      throw new PhoneError("NOT_OFFERED", "This server does not hand out phone numbers to bots.");
    if (!countryList(offer.countries.join(",")).includes(country))
      throw new PhoneError("COUNTRY", "Numbers in that country are not offered here.");
    if ((await countCosting()) >= offer.maxNumbers)
      throw new PhoneError(
        "LIMIT",
        "This server has reached its limit of phone numbers. Ask an administrator.",
      );
  }

  /**
   * The provider a request or an attached number uses: the one named, which must be ready, or the default (the saved one when it is
   * ready, else the only ready one). A reader that does not list providers (an older one) offers Telnyx alone.
   */
  function chooseProvider(offer: PhoneOffer, wanted?: PhoneProviderId): PhoneProviderId {
    const ready = offer.providers?.map((p) => p.id) ?? (["telnyx"] as PhoneProviderId[]);
    if (wanted) {
      if (!ready.includes(wanted))
        throw new PhoneError(
          "NOT_OFFERED",
          `${PROVIDER_NAME[wanted]} is not ready on this server. An administrator switches it on and saves its settings and key in Studio.`,
        );
      return wanted;
    }
    const d = offer.defaultProvider === undefined ? ready[0] : offer.defaultProvider;
    if (!d)
      throw new PhoneError("NOT_OFFERED", "This server does not hand out phone numbers to bots.");
    return d;
  }
  async function providerFor(id: PhoneProviderId): Promise<PhoneProvider> {
    const provider = await deps.reader.provider(id);
    if (!provider)
      throw new PhoneError(
        "NOT_OFFERED",
        `${PROVIDER_NAME[id]} is not set up on this server, so the number cannot be handled now.`,
      );
    return provider;
  }

  /** Searches, orders and records one number for a request row (or a new one). Releases it again if it cannot be recorded. */
  async function buy(
    provider: PhoneProvider,
    target: {
      ownerUserId: string;
      botId: string;
      country: string;
      areaCode: string | null;
      existingId?: string;
    },
  ): Promise<Row> {
    let found;
    try {
      found = await provider.searchNumbers({
        country: target.country,
        areaCode: target.areaCode ?? undefined,
        limit: 3,
      });
    } catch (e) {
      throw providerFailure(e);
    }
    const pick = found[0];
    if (!pick)
      throw new PhoneError(
        "NOT_AVAILABLE",
        target.areaCode
          ? "No number is free in that area. Try another area code or none."
          : "No number is free in that country right now.",
      );
    let order;
    try {
      order = await provider.orderNumber({
        e164: pick.e164,
        reference: target.botId,
        requirements: pick.requirements,
      });
    } catch (e) {
      throw providerFailure(e);
    }
    if (order.status === "failed")
      throw new PhoneError("PROVIDER", "The provider did not accept the order for that number.");
    const values = {
      e164: order.e164,
      providerRef: order.providerRef,
      status: order.status as PhoneNumberStatus,
      country: target.country,
      areaCode: target.areaCode,
      provider: provider.name,
      updatedAt: now(),
    };
    try {
      if (target.existingId) {
        const [row] = await db
          .update(phoneNumber)
          .set(values)
          .where(eq(phoneNumber.id, target.existingId))
          .returning();
        return row!;
      }
      const [row] = await db
        .insert(phoneNumber)
        .values({ id: uuidv7(), ownerUserId: target.ownerUserId, botId: target.botId, ...values })
        .returning();
      return row!;
    } catch (e) {
      // A paid number that cannot be recorded would be lost money: give it back.
      await provider.releaseNumber(order.e164).catch(() => undefined);
      throw e;
    }
  }
  function providerFailure(e: unknown): PhoneError {
    return new PhoneError(
      "PROVIDER",
      e instanceof PhoneProviderError
        ? e.safe
        : "The phone provider could not be reached. Try again in a moment.",
    );
  }

  return {
    /** Whether bots can be given numbers here, and how. Nothing in it is secret. */
    offer: () => deps.reader.offer(),

    /** The number (or request) of one of the person's bots, or null. */
    async get(a: ActiveActor, botId: string): Promise<PhoneNumberView | null> {
      await ownedBot(a, botId);
      const row = await currentRow(botId);
      return row && row.ownerUserId === a.userId ? viewOf(row) : null;
    },

    /**
     * The owner asks for a number. In `owner_request` mode it is ordered at once; in `operator_approval` mode a request is recorded and
     * waits for an administrator. A bot has at most one number or request.
     */
    async request(
      a: ActiveActor,
      botId: string,
      input: { country: string; areaCode?: string | null; provider?: PhoneProviderId },
    ): Promise<PhoneNumberView> {
      const b = await ownedBot(a, botId);
      if (b.archived)
        throw new PhoneError(
          "BAD_INPUT",
          "Only a bot of yours that is not archived can have a number.",
        );
      const country = input.country.trim().toUpperCase();
      const areaCode = input.areaCode?.trim() || null;
      if (!isCountryCode(country) || (areaCode !== null && !/^[0-9]{1,6}$/.test(areaCode)))
        throw new PhoneError(
          "BAD_INPUT",
          "Give a two-letter country and, if you like, a numeric area code.",
        );
      const offer = await deps.reader.offer();
      await checkAllowed(offer, country);
      const chosen = chooseProvider(offer, input.provider);
      const have = await currentRow(botId);
      if (have && (PHONE_OPEN_STATUSES as readonly string[]).includes(have.status))
        throw new PhoneError("HAVE_ONE", "This bot already has a number or a request for one.");
      // A failed earlier try is cleared before a new one.
      if (have?.status === "failed")
        await db.delete(phoneNumber).where(eq(phoneNumber.id, have.id));
      if (offer.mode === "operator_approval") {
        try {
          const [row] = await db
            .insert(phoneNumber)
            .values({
              id: uuidv7(),
              ownerUserId: a.userId,
              botId,
              country,
              areaCode,
              provider: chosen,
              status: "requested",
            })
            .returning();
          await audit(a.userId, "phone:requested", botId);
          return viewOf(row!);
        } catch {
          throw new PhoneError("HAVE_ONE", "This bot already has a number or a request for one.");
        }
      }
      const provider = await providerFor(chosen);
      let row: Row;
      try {
        row = await buy(provider, { ownerUserId: a.userId, botId, country, areaCode });
      } catch (e) {
        if (e instanceof PhoneError) throw e;
        throw new PhoneError("HAVE_ONE", "This bot already has a number or a request for one.");
      }
      await audit(a.userId, "phone:ordered", botId);
      return viewOf(row);
    },

    /** The owner takes the number back: it is released at the provider. A request that was never approved is just withdrawn. */
    async release(a: ActiveActor, botId: string): Promise<void> {
      const row = await ownedRow(a, botId);
      await releaseRow(row, a.userId);
    },

    /** Changes who may call, whether the bot may call out, and the owner's own number. */
    async update(
      a: ActiveActor,
      botId: string,
      patch: {
        inbound?: PhoneInboundMode;
        outbound?: PhoneOutboundMode;
        ownerNumber?: string | null;
      },
    ): Promise<PhoneNumberView> {
      const row = await ownedRow(a, botId);
      if (row.status === "held" || row.status === "failed")
        throw new PhoneError("WRONG_STATE", "This number cannot be changed now.");
      const set: Partial<Row> = { updatedAt: now() };
      if (patch.inbound) set.inbound = patch.inbound;
      if (patch.outbound) set.outbound = patch.outbound;
      if (patch.ownerNumber !== undefined) {
        if (patch.ownerNumber === null || patch.ownerNumber.trim() === "") set.ownerNumber = null;
        else {
          const n = normalizeE164(patch.ownerNumber);
          if (!n)
            throw new PhoneError(
              "BAD_INPUT",
              "Give your own number with its country code, for example +1 555 0100.",
            );
          if (n === row.e164) throw new PhoneError("BAD_INPUT", "That is the bot's own number.");
          set.ownerNumber = n;
        }
        // A new number starts over: the old PIN was set for another phone.
        if (set.ownerNumber !== row.ownerNumber) {
          set.pinHash = null;
          set.pinFailures = 0;
          set.pinLockedUntil = null;
        }
      }
      const [saved] = await db
        .update(phoneNumber)
        .set(set)
        .where(eq(phoneNumber.id, row.id))
        .returning();
      return viewOf(saved!);
    },

    /** Sets (or, with null, removes) the keypad PIN. Needs the owner's own number: a PIN without one recognises nobody. */
    async setPin(a: ActiveActor, botId: string, pin: string | null): Promise<PhoneNumberView> {
      const row = await ownedRow(a, botId);
      if (row.status === "held" || row.status === "failed")
        throw new PhoneError("WRONG_STATE", "This number cannot be changed now.");
      let pinHash: string | null = null;
      if (pin !== null) {
        if (!isPin(pin)) throw new PhoneError("BAD_INPUT", "A PIN is four to eight digits.");
        if (!row.ownerNumber) throw new PhoneError("BAD_INPUT", "Save your own number first.");
        pinHash = await hashPin(pin);
      }
      const [saved] = await db
        .update(phoneNumber)
        .set({ pinHash, pinFailures: 0, pinLockedUntil: null, updatedAt: now() })
        .where(eq(phoneNumber.id, row.id))
        .returning();
      await audit(a.userId, pin === null ? "phone:pin-cleared" : "phone:pin-set", botId);
      return viewOf(saved!);
    },

    /**
     * Checks a PIN typed on a call to this number and counts a wrong try; three wrong tries lock it for half an hour. The call handling
     * of the next step uses this; only the digits of the pin are taken, never the owner's chat.
     */
    async checkPin(numberId: string, pin: string): Promise<"ok" | "wrong" | "locked" | "none"> {
      const row = await rowOf(numberId);
      const at = now();
      const outcome = await decidePin(row, pin, at);
      if (outcome.result === "none") return "none";
      if (outcome.result !== "locked")
        await db
          .update(phoneNumber)
          .set({
            pinFailures: outcome.pinFailures,
            pinLockedUntil: outcome.pinLockedUntil,
            updatedAt: at,
          })
          .where(eq(phoneNumber.id, row.id));
      return outcome.result;
    },

    /** A bot was archived: its number is held (it keeps costing, answers "not in service") and released after the hold. */
    async holdForBot(botId: string): Promise<void> {
      const rows = await db
        .select()
        .from(phoneNumber)
        .where(
          and(eq(phoneNumber.botId, botId), inArray(phoneNumber.status, [...PHONE_OPEN_STATUSES])),
        );
      for (const row of rows) {
        if (row.status === "requested") {
          await db
            .update(phoneNumber)
            .set({ status: "failed", updatedAt: now() })
            .where(eq(phoneNumber.id, row.id));
        } else {
          await db
            .update(phoneNumber)
            .set({
              status: "held",
              heldUntil: new Date(now().getTime() + HOLD_MS),
              updatedAt: now(),
            })
            .where(eq(phoneNumber.id, row.id));
          await audit(null, "phone:held", botId);
        }
      }
    },

    /** Releases the held numbers whose time is up. Returns how many. The worker runs it on its ticker. */
    async releaseExpired(): Promise<number> {
      const due = await db
        .select()
        .from(phoneNumber)
        .where(and(eq(phoneNumber.status, "held"), lte(phoneNumber.heldUntil, now())));
      let released = 0;
      for (const row of due) {
        try {
          await releaseRow(row, null);
          released += 1;
        } catch {
          // the provider is down: the number stays held and the next tick tries again
        }
      }
      return released;
    },

    /** Asks the provider how the orders that wait for review stand, and records the answer. Returns how many changed. */
    async syncPending(): Promise<number> {
      const waiting = await db
        .select()
        .from(phoneNumber)
        .where(eq(phoneNumber.status, "pending_review"));
      if (waiting.length === 0) return 0;
      let changed = 0;
      for (const row of waiting) {
        if (!row.providerRef) continue;
        // Each order is asked of the provider that holds it.
        const provider = await deps.reader.provider(providerOf(row));
        if (!provider) continue;
        try {
          const status = await provider.orderStatus(row.providerRef);
          if (status === "pending_review") continue;
          await db
            .update(phoneNumber)
            .set({ status, updatedAt: now() })
            .where(and(eq(phoneNumber.id, row.id), eq(phoneNumber.status, "pending_review")));
          if (status === "failed" && row.e164)
            await provider.releaseNumber(row.e164).catch(() => undefined);
          changed += 1;
        } catch {
          // try again at the next tick
        }
      }
      return changed;
    },

    // ---- Administrators ----

    /** Every number and request on the installation, requests first. */
    async list(a: ActiveActor): Promise<PhoneRequestView[]> {
      requireAdmin(a);
      const rows = await db
        .select({ row: phoneNumber, botName: bot.name })
        .from(phoneNumber)
        .innerJoin(bot, eq(bot.id, phoneNumber.botId))
        .where(ne(phoneNumber.status, "released"))
        .orderBy(asc(phoneNumber.createdAt));
      const views = rows.map((r) => ({
        ...viewOf(r.row),
        ownerUserId: r.row.ownerUserId,
        botName: r.botName,
      }));
      return [
        ...views.filter((v) => v.status === "requested"),
        ...views.filter((v) => v.status !== "requested"),
      ];
    },

    /** Approves a request: the number is ordered now, and the owner's bot has it (or it is under review). */
    async approve(a: ActiveActor, id: string): Promise<PhoneNumberView> {
      requireAdmin(a);
      const row = await rowOf(id);
      if (row.status !== "requested")
        throw new PhoneError("WRONG_STATE", "That request was already answered.");
      const offer = await deps.reader.offer();
      await checkAllowed(offer, row.country);
      // The request names its provider (when it was made); it must still be ready now.
      chooseProvider(offer, providerOf(row));
      const provider = await providerFor(providerOf(row));
      const bought = await buy(provider, {
        ownerUserId: row.ownerUserId,
        botId: row.botId,
        country: row.country,
        areaCode: row.areaCode,
        existingId: row.id,
      });
      await audit(a.userId, "phone:approved", row.botId);
      return viewOf(bought);
    },

    /** Turns a request down. The owner may ask again. */
    async reject(a: ActiveActor, id: string): Promise<void> {
      requireAdmin(a);
      const row = await rowOf(id);
      if (row.status !== "requested")
        throw new PhoneError("WRONG_STATE", "That request was already answered.");
      await db
        .update(phoneNumber)
        .set({ status: "failed", updatedAt: now() })
        .where(eq(phoneNumber.id, id));
      await audit(a.userId, "phone:rejected", row.botId);
    },

    /**
     * Attaches a number the installation's provider account already holds (bought in the provider's dashboard, say) to a bot: no order, no
     * review. Zetta checks the account holds it, routes it to the call application and records it as active for the bot's owner.
     */
    async attach(
      a: ActiveActor,
      input: { botId: string; number: string; provider?: PhoneProviderId },
    ): Promise<PhoneNumberView> {
      requireAdmin(a);
      const e164 = normalizeE164(input.number);
      const parsed = e164 ? parsePhoneNumberFromString(e164) : undefined;
      const country = parsed?.isValid() ? parsed.country : undefined;
      if (!e164 || !country)
        throw new PhoneError(
          "BAD_INPUT",
          "Give a real number with its country code, for example +1 202 555 0123.",
        );
      const offer = await deps.reader.offer();
      await checkAllowed(offer, country);
      const provider = await providerFor(chooseProvider(offer, input.provider));
      const target = await assignTarget(input.botId);
      const [used] = await db
        .select({ id: phoneNumber.id })
        .from(phoneNumber)
        .where(and(eq(phoneNumber.e164, e164), ne(phoneNumber.status, "released")));
      if (used) throw new PhoneError("WRONG_STATE", "That number is already assigned to a bot.");
      let held;
      try {
        held = await provider.findNumber(e164);
      } catch (e) {
        throw providerFailure(e);
      }
      if (!held || held.status !== "active")
        throw new PhoneError(
          "NO_NUMBER",
          "The provider account does not hold that number, or it is not ready to use.",
        );
      try {
        await provider.routeNumber(e164);
      } catch (e) {
        throw providerFailure(e);
      }
      let row: Row | undefined;
      try {
        [row] = await db
          .insert(phoneNumber)
          .values({
            id: uuidv7(),
            ownerUserId: target.ownerUserId,
            botId: target.id,
            e164,
            providerRef: held.providerRef,
            provider: provider.name,
            country,
            status: "active",
            inbound: "owner_only",
            outbound: "on",
          })
          .returning();
      } catch {
        throw new PhoneError(
          "HAVE_ONE",
          "That bot already has a number, or the number was just given to another bot.",
        );
      }
      await audit(a.userId, "phone:attached", target.id);
      return viewOf(row!);
    },

    /**
     * Moves an active or held number to another bot. The owner's registered number, the PIN and any hold belonged to the old owner, so they
     * are cleared; the new owner sets their own.
     */
    async reassign(a: ActiveActor, id: string, botId: string): Promise<PhoneNumberView> {
      requireAdmin(a);
      const row = await rowOf(id);
      if (row.status !== "active" && row.status !== "held")
        throw new PhoneError("WRONG_STATE", "Only a number that is ready or held can be moved.");
      const target = await assignTarget(botId);
      if (await openCallsOf(row.id))
        throw new PhoneError(
          "WRONG_STATE",
          "A call is running on that number. Move it after the call.",
        );
      let saved: Row | undefined;
      try {
        [saved] = await db
          .update(phoneNumber)
          .set({
            botId: target.id,
            ownerUserId: target.ownerUserId,
            status: "active",
            ownerNumber: null,
            pinHash: null,
            pinFailures: 0,
            pinLockedUntil: null,
            heldUntil: null,
            updatedAt: now(),
          })
          .where(and(eq(phoneNumber.id, row.id), inArray(phoneNumber.status, ["active", "held"])))
          .returning();
      } catch {
        throw new PhoneError("HAVE_ONE", "That bot already has a number or a request for one.");
      }
      if (!saved) throw new PhoneError("WRONG_STATE", "That number cannot be moved now.");
      await audit(a.userId, "phone:reassigned", target.id);
      return viewOf(saved);
    },

    /** Every bot that is not archived, for the pickers of "attach" and "reassign". Administrators only: it lists other people's bots. */
    async assignableBots(a: ActiveActor): Promise<AssignableBot[]> {
      requireAdmin(a);
      const rows = await db
        .select({
          id: bot.id,
          name: bot.name,
          kind: bot.kind,
          ownerUserId: bot.ownerUserId,
          ownerName: user.name,
        })
        .from(bot)
        .innerJoin(user, eq(user.id, bot.ownerUserId))
        .where(eq(bot.archived, false))
        .orderBy(asc(user.name), asc(bot.name));
      const open = await db
        .select({ botId: phoneNumber.botId })
        .from(phoneNumber)
        .where(inArray(phoneNumber.status, [...PHONE_OPEN_STATUSES]));
      const has = new Set(open.map((r) => r.botId));
      return rows.map((r) => ({ ...r, hasNumber: has.has(r.id) }));
    },

    /** Releases any number at once, including one that is held. */
    async operatorRelease(a: ActiveActor, id: string): Promise<void> {
      requireAdmin(a);
      await releaseRow(await rowOf(id), a.userId);
    },

    // ---- Call history (read only: never a transcript, never a word that was said) ----

    /** The person's phone calls, newest first: who, how it went and how long. The words are in the call's own chat, which `conversationId` names. */
    async calls(
      a: ActiveActor,
      o: { botId?: string; id?: string; limit?: number } = {},
    ): Promise<PhoneCallView[]> {
      const rows = await db
        .select({ call: voiceCall, botName: bot.name })
        .from(voiceCall)
        .innerJoin(bot, eq(bot.id, voiceCall.botId))
        .where(
          and(
            eq(voiceCall.ownerUserId, a.userId),
            eq(voiceCall.channel, "phone"),
            ...(o.botId ? [eq(voiceCall.botId, o.botId)] : []),
            ...(o.id ? [eq(voiceCall.id, o.id)] : []),
          ),
        )
        .orderBy(desc(voiceCall.startedAt))
        .limit(Math.min(Math.max(o.limit ?? 20, 1), 100));
      return rows.map(({ call: c, botName }) => ({
        id: c.id,
        botId: c.botId,
        botName,
        direction: c.direction,
        peer: c.peer,
        status: c.status,
        outcome: c.outcome,
        endReason: c.endReason,
        durationSeconds: c.durationSeconds,
        startedAt: c.startedAt.toISOString(),
        conversationId: c.conversationId,
      }));
    },

    /** The calls bots of this person are placing now (ringing or talking), with the chat that asked: what the "Hang up" card shows. */
    async liveCalls(a: ActiveActor) {
      const rows = await db
        .select({ call: voiceCall, botName: bot.name })
        .from(voiceCall)
        .innerJoin(bot, eq(bot.id, voiceCall.botId))
        .where(
          and(
            eq(voiceCall.ownerUserId, a.userId),
            eq(voiceCall.channel, "phone"),
            eq(voiceCall.direction, "out"),
            inArray(voiceCall.status, ["ringing", "active"]),
            gte(voiceCall.startedAt, sql`now() - interval '35 minutes'`),
          ),
        )
        .orderBy(desc(voiceCall.startedAt))
        .limit(20);
      return rows.map(({ call: c, botName }) => ({
        id: c.id,
        botName,
        number: c.peer,
        status: c.status,
        requestedIn: c.requestedIn,
        startedAt: c.startedAt.toISOString(),
      }));
    },

    // ---- The do-not-call list (installation-wide) ----

    async optouts(a: ActiveActor) {
      requireAdmin(a);
      const rows = await db.select().from(phoneOptout).orderBy(desc(phoneOptout.createdAt));
      return rows.map((r) => ({
        id: r.id,
        number: r.e164,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    async addOptout(a: ActiveActor, raw: string, reason: PhoneOptoutReason = "operator") {
      requireAdmin(a);
      const n = normalizeE164(raw);
      if (!n)
        throw new PhoneError(
          "BAD_INPUT",
          "Give the number with its country code, for example +1 555 0100.",
        );
      await db
        .insert(phoneOptout)
        .values({ id: uuidv7(), e164: n, reason, createdBy: a.userId })
        .onConflictDoNothing();
      return { number: n };
    },
    async removeOptout(a: ActiveActor, id: string) {
      requireAdmin(a);
      await db.delete(phoneOptout).where(eq(phoneOptout.id, id));
    },
    /** Whether nobody may call this number. Used before every outgoing call (next step). */
    async isOptedOut(raw: string): Promise<boolean> {
      const n = normalizeE164(raw);
      if (!n || !isE164(n)) return true;
      const [row] = await db
        .select({ id: phoneOptout.id })
        .from(phoneOptout)
        .where(eq(phoneOptout.e164, n));
      return Boolean(row);
    },
    /** A person on a call asked not to be called again: the number goes on the list without an administrator. */
    async optOutCaller(raw: string): Promise<void> {
      const n = normalizeE164(raw);
      if (!n) return;
      await db
        .insert(phoneOptout)
        .values({ id: uuidv7(), e164: n, reason: "caller_request" })
        .onConflictDoNothing();
    },
  };

  async function releaseRow(row: Row, actor: string | null): Promise<void> {
    if (row.status === "released") return;
    if (row.e164 && row.status !== "failed" && row.status !== "requested") {
      const provider = await deps.reader.provider(providerOf(row));
      if (!provider)
        throw new PhoneError(
          "NOT_OFFERED",
          "Phone numbers are not set up on this server, so the number cannot be released now.",
        );
      try {
        await provider.releaseNumber(row.e164);
      } catch (e) {
        throw providerFailure(e);
      }
    }
    if (row.status === "requested" || row.status === "failed") {
      await db.delete(phoneNumber).where(eq(phoneNumber.id, row.id));
    } else {
      await db
        .update(phoneNumber)
        .set({
          status: "released",
          releasedAt: now(),
          heldUntil: null,
          pinHash: null,
          updatedAt: now(),
        })
        .where(and(eq(phoneNumber.id, row.id), isNull(phoneNumber.releasedAt)));
    }
    await audit(actor, "phone:released", row.botId);
  }
}
export type PhoneService = ReturnType<typeof createPhoneService>;

type ChatLike = { archiveBot(a: ActiveActor, id: string): Promise<unknown> };

/**
 * Hooks the chat service so an archived bot's number is held. The bot's own work finishes first and the hook never fails it (the same
 * shape as the e-mail address hook in `mail/provision.ts`).
 */
export function withPhoneHold(chat: object, phone: Pick<PhoneService, "holdForBot">) {
  const c = chat as ChatLike;
  const archiveBot = c.archiveBot;
  c.archiveBot = async function (this: unknown, ...args: Parameters<ChatLike["archiveBot"]>) {
    const result = await archiveBot.apply(this, args);
    await phone.holdForBot(args[1]).catch(() => undefined);
    return result;
  };
  return chat;
}
