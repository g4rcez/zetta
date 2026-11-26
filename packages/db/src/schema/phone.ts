import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  PHONE_INBOUND_MODES,
  PHONE_NUMBER_STATUSES,
  PHONE_OPTOUT_REASONS,
  PHONE_OUTBOUND_MODES,
  PHONE_NUMBER_PROVIDERS,
} from "@zetta/core/phone";
import { zetta } from "./pg-schema";
import { inWorkspace } from "./workspace-table";

import { user } from "./auth";
import { bot } from "./chat";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/**
 * A phone number of one bot. The installation buys it from its provider (the operator's account, in the operator's name) and the bot's
 * owner asks for it. `requested` is a request an administrator has not approved yet (no number then). `pending_review` is ordered and
 * under review (Brazilian numbers can take up to 3 business days). `held`: the bot was archived; the number keeps costing, answers "not in
 * service" and is released when `heldUntil` passes. A released number's digits may be bought again later by anyone, so the number is
 * unique only while it is not released.
 *
 * `ownerNumber` and `pinHash` are how the owner is recognised on a call (the keypad PIN; caller ID alone never is). The PIN is stored as a
 * hash. Three wrong tries lock it until `pinLockedUntil`.
 */
export const phoneNumber = zetta.table(
  "phone_number",
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
    /** E.164 ("+15550100123"); null until a request is approved and ordered, and on an order that failed. */
    e164: text("e164"),
    provider: text("provider", { enum: PHONE_NUMBER_PROVIDERS }).default("telnyx").notNull(),
    /** The provider's id of the number or its order. */
    providerRef: text("provider_ref"),
    /** ISO country the number belongs to ("BR"). */
    country: text("country").notNull(),
    /** Area code asked for, when the owner gave one. */
    areaCode: text("area_code"),
    status: text("status", { enum: PHONE_NUMBER_STATUSES }).default("pending_review").notNull(),
    inbound: text("inbound", { enum: PHONE_INBOUND_MODES }).default("owner_only").notNull(),
    outbound: text("outbound", { enum: PHONE_OUTBOUND_MODES }).default("on").notNull(),
    /** The owner's own phone (E.164): with the PIN it is how the owner is recognised. */
    ownerNumber: text("owner_number"),
    pinHash: text("pin_hash"),
    pinFailures: integer("pin_failures").default(0).notNull(),
    pinLockedUntil: timestamp("pin_locked_until", { withTimezone: true }),
    /** When a held number is released if nobody does it first. */
    heldUntil: timestamp("held_until", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("phone_number_e164_key")
      .on(t.e164)
      .where(sql`${t.status} <> 'released' and ${t.e164} is not null`),
    // At most one number (or request for one) per bot.
    uniqueIndex("phone_number_bot_open_key")
      .on(t.botId)
      .where(sql`${t.status} in ('requested', 'pending_review', 'active')`),
    index("phone_number_owner_idx").on(t.ownerUserId),
    index("phone_number_held_idx")
      .on(t.heldUntil)
      .where(sql`${t.status} = 'held'`),
    check("phone_number_provider_check", sql`${t.provider} in ('off', 'telnyx', 'twilio')`),
    check(
      "phone_number_status_check",
      sql`${t.status} in ('requested', 'pending_review', 'active', 'held', 'released', 'failed')`,
    ),
    check("phone_number_inbound_check", sql`${t.inbound} in ('anyone', 'owner_only', 'off')`),
    check("phone_number_outbound_check", sql`${t.outbound} in ('on', 'off')`),
    check("phone_number_e164_check", sql`${t.e164} is null or ${t.e164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      "phone_number_owner_number_check",
      sql`${t.ownerNumber} is null or ${t.ownerNumber} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
    check("phone_number_country_check", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check("phone_number_area_check", sql`${t.areaCode} is null or ${t.areaCode} ~ '^[0-9]{1,6}$'`),
    check(
      "phone_number_provider_ref_check",
      sql`${t.providerRef} is null or length(${t.providerRef}) <= 200`,
    ),
    check("phone_number_pin_failures_check", sql`${t.pinFailures} between 0 and 100`),
    check("phone_number_pin_hash_check", sql`${t.pinHash} is null or length(${t.pinHash}) <= 300`),
    // A number that exists has its digits; only a request or a failed order may lack them.
    check(
      "phone_number_has_number_check",
      sql`${t.e164} is not null or ${t.status} in ('requested', 'failed')`,
    ),
  ],
);

/**
 * The installation-wide do-not-call list: nobody is called on a number that is here, by any bot. Rows are closed codes, never free text.
 */
export const phoneOptout = zetta.table(
  "phone_optout",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    e164: text("e164").notNull(),
    reason: text("reason", { enum: PHONE_OPTOUT_REASONS }).default("operator").notNull(),
    /** The administrator who added it (null: added by a caller's own request on a call). */
    createdBy: text("created_by").references(() => user.id, setNull),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("phone_optout_e164_key").on(t.e164),
    check("phone_optout_e164_check", sql`${t.e164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      "phone_optout_reason_check",
      sql`${t.reason} in ('caller_request', 'operator', 'complaint')`,
    ),
  ],
);

/**
 * The ids of the provider's webhooks already handled, so a replay is refused by every instance that shares this database and not only by
 * the one that saw the first delivery. A row older than an hour is useless (the signature's own window is five minutes) and is purged.
 */
export const phoneWebhookEvent = zetta.table(
  "phone_webhook_event",
  {
    eventId: text("event_id").primaryKey(),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("phone_webhook_event_seen_idx").on(t.seenAt),
    check("phone_webhook_event_id_check", sql`length(${t.eventId}) between 1 and 200`),
  ],
);
