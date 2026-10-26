import { createHash } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, lt, or, sql } from "@zetta/db/query";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { botPeer, discussion, discussionMember, discussionTurn } from "@zetta/db/schema/discussions";
import { configProposal } from "@zetta/db/schema/features";
import { raiseAttention } from "../features/attention";
import { AccessError, requireOwned, type ActiveActor } from "../identity/access";
import { dockerConfig } from "../chat/harness";
import { insertMessage } from "../chat/messages";
import { codeEnabled } from "../chat/pipeline";
import { mentionKey, wakeTargets } from "./prompt";

type Bot = typeof bot.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Discussion = typeof discussion.$inferSelect;
export type DiscussionTurn = typeof discussionTurn.$inferSelect;
export type Member = typeof discussionMember.$inferSelect;

export const MAX_MEMBERS = 6, MAX_OPEN = 5, MAX_PENDING_PROPOSALS = 3, MAX_PEERS = 20;
const ACTIVE = ["open", "paused", "stalled"] as const;

/** `safe` is shown to the user and to the bot that asked (no ids of other users, no secrets). */
export class DiscussionError extends Error { constructor(readonly code: "INVALID" | "LIMIT" | "NOT_ALLOWED" | "NOT_FOUND" | "CONFLICT" | "CLOSED", readonly safe: string) { super(code); } }

export type OpenInput = {
  title: string; goal: string; context: string; members: { bot: string; role?: string | undefined }[]; firstMessage: string;
  /** The bot that asked (null: a person opened it from the UI). */ createdBy: Bot | null;
  origin?: { conversationId: string; messageId: string | null } | undefined;
  originInbound?: { plugin: string; chat: string; chatName: string } | undefined;
  tainted: boolean; turnBudget?: number | undefined;
};
export type Claimed = { turn: DiscussionTurn; discussion: Discussion; member: Member };

/**
 * Group discussions between bots: one owner (the user every member turn runs as), a shared task context and a transcript in a
 * conversation of kind "discussion". Posts wake members through a durable turn queue; the worker (worker.ts) runs them one at a time
 * per owner through the chat service. Bounded by members, open discussions, a turn budget and, when outside content is in play, an
 * owner-approved brief for members that can change code.
 */
