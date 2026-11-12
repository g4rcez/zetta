import { uuidv7 } from "@zetta/core/uuid";
import type { Database } from "@zetta/db";
import { and, eq, inArray, sql } from "@zetta/db/query";
import { message } from "@zetta/db/schema/chat";
import { pollVote } from "@zetta/db/schema/features";

import { AccessError } from "../identity/access";

export const POLL_MODES = ["single", "multiple"] as const;
export type PollMode = (typeof POLL_MODES)[number];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_QUESTION = 200;
export const MAX_LABEL = 80;

/** A poll, kept in `message.meta.poll`: what is asked, how many options a voter may pick, and whether it still takes votes. */
export type Poll = {
  question: string;
  mode: PollMode;
  status: "open" | "closed";
  options: { id: string; label: string }[];
  closedAt?: string;
};

/** What went wrong with a poll, in words the person or the bot can act on (`safe` is shown to both). */
export class PollError extends Error {
  constructor(
    readonly code:
      | "INVALID"
      | "CLOSED"
      | "UNKNOWN_OPTION"
      | "NOT_A_POLL"
      | "SINGLE_CHOICE"
      | "NOT_ALLOWED",
    readonly safe: string,
  ) {
    super(code);
  }
}

/** The text a poll message carries when its author wrote nothing else: what the page, a notification and a bot read. */
export const pollBody = (poll: Pick<Poll, "question">) => `📊 ${poll.question}`;

/** A new poll. 2 to 10 distinct options (the same text in another case is the same option), short ids a bot can quote. */
export function newPoll(input: {
  question: string;
  options: readonly string[];
  mode?: PollMode;
}): Poll {
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION)
    throw new PollError(
      "INVALID",
      `A poll needs a question of at most ${MAX_QUESTION} characters.`,
    );
  const labels: string[] = [];
  for (const raw of input.options) {
    const label = raw.trim();
    if (!label) continue;
    if (label.length > MAX_LABEL)
      throw new PollError("INVALID", `An option is at most ${MAX_LABEL} characters.`);
    if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
  }
  if (labels.length < MIN_OPTIONS || labels.length > MAX_OPTIONS)
    throw new PollError(
      "INVALID",
      `A poll needs ${MIN_OPTIONS} to ${MAX_OPTIONS} different options.`,
    );
  const used = new Set<string>();
  const options = labels.map((label) => {
    // The tail of a v7 id is random; six characters are enough to tell ten options apart.
    let id = `o${uuidv7().slice(-6)}`;
    while (used.has(id)) id = `o${uuidv7().slice(-6)}`;
    used.add(id);
    return { id, label };
  });
  return { question, mode: input.mode ?? "single", status: "open", options };
}

/** Reads `meta.poll` back from a saved message. Anything that is not a well-formed poll is ignored. */
export function savedPoll(meta: unknown): Poll | null {
  const p = (meta as { poll?: Partial<Poll> } | null)?.poll;
  if (
    !p ||
    typeof p.question !== "string" ||
    !Array.isArray(p.options) ||
    p.options.length < MIN_OPTIONS
  )
    return null;
  const options = p.options.filter(
    (o): o is { id: string; label: string } =>
      !!o && typeof o.id === "string" && typeof o.label === "string",
  );
  if (options.length !== p.options.length) return null;
  return {
    question: p.question,
    mode: p.mode === "multiple" ? "multiple" : "single",
    status: p.status === "closed" ? "closed" : "open",
    options,
    ...(typeof p.closedAt === "string" ? { closedAt: p.closedAt } : {}),
  };
}

/** The option ids a voter picked, given as ids or as the label text (a bot finds the label easier). An unknown pick is refused. */
export function pickOptions(poll: Poll, picks: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const raw of picks) {
    const pick = raw.trim();
    const hit =
      poll.options.find((o) => o.id === pick) ??
      poll.options.find((o) => o.label.toLowerCase() === pick.toLowerCase());
    if (!hit)
      throw new PollError(
        "UNKNOWN_OPTION",
        `"${pick.slice(0, 80)}" is not an option of this poll. The options: ${poll.options.map((o) => `${o.label} (id ${o.id})`).join(", ")}.`,
      );
    ids.add(hit.id);
  }
  return [...ids];
}

export type Voter = { kind: "user"; userId: string } | { kind: "bot"; botId: string };

const voterIs = (v: Voter) =>
  v.kind === "user" ? eq(pollVote.voterUserId, v.userId) : eq(pollVote.voterBotId, v.botId);

/**
 * Sets what a voter picked: their whole choice, so it is also how a vote is changed or taken back (an empty choice). The message row is
 * locked while the check and the write run, so a poll that is being closed cannot take one more vote. A single-choice poll takes one pick.
 */
