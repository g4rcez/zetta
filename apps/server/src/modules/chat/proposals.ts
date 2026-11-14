import type { Database } from "@zetta/db";
import { configProposal } from "@zetta/db/schema/features";
import { topics } from "@zetta/core/live-topics";
import { events } from "../events/bus";

export type NewProposal = typeof configProposal.$inferInsert;

/**
 * The one place a pending approval is created. Besides the insert it tells the web app that the approvals changed, so Inbox and the
 * bot's chat footer show the card without waiting for their next poll, and it keeps where the card was raised (`resultLink`) on the
 * proposal itself, so "Open in chat" needs no second record.
 */
export async function insertProposal(db: Pick<Database, "insert">, values: NewProposal) {
  const [row] = await db.insert(configProposal).values(values).returning();
  events.publish([values.ownerUserId], topics.proposals, topics.botStatus);
  return row!;
}
