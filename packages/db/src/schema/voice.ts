import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";
import { inWorkspace } from "./workspace-table";

import { user } from "./auth";
import { bot, conversation } from "./chat";
import { phoneNumber } from "./phone";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;
const cascade = { onDelete: "cascade", onUpdate: "restrict" } as const;

/** `web`: the person talks inside Zetta (a browser socket). `phone`: a call over a phone number (later). */
export const VOICE_CALL_CHANNELS = ["web", "phone"] as const;
export type VoiceCallChannel = (typeof VOICE_CALL_CHANNELS)[number];
/** `in`: the person called the bot (a web call is always `in`). `out`: the bot called a number. */
export const VOICE_CALL_DIRECTIONS = ["in", "out"] as const;
export type VoiceCallDirection = (typeof VOICE_CALL_DIRECTIONS)[number];
/** `owner`: the person who owns the bot is on the line. `outside`: anyone else (a phone call from an unknown number). */
export const VOICE_CALL_TRUSTS = ["owner", "outside"] as const;
export type VoiceCallTrust = (typeof VOICE_CALL_TRUSTS)[number];
/**
 * `ringing`: placed, not picked up. `active`: people talk. `ended`: finished in the normal way. `failed`: cut by a problem (a server restart,
 * a provider error). `blocked`: refused before it began (a number that may not call).
 */
export const VOICE_CALL_STATUSES = ["ringing", "active", "ended", "failed", "blocked"] as const;
export type VoiceCallStatus = (typeof VOICE_CALL_STATUSES)[number];
/** Why a call ended, a closed list (never free text, never a provider's error). */
export const VOICE_END_REASONS = [
  "hangup",
  "disconnected",
  "idle",
  "time_limit",
  "replaced",
  "restart",
  "error",
  "refused",
] as const;
export type VoiceEndReason = (typeof VOICE_END_REASONS)[number];
/** How a call a bot placed turned out, a closed list (`end_call` of the bot, or what the server saw). Null on a call that is not outgoing or still runs. */
export const VOICE_CALL_OUTCOMES = [
  "done",
  "declined",
  "no_answer",
  "voicemail",
  "failed",
] as const;
export type VoiceCallOutcome = (typeof VOICE_CALL_OUTCOMES)[number];

/**
 * One spoken conversation with a bot. The words are ordinary chat messages (`message.meta.voice.callId` points here); this row is only the
 * call itself: who, with which bot, how it ended and how long it lasted. `ownerInstance` is the server instance that holds the live audio, so
 * a restart marks only its own open calls `failed`. `numberId` is for the phone channel (a number the installation owns, `phone_number`; the call row stays when the
 * number row is deleted). Deleting the chat deletes its calls; the bot and the person are never deleted while a call exists.
 */
export const voiceCall = zetta.table(
  "voice_call",
  {
    workspaceId: inWorkspace(),
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bot.id, restrict),
    /** Null for a phone call that was turned away before any conversation began (a busy or not-in-service number). */
    conversationId: uuid("conversation_id").references(() => conversation.id, cascade),
    numberId: uuid("number_id").references(() => phoneNumber.id, setNull),
    channel: text("channel", { enum: VOICE_CALL_CHANNELS }).default("web").notNull(),
    direction: text("direction", { enum: VOICE_CALL_DIRECTIONS }).default("in").notNull(),
    /** The other end of a phone call (E.164); null on the web. */
    peer: text("peer"),
    trust: text("trust", { enum: VOICE_CALL_TRUSTS }).default("owner").notNull(),
    status: text("status", { enum: VOICE_CALL_STATUSES }).default("active").notNull(),
    endReason: text("end_reason", { enum: VOICE_END_REASONS }),
    /** Outgoing calls: how it turned out. */
    outcome: text("outcome", { enum: VOICE_CALL_OUTCOMES }),
    /** Outgoing calls: the chat that asked for the call, where its outcome is reported (the row stays when that chat is deleted). */
    requestedIn: uuid("requested_in").references(() => conversation.id, setNull),
    /** The language the call was held in ("pt-BR"), when known. */
    language: text("language"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    ownerInstance: uuid("owner_instance"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("voice_call_owner_idx").on(t.ownerUserId, t.startedAt.desc()),
    index("voice_call_conversation_idx").on(t.conversationId),
    index("voice_call_bot_idx").on(t.botId),
    // The open calls of an instance: read on every start (recovery) and when a person starts another call.
    index("voice_call_open_idx")
      .on(t.ownerInstance, t.ownerUserId)
      .where(sql`${t.status} in ('ringing', 'active')`),
    check("voice_call_channel_check", sql`${t.channel} in ('web', 'phone')`),
    check("voice_call_direction_check", sql`${t.direction} in ('in', 'out')`),
    check("voice_call_trust_check", sql`${t.trust} in ('owner', 'outside')`),
    check(
      "voice_call_status_check",
      sql`${t.status} in ('ringing', 'active', 'ended', 'failed', 'blocked')`,
    ),
    check(
      "voice_call_end_reason_check",
      sql`${t.endReason} is null or ${t.endReason} in ('hangup', 'disconnected', 'idle', 'time_limit', 'replaced', 'restart', 'error', 'refused')`,
    ),
    check(
      "voice_call_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in ('done', 'declined', 'no_answer', 'voicemail', 'failed')`,
    ),
    check("voice_call_peer_check", sql`${t.peer} is null or length(${t.peer}) <= 32`),
    check("voice_call_language_check", sql`${t.language} is null or length(${t.language}) <= 35`),
    check(
      "voice_call_duration_check",
      sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`,
    ),
    // A call that is over says how.
    check(
      "voice_call_ended_check",
      sql`(${t.status} in ('ringing', 'active')) = (${t.endedAt} is null)`,
    ),
  ],
);