export async function castVote(
  db: Database,
  messageId: string,
  conversationId: string,
  voter: Voter,
  picks: readonly string[],
): Promise<Poll> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ meta: message.meta })
      .from(message)
      .where(and(eq(message.id, messageId), eq(message.conversationId, conversationId)))
      .for("update");
    if (!m) throw new AccessError("NOT_FOUND");
    const poll = savedPoll(m.meta);
    if (!poll) throw new PollError("NOT_A_POLL", "That message is not a poll.");
    if (poll.status === "closed") throw new PollError("CLOSED", "This poll is closed.");
    const ids = pickOptions(poll, picks);
    if (poll.mode === "single" && ids.length > 1)
      throw new PollError("SINGLE_CHOICE", "This poll takes one choice. Pick one option.");
    await tx.delete(pollVote).where(and(eq(pollVote.messageId, messageId), voterIs(voter)));
    if (ids.length)
      await tx
        .insert(pollVote)
        .values(
          ids.map((optionId) =>
            voter.kind === "user"
              ? { messageId, optionId, voter: "user" as const, voterUserId: voter.userId }
              : { messageId, optionId, voter: "bot" as const, voterBotId: voter.botId },
          ),
        );
    return poll;
  });
}

/**
 * Closes a poll: no more votes, the results stay. `canClose` decides from the message row who may; closing twice changes nothing.
 */
export async function closePoll(
  db: Database,
  messageId: string,
  conversationId: string,
  canClose: (m: { role: string; ownerUserId: string; botId: string | null }) => boolean,
): Promise<Poll> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({
        meta: message.meta,
        role: message.role,
        ownerUserId: message.ownerUserId,
        botId: message.botId,
      })
      .from(message)
      .where(and(eq(message.id, messageId), eq(message.conversationId, conversationId)))
      .for("update");
    if (!m) throw new AccessError("NOT_FOUND");
    const poll = savedPoll(m.meta);
    if (!poll) throw new PollError("NOT_A_POLL", "That message is not a poll.");
    if (!canClose(m))
      throw new PollError("NOT_ALLOWED", "Only whoever made the poll can close it.");
    if (poll.status === "closed") return poll;
    const closed: Poll = { ...poll, status: "closed", closedAt: new Date().toISOString() };
    await tx
      .update(message)
      .set({
        meta: sql`jsonb_set(coalesce(${message.meta}, '{}'::jsonb), '{poll}', ${JSON.stringify(closed)}::jsonb)`,
      })
      .where(eq(message.id, messageId));
    return closed;
  });
}

/** What one option has so far: how many picked it, whether the viewer did, and which bots did (their faces show). */
export type OptionTally = { count: number; mine: boolean; botIds: string[] };

/** The votes of many polls, grouped by message and option. People are counted, never named; bots are listed. */
export async function tallies(
  db: Database,
  messageIds: readonly string[],
  viewerUserId: string,
): Promise<Map<string, Record<string, OptionTally>>> {
  const out = new Map<string, Record<string, OptionTally>>();
  if (!messageIds.length) return out;
  const votes = await db
    .select({
      messageId: pollVote.messageId,
      optionId: pollVote.optionId,
      voterUserId: pollVote.voterUserId,
      voterBotId: pollVote.voterBotId,
    })
    .from(pollVote)
    .where(inArray(pollVote.messageId, [...messageIds]));
  for (const v of votes) {
    const byOption = out.get(v.messageId) ?? {};
    const t = byOption[v.optionId] ?? { count: 0, mine: false, botIds: [] };
    t.count++;
    if (v.voterUserId === viewerUserId) t.mine = true;
    if (v.voterBotId) t.botIds.push(v.voterBotId);
    byOption[v.optionId] = t;
    out.set(v.messageId, byOption);
  }
  return out;
}

const TEXT_LIMIT = 700;

/**
 * A poll as a bot reads it in the history: the message id to vote on, the options with their ids and how many picked each. The question
 * and labels were typed by a person or a bot, so their fences are defused, and the whole is capped to keep the history small.
 */
export function pollText(
  messageId: string,
  poll: Poll,
  tally: Record<string, OptionTally> | undefined,
  botName: (id: string) => string,
): string {
  const lines = poll.options.map((o) => {
    const t = tally?.[o.id];
    const bots = t?.botIds.length ? ` (bots: ${t.botIds.map(botName).join(", ")})` : "";
    return `  - ${o.label} [id ${o.id}]: ${t?.count ?? 0} vote${t?.count === 1 ? "" : "s"}${bots}`;
  });
  const head = `[Poll, message id ${messageId}, ${poll.status}, ${poll.mode === "single" ? "one choice" : "several choices"}: "${poll.question}"`;
  return `${head}\n${lines.join("\n")}]`.replaceAll("```", "'''").slice(0, TEXT_LIMIT);
}
