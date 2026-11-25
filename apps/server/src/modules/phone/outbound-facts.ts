/**
 * What the server knows when a bot asks to place a call, read fresh on every use (when the bot asks, and again when the person approves a
 * card or the call is placed): the bot's number, the provider, the operator's limits, what the bot used today, the do-not-call list and
 * every other bot's number. The decision itself is pure (chat/phone-policy.ts).
 */
import {
  PHONE_OPEN_STATUSES,
  countryList,
  normalizeE164,
  type PhoneSettings,
} from "@zetta/core/phone";
import type { Database } from "@zetta/db";
import { and, eq, gt, inArray, isNotNull, ne, or, sql } from "@zetta/db/query";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { phoneNumber, phoneOptout } from "@zetta/db/schema/phone";
import { voiceCall } from "@zetta/db/schema/voice";
import {
  phoneBlock,
  type PhoneBlock,
  type PhoneCallFacts,
  type PhoneLimits,
  type PhoneUsed,
} from "../chat/phone-policy";
import type { PhoneProviderReader } from "./config";

type NumberRow = typeof phoneNumber.$inferSelect;
type BotRow = typeof bot.$inferSelect;

export type OutboundFacts = {
  number: NumberRow | undefined;
  bot: BotRow | undefined;
  ownerName: string;
  settings: PhoneSettings;
  limits: PhoneLimits;
  used: PhoneUsed;
  busy: boolean;
  block: PhoneBlock;
  /** What the policy reads. */
  call: PhoneCallFacts;
};

/** A call still counts as open this long (a lost hangup webhook must not keep a bot busy for ever). */
const OPEN = { ringingMs: 2 * 60_000, activeMs: 35 * 60_000 } as const;

export function createOutboundFacts(deps: {
  db: Database;
  reader: Pick<PhoneProviderReader, "provider" | "settings">;
}) {
  const { db } = deps;

  async function usedOf(numberId: string): Promise<PhoneUsed> {
    const [r] = await db
      .select({
        calls: sql<number>`count(*)::int`,
        seconds: sql<number>`coalesce(sum(${voiceCall.durationSeconds}), 0)::int`,
      })
      .from(voiceCall)
      .where(
        and(
          eq(voiceCall.numberId, numberId),
          eq(voiceCall.channel, "phone"),
          ne(voiceCall.status, "blocked"),
          gt(voiceCall.startedAt, sql`now() - interval '24 hours'`),
        ),
      );
    return { calls: r?.calls ?? 0, seconds: r?.seconds ?? 0 };
  }

  async function busyOf(numberId: string): Promise<boolean> {
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
              gt(voiceCall.startedAt, sql`now() - make_interval(secs => ${OPEN.ringingMs / 1000})`),
            ),
            and(
              eq(voiceCall.status, "active"),
              gt(voiceCall.startedAt, sql`now() - make_interval(secs => ${OPEN.activeMs / 1000})`),
            ),
          ),
        ),
      );
    return (r?.n ?? 0) > 0;
  }

  return {
    busyOf,
    usedOf,
    /** Everything about one call of this bot to this number. Reads only; changes nothing. */
    async read(o: { userId: string; botId: string; to: string }): Promise<OutboundFacts> {
      const settings = await deps.reader.settings();
      const limits: PhoneLimits = {
        countries: countryList(settings.phoneCountries),
        maxCallMinutes: settings.phoneMaxCallMinutes,
        dailyMinutesPerBot: settings.phoneDailyMinutesPerBot,
        dailyCallsPerBot: settings.phoneDailyCallsPerBot,
      };
      const [number] = await db
        .select()
        .from(phoneNumber)
        .where(
          and(
            eq(phoneNumber.botId, o.botId),
            eq(phoneNumber.ownerUserId, o.userId),
            inArray(phoneNumber.status, [...PHONE_OPEN_STATUSES]),
          ),
        );
      const [b] = await db.select().from(bot).where(eq(bot.id, o.botId));
      const [owner] = await db.select({ name: user.name }).from(user).where(eq(user.id, o.userId));
      const botNumbers = new Set(
        (
          await db
            .select({ e164: phoneNumber.e164 })
            .from(phoneNumber)
            .where(and(ne(phoneNumber.status, "released"), isNotNull(phoneNumber.e164)))
        ).flatMap((r) => (r.e164 ? [r.e164] : [])),
      );
      const compact = normalizeE164(o.to) ?? "";
      const optedOut = compact
        ? (
            await db
              .select({ id: phoneOptout.id })
              .from(phoneOptout)
              .where(eq(phoneOptout.e164, compact))
          ).length > 0
        : false;
      const used = number ? await usedOf(number.id) : { calls: 0, seconds: 0 };
      const busy = number ? await busyOf(number.id) : false;
      const block = phoneBlock({ to: o.to, botNumbers, optedOut, limits, used });
      // The number's own provider is the one that must be ready; a bot with no number is judged by the default one.
      const provider = (await deps.reader.provider(
        number?.provider === "twilio"
          ? "twilio"
          : number?.provider === "telnyx"
            ? "telnyx"
            : undefined,
        o.userId,
      ))
        ? ("ready" as const)
        : ("off" as const);
      return {
        number,
        bot: b,
        ownerName: owner?.name?.trim() || b?.name || "the owner",
        settings,
        limits,
        used,
        busy,
        block,
        call: {
          number: number ? { status: number.status, outbound: number.outbound } : undefined,
          provider,
          busy,
          ownerNumber: number?.ownerNumber ?? null,
          to: o.to,
          block,
        },
      };
    },
  };
}
export type OutboundFactsReader = ReturnType<typeof createOutboundFacts>;
