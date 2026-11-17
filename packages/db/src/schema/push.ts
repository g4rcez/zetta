import { sql } from "drizzle-orm";
import { check, index, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { PUSH_LIMITS } from "@zetta/core/push";
import { zetta } from "./pg-schema";

import { user } from "./auth";

/**
 * One browser or phone a person allowed to push to (Web Push). `endpoint`, `p256dh` and `auth` are the secrets of the subscription:
 * whoever holds them can push to that device, so they stay in this row and no API returns them. A push service that answers 404 or 410
 * means the subscription is gone: the sender sets `failedAt` and prunes the row. Deleting the person deletes their subscriptions.
 */
export const pushSubscription = zetta.table(
  "push_subscription",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade", onUpdate: "restrict" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** The browser's own name, cut to a short label for the person's list of devices. */
    userAgent: text("user_agent").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** The last time a push was sent to it (or it subscribed). */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow().notNull(),
    /** Set when the push service says the subscription no longer exists; the sender skips it and prunes it. */
    failedAt: timestamp("failed_at", { withTimezone: true }),
  },
  (table) => [
    unique("push_subscription_endpoint_unique").on(table.endpoint),
    index("push_subscription_user_id_idx").on(table.userId),
    check(
      "push_subscription_limits_check",
      sql`length(${table.endpoint}) between 1 and ${sql.raw(String(PUSH_LIMITS.endpoint))} and length(${table.p256dh}) between 1 and ${sql.raw(String(PUSH_LIMITS.p256dh))} and length(${table.auth}) between 1 and ${sql.raw(String(PUSH_LIMITS.auth))} and length(${table.userAgent}) <= ${sql.raw(String(PUSH_LIMITS.userAgent))}`,
    ),
  ],
);