export function createDiscussionStore(db: Database) {
  let onEnqueue: (() => void) | undefined;
  const visible = (a: ActiveActor) => or(eq(bot.ownerUserId, a.userId), eq(bot.visibility, "team"));

  async function loadOwned(a: ActiveActor, id: string) {
    const [row] = await db.select().from(discussion).where(and(eq(discussion.id, id), eq(discussion.ownerUserId, a.userId)));
    return requireOwned(a, row);
  }
  async function membersOf(d: Pick<Discussion, "id">) {
    return db.select({ m: discussionMember, name: bot.name, harness: bot.harness, codeAccess: bot.codeAccess }).from(discussionMember).innerJoin(bot, eq(bot.id, discussionMember.botId)).where(eq(discussionMember.discussionId, d.id)).orderBy(asc(discussionMember.joinedAt));
  }
  /** Bots the actor may use, by id or name (own bots win, then the oldest), ready and not archived. */
  async function resolveBots(a: ActiveActor, refs: string[]) {
    const rows = (await db.select().from(bot).where(and(visible(a), eq(bot.archived, false))).orderBy(asc(bot.createdAt))).sort((x, y) => Number(y.ownerUserId === a.userId) - Number(x.ownerUserId === a.userId));
    return refs.map((ref) => {
      const hit = rows.find((b) => b.id === ref) ?? rows.find((b) => mentionKey(b.name) === mentionKey(ref.replace(/^@/, "")));
      if (!hit) throw new DiscussionError("NOT_FOUND", `There is no bot called "${ref.slice(0, 60)}" that you can use.`);
      if (!hit.onboarded) throw new DiscussionError("NOT_ALLOWED", `${hit.name} is not ready yet; finish its setup first.`);
      if (hit.ownerUserId !== a.userId && hit.requiredConnections.length && !dockerConfig()) throw new DiscussionError("NOT_ALLOWED", `${hit.name} belongs to someone else and needs account keys; that only works when bots run in Docker mode.`);
      return hit;
    });
  }

  async function peerIds(a: ActiveActor, botId: string) {
    return (await db.select({ id: botPeer.peerBotId }).from(botPeer).where(and(eq(botPeer.ownerUserId, a.userId), eq(botPeer.botId, botId)))).map((r) => r.id);
  }

  /** Queues one turn per woken member (never the author; at most one per member per post). */
  async function enqueueWakes(tx: Pick<Database, "select" | "insert">, d: Pick<Discussion, "id" | "ownerUserId" | "createdByBotId">, authorBotId: string | null, text: string, messageId: string, opening = false) {
    const members = await tx.select({ botId: discussionMember.botId, name: bot.name }).from(discussionMember).innerJoin(bot, eq(bot.id, discussionMember.botId)).where(eq(discussionMember.discussionId, d.id));
    const targets = wakeTargets(members, d.createdByBotId, authorBotId, text, opening);
    if (!targets.length) return 0;
    const rows = await tx.insert(discussionTurn).values(targets.map((botId) => ({ ownerUserId: d.ownerUserId, discussionId: d.id, botId, triggerMessageId: messageId }))).onConflictDoNothing().returning({ id: discussionTurn.id });
    return rows.length;
  }

  async function open(a: ActiveActor, input: OpenInput) {
    const bots = await resolveBots(a, input.members.map((m) => m.bot));
    const roles = new Map(bots.map((b, i) => [b.id, input.members[i]!.role ?? ""]));
    const all = [...new Map([...(input.createdBy ? [[input.createdBy.id, input.createdBy] as const] : []), ...bots.map((b) => [b.id, b] as const)]).values()];
    if (all.length < 2 && input.createdBy) throw new DiscussionError("INVALID", "Invite at least one other bot.");
    if (all.length > MAX_MEMBERS) throw new DiscussionError("LIMIT", `A discussion has at most ${MAX_MEMBERS} bots.`);
    const openKey = createHash("sha256").update([input.origin?.conversationId ?? "", input.createdBy?.id ?? "user", input.title.trim().toLowerCase()].join("\u0000")).digest("hex");
    const res = await db.transaction(async (tx) => {
      const [same] = await tx.select().from(discussion).where(and(eq(discussion.ownerUserId, a.userId), eq(discussion.openKey, openKey), inArray(discussion.status, [...ACTIVE])));
      if (same) return { discussion: same, created: false };
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(discussion).where(and(eq(discussion.ownerUserId, a.userId), inArray(discussion.status, [...ACTIVE])));
      if (n >= MAX_OPEN) throw new DiscussionError("LIMIT", `You already have ${MAX_OPEN} discussions running. Resolve or cancel one first.`);
      const [conv] = await tx.insert(conversation).values({ ownerUserId: a.userId, botId: (input.createdBy ?? all[0]!).id, kind: "discussion", title: input.title.trim().slice(0, 120) }).returning();
      const [d] = await tx.insert(discussion).values({
        ownerUserId: a.userId, conversationId: conv!.id, createdByBotId: input.createdBy?.id ?? null, originConversationId: input.origin?.conversationId ?? null, originMessageId: input.origin?.messageId ?? null,
        originInbound: input.originInbound ?? null, title: input.title.trim().slice(0, 120), goal: input.goal.slice(0, 1000), context: input.context.slice(0, 8000), tainted: input.tainted,
        turnBudget: Math.min(Math.max(input.turnBudget ?? 20, 1), 50), openKey,
      }).returning();
      await tx.insert(discussionMember).values(all.map((b) => ({ discussionId: d!.id, botId: b.id, role: (b.id === input.createdBy?.id ? roles.get(b.id) || "facilitator" : roles.get(b.id) ?? "").slice(0, 200), requireApproval: codeEnabled(b, a.userId) })));
      const first = await insertMessage(tx, conv!.id, input.createdBy
        ? { ownerUserId: a.userId, role: "assistant", content: input.firstMessage, botId: input.createdBy.id, botVersion: input.createdBy.version }
        : { ownerUserId: a.userId, role: "user", content: input.firstMessage });
      await enqueueWakes(tx, d!, input.createdBy?.id ?? null, input.firstMessage, first.id, true);
      return { discussion: d!, created: true };
    });
    if (res.created) onEnqueue?.();
    return { ...res, members: all };
  }

  async function post(tx: Pick<Database, "select" | "insert">, d: Discussion, author: Bot, text: string) {
    const row = await insertMessage(tx, d.conversationId, { ownerUserId: d.ownerUserId, role: "assistant", content: text, botId: author.id, botVersion: author.version });
    const n = d.status === "open" ? await enqueueWakes(tx, d, author.id, text, row.id) : 0;
    if (n) onEnqueue?.();
    return row;
  }

  /** Turns in the gate get a brief the owner approves: the bot, the context version it will act on, and the post that woke it. */
  async function gate(tx: Tx, c: Claimed, botName: string) {
    const [trigger] = c.turn.triggerMessageId ? await tx.select({ content: message.content }).from(message).where(eq(message.id, c.turn.triggerMessageId)) : [];
    await tx.update(discussionTurn).set({ status: "awaiting_approval" }).where(eq(discussionTurn.id, c.turn.id));
    const patch = { discussionId: c.discussion.id, turnId: c.turn.id, botId: c.turn.botId, contextVersion: c.discussion.contextVersion };
    const [p] = await tx.insert(configProposal).values({ ownerUserId: c.discussion.ownerUserId, kind: "discussion_brief", botId: c.turn.botId, proposedByBotId: c.discussion.createdByBotId, baseVersion: c.discussion.contextVersion, patch,
      diff: [{ field: "bot", from: null, to: botName }, { field: "discussion", from: null, to: c.discussion.title }, { field: "goal", from: null, to: c.discussion.goal.slice(0, 400) }, { field: "context", from: null, to: c.discussion.context.slice(0, 1200) }, { field: "request", from: null, to: (trigger?.content ?? "").slice(0, 600) }] }).returning();
    await raiseAttention(tx, c.discussion.ownerUserId, { botId: c.turn.botId, title: `Approve ${botName} acting in "${c.discussion.title}"`, detail: "This discussion includes outside content (for example a customer's message) and the bot can change code.", nextAction: "Review the brief and approve or reject it.", resultLink: `/discussions?id=${c.discussion.id}`, source: "bot", sourceKey: `proposal:${p!.id}` });
  }

  return {
    set onEnqueue(fn: (() => void) | undefined) { onEnqueue = fn; },
    peerIds,
    async peers(a: ActiveActor, botId: string) {
      const [b] = await db.select({ id: bot.id }).from(bot).where(and(eq(bot.id, botId), visible(a), eq(bot.archived, false)));
      if (!b) throw new AccessError("NOT_FOUND");
      const ids = await peerIds(a, botId);
      return ids.length ? db.select({ id: bot.id, name: bot.name }).from(bot).where(and(inArray(bot.id, ids), visible(a), eq(bot.archived, false))) : [];
    },
    /** Replaces the allowlist of one bot (for this user only). Peers must be bots the user can use. */
    async setPeers(a: ActiveActor, botId: string, ids: string[]) {
      const unique = [...new Set(ids)].filter((id) => id !== botId);
      if (unique.length > MAX_PEERS) throw new DiscussionError("LIMIT", `At most ${MAX_PEERS} bots.`);
      const [b] = await db.select({ id: bot.id }).from(bot).where(and(eq(bot.id, botId), visible(a), eq(bot.archived, false)));
      if (!b) throw new AccessError("NOT_FOUND");
      const ok = unique.length ? await db.select({ id: bot.id }).from(bot).where(and(inArray(bot.id, unique), visible(a), eq(bot.archived, false))) : [];
      if (ok.length !== unique.length) throw new AccessError("NOT_FOUND");
      await db.transaction(async (tx) => {
        await tx.delete(botPeer).where(and(eq(botPeer.ownerUserId, a.userId), eq(botPeer.botId, botId)));
        if (unique.length) await tx.insert(botPeer).values(unique.map((peerBotId) => ({ ownerUserId: a.userId, botId, peerBotId })));
      });
      return unique;
    },
    resolveBots,
    open,
    /** A bot asked to open a discussion: allowlisted peers open it now; others become a proposal (never for outside people). */
    async request(a: ActiveActor, input: OpenInput & { createdBy: Bot }, inbound: boolean) {
      const bots = await resolveBots(a, input.members.map((m) => m.bot));
      const allowed = new Set(await peerIds(a, input.createdBy.id));
      const outside = bots.filter((b) => b.id !== input.createdBy.id && !allowed.has(b.id));
      if (!outside.length) return { kind: "opened" as const, ...(await open(a, input)) };
      if (inbound) throw new DiscussionError("NOT_ALLOWED", `${outside.map((b) => b.name).join(", ")} ${outside.length === 1 ? "is" : "are"} not pre-approved for ${input.createdBy.name}, and requests from outside people cannot ask for approval. The user can add them under the bot's settings > Group discussions.`);
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(configProposal).where(and(eq(configProposal.ownerUserId, a.userId), eq(configProposal.kind, "open_discussion"), eq(configProposal.status, "pending")));
      if (n >= MAX_PENDING_PROPOSALS) throw new DiscussionError("LIMIT", "There are already discussion requests waiting for the user's approval.");
      const patch = { title: input.title, goal: input.goal, context: input.context, members: bots.map((b, i) => ({ bot: b.id, role: input.members[i]!.role })), firstMessage: input.firstMessage, createdByBotId: input.createdBy.id, origin: input.origin ?? null, originInbound: input.originInbound ?? null, tainted: input.tainted };
      const [p] = await db.insert(configProposal).values({ ownerUserId: a.userId, kind: "open_discussion", botId: null, proposedByBotId: input.createdBy.id, baseVersion: 0, patch,
        diff: [{ field: "discussion", from: null, to: input.title }, { field: "goal", from: null, to: input.goal.slice(0, 400) }, { field: "members", from: null, to: [input.createdBy.name, ...bots.map((b) => b.name)].join(", ") }, { field: "context", from: null, to: input.context.slice(0, 1200) }] }).returning();
      await raiseAttention(db, a.userId, { botId: input.createdBy.id, title: `${input.createdBy.name} wants to open a discussion with ${outside.map((b) => b.name).join(", ")}`, detail: input.title, nextAction: "Open Chat and approve or reject the proposal.", resultLink: "/chat", source: "bot", sourceKey: `proposal:${p!.id}` });
      return { kind: "proposed" as const, proposalId: p!.id };
    },
    /** Approved `open_discussion` proposal: everything is checked again with today's bots and limits. */
    async openFromProposal(a: ActiveActor, patch: Record<string, unknown>) {
      const [creator] = await db.select().from(bot).where(and(eq(bot.id, String(patch.createdByBotId)), visible(a), eq(bot.archived, false)));
      if (!creator) throw new AccessError("NOT_FOUND");
      return open(a, { title: String(patch.title), goal: String(patch.goal ?? ""), context: String(patch.context ?? ""), members: (patch.members as { bot: string; role?: string }[]) ?? [], firstMessage: String(patch.firstMessage ?? ""), createdBy: creator,
        origin: (patch.origin as OpenInput["origin"]) ?? undefined, originInbound: (patch.originInbound as OpenInput["originInbound"]) ?? undefined, tainted: Boolean(patch.tainted) });
    },
    /** For tool calls: the discussion when `who` is a member of it (else NOT_FOUND, never someone else's). */
    async forMember(a: ActiveActor, id: string, botId: string) {
      const d = await loadOwned(a, id);
      const [m] = await db.select().from(discussionMember).where(and(eq(discussionMember.discussionId, d.id), eq(discussionMember.botId, botId)));
      if (!m) throw new DiscussionError("NOT_FOUND", "You are not a member of that discussion.");
      return d;
    },
    async postAsBot(a: ActiveActor, id: string, who: Bot, text: string) {
      const d = await this.forMember(a, id, who.id);
      if (d.status !== "open") throw new DiscussionError("CLOSED", `That discussion is ${d.status}.`);
      return post(db, d, who, text);
    },
    /** A post that already exists (a member turn's reply): only wakes the next members. */
    async afterReply(d: Discussion, authorBotId: string, text: string, messageId: string) {
      const [cur] = await db.select().from(discussion).where(eq(discussion.id, d.id));
      if (cur?.status !== "open") return 0;
      const n = await enqueueWakes(db, cur, authorBotId, text, messageId);
      if (n) onEnqueue?.();
      return n;
    },
    /** A person posts into the discussion (wakes who they mention, else the facilitator). Posting reopens a stalled one. */
    async postAsOwner(a: ActiveActor, id: string, text: string) {
      const d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled") throw new DiscussionError("CLOSED", `This discussion is ${d.status}.`);
      const res = await db.transaction(async (tx) => {
        const cur = d.status === "stalled" ? (await tx.update(discussion).set({ status: "open", turnBudget: sql`least(50, greatest(${discussion.turnBudget}, ${discussion.turnsUsed} + 5))`, updatedAt: new Date() }).where(eq(discussion.id, d.id)).returning())[0]! : d;
        const row = await insertMessage(tx, d.conversationId, { ownerUserId: a.userId, role: "user", content: text });
        const n = cur.status === "open" ? await enqueueWakes(tx, cur, null, text, row.id) : 0;
        return { row, n };
      });
      if (res.n) onEnqueue?.();
      return res.row;
    },
    async updateContext(a: ActiveActor, id: string, patch: { title?: string | undefined; goal?: string | undefined; context?: string | undefined }, expectedVersion?: number) {
      const d = await loadOwned(a, id);
      if (expectedVersion !== undefined && d.version !== expectedVersion) throw new DiscussionError("CONFLICT", "The discussion changed meanwhile. Reload it and try again.");
      const brief = (patch.goal !== undefined && patch.goal !== d.goal) || (patch.context !== undefined && patch.context !== d.context);
      const [row] = await db.update(discussion).set({ ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 120) } : {}), ...(patch.goal !== undefined ? { goal: patch.goal.slice(0, 1000) } : {}), ...(patch.context !== undefined ? { context: patch.context.slice(0, 8000) } : {}),
        ...(brief ? { contextVersion: sql`${discussion.contextVersion} + 1` } : {}), version: sql`${discussion.version} + 1`, updatedAt: new Date() }).where(and(eq(discussion.id, d.id), eq(discussion.version, d.version))).returning();
      if (!row) throw new DiscussionError("CONFLICT", "The discussion changed meanwhile. Reload it and try again.");
      return row;
    },
    /** A member rewrites the shared context (bumps the version, so pending approvals must be given again). */
    async updateContextAsBot(a: ActiveActor, id: string, who: Bot, text: string) {
      const d = await this.forMember(a, id, who.id);
      if (d.status === "resolved" || d.status === "cancelled") throw new DiscussionError("CLOSED", `That discussion is ${d.status}.`);
      const [row] = await db.update(discussion).set({ context: text.slice(0, 8000), contextVersion: sql`${discussion.contextVersion} + 1`, version: sql`${discussion.version} + 1`, updatedAt: new Date() }).where(eq(discussion.id, d.id)).returning();
      await insertMessage(db, d.conversationId, { ownerUserId: d.ownerUserId, role: "system", content: `📝 ${who.name} updated the shared context.`, meta: { discussionEvent: "context" } });
      return row!;
    },
    /**
     * Resolves: queued turns are cancelled, the facilitator gets one wrap-up turn (when someone else resolved it), and the origin chat and
     * the owner's attention list get the summary.
     */
    async resolve(a: ActiveActor, id: string, by: Bot | null, summary: string) {
      const d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled") throw new DiscussionError("CLOSED", `That discussion is already ${d.status}.`);
      const wrap = d.createdByBotId && by?.id !== d.createdByBotId ? d.createdByBotId : null;
      const row = await db.transaction(async (tx) => {
        const [r] = await tx.update(discussion).set({ status: "resolved", summary: summary.slice(0, 2000), resolvedAt: new Date(), updatedAt: new Date(), version: sql`${discussion.version} + 1` }).where(and(eq(discussion.id, d.id), inArray(discussion.status, [...ACTIVE]))).returning();
        if (!r) throw new DiscussionError("CLOSED", "That discussion is already closed.");
        await tx.update(discussionTurn).set({ status: "cancelled", finishedAt: new Date(), reasonCode: "resolved" }).where(and(eq(discussionTurn.discussionId, d.id), inArray(discussionTurn.status, ["queued", "awaiting_approval"])));
        const note = await insertMessage(tx, d.conversationId, { ownerUserId: d.ownerUserId, role: "system", content: `✅ Resolved${by ? ` by ${by.name}` : ""}: ${summary}`, meta: { discussionEvent: "resolved" } });
        if (wrap) await tx.insert(discussionTurn).values({ ownerUserId: d.ownerUserId, discussionId: d.id, botId: wrap, triggerMessageId: note.id, kind: "wrapup" }).onConflictDoNothing();
        if (d.originConversationId) await insertMessage(tx, d.originConversationId, { ownerUserId: d.ownerUserId, role: "system", content: `👥 Discussion "${d.title}" was resolved: ${summary}`, meta: { discussion: { id: d.id, title: d.title, status: "resolved" } } });
        await raiseAttention(tx, d.ownerUserId, { botId: by?.id ?? null, title: `Discussion resolved: ${d.title}`, detail: summary, resultLink: `/discussions?id=${d.id}`, source: "bot", sourceKey: `discussion:${d.id}:resolved` });
        return r;
      });
      if (wrap) onEnqueue?.();
      return row;
    },
    async resolveAsBot(a: ActiveActor, id: string, who: Bot, summary: string) {
      await this.forMember(a, id, who.id);
      return this.resolve(a, id, who, summary);
    },
    async setStatus(a: ActiveActor, id: string, action: "pause" | "resume" | "cancel") {
      const d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled") throw new DiscussionError("CLOSED", `This discussion is ${d.status}.`);
      const row = await db.transaction(async (tx) => {
        const set = action === "pause" ? { status: "paused" as const } : action === "cancel" ? { status: "cancelled" as const } : { status: "open" as const, turnBudget: sql`least(50, greatest(${discussion.turnBudget}, ${discussion.turnsUsed} + 5))` };
        const [r] = await tx.update(discussion).set({ ...set, updatedAt: new Date(), version: sql`${discussion.version} + 1` }).where(eq(discussion.id, d.id)).returning();
        if (action === "cancel") await tx.update(discussionTurn).set({ status: "cancelled", finishedAt: new Date(), reasonCode: "cancelled" }).where(and(eq(discussionTurn.discussionId, d.id), inArray(discussionTurn.status, ["queued", "awaiting_approval"])));
        // Resuming retries what a restart interrupted (the owner saw the card and chose to go on).
        if (action === "resume") await tx.update(discussionTurn).set({ status: "queued", reasonCode: null }).where(and(eq(discussionTurn.discussionId, d.id), eq(discussionTurn.status, "interrupted")));
        await insertMessage(tx, d.conversationId, { ownerUserId: d.ownerUserId, role: "system", content: action === "pause" ? "⏸ Paused by the user." : action === "cancel" ? "⏹ Cancelled by the user." : "▶️ Resumed by the user.", meta: { discussionEvent: action } });
        return r!;
      });
      if (action === "resume") onEnqueue?.();
      return row;
    },
    async list(a: ActiveActor, status?: Discussion["status"]) {
      const rows = await db.select().from(discussion).where(and(eq(discussion.ownerUserId, a.userId), status ? eq(discussion.status, status) : undefined)).orderBy(desc(discussion.updatedAt)).limit(100);
      const members = rows.length ? await db.select({ discussionId: discussionMember.discussionId, botId: discussionMember.botId, name: bot.name }).from(discussionMember).innerJoin(bot, eq(bot.id, discussionMember.botId)).where(inArray(discussionMember.discussionId, rows.map((r) => r.id))) : [];
      const active = rows.length ? await db.select({ discussionId: discussionTurn.discussionId, status: discussionTurn.status }).from(discussionTurn).where(and(inArray(discussionTurn.discussionId, rows.map((r) => r.id)), inArray(discussionTurn.status, ["queued", "running", "awaiting_approval"]))) : [];
      return rows.map((d) => ({ ...d, openKey: undefined, members: members.filter((m) => m.discussionId === d.id).map((m) => ({ botId: m.botId, name: m.name })), queued: active.filter((t) => t.discussionId === d.id && t.status === "queued").length, running: active.some((t) => t.discussionId === d.id && t.status === "running"), awaitingApproval: active.some((t) => t.discussionId === d.id && t.status === "awaiting_approval") }));
    },
    async get(a: ActiveActor, id: string) {
      const d = await loadOwned(a, id);
      const members = (await membersOf(d)).map((r) => ({ botId: r.m.botId, name: r.name, role: r.m.role, requireApproval: r.m.requireApproval, turns: r.m.turns, code: codeEnabled(r, a.userId) }));
      const turns = await db.select().from(discussionTurn).where(eq(discussionTurn.discussionId, d.id)).orderBy(desc(discussionTurn.createdAt)).limit(30);
      return { discussion: { ...d, openKey: undefined }, members, turns };
    },
    /** Owner toggle: whether a member must wait for an approved brief while outside content is in play. */
    async setRequireApproval(a: ActiveActor, id: string, botId: string, on: boolean) {
      const d = await loadOwned(a, id);
      const [m] = await db.update(discussionMember).set({ requireApproval: on }).where(and(eq(discussionMember.discussionId, d.id), eq(discussionMember.botId, botId))).returning();
      if (!m) throw new AccessError("NOT_FOUND");
      if (!on) { const n = await db.update(discussionTurn).set({ status: "queued" }).where(and(eq(discussionTurn.discussionId, d.id), eq(discussionTurn.botId, botId), eq(discussionTurn.status, "awaiting_approval"))).returning(); if (n.length) onEnqueue?.(); }
      return m;
    },
    membersOf,
    async transcript(d: Discussion, limit = 80) {
      const rows = await db.select({ role: message.role, content: message.content, botId: message.botId, status: message.status }).from(message).where(eq(message.conversationId, d.conversationId)).orderBy(desc(message.seq)).limit(limit);
      return rows.reverse().filter((m) => m.status === "complete");
    },
    /**
     * Claims the oldest runnable turn: its discussion is open (or it is a wrap-up), and its owner has no other turn running (members share
     * the owner's code workspace). Gated turns go to the owner for approval; a spent budget stalls the discussion.
     */
    async claimNext(names: (botId: string) => Promise<string>): Promise<Claimed | undefined> {
      for (let i = 0; i < 10; i++) {
        const out = await db.transaction(async (tx): Promise<Claimed | "again" | undefined> => {
          const picked = await tx.execute<{ id: string }>(sql`select t.id from discussion_turn t join discussion d on d.id = t.discussion_id
            where t.status = 'queued' and (d.status = 'open' or (t.kind = 'wrapup' and d.status = 'resolved'))
              and not exists (select 1 from discussion_turn r where r.owner_user_id = t.owner_user_id and r.status = 'running')
            order by t.created_at limit 1 for update of t skip locked`);
          const id = (picked as unknown as { rows?: { id: string }[] }).rows?.[0]?.id ?? (picked as unknown as { id: string }[])[0]?.id;
          if (!id) return undefined;
          const [turn] = await tx.select().from(discussionTurn).where(eq(discussionTurn.id, id));
          const [d] = await tx.select().from(discussion).where(eq(discussion.id, turn!.discussionId)).for("update");
          const [member] = await tx.select().from(discussionMember).where(and(eq(discussionMember.discussionId, d!.id), eq(discussionMember.botId, turn!.botId)));
          if (!member) { await tx.update(discussionTurn).set({ status: "skipped", reasonCode: "not_member", finishedAt: new Date() }).where(eq(discussionTurn.id, id)); return "again"; }
          const c: Claimed = { turn: turn!, discussion: d!, member };
          if (d!.tainted && member.requireApproval && turn!.approvedContextVersion !== d!.contextVersion) { await gate(tx, c, await names(turn!.botId)); return "again"; }
          if (turn!.kind === "reply") {
            const [spent] = await tx.update(discussion).set({ turnsUsed: sql`${discussion.turnsUsed} + 1` }).where(and(eq(discussion.id, d!.id), lt(discussion.turnsUsed, discussion.turnBudget))).returning();
            if (!spent) {
              await tx.update(discussionTurn).set({ status: "skipped", reasonCode: "budget", finishedAt: new Date() }).where(eq(discussionTurn.id, id));
              await tx.update(discussion).set({ status: "stalled", updatedAt: new Date() }).where(eq(discussion.id, d!.id));
              await raiseAttention(tx, d!.ownerUserId, { title: `Discussion "${d!.title}" used its turn budget`, detail: `The bots took ${d!.turnBudget} turns without resolving it.`, nextAction: "Read the discussion, then post a nudge, resume it, or cancel it.", resultLink: `/discussions?id=${d!.id}`, source: "bot", sourceKey: `discussion:${d!.id}:budget` });
              return "again";
            }
            c.discussion = spent;
          }
          const [running] = await tx.update(discussionTurn).set({ status: "running", claimedAt: new Date(), attempts: sql`${discussionTurn.attempts} + 1` }).where(eq(discussionTurn.id, id)).returning();
          c.turn = running!;
          return c;
        });
        if (out !== "again") return out;
      }
      return undefined;
    },
    /** Whether a queued turn could be claimed now (tests and diagnostics). */
    async hasRunnable() {
      const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from discussion_turn t join discussion d on d.id = t.discussion_id where t.status in ('queued', 'running') and (d.status = 'open' or (t.kind = 'wrapup' and d.status = 'resolved'))`);
      return Number(((r as unknown as { rows?: { n: number }[] }).rows ?? (r as unknown as { n: number }[]))[0]?.n ?? 0) > 0;
    },
    async finishTurn(turnId: string, status: "done" | "failed" | "skipped" | "cancelled" | "queued", v: { resultMessageId?: string | null; reasonCode?: string | null } = {}) {
      const [t] = await db.update(discussionTurn).set({ status, resultMessageId: v.resultMessageId ?? null, reasonCode: v.reasonCode ?? null, finishedAt: status === "queued" ? null : new Date() }).where(eq(discussionTurn.id, turnId)).returning();
      if (t && status === "done") await db.update(discussionMember).set({ turns: sql`${discussionMember.turns} + 1` }).where(and(eq(discussionMember.discussionId, t.discussionId), eq(discussionMember.botId, t.botId)));
      if (t && status === "done") await db.update(discussion).set({ updatedAt: new Date() }).where(eq(discussion.id, t.discussionId));
      return t;
    },
    /** Approved brief: the turn runs against exactly that context version (a later change asks again). */
    async approveBrief(a: ActiveActor, patch: Record<string, unknown>) {
      const d = await loadOwned(a, String(patch.discussionId));
      const [t] = await db.update(discussionTurn).set({ status: "queued", approvedContextVersion: Number(patch.contextVersion) }).where(and(eq(discussionTurn.id, String(patch.turnId)), eq(discussionTurn.discussionId, d.id), eq(discussionTurn.status, "awaiting_approval"))).returning();
      if (!t) throw new AccessError("NOT_FOUND");
      onEnqueue?.();
      return t;
    },
    async declineBrief(a: ActiveActor, patch: Record<string, unknown>) {
      const d = await loadOwned(a, String(patch.discussionId));
      const [t] = await db.update(discussionTurn).set({ status: "skipped", reasonCode: "declined", finishedAt: new Date() }).where(and(eq(discussionTurn.id, String(patch.turnId)), eq(discussionTurn.discussionId, d.id), eq(discussionTurn.status, "awaiting_approval"))).returning();
      if (t) await insertMessage(db, d.conversationId, { ownerUserId: d.ownerUserId, role: "system", content: "🚫 The user declined to let that bot act on this brief.", meta: { discussionEvent: "declined" } });
    },
    /** Boot: turns that were running are interrupted, never retried on their own (a code bot may already have pushed). */
    async recover() {
      const rows = await db.update(discussionTurn).set({ status: "interrupted", reasonCode: "restart", finishedAt: new Date() }).where(eq(discussionTurn.status, "running")).returning();
      for (const id of new Set(rows.map((r) => r.discussionId))) {
        const [d] = await db.update(discussion).set({ status: "stalled", updatedAt: new Date() }).where(and(eq(discussion.id, id), eq(discussion.status, "open"))).returning();
        if (d) await raiseAttention(db, d.ownerUserId, { title: `Discussion "${d.title}" was interrupted`, detail: "The server restarted while a bot was working on it.", nextAction: "Check what was done, then resume or cancel it.", resultLink: `/discussions?id=${d.id}`, source: "bot", sourceKey: `discussion:${d.id}:interrupted` }).catch(() => {});
      }
      return rows.length;
    },
    /** Open discussions with nothing queued: one card after 30 minutes, stalled after a day. */
    async sweepIdle(now = new Date()) {
      const idle = await db.select().from(discussion).where(and(eq(discussion.status, "open"), lt(discussion.updatedAt, new Date(now.getTime() - 30 * 60_000)),
        sql`not exists (select 1 from discussion_turn t where t.discussion_id = ${discussion.id} and t.status in ('queued', 'running', 'awaiting_approval'))`)).limit(50);
      for (const d of idle) {
        if (d.updatedAt.getTime() < now.getTime() - 24 * 3600_000) await db.update(discussion).set({ status: "stalled", updatedAt: now }).where(eq(discussion.id, d.id));
        await raiseAttention(db, d.ownerUserId, { title: `Discussion "${d.title}" is waiting`, detail: "No bot is working on it and it is not resolved.", nextAction: "Post a nudge mentioning a bot, or resolve or cancel it.", resultLink: `/discussions?id=${d.id}`, source: "bot", sourceKey: `discussion:${d.id}:idle` }).catch(() => {});
      }
      return idle.length;
    },
  };
}
export type DiscussionStore = ReturnType<typeof createDiscussionStore>;
