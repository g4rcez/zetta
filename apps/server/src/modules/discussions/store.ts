import { refreshMentionLabels } from "../chat/mention-text";
import { createHash } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "@zetta/db/query";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import {
  botPeer,
  discussion,
  discussionMember,
  discussionTurn,
  turnStep,
  type TurnStep,
} from "@zetta/db/schema/discussions";
import { attachment, configProposal, routine } from "@zetta/db/schema/features";
import { task } from "@zetta/db/schema/tasks";
import { memoryItem } from "@zetta/db/schema/memory";
import { closeAttention, closeAttentionKey, raiseAttention } from "../features/attention";
import { AccessError, requireOwned, requireTeamMember, type ActiveActor } from "../identity/access";
import { createTeamPeople } from "../teams/people";
import { user } from "@zetta/db/schema/auth";
import { dockerConfig } from "../chat/harness";
import type { FileStore } from "../chat/files";
import { insertMessage, quoteOf } from "../chat/messages";
import { transaction } from "./transaction";
import { codeEnabled } from "../chat/pipeline";
import type { LoopStore } from "../chat/loops";
import { createBotClaude, skillsOf } from "../bot-claude/store";
import { visibleTo } from "../memory/service";
import { legacyMentions, mentionIds, mentionToken } from "@zetta/core/mentions";
import { HELP_PREFIX, isIdleChatter, mentionKey, wakeTargets } from "./prompt";
import { topics } from "@zetta/core/live-topics";
import { events } from "../events/bus";
import { instanceId, recoverable, type RecoveryScope } from "../runtime/instance";
import { STUCK_MS, type StuckReason } from "./watchdog";

type Bot = typeof bot.$inferSelect;
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Discussion = typeof discussion.$inferSelect;
export type DiscussionTurn = typeof discussionTurn.$inferSelect;
export type Member = typeof discussionMember.$inferSelect;

export const PERMISSIONS_TITLE = "Permissions";
/** A room as the API shows it: never the dedupe key. */
export const publicRoom = (d: Discussion) => ({ ...d, openKey: undefined });
/** Where a blocked bot stopped, kept on its help request so the answer can resume it (a loop, or the chat turn). */
export type HelpStop = { conversationId: string; messageId: string | null; loopId?: string };
export const MAX_PENDING_PROPOSALS = 3,
  MAX_PEERS = 20,
  STEP_LIMIT = 200;
const ACTIVE = ["open", "paused", "stalled"] as const;

/** `safe` is shown to the user and to the bot that asked (no ids of other users, no secrets). */
export class DiscussionError extends Error {
  constructor(
    readonly code: "INVALID" | "LIMIT" | "NOT_ALLOWED" | "NOT_FOUND" | "CONFLICT" | "CLOSED",
    readonly safe: string,
  ) {
    super(code);
  }
}

export type OpenInput = {
  title: string;
  goal: string;
  context: string;
  members: { bot: string; role?: string | undefined }[];
  firstMessage: string;
  /** The bot that asked (null: a person opened it from the UI). */ createdBy: Bot | null;
  origin?: { conversationId: string; messageId: string | null } | undefined;
  originInbound?: { plugin: string; chat: string; chatName: string } | undefined;
  tainted: boolean;
  /** Set for a team room: the chief opens it (`createdBy`) and the team's other bots are the members. */
  teamId?: string | undefined;
  /** Defaults to a plain room; the Chief's help and permission rooms say what they are. */
  kind?: Discussion["kind"] | undefined;
  /** false: the opening post wakes nobody (system-made discussions). */
  wake?: boolean | undefined;
};
export type Claimed = { turn: DiscussionTurn; discussion: Discussion; member: Member };

/**
 * Group discussions between bots: one owner (the user every member turn runs as), a shared task context and a transcript in a
 * conversation of kind "discussion". Posts wake members through a durable turn queue; the worker (worker.ts) runs them one at a time
 * per owner through the chat service. Bounded by members, open discussions, a turn budget and, when outside content is in play, an
 * owner-approved brief for members that can change code.
 */
/** What a person attached to a post: uploaded attachments and files from the server folder, like in a chat. */
export type PostFiles = {
  attachmentIds?: string[] | undefined;
  fileRefs?: string[] | undefined;
  memoryIds?: string[] | undefined;
  /** Skills picked with `/`; each belongs to one member bot, which is the only one that uses it. */
  skills?: { botId: string; name: string }[] | undefined;
  /** A message of this room the post replies to: saved as `meta.quote`, and the bot that wrote it is woken. */
  quotedMessageId?: string | undefined;
};
const FILE_CLIP = 12_000;

/** How a room loop step ended: the room went quiet (`idle`, or `failed` when a member turn failed) or something else took over. */
export type RoomSettle =
  | "idle"
  | "failed"
  | "resolved"
  | "cancelled"
  | "paused"
  | "approval"
  | "stopped";
const SETTLE_POLL_MS = 2_000;

/** A turn that started this many times and still sits in "running" at boot is treated as a crash loop. */
const MAX_RESTART_ATTEMPTS = 3;

export function createDiscussionStore(
  db: Database,
  files?: Pick<FileStore, "readWithHash">,
  loops?: Pick<LoopStore, "start" | "active" | "activeAll" | "kick" | "setStatus">,
) {
  let onEnqueue: (() => void) | undefined;
  const claude = createBotClaude(db);
  const visible = (a: ActiveActor) => or(eq(bot.ownerUserId, a.userId), eq(bot.visibility, "team"));

  async function loadOwned(a: ActiveActor, id: string) {
    const [row] = await db
      .select()
      .from(discussion)
      .where(and(eq(discussion.id, id), eq(discussion.ownerUserId, a.userId)));
    return requireOwned(a, row);
  }
  const people = createTeamPeople(db);
  /** Read access: the owner, or a person of the room's team. Every write still goes through `loadOwned`. */
  async function loadReadable(a: ActiveActor, id: string) {
    const [row] = await db.select().from(discussion).where(eq(discussion.id, id));
    const member =
      !!row &&
      (row.ownerUserId === a.userId ||
        (!!row.teamId && (await people.isPerson(a.userId, row.teamId))));
    return requireTeamMember(a, row, member);
  }
  /** A cancelled room runs nothing more: queued and waiting turns stop and its attention item closes. */
  async function dropQueuedTurns(tx: Tx, d: Pick<Discussion, "id" | "ownerUserId">) {
    await tx
      .update(discussionTurn)
      .set({ status: "cancelled", finishedAt: new Date(), reasonCode: "cancelled" })
      .where(
        and(
          eq(discussionTurn.discussionId, d.id),
          inArray(discussionTurn.status, ["queued", "awaiting_approval"]),
        ),
      );
    await closeAttention(tx, d.ownerUserId, `/rooms?id=${d.id}`, "cancelled");
  }
  /** Silence: the room waits (paused) with nothing queued, until a person posts. A person's post reopens it. */
  async function silenceRoom(
    tx: Tx,
    d: Pick<Discussion, "id" | "ownerUserId" | "conversationId">,
    by: "user" | "auto",
  ) {
    const [r] = await tx
      .update(discussion)
      .set({ status: "paused", updatedAt: new Date(), version: sql`${discussion.version} + 1` })
      .where(eq(discussion.id, d.id))
      .returning();
    await dropQueuedTurns(tx, d);
    await insertMessage(tx, d.conversationId, {
      ownerUserId: d.ownerUserId,
      role: "system",
      content:
        by === "user"
          ? "🤫 Silenced by the user. The bots wait until you post."
          : "🤫 Silenced: the bots were repeating themselves. They wait until you post.",
      meta: { discussionEvent: "silenced" },
    });
    return r!;
  }
  async function membersOf(d: Pick<Discussion, "id">) {
    return db
      .select({
        m: discussionMember,
        name: bot.name,
        harness: bot.harness,
        codeAccess: bot.codeAccess,
      })
      .from(discussionMember)
      .innerJoin(bot, eq(bot.id, discussionMember.botId))
      .where(eq(discussionMember.discussionId, d.id))
      .orderBy(asc(discussionMember.joinedAt));
  }
  /** Bots the actor may use, by id or name (own bots win, then the oldest), ready and not archived. */
  async function resolveBots(a: ActiveActor, refs: string[]) {
    const rows = (
      await db
        .select()
        .from(bot)
        .where(and(visible(a), eq(bot.archived, false)))
        .orderBy(asc(bot.createdAt))
    ).sort((x, y) => Number(y.ownerUserId === a.userId) - Number(x.ownerUserId === a.userId));
    return refs.map((ref) => {
      const hit =
        rows.find((b) => b.id === ref) ??
        rows.find((b) => mentionKey(b.name) === mentionKey(ref.replace(/^@/, "")));
      if (!hit)
        throw new DiscussionError(
          "NOT_FOUND",
          `There is no bot called "${ref.slice(0, 60)}" that you can use.`,
        );
      if (!hit.onboarded)
        throw new DiscussionError(
          "NOT_ALLOWED",
          `${hit.name} is not ready yet; finish its setup first.`,
        );
      if (hit.ownerUserId !== a.userId && hit.requiredConnections.length && !dockerConfig())
        throw new DiscussionError(
          "NOT_ALLOWED",
          `${hit.name} belongs to someone else and needs account keys; that only works when bots run in Docker mode.`,
        );
      return hit;
    });
  }

  async function peerIds(a: ActiveActor, botId: string) {
    return (
      await db
        .select({ id: botPeer.peerBotId })
        .from(botPeer)
        .where(and(eq(botPeer.ownerUserId, a.userId), eq(botPeer.botId, botId)))
    ).map((r) => r.id);
  }

  /** Queues one turn per woken member (never the author; at most one per member per post). */
  async function enqueueWakes(
    tx: Pick<Database, "select" | "insert">,
    d: Pick<Discussion, "id" | "ownerUserId" | "createdByBotId">,
    authorBotId: string | null,
    text: string,
    messageId: string,
    opening = false,
    fallback = true,
    /** Bots the person addressed without a mention (owners of a picked skill, the author of a quoted message): they are woken, and then the fallback answer is not needed. */
    skillOwners: readonly string[] = [],
  ) {
    const members = await tx
      .select({ botId: discussionMember.botId, name: bot.name, kind: bot.kind })
      .from(discussionMember)
      .innerJoin(bot, eq(bot.id, discussionMember.botId))
      .where(eq(discussionMember.discussionId, d.id));
    const targets = [
      ...new Set([
        ...wakeTargets(
          members,
          d.createdByBotId,
          authorBotId,
          text,
          opening,
          fallback && !skillOwners.length,
        ),
        ...skillOwners.filter((id) => id !== authorBotId),
      ]),
    ];
    if (!targets.length) return 0;
    const rows = await tx
      .insert(discussionTurn)
      .values(
        targets.map((botId) => ({
          ownerUserId: d.ownerUserId,
          discussionId: d.id,
          botId,
          triggerMessageId: messageId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: discussionTurn.id });
    return rows.length;
  }

  /**
   * Wakes members only while the room is open. The room row is locked for the check and the insert, so a delete or a resolve that runs at
   * the same time either finishes first (nothing is queued) or waits and then drops the turns queued here. Without the lock a turn could
   * be queued just after the room was cancelled, and nothing would drop it.
   */
  async function enqueueWakesIfOpen(
    db: Pick<Database, "transaction">,
    id: string,
    authorBotId: string | null,
    text: string,
    messageId: string,
    fallback = true,
  ) {
    return transaction(db, async (tx) => {
      const [cur] = await tx.select().from(discussion).where(eq(discussion.id, id)).for("update");
      return cur?.status === "open"
        ? enqueueWakes(tx, cur, authorBotId, text, messageId, false, fallback)
        : 0;
    });
  }

  async function open(a: ActiveActor, input: OpenInput) {
    const bots = await resolveBots(
      a,
      input.members.map((m) => m.bot),
    );
    const roles = new Map(bots.map((b, i) => [b.id, input.members[i]!.role ?? ""]));
    // A room the user opens has no facilitator bot: the owner's Chief joins, so a post without a mention reaches it (wakeTargets).
    const [chief] = input.createdBy
      ? []
      : await db
          .select()
          .from(bot)
          .where(
            and(
              eq(bot.ownerUserId, a.userId),
              eq(bot.kind, "chief"),
              eq(bot.archived, false),
              eq(bot.onboarded, true),
            ),
          );
    if (chief) roles.set(chief.id, roles.get(chief.id) || "facilitator");
    const all = [
      ...new Map([
        ...(input.createdBy ? [[input.createdBy.id, input.createdBy] as const] : []),
        ...bots.map((b) => [b.id, b] as const),
        ...(chief ? [[chief.id, chief] as const] : []),
      ]).values(),
    ];
    if (all.length < 2 && input.createdBy)
      throw new DiscussionError("INVALID", "Invite at least one other bot.");
    const openKey = createHash("sha256")
      .update(
        [
          input.origin?.conversationId ?? "",
          input.createdBy?.id ?? "user",
          input.title.trim().toLowerCase(),
        ].join("\u0000"),
      )
      .digest("hex");
    const res = await transaction(db, async (tx) => {
      const [same] = await tx
        .select()
        .from(discussion)
        .where(
          and(
            eq(discussion.ownerUserId, a.userId),
            eq(discussion.openKey, openKey),
            inArray(discussion.status, [...ACTIVE]),
          ),
        );
      if (same) return { discussion: same, created: false };
      const [conv] = await tx
        .insert(conversation)
        .values({
          ownerUserId: a.userId,
          botId: (input.createdBy ?? all[0]!).id,
          kind: "discussion",
          title: input.title.trim().slice(0, 120),
        })
        .returning();
      const [d] = await tx
        .insert(discussion)
        .values({
          ownerUserId: a.userId,
          conversationId: conv!.id,
          createdByBotId: input.createdBy?.id ?? null,
          teamId: input.teamId ?? null,
          originConversationId: input.origin?.conversationId ?? null,
          originMessageId: input.origin?.messageId ?? null,
          originInbound: input.originInbound ?? null,
          title: input.title.trim().slice(0, 120),
          goal: input.goal.slice(0, 1000),
          context: input.context.slice(0, 8000),
          tainted: input.tainted,
          kind: input.kind ?? "room",
          openKey,
        })
        .returning();
      await tx.insert(discussionMember).values(
        all.map((b) => ({
          discussionId: d!.id,
          botId: b.id,
          role: (b.id === input.createdBy?.id
            ? roles.get(b.id) || "facilitator"
            : (roles.get(b.id) ?? "")
          ).slice(0, 200),
          // Only a room that came from an outside channel (a stranger wrote the content) holds a code bot for one approval, and never
          // the bot that opened it. Everywhere else a member in the room acts without asking.
          requireApproval:
            Boolean(input.originInbound) &&
            b.id !== input.createdBy?.id &&
            codeEnabled(b, a.userId),
        })),
      );
      const first = await insertMessage(
        tx,
        conv!.id,
        input.createdBy
          ? {
              ownerUserId: a.userId,
              role: "assistant",
              content: input.firstMessage,
              botId: input.createdBy.id,
              botVersion: input.createdBy.version,
            }
          : { ownerUserId: a.userId, role: "user", content: input.firstMessage },
      );
      if (input.wake !== false)
        await enqueueWakes(tx, d!, input.createdBy?.id ?? null, first.content, first.id, true);
      return { discussion: d!, created: true };
    });
    if (res.created && input.wake !== false) onEnqueue?.();
    return { ...res, members: all };
  }

  async function post(
    tx: Pick<Database, "select" | "insert" | "transaction">,
    d: Discussion,
    author: Bot,
    text: string,
  ) {
    const row = await insertMessage(tx, d.conversationId, {
      ownerUserId: d.ownerUserId,
      role: "assistant",
      content: text,
      botId: author.id,
      botVersion: author.version,
    });
    const n = await enqueueWakesIfOpen(tx, d.id, author.id, row.content, row.id);
    if (n) onEnqueue?.();
    return row;
  }

  /**
   * Turns in the gate get a brief the owner approves: the bot, the context version it will act on, and the post that woke it. One card
   * per bot and room: later turns of the same bot wait behind it, and approving it releases them all and lifts the gate for that room.
   */
  async function gate(tx: Tx, c: Claimed, botName: string) {
    await tx
      .update(discussionTurn)
      .set({ status: "awaiting_approval" })
      .where(eq(discussionTurn.id, c.turn.id));
    const [waiting] = await tx
      .select({ id: configProposal.id })
      .from(configProposal)
      .where(
        and(
          eq(configProposal.ownerUserId, c.discussion.ownerUserId),
          eq(configProposal.kind, "discussion_brief"),
          eq(configProposal.status, "pending"),
          eq(configProposal.botId, c.turn.botId),
          sql`${configProposal.patch}->>'discussionId' = ${c.discussion.id}`,
        ),
      )
      .limit(1);
    if (waiting) return;
    const [trigger] = c.turn.triggerMessageId
      ? await tx
          .select({ content: message.content })
          .from(message)
          .where(eq(message.id, c.turn.triggerMessageId))
      : [];
    const patch = {
      discussionId: c.discussion.id,
      turnId: c.turn.id,
      botId: c.turn.botId,
      contextVersion: c.discussion.contextVersion,
    };
    const [p] = await tx
      .insert(configProposal)
      .values({
        ownerUserId: c.discussion.ownerUserId,
        kind: "discussion_brief",
        botId: c.turn.botId,
        proposedByBotId: c.discussion.createdByBotId,
        baseVersion: c.discussion.contextVersion,
        patch,
        diff: [
          { field: "bot", from: null, to: botName },
          { field: "discussion", from: null, to: c.discussion.title },
          { field: "goal", from: null, to: c.discussion.goal.slice(0, 400) },
          { field: "context", from: null, to: c.discussion.context.slice(0, 1200) },
          { field: "request", from: null, to: (trigger?.content ?? "").slice(0, 600) },
        ],
      })
      .returning();
    await raiseAttention(tx, c.discussion.ownerUserId, {
      botId: c.turn.botId,
      title: `Approve ${botName} acting in "${c.discussion.title}"`,
      detail:
        "This room includes outside content (for example a customer's message) and the bot can change code.",
      nextAction: "Review the brief and approve or reject it.",
      resultLink: `/rooms?id=${c.discussion.id}`,
      source: "bot",
      sourceKey: `proposal:${p!.id}`,
    });
  }

  const store = {
    set onEnqueue(fn: (() => void) | undefined) {
      onEnqueue = fn;
    },
    peerIds,
    async peers(a: ActiveActor, botId: string) {
      const [b] = await db
        .select({ id: bot.id })
        .from(bot)
        .where(and(eq(bot.id, botId), visible(a), eq(bot.archived, false)));
      if (!b) throw new AccessError("NOT_FOUND");
      const ids = await peerIds(a, botId);
      return ids.length
        ? db
            .select({ id: bot.id, name: bot.name })
            .from(bot)
            .where(and(inArray(bot.id, ids), visible(a), eq(bot.archived, false)))
        : [];
    },
    /** Replaces the allowlist of one bot (for this user only). Peers must be bots the user can use. */
    async setPeers(a: ActiveActor, botId: string, ids: string[]) {
      const unique = [...new Set(ids)].filter((id) => id !== botId);
      if (unique.length > MAX_PEERS)
        throw new DiscussionError("LIMIT", `At most ${MAX_PEERS} bots.`);
      const [b] = await db
        .select({ id: bot.id })
        .from(bot)
        .where(and(eq(bot.id, botId), visible(a), eq(bot.archived, false)));
      if (!b) throw new AccessError("NOT_FOUND");
      const ok = unique.length
        ? await db
            .select({ id: bot.id })
            .from(bot)
            .where(and(inArray(bot.id, unique), visible(a), eq(bot.archived, false)))
        : [];
      if (ok.length !== unique.length) throw new AccessError("NOT_FOUND");
      await transaction(db, async (tx) => {
        await tx
          .delete(botPeer)
          .where(and(eq(botPeer.ownerUserId, a.userId), eq(botPeer.botId, botId)));
        if (unique.length)
          await tx
            .insert(botPeer)
            .values(unique.map((peerBotId) => ({ ownerUserId: a.userId, botId, peerBotId })));
      });
      return unique;
    },
    resolveBots,
    open,
    /**
     * A bot asks the chief for a permission. Every request of the user lands in one "Permissions" discussion (the chief facilitates it), so
     * the user answers in one place; the post wakes the chief, who asks the user before granting anything.
     */
    async requestPermission(
      a: ActiveActor,
      chief: Bot,
      requester: Bot,
      rule: string,
      reason: string,
      /** The chat turn the requester stopped in: runs again once the rule is granted (see takeGrantedRequests). */
      stoppedAt?: { conversationId: string; messageId: string },
    ) {
      const goal = "Decide, with the user, which commands and tools the user's bots may use.";
      const opened = await open(a, {
        title: PERMISSIONS_TITLE,
        goal,
        context:
          "Bots ask here for permission to run a command. The chief asks the user before it grants anything, and grants the narrowest rule that does the job.",
        members: [{ bot: requester.id }],
        firstMessage: "Permission requests from the bots are collected here.",
        createdBy: chief,
        tainted: false,
        wake: false,
        kind: "permissions",
      });
      let d: Discussion = opened.discussion;
      await db
        .insert(discussionMember)
        .values({ discussionId: d.id, botId: requester.id, role: "", requireApproval: false })
        .onConflictDoNothing();
      if (d.status === "paused")
        throw new DiscussionError(
          "CLOSED",
          "The Permissions room is paused; ask the user to resume it.",
        );
      if (d.status === "stalled") {
        const [again] = await db
          .update(discussion)
          .set({ status: "open" })
          .where(eq(discussion.id, d.id))
          .returning();
        d = again ?? d;
      }
      const text = `${mentionToken("bot", chief.id, chief.name)} ${requester.name} asks to be allowed: ${rule}\nWhy: ${reason}`;
      const row = await post(db, d, requester, text);
      if (stoppedAt)
        await db
          .update(message)
          .set({ meta: { permissionRequest: { rule, ...stoppedAt } } })
          .where(eq(message.id, row.id));
      await raiseAttention(db, a.userId, {
        botId: requester.id,
        title: `${requester.name} asks for permission: ${rule}`,
        detail: reason.slice(0, 400),
        nextAction: "Open the Permissions room and answer the Chief.",
        resultLink: `/rooms?id=${d.id}`,
        source: "bot",
        sourceKey: `permission:${d.id}:${row.id}`,
      });
      return d;
    },
    /**
     * A blocked bot asks the Chief for help. Each request is its own discussion led by the Chief, so the bots settle it between
     * themselves; the user is only asked if the Chief cannot (see HELP_CHIEF_TOOLS). The request post remembers where the bot stopped.
     */
    async requestHelp(
      a: ActiveActor,
      chief: Bot,
      requester: Bot,
      problem: string,
      tried: string,
      request: string,
      stoppedAt: HelpStop,
    ) {
      const opened = await open(a, {
        title: `${HELP_PREFIX}${requester.name}: ${problem}`.slice(0, 120),
        goal: `Unblock ${requester.name} inside the user's request. Hand off to the user when a person must act or the request's limits block the work.`,
        // The user's own words travel with the request: the Chief must keep their limits (sources, sites, scope, output).
        context: `${request ? `User's request (binding; keep its sources, sites, scope and output):\n${request}\n\n` : ""}Problem: ${problem}\nTried: ${tried}`,
        members: [{ bot: requester.id }],
        firstMessage: `${requester.name} is blocked and asks the Chief for help.`,
        createdBy: chief,
        tainted: false,
        wake: false,
        kind: "help",
      });
      const row = await post(
        db,
        opened.discussion,
        requester,
        `${mentionToken("bot", chief.id, chief.name)} I am blocked: ${problem}\nTried: ${tried}`,
      );
      await db
        .update(message)
        .set({ meta: { helpRequest: { botId: requester.id, ...stoppedAt } } })
        .where(eq(message.id, row.id));
      return opened.discussion;
    },
    /** Where the blocked bot of a help discussion stopped, or undefined for any other discussion. */
    async helpRequestOf(a: ActiveActor, id: string) {
      const d = await loadOwned(a, id);
      if (d.kind !== "help") return undefined;
      const [row] = await db
        .select({ meta: message.meta })
        .from(message)
        .where(
          and(
            eq(message.conversationId, d.conversationId),
            sql`${message.meta} -> 'helpRequest' is not null`,
          ),
        )
        .limit(1);
      return (row?.meta as { helpRequest?: HelpStop & { botId: string } } | null)?.helpRequest;
    },
    /**
     * The chats a bot stopped in to wait for a permission, for the rules now granted. Each request is handed out once (a concurrent grant
     * finds it already taken); requests for rules not granted stay waiting.
     */
    async takeGrantedRequests(a: ActiveActor, botId: string, allow: string[]) {
      if (!allow.length) return [];
      const waiting = await db
        .select({ id: message.id, meta: message.meta, roomChat: message.conversationId })
        .from(message)
        .where(
          and(
            eq(message.ownerUserId, a.userId),
            eq(message.botId, botId),
            inArray(sql<string>`${message.meta} -> 'permissionRequest' ->> 'rule'`, allow),
            sql`${message.meta} -> 'permissionRequest' ->> 'taken' is null`,
          ),
        );
      const taken: {
        requestId: string;
        rule: string;
        conversationId: string;
        messageId: string;
      }[] = [];
      for (const w of waiting) {
        const req = (
          w.meta as {
            permissionRequest: { rule: string; conversationId: string; messageId: string };
          }
        ).permissionRequest;
        const [won] = await db
          .update(message)
          .set({ meta: { permissionRequest: { ...req, taken: true } } })
          .where(
            and(
              eq(message.id, w.id),
              sql`${message.meta} -> 'permissionRequest' ->> 'taken' is null`,
            ),
          )
          .returning({ id: message.id });
        if (won) {
          taken.push({ requestId: w.id, ...req });
          // The request message sits in the Permissions room; its card is keyed by that room and message.
          const [room] = await db
            .select({ id: discussion.id })
            .from(discussion)
            .where(eq(discussion.conversationId, w.roomChat));
          if (room)
            await closeAttentionKey(db, a.userId, `permission:${room.id}:${w.id}`, "resolved");
        }
      }
      return taken;
    },
    /** A bot asked to open a discussion: allowlisted peers open it now; others become a proposal (never for outside people). */
    async request(a: ActiveActor, input: OpenInput & { createdBy: Bot }, inbound: boolean) {
      const bots = await resolveBots(
        a,
        input.members.map((m) => m.bot),
      );
      const allowed = new Set(await peerIds(a, input.createdBy.id));
      const outside = bots.filter((b) => b.id !== input.createdBy.id && !allowed.has(b.id));
      if (!outside.length) return { kind: "opened" as const, ...(await open(a, input)) };
      if (inbound)
        throw new DiscussionError(
          "NOT_ALLOWED",
          `${outside.map((b) => b.name).join(", ")} ${outside.length === 1 ? "is" : "are"} not pre-approved for ${input.createdBy.name}, and requests from outside people cannot ask for approval. The user can add them under the bot's settings > Rooms.`,
        );
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(configProposal)
        .where(
          and(
            eq(configProposal.ownerUserId, a.userId),
            eq(configProposal.kind, "open_discussion"),
            eq(configProposal.status, "pending"),
          ),
        );
      if (n >= MAX_PENDING_PROPOSALS)
        throw new DiscussionError(
          "LIMIT",
          "There are already room requests waiting for the user's approval.",
        );
      const patch = {
        title: input.title,
        goal: input.goal,
        context: input.context,
        members: bots.map((b, i) => ({ bot: b.id, role: input.members[i]!.role })),
        firstMessage: input.firstMessage,
        createdByBotId: input.createdBy.id,
        origin: input.origin ?? null,
        originInbound: input.originInbound ?? null,
        tainted: input.tainted,
      };
      const [p] = await db
        .insert(configProposal)
        .values({
          ownerUserId: a.userId,
          kind: "open_discussion",
          botId: null,
          proposedByBotId: input.createdBy.id,
          baseVersion: 0,
          patch,
          diff: [
            { field: "discussion", from: null, to: input.title },
            { field: "goal", from: null, to: input.goal.slice(0, 400) },
            {
              field: "members",
              from: null,
              to: [input.createdBy.name, ...bots.map((b) => b.name)].join(", "),
            },
            { field: "context", from: null, to: input.context.slice(0, 1200) },
          ],
        })
        .returning();
      await raiseAttention(db, a.userId, {
        botId: input.createdBy.id,
        title: `${input.createdBy.name} wants to open a room with ${outside.map((b) => b.name).join(", ")}`,
        detail: input.title,
        nextAction: "Open Chat and approve or reject the proposal.",
        // The asking bot's own chat, where the card is shown.
        resultLink: `/chat/${input.origin?.conversationId ?? `new?bot=${input.createdBy.id}`}`,
        source: "bot",
        sourceKey: `proposal:${p!.id}`,
      });
      return { kind: "proposed" as const, proposalId: p!.id };
    },
    /** Approved `open_discussion` proposal: everything is checked again with today's bots and limits. */
    async openFromProposal(a: ActiveActor, patch: Record<string, unknown>) {
      const [creator] = await db
        .select()
        .from(bot)
        .where(and(eq(bot.id, String(patch.createdByBotId)), visible(a), eq(bot.archived, false)));
      if (!creator) throw new AccessError("NOT_FOUND");
      return open(a, {
        title: String(patch.title),
        goal: String(patch.goal ?? ""),
        context: String(patch.context ?? ""),
        members: (patch.members as { bot: string; role?: string }[]) ?? [],
        firstMessage: String(patch.firstMessage ?? ""),
        createdBy: creator,
        origin: (patch.origin as OpenInput["origin"]) ?? undefined,
        originInbound: (patch.originInbound as OpenInput["originInbound"]) ?? undefined,
        tainted: Boolean(patch.tainted),
      });
    },
    /**
     * A bot named in a chat that is not its own answers in a room, never in that chat. The bots the chat's own bot already took into a room
     * (opened, or waiting for approval) for this message are left alone. The rest join an open room from this chat that has them all, or a
     * new room the person opens (no approval needed). Returns that room, or null when nothing was left to do.
     */
    async redirectMention(
      a: ActiveActor,
      v: {
        conversationId: string;
        conversationTitle: string;
        messageId: string;
        chatBot: Bot;
        bots: Bot[];
        text: string;
        leadReply: string;
        tainted: boolean;
      },
    ) {
      const covered = new Set(
        (
          await db
            .select({ botId: discussionMember.botId })
            .from(discussionMember)
            .innerJoin(discussion, eq(discussion.id, discussionMember.discussionId))
            .where(
              and(
                eq(discussion.ownerUserId, a.userId),
                eq(discussion.originMessageId, v.messageId),
              ),
            )
        ).map((r) => r.botId),
      );
      const pending = await db
        .select({ patch: configProposal.patch })
        .from(configProposal)
        .where(
          and(
            eq(configProposal.ownerUserId, a.userId),
            eq(configProposal.kind, "open_discussion"),
            eq(configProposal.status, "pending"),
          ),
        );
      for (const { patch } of pending) {
        const p = patch as {
          origin?: { messageId?: string | null } | null;
          members?: { bot: string }[];
        };
        if (p.origin?.messageId === v.messageId)
          for (const m of p.members ?? []) covered.add(m.bot);
      }
      const targets = v.bots.filter((b) => !covered.has(b.id));
      if (!targets.length) return null;
      const names = targets.map((b) => b.name);
      // The opening post must name the targets, or the Chief (facilitator of a person's room) would answer instead of them.
      const namedIds = new Set(mentionIds(v.text, "bot"));
      const namedKeys = new Set(
        legacyMentions(v.text)
          .filter((m) => m.sigil === "@")
          .map((m) => m.key),
      );
      const tags = targets
        .filter((b) => !namedIds.has(b.id) && !namedKeys.has(mentionKey(b.name)))
        .map((b) => mentionToken("bot", b.id, b.name));
      const firstMessage = (tags.length ? `${tags.join(" ")} ${v.text}` : v.text).slice(0, 8000);
      const room = async (d: Discussion) => {
        await this.postAsOwner(a, d.id, firstMessage);
        return { id: d.id, title: d.title, names };
      };
      const open_ = await db
        .select()
        .from(discussion)
        .where(
          and(
            eq(discussion.ownerUserId, a.userId),
            eq(discussion.originConversationId, v.conversationId),
            eq(discussion.kind, "room"),
            inArray(discussion.status, ["open", "stalled"]),
          ),
        )
        .orderBy(desc(discussion.updatedAt));
      for (const d of open_) {
        const have = new Set((await membersOf(d)).map((m) => m.m.botId));
        if (targets.every((b) => have.has(b.id))) return room(d);
      }
      const firstLine = v.text.trim().split("\n")[0]!;
      const res = await open(a, {
        title: `${names.join(", ")}: ${firstLine}`.slice(0, 120),
        goal: v.text.slice(0, 1000),
        context: `From the chat "${v.conversationTitle}" with ${v.chatBot.name}.\n\n${v.chatBot.name} replied: ${v.leadReply}`,
        members: targets.map((b) => ({ bot: b.id })),
        firstMessage,
        createdBy: null,
        origin: { conversationId: v.conversationId, messageId: v.messageId },
        tainted: v.tainted,
      });
      return res.created
        ? { id: res.discussion.id, title: res.discussion.title, names }
        : room(res.discussion);
    },
    /** For tool calls: the discussion when `who` is a member of it (else NOT_FOUND, never someone else's). */
    async forMember(a: ActiveActor, id: string, botId: string) {
      const d = await loadOwned(a, id);
      const [m] = await db
        .select()
        .from(discussionMember)
        .where(and(eq(discussionMember.discussionId, d.id), eq(discussionMember.botId, botId)));
      if (!m) throw new DiscussionError("NOT_FOUND", "You are not a member of that room.");
      return d;
    },
    async postAsBot(a: ActiveActor, id: string, who: Bot, text: string) {
      const d = await this.forMember(a, id, who.id);
      if (d.status !== "open") throw new DiscussionError("CLOSED", `That room is ${d.status}.`);
      return post(db, d, who, text);
    },
    /** Wakes one member for a post (even its own author): a bot that waited for the person's approval goes on once the click is done. */
    async wakeBot(a: ActiveActor, id: string, botId: string, messageId: string) {
      const d = await this.forMember(a, id, botId);
      const n = await transaction(db, async (tx) => {
        const [cur] = await tx
          .select()
          .from(discussion)
          .where(eq(discussion.id, d.id))
          .for("update");
        if (cur?.status !== "open") return 0;
        const rows = await tx
          .insert(discussionTurn)
          .values({
            ownerUserId: d.ownerUserId,
            discussionId: d.id,
            botId,
            triggerMessageId: messageId,
          })
          .onConflictDoNothing()
          .returning({ id: discussionTurn.id });
        return rows.length;
      });
      if (n) onEnqueue?.();
      return n;
    },
    /** A post that already exists (a member turn's reply): only wakes the next members. */
    async afterReply(
      d: Discussion,
      authorBotId: string,
      text: string,
      messageId: string,
      { mentionsOnly = false }: { mentionsOnly?: boolean } = {},
    ) {
      const [cur] = await db.select().from(discussion).where(eq(discussion.id, d.id));
      if (cur?.status !== "open") return 0;
      // Bots that only repeat themselves are silenced; a goal loop keeps its state and goes on when a person posts.
      const recent = await db
        .select({ authorBotId: message.botId, role: message.role, content: message.content })
        .from(message)
        .where(
          and(
            eq(message.conversationId, cur.conversationId),
            inArray(message.role, ["user", "assistant"]),
          ),
        )
        .orderBy(desc(message.createdAt))
        .limit(12);
      const sinceUser = recent.findIndex((m) => m.role === "user");
      const posts = (sinceUser < 0 ? recent : recent.slice(0, sinceUser)).reverse();
      if (isIdleChatter(posts)) {
        await transaction(db, (tx) => silenceRoom(tx, cur, "auto"));
        return 0;
      }
      const n = await enqueueWakesIfOpen(db, cur.id, authorBotId, text, messageId, !mentionsOnly);
      if (n) onEnqueue?.();
      return n;
    },
    /** A person posts into the discussion (wakes who they mention, else the facilitator). Posting reopens a stalled one. */
    async postAsOwner(a: ActiveActor, id: string, text: string, attached: PostFiles = {}) {
      let d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `This room is ${d.status}.`);
      // A person's post always reaches the room: it reopens a paused one (as it does a stalled one).
      if (d.status === "paused") d = await this.setStatus(a, id, "resume");
      // Everything the post will carry is checked before anything is written (same rule as a chat message).
      const ids = attached.attachmentIds ?? [],
        refs = attached.fileRefs ?? [];
      const picked = ids.length
        ? await db
            .select()
            .from(attachment)
            .where(
              and(
                inArray(attachment.id, ids),
                eq(attachment.ownerUserId, a.userId),
                sql`${attachment.messageId} is null`,
              ),
            )
        : [];
      if (picked.length !== ids.length)
        throw new DiscussionError(
          "NOT_FOUND",
          "An attachment is no longer available. Attach it again.",
        );
      const isPicture = (f: (typeof picked)[number]) => !!f.path && f.mimeType.startsWith("image/");
      const images = picked.filter(isPicture).map((f) => ({ id: f.id, name: f.name }));
      const carried: { name: string; text: string }[] = picked
        .filter((f) => !isPicture(f))
        .map((f) => ({ name: f.name, text: f.content.slice(0, FILE_CLIP) }));
      const fileHashes: { path: string; sha256: string }[] = [];
      for (const ref of refs) {
        try {
          const r = await (files?.readWithHash(a.userId, ref) ??
            Promise.reject(new Error("no files")));
          carried.push({ name: ref, text: r.text.slice(0, FILE_CLIP) });
          fileHashes.push({ path: ref, sha256: r.sha256 });
        } catch {
          throw new DiscussionError("NOT_FOUND", `The file ${ref} could not be read.`);
        }
      }
      // Memory items the person picked: they must be readable by them, and they stay on the post for the bots woken by it.
      const memoryIds = [...new Set(attached.memoryIds ?? [])];
      if (memoryIds.length) {
        const readable = await db
          .select({ id: memoryItem.id })
          .from(memoryItem)
          .where(
            and(
              inArray(memoryItem.id, memoryIds),
              ne(memoryItem.status, "archived"),
              visibleTo(a.userId),
            ),
          );
        if (readable.length !== memoryIds.length)
          throw new DiscussionError("NOT_FOUND", "A memory item is no longer available.");
      }
      // Skills the person picked: each must belong to a bot in this room, so a pick never reaches a bot that does not have the skill.
      const skills = [
        ...new Map((attached.skills ?? []).map((k) => [`${k.botId}/${k.name}`, k])).values(),
      ];
      const skillOwners = [...new Set(skills.map((k) => k.botId))];
      if (skills.length) {
        const owners = await db
          .select({ id: bot.id, harness: bot.harness })
          .from(discussionMember)
          .innerJoin(bot, eq(bot.id, discussionMember.botId))
          .where(
            and(
              eq(discussionMember.discussionId, d.id),
              inArray(discussionMember.botId, skillOwners),
            ),
          );
        const have = new Map(
          await Promise.all(
            owners.map(
              async (o) => [o.id, new Set((await skillsOf(claude, o)).map((k) => k.name))] as const,
            ),
          ),
        );
        if (skills.some((k) => !have.get(k.botId)?.has(k.name)))
          throw new DiscussionError("NOT_FOUND", "A skill is no longer available.");
      }
      // A reply quotes a message of this room. The bot that wrote it, if it is a member, answers without a mention.
      const [quoted] = attached.quotedMessageId
        ? await db
            .select({
              id: message.id,
              role: message.role,
              botId: message.botId,
              content: message.content,
            })
            .from(message)
            .where(
              and(
                eq(message.id, attached.quotedMessageId),
                eq(message.conversationId, d.conversationId),
              ),
            )
        : [];
      if (attached.quotedMessageId && !quoted)
        throw new DiscussionError("NOT_FOUND", "That message is no longer available.");
      const quote = quoted ? quoteOf(quoted) : null;
      const [quotedMember] = quote?.botId
        ? await db
            .select({ botId: discussionMember.botId })
            .from(discussionMember)
            .where(
              and(eq(discussionMember.discussionId, d.id), eq(discussionMember.botId, quote.botId)),
            )
        : [];
      const addressed = [
        ...new Set([...skillOwners, ...(quotedMember ? [quotedMember.botId] : [])]),
      ];
      const res = await transaction(db, async (tx) => {
        const cur =
          d.status === "stalled"
            ? (
                await tx
                  .update(discussion)
                  .set({
                    status: "open",
                    updatedAt: new Date(),
                  })
                  .where(eq(discussion.id, d.id))
                  .returning()
              )[0]!
            : d;
        const row = await insertMessage(tx, d.conversationId, {
          ownerUserId: a.userId,
          role: "user",
          content: text,
          meta:
            carried.length || images.length || memoryIds.length || skills.length || quote
              ? {
                  ...(quote ? { quote } : {}),
                  ...(memoryIds.length ? { memoryIds } : {}),
                  ...(skills.length ? { skills } : {}),
                  ...(carried.length ? { files: carried } : {}),
                  ...(images.length ? { images } : {}),
                  ...(refs.length ? { fileRefs: refs, fileHashes } : {}),
                }
              : null,
        });
        if (picked.length)
          await tx
            .update(attachment)
            .set({ messageId: row.id, conversationId: d.conversationId })
            .where(
              inArray(
                attachment.id,
                picked.map((f) => f.id),
              ),
            );
        const n =
          cur.status === "open"
            ? await enqueueWakes(tx, cur, null, row.content, row.id, false, true, addressed)
            : 0;
        return { row, n };
      });
      if (res.n) onEnqueue?.();
      return res.row;
    },
    async updateContext(
      a: ActiveActor,
      id: string,
      patch: {
        title?: string | undefined;
        goal?: string | undefined;
        context?: string | undefined;
      },
      expectedVersion?: number,
    ) {
      const d = await loadOwned(a, id);
      if (expectedVersion !== undefined && d.version !== expectedVersion)
        throw new DiscussionError(
          "CONFLICT",
          "The room changed meanwhile. Reload it and try again.",
        );
      const retitled = patch.title !== undefined;
      const brief =
        (patch.goal !== undefined && patch.goal !== d.goal) ||
        (patch.context !== undefined && patch.context !== d.context);
      const [row] = await db
        .update(discussion)
        .set({
          ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 120) } : {}),
          ...(patch.goal !== undefined ? { goal: patch.goal.slice(0, 1000) } : {}),
          ...(patch.context !== undefined ? { context: patch.context.slice(0, 8000) } : {}),
          ...(brief ? { contextVersion: sql`${discussion.contextVersion} + 1` } : {}),
          version: sql`${discussion.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(discussion.id, d.id), eq(discussion.version, d.version)))
        .returning()
        .catch((e) => {
          if (
            [e, (e as { cause?: unknown } | null)?.cause].some(
              (x) => (x as { code?: string } | null)?.code === "23505",
            )
          )
            throw new DiscussionError(
              "CONFLICT",
              "A room with this name already exists. Pick another name.",
            );
          throw e;
        });
      if (!row)
        throw new DiscussionError(
          "CONFLICT",
          "The room changed meanwhile. Reload it and try again.",
        );
      if (retitled && row.kind === "room")
        await refreshMentionLabels(db, "room", row.id, row.title);
      return row;
    },
    /** A member rewrites the shared context (bumps the version). */
    async updateContextAsBot(a: ActiveActor, id: string, who: Bot, text: string) {
      const d = await this.forMember(a, id, who.id);
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `That room is ${d.status}.`);
      const [row] = await db
        .update(discussion)
        .set({
          context: text.slice(0, 8000),
          contextVersion: sql`${discussion.contextVersion} + 1`,
          version: sql`${discussion.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(discussion.id, d.id))
        .returning();
      await insertMessage(db, d.conversationId, {
        ownerUserId: d.ownerUserId,
        role: "system",
        content: `📝 ${who.name} updated the shared context.`,
        meta: { discussionEvent: "context" },
      });
      return row!;
    },
    /**
     * Resolves: queued turns are cancelled, the facilitator gets one wrap-up turn (when someone else resolved it), and the origin chat
     * gets the summary. The discussion's notifications close: a solved discussion needs nothing from the owner.
     */
    async resolve(a: ActiveActor, id: string, by: Bot | null, summary: string) {
      const d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `That room is already ${d.status}.`);
      const wrap = d.createdByBotId && by?.id !== d.createdByBotId ? d.createdByBotId : null;
      const row = await transaction(db, async (tx) => {
        const [r] = await tx
          .update(discussion)
          .set({
            status: "resolved",
            summary: summary.slice(0, 2000),
            resolvedAt: new Date(),
            updatedAt: new Date(),
            version: sql`${discussion.version} + 1`,
          })
          .where(and(eq(discussion.id, d.id), inArray(discussion.status, [...ACTIVE])))
          .returning();
        if (!r) throw new DiscussionError("CLOSED", "That room is already closed.");
        await tx
          .update(discussionTurn)
          .set({ status: "cancelled", finishedAt: new Date(), reasonCode: "resolved" })
          .where(
            and(
              eq(discussionTurn.discussionId, d.id),
              inArray(discussionTurn.status, ["queued", "awaiting_approval"]),
            ),
          );
        const note = await insertMessage(tx, d.conversationId, {
          ownerUserId: d.ownerUserId,
          role: "system",
          content: `✅ Resolved${by ? ` by ${by.name}` : ""}: ${summary}`,
          meta: { discussionEvent: "resolved" },
        });
        if (wrap)
          await tx
            .insert(discussionTurn)
            .values({
              ownerUserId: d.ownerUserId,
              discussionId: d.id,
              botId: wrap,
              triggerMessageId: note.id,
              kind: "wrapup",
            })
            .onConflictDoNothing();
        if (d.originConversationId)
          await insertMessage(tx, d.originConversationId, {
            ownerUserId: d.ownerUserId,
            role: "system",
            content: `👥 Room "${d.title}" was resolved: ${summary}`,
            meta: { discussion: { id: d.id, title: d.title, status: "resolved" } },
          });
        await closeAttention(tx, d.ownerUserId, `/rooms?id=${d.id}`, "resolved");
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
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `This room is ${d.status}.`);
      const row = await transaction(db, async (tx) => {
        const set =
          action === "pause"
            ? { status: "paused" as const }
            : action === "cancel"
              ? { status: "cancelled" as const }
              : { status: "open" as const };
        const [r] = await tx
          .update(discussion)
          .set({ ...set, updatedAt: new Date(), version: sql`${discussion.version} + 1` })
          .where(eq(discussion.id, d.id))
          .returning();
        if (action === "cancel") await dropQueuedTurns(tx, d);
        // Resuming retries what a restart interrupted (the owner saw the card and chose to go on).
        if (action === "resume")
          await tx
            .update(discussionTurn)
            .set({ status: "queued", reasonCode: null })
            .where(
              and(eq(discussionTurn.discussionId, d.id), eq(discussionTurn.status, "interrupted")),
            );
        await insertMessage(tx, d.conversationId, {
          ownerUserId: d.ownerUserId,
          role: "system",
          content:
            action === "pause"
              ? "⏸ Paused by the user."
              : action === "cancel"
                ? "⏹ Cancelled by the user."
                : "▶️ Resumed by the user.",
          meta: { discussionEvent: action },
        });
        return r!;
      });
      if (action === "resume") onEnqueue?.();
      return row;
    },
    /** Stops the bots talking: ends the goal loops, drops queued turns and pauses the room until a person posts. */
    async silence(a: ActiveActor, id: string) {
      const d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `This room is ${d.status}.`);
      for (const l of (await loops?.activeAll(d.conversationId)) ?? [])
        await loops?.setStatus(a.userId, l.id, "cancelled");
      return transaction(db, (tx) => silenceRoom(tx, d, "user"));
    },
    /**
     * Ends every goal loop of the room and drops the queued turns, but keeps the room, its messages and its context.
     * A paused or stalled room opens again, so the bots answer the next question.
     */
    async stopGoals(a: ActiveActor, id: string) {
      const d = await loadOwned(a, id);
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `This room is ${d.status}.`);
      for (const l of (await loops?.activeAll(d.conversationId)) ?? [])
        await loops?.setStatus(a.userId, l.id, "cancelled");
      return transaction(db, async (tx) => {
        const [r] = await tx
          .update(discussion)
          .set({ status: "open", updatedAt: new Date(), version: sql`${discussion.version} + 1` })
          .where(eq(discussion.id, d.id))
          .returning();
        await dropQueuedTurns(tx, d);
        await insertMessage(tx, d.conversationId, {
          ownerUserId: d.ownerUserId,
          role: "system",
          content: "🎯 Goals stopped by the user. The room goes on with its history.",
          meta: { discussionEvent: "goals_stopped" },
        });
        return r!;
      });
    },
    /**
     * "Delete" a room: it is cancelled and hidden from every list (its conversation is archived), history kept. Work attached to it
     * (its tasks) moves to `moveTo`, the chat the person asked to continue in. Returns what a caller needs to carry the work on.
     */
    async remove(
      a: ActiveActor,
      id: string,
      by: Bot | null,
      opts: { reason?: string; moveTo?: string } = {},
    ) {
      const d = await loadOwned(a, id);
      await transaction(db, async (tx) => {
        const live = d.status !== "resolved" && d.status !== "cancelled";
        if (live) {
          await tx
            .update(discussion)
            .set({
              status: "cancelled",
              updatedAt: new Date(),
              version: sql`${discussion.version} + 1`,
            })
            .where(eq(discussion.id, d.id));
          await dropQueuedTurns(tx, d);
        }
        if (opts.moveTo && opts.moveTo !== d.conversationId)
          await tx
            .update(task)
            .set({ conversationId: opts.moveTo, updatedAt: new Date() })
            .where(and(eq(task.ownerUserId, a.userId), eq(task.conversationId, d.conversationId)));
        await insertMessage(tx, d.conversationId, {
          ownerUserId: d.ownerUserId,
          role: "system",
          content: `🗑 Deleted by ${by ? by.name : "the user"}${opts.reason ? `: ${opts.reason}` : "."}`,
          meta: { discussionEvent: "deleted" },
        });
        await tx
          .update(conversation)
          .set({ archived: true, archivedAt: new Date() })
          .where(eq(conversation.id, d.conversationId));
      });
      return { discussion: d, transcript: await this.transcript(d, 20) };
    },
    /** A room of the owner where `botId` is the creator or a member, found by id, title or `#mention` key. The newest match wins. */
    async findForBot(a: ActiveActor, botId: string, ref: string) {
      const key = mentionKey(ref.replace(/^#/, ""));
      const tokenId = mentionIds(ref, "room")[0]; // a bot may copy `[#Title](room:<id>)`
      const rows = await db
        .select({ d: discussion })
        .from(discussion)
        .innerJoin(conversation, eq(conversation.id, discussion.conversationId))
        .leftJoin(
          discussionMember,
          and(eq(discussionMember.discussionId, discussion.id), eq(discussionMember.botId, botId)),
        )
        .where(
          and(
            eq(discussion.ownerUserId, a.userId),
            eq(conversation.archived, false),
            or(eq(discussion.createdByBotId, botId), eq(discussionMember.botId, botId)),
          ),
        )
        .orderBy(desc(discussion.createdAt));
      return rows
        .map((r) => r.d)
        .find((d) => d.id === (tokenId ?? ref) || mentionKey(d.title) === key || d.title === ref);
    },
    /** A room request still waiting for approval, withdrawn by the bot that made it (found by title). */
    async withdrawRequest(a: ActiveActor, botId: string, ref: string) {
      const key = mentionKey(ref.replace(/^#/, ""));
      const rows = await db
        .select()
        .from(configProposal)
        .where(
          and(
            eq(configProposal.ownerUserId, a.userId),
            eq(configProposal.kind, "open_discussion"),
            eq(configProposal.status, "pending"),
            eq(configProposal.proposedByBotId, botId),
          ),
        );
      const hit = rows.find(
        (p) => mentionKey(String((p.patch as { title?: string }).title ?? "")) === key,
      );
      if (!hit) return undefined;
      await db.update(configProposal).set({ status: "stale" }).where(eq(configProposal.id, hit.id));
      await closeAttentionKey(db, a.userId, `proposal:${hit.id}`, "cancelled");
      return { id: hit.id, title: String((hit.patch as { title?: string }).title ?? "") };
    },
    /** Discussions the bots are working on now (status open): the count on the Discussions rail badge. */
    async countRunning(a: ActiveActor) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(discussion)
        .where(and(eq(discussion.ownerUserId, a.userId), eq(discussion.status, "open")));
      return r?.n ?? 0;
    },
    async list(a: ActiveActor, status?: Discussion["status"]) {
      const rows = (
        await db
          .select({ d: discussion })
          .from(discussion)
          .innerJoin(conversation, eq(conversation.id, discussion.conversationId))
          .where(
            and(
              or(
                eq(discussion.ownerUserId, a.userId),
                inArray(discussion.teamId, people.teamIds(a.userId)),
              ),
              eq(conversation.archived, false),
              status ? eq(discussion.status, status) : undefined,
            ),
          )
          .orderBy(desc(discussion.updatedAt))
          .limit(100)
      ).map((r) => r.d);
      const members = rows.length
        ? await db
            .select({
              discussionId: discussionMember.discussionId,
              botId: discussionMember.botId,
              name: bot.name,
            })
            .from(discussionMember)
            .innerJoin(bot, eq(bot.id, discussionMember.botId))
            .where(
              inArray(
                discussionMember.discussionId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      const active = rows.length
        ? await db
            .select({ discussionId: discussionTurn.discussionId, status: discussionTurn.status })
            .from(discussionTurn)
            .where(
              and(
                inArray(
                  discussionTurn.discussionId,
                  rows.map((r) => r.id),
                ),
                inArray(discussionTurn.status, ["queued", "running", "awaiting_approval"]),
              ),
            )
        : [];
      return rows.map((d) => ({
        ...publicRoom(d),
        members: members
          .filter((m) => m.discussionId === d.id)
          .map((m) => ({ botId: m.botId, name: m.name })),
        queued: active.filter((t) => t.discussionId === d.id && t.status === "queued").length,
        running: active.some((t) => t.discussionId === d.id && t.status === "running"),
        awaitingApproval: active.some(
          (t) => t.discussionId === d.id && t.status === "awaiting_approval",
        ),
      }));
    },
    async byConversation(conversationId: string) {
      return (
        await db.select().from(discussion).where(eq(discussion.conversationId, conversationId))
      )[0];
    },
    /** The owner starts a goal loop for a room: its facilitator leads, the members discuss how to reach the goal. */
    async startLoop(a: ActiveActor, id: string, v: { goal: string; doneWhen: string }) {
      if (!loops) throw new DiscussionError("INVALID", "Loops are not available.");
      const d = await loadOwned(a, id);
      if (!d.createdByBotId)
        throw new DiscussionError("INVALID", "A loop needs a facilitator bot to lead the room.");
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `This room is ${d.status}.`);
      if ((await membersOf(d)).length < 2)
        throw new DiscussionError("INVALID", "A loop needs at least two bots in the room.");
      const goal = (v.goal || d.goal).trim();
      if (!goal) throw new DiscussionError("INVALID", "Give the loop a goal.");
      if (await loops.active(d.conversationId))
        throw new DiscussionError(
          "CONFLICT",
          "This room already has a loop. Stop it before starting another.",
        );
      return loops.start(a.userId, {
        conversationId: d.conversationId,
        botId: d.createdByBotId,
        goal: goal.slice(0, 500),
        doneWhen: v.doneWhen,
      });
    },
    /**
     * The owner approved the chief's split of the team goal: one loop per member, started together or not at all.
     * Everything is checked again here, because the room may have changed since the chief proposed it.
     */
    async startMemberLoops(
      a: ActiveActor,
      id: string,
      v: {
        request: string;
        goals: readonly { botId: string; goal: string; doneWhen: string }[];
      },
    ) {
      if (!loops) throw new DiscussionError("INVALID", "Loops are not available.");
      const d = await loadOwned(a, id);
      if (!d.teamId || !d.createdByBotId)
        throw new DiscussionError("INVALID", "Member goals belong to a team room.");
      if (d.status === "resolved" || d.status === "cancelled")
        throw new DiscussionError("CLOSED", `This room is ${d.status}.`);
      const members = new Set(
        (await membersOf(d)).filter((m) => m.m.botId !== d.createdByBotId).map((m) => m.m.botId),
      );
      const ids = v.goals.map((g) => g.botId);
      if (!ids.length || new Set(ids).size !== ids.length || !ids.every((b) => members.has(b)))
        throw new DiscussionError("INVALID", "Each goal needs a different member of the team.");
      if (await loops.active(d.conversationId))
        throw new DiscussionError(
          "CONFLICT",
          "This room already has a loop. Stop it before starting another.",
        );
      const started = await transaction(db, (tx) =>
        Promise.all(
          v.goals.map((g) =>
            loops.start(
              a.userId,
              {
                conversationId: d.conversationId,
                botId: g.botId,
                goal: g.goal.slice(0, 500),
                doneWhen: g.doneWhen,
                request: v.request,
              },
              tx,
            ),
          ),
        ),
      );
      for (const l of started) loops.kick(l.id);
      return started;
    },
    /**
     * One loop step: a stalled room reopens, and a system post wakes the facilitator.
     * Returns why no step started when the room is paused or closed.
     */
    async startLoopStep(
      id: string,
      label: string,
      /** A member's own loop: only that member is woken, not the facilitator. */
      memberBotId?: string,
    ): Promise<{ state: "started"; since: Date } | { state: "resolved" | "cancelled" | "paused" }> {
      const since = new Date();
      const [d] = await db
        .update(discussion)
        .set({ status: "open", updatedAt: since })
        .where(and(eq(discussion.id, id), inArray(discussion.status, ["open", "stalled"])))
        .returning();
      if (!d) {
        const [now] = await db
          .select({ status: discussion.status })
          .from(discussion)
          .where(eq(discussion.id, id));
        return {
          state:
            now?.status === "resolved"
              ? "resolved"
              : now?.status === "paused"
                ? "paused"
                : "cancelled",
        };
      }
      await transaction(db, async (tx) => {
        const row = await insertMessage(tx, d.conversationId, {
          ownerUserId: d.ownerUserId,
          role: "system",
          content: label,
          meta: { discussionEvent: "loop" },
        });
        if (memberBotId) {
          await tx
            .insert(discussionTurn)
            .values({
              ownerUserId: d.ownerUserId,
              discussionId: d.id,
              botId: memberBotId,
              triggerMessageId: row.id,
            })
            .onConflictDoNothing();
          return;
        }
        // No text to scan for mentions: the goal may name a member, but a loop step always goes to the facilitator first.
        await enqueueWakes(tx, d, null, "", row.id);
      });
      onEnqueue?.();
      return { state: "started", since };
    },
    /** Waits until the room is quiet (nothing queued or running), or something stops the step. */
    async settle(
      id: string,
      since: Date,
      stopped: () => Promise<boolean>,
      /** A member's loop only waits for, and fails on, that member's own turns. */
      memberBotId?: string,
    ): Promise<{ state: RoomSettle; summary: string }> {
      const turnsOf = memberBotId
        ? and(eq(discussionTurn.discussionId, id), eq(discussionTurn.botId, memberBotId))
        : eq(discussionTurn.discussionId, id);
      for (;;) {
        if (await stopped()) return { state: "stopped", summary: "" };
        const [d] = await db.select().from(discussion).where(eq(discussion.id, id));
        if (!d || d.status === "cancelled") return { state: "cancelled", summary: "" };
        if (d.status === "resolved") return { state: "resolved", summary: d.summary };
        if (d.status === "paused") return { state: "paused", summary: "" };
        const pending = (
          await db
            .select({ status: discussionTurn.status })
            .from(discussionTurn)
            .where(
              and(
                turnsOf,
                inArray(discussionTurn.status, ["queued", "running", "awaiting_approval"]),
              ),
            )
        ).map((t) => t.status);
        const running = pending.includes("running");
        // A stalled room (restart or idle) keeps its queued turns; the next step reopens it.
        const quiet = !running && (d.status === "stalled" || !pending.includes("queued"));
        if (quiet) {
          if (pending.includes("awaiting_approval")) return { state: "approval", summary: "" };
          const [{ n } = { n: 0 }] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(discussionTurn)
            .where(
              and(
                turnsOf,
                eq(discussionTurn.status, "failed"),
                sql`${discussionTurn.createdAt} >= ${since}`,
              ),
            );
          return { state: n > 0 ? "failed" : "idle", summary: "" };
        }
        await Bun.sleep(SETTLE_POLL_MS);
      }
    },
    /** One step row per member turn (the room drawer reads it). */
    async startSteps(t: Pick<DiscussionTurn, "id" | "ownerUserId" | "botId">) {
      await db
        .insert(turnStep)
        .values({ discussionTurnId: t.id, ownerUserId: t.ownerUserId, botId: t.botId })
        .onConflictDoNothing();
    },
    /** Appends one step to `data.steps` in a single statement; only the newest STEP_LIMIT steps stay. */
    async addStep(turnId: string, step: TurnStep, messageId?: string) {
      await db
        .update(turnStep)
        .set({
          data: sql`jsonb_build_object('steps', (select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb) from (select e, n from jsonb_array_elements(${turnStep.data} -> 'steps' || ${JSON.stringify([step])}::jsonb) with ordinality as t(e, n) order by n desc limit ${STEP_LIMIT}) x))`,
          ...(messageId ? { messageId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(turnStep.discussionTurnId, turnId));
    },
    /** Turns of a room with their saved steps, and the tasks its bots put on the board. */
    async steps(a: ActiveActor, id: string) {
      const d = await loadReadable(a, id);
      const rows = await db
        .select({ turn: discussionTurn, data: turnStep.data })
        .from(discussionTurn)
        .leftJoin(turnStep, eq(turnStep.discussionTurnId, discussionTurn.id))
        .where(eq(discussionTurn.discussionId, d.id))
        .orderBy(desc(discussionTurn.createdAt))
        .limit(100);
      const tasks = await db
        .select()
        .from(task)
        .where(and(eq(task.conversationId, d.conversationId), eq(task.ownerUserId, a.userId)))
        .orderBy(desc(task.updatedAt));
      return {
        turns: rows.map((r) => ({
          id: r.turn.id,
          botId: r.turn.botId,
          kind: r.turn.kind,
          status: r.turn.status,
          createdAt: r.turn.createdAt,
          finishedAt: r.turn.finishedAt,
          steps: r.data?.steps ?? [],
        })),
        tasks,
      };
    },
    async get(a: ActiveActor, id: string) {
      const d = await loadReadable(a, id);
      const members = (await membersOf(d)).map((r) => ({
        botId: r.m.botId,
        name: r.name,
        role: r.m.role,
        requireApproval: r.m.requireApproval,
        turns: r.m.turns,
        code: codeEnabled(r, a.userId),
      }));
      const turns = await db
        .select()
        .from(discussionTurn)
        .where(eq(discussionTurn.discussionId, d.id))
        .orderBy(desc(discussionTurn.createdAt))
        .limit(30);
      const routines = await db
        .select({ id: routine.id, title: routine.title, status: routine.status })
        .from(routine)
        .where(
          and(
            eq(routine.originDiscussionId, d.id),
            eq(routine.ownerUserId, a.userId),
            eq(routine.archived, false),
          ),
        )
        .orderBy(asc(routine.createdAt));
      const [owner] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, d.ownerUserId));
      return {
        discussion: publicRoom(d),
        owner: { userId: d.ownerUserId, name: owner?.name ?? "" },
        members,
        turns,
        routines,
      };
    },
    /** Owner toggle: whether a member must wait for an approved brief while outside content is in play. */
    async setRequireApproval(a: ActiveActor, id: string, botId: string, on: boolean) {
      const d = await loadOwned(a, id);
      const [m] = await db
        .update(discussionMember)
        .set({ requireApproval: on })
        .where(and(eq(discussionMember.discussionId, d.id), eq(discussionMember.botId, botId)))
        .returning();
      if (!m) throw new AccessError("NOT_FOUND");
      if (!on) {
        const n = await db
          .update(discussionTurn)
          .set({ status: "queued" })
          .where(
            and(
              eq(discussionTurn.discussionId, d.id),
              eq(discussionTurn.botId, botId),
              eq(discussionTurn.status, "awaiting_approval"),
            ),
          )
          .returning();
        if (n.length) onEnqueue?.();
      }
      return m;
    },
    membersOf,
    async transcript(d: Discussion, limit = 80) {
      const rows = await db
        .select({
          role: message.role,
          content: message.content,
          botId: message.botId,
          status: message.status,
          meta: message.meta,
        })
        .from(message)
        .where(eq(message.conversationId, d.conversationId))
        .orderBy(desc(message.seq))
        .limit(limit);
      return rows.reverse().filter((m) => m.status === "complete");
    },
    /**
     * Claims the oldest runnable turn: its discussion is open (or it is a wrap-up). Gated turns go to the owner for approval; a spent
     * budget stalls the discussion. Lane "any": the room has no other turn running (the members of a room take turns; different rooms
     * run side by side).
     * Lane "user": only turns woken by the person's own post, and they start at once beside running turns, so the person is never
     * kept waiting for a busy bot (the harness limiter still caps the processes).
     */
    async claimNext(
      names: (botId: string) => Promise<string>,
      lane: "any" | "user" = "any",
    ): Promise<Claimed | undefined> {
      for (let i = 0; i < 10; i++) {
        const out = await transaction(db, async (tx): Promise<Claimed | "again" | undefined> => {
          // One claim at a time across instances: the "one running turn per room" check below reads rows that a parallel claim could
          // still be changing. Claims are short, so the wait is not noticed.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext('zetta:discussion-claim'))`);
          const picked = await tx.execute<{
            id: string;
          }>(sql`select t.id from discussion_turn t join discussion d on d.id = t.discussion_id
            where t.status = 'queued' and (d.status = 'open' or (t.kind = 'wrapup' and d.status = 'resolved'))
              -- "Pause everything": a paused owner's turns stay queued, and the worker takes them after "resume".
              and not exists (select 1 from user_preference up where up.owner_user_id = t.owner_user_id and up.agents_state = 'paused')
              and ${
                lane === "user"
                  ? sql`t.kind = 'reply' and exists (select 1 from message m where m.id = t.trigger_message_id and m.role = 'user')`
                  : sql`not exists (select 1 from discussion_turn r where r.discussion_id = t.discussion_id and r.status = 'running')`
              }
            order by t.created_at limit 1 for update of t skip locked`);
          const id =
            (picked as unknown as { rows?: { id: string }[] }).rows?.[0]?.id ??
            (picked as unknown as { id: string }[])[0]?.id;
          if (!id) return undefined;
          const [turn] = await tx.select().from(discussionTurn).where(eq(discussionTurn.id, id));
          const [d] = await tx
            .select()
            .from(discussion)
            .where(eq(discussion.id, turn!.discussionId))
            .for("update");
          const [member] = await tx
            .select()
            .from(discussionMember)
            .where(
              and(
                eq(discussionMember.discussionId, d!.id),
                eq(discussionMember.botId, turn!.botId),
              ),
            );
          if (!member) {
            await tx
              .update(discussionTurn)
              .set({ status: "skipped", reasonCode: "not_member", finishedAt: new Date() })
              .where(eq(discussionTurn.id, id));
            return "again";
          }
          const c: Claimed = { turn: turn!, discussion: d!, member };
          if (
            d!.tainted &&
            member.requireApproval &&
            turn!.approvedContextVersion !== d!.contextVersion
          ) {
            await gate(tx, c, await names(turn!.botId));
            return "again";
          }
          // Rooms have no turn limit: the count is a statistic only.
          if (turn!.kind === "reply") {
            const [spent] = await tx
              .update(discussion)
              .set({ turnsUsed: sql`${discussion.turnsUsed} + 1` })
              .where(eq(discussion.id, d!.id))
              .returning();
            c.discussion = spent!;
          }
          const [running] = await tx
            .update(discussionTurn)
            .set({
              status: "running",
              claimedAt: new Date(),
              ownerInstance: instanceId(),
              attempts: sql`${discussionTurn.attempts} + 1`,
            })
            .where(eq(discussionTurn.id, id))
            .returning();
          c.turn = running!;
          return c;
        });
        if (out !== "again") return out;
      }
      return undefined;
    },
    /** Whether a queued turn could be claimed now (tests and diagnostics). */
    async hasRunnable() {
      const r = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from discussion_turn t join discussion d on d.id = t.discussion_id where t.status in ('queued', 'running') and (d.status = 'open' or (t.kind = 'wrapup' and d.status = 'resolved'))`,
      );
      return (
        Number(
          ((r as unknown as { rows?: { n: number }[] }).rows ??
            (r as unknown as { n: number }[]))[0]?.n ?? 0,
        ) > 0
      );
    },
    /**
     * Ends (or re-queues) a turn. With `attempt`, only the run that holds that claim can end it: a run the watchdog already took back, or
     * one that was claimed again since, changes nothing and gets undefined. A re-queue keeps the reason it had (`stuck_resumed` must
     * survive a "busy" re-queue) unless a new one is given.
     */
    async finishTurn(
      turnId: string,
      status: "done" | "failed" | "skipped" | "cancelled" | "queued",
      v: { resultMessageId?: string | null; reasonCode?: string | null; attempt?: number } = {},
    ) {
      const [t] = await db
        .update(discussionTurn)
        .set({
          status,
          resultMessageId: v.resultMessageId ?? null,
          ...(status === "queued" && v.reasonCode === undefined
            ? {}
            : { reasonCode: v.reasonCode ?? null }),
          finishedAt: status === "queued" ? null : new Date(),
        })
        .where(
          and(
            eq(discussionTurn.id, turnId),
            ...(v.attempt === undefined
              ? []
              : [eq(discussionTurn.status, "running"), eq(discussionTurn.attempts, v.attempt)]),
          ),
        )
        .returning();
      if (t && status === "done")
        await db
          .update(discussionMember)
          .set({ turns: sql`${discussionMember.turns} + 1` })
          .where(
            and(
              eq(discussionMember.discussionId, t.discussionId),
              eq(discussionMember.botId, t.botId),
            ),
          );
      if (t && status === "done")
        await db
          .update(discussion)
          .set({ updatedAt: new Date() })
          .where(eq(discussion.id, t.discussionId));
      return t;
    },
    /** Whether the run that holds `attempt` still owns the turn (the watchdog may have taken it back meanwhile). */
    async stillRunning(turnId: string, attempt: number) {
      const [row] = await db
        .select({ id: discussionTurn.id })
        .from(discussionTurn)
        .where(
          and(
            eq(discussionTurn.id, turnId),
            eq(discussionTurn.status, "running"),
            eq(discussionTurn.attempts, attempt),
          ),
        );
      return !!row;
    },
    /** The turns this server instance is running now, for the watchdog. */
    async runningOn(instance: string | undefined) {
      return db
        .select({
          id: discussionTurn.id,
          attempts: discussionTurn.attempts,
          claimedAt: discussionTurn.claimedAt,
          botName: bot.name,
        })
        .from(discussionTurn)
        .innerJoin(bot, eq(bot.id, discussionTurn.botId))
        .where(
          and(
            eq(discussionTurn.status, "running"),
            instance
              ? eq(discussionTurn.ownerInstance, instance)
              : sql`${discussionTurn.ownerInstance} is null`,
          ),
        );
    },
    /**
     * A running turn stopped making progress. The first time it goes back to the queue with a line in the room, and runs again; stuck
     * again, it ends as failed with a line and a card for the owner (the room keeps going). The claim's `attempts` must still match: a
     * turn that ended or was claimed again meanwhile is left alone. `reasonCode` carries "resumed once" over the re-claim.
     */
    async settleStuck(
      turn: { id: string; attempts: number },
      reason: StuckReason,
      botName: string,
    ) {
      const settled = await transaction(db, async (tx) => {
        const [t] = await tx
          .select()
          .from(discussionTurn)
          .where(eq(discussionTurn.id, turn.id))
          .for("update");
        if (!t || t.status !== "running" || t.attempts !== turn.attempts) return undefined;
        const [d] = await tx.select().from(discussion).where(eq(discussion.id, t.discussionId));
        if (!d) return undefined;
        const again = t.reasonCode === "stuck_resumed";
        const line = (discussionEvent: string, content: string) =>
          insertMessage(tx, d.conversationId, {
            ownerUserId: d.ownerUserId,
            role: "system",
            content,
            meta: { discussionEvent, botId: t.botId, turnId: t.id, reason },
          });
        if (!again) {
          await tx
            .update(discussionTurn)
            .set({
              status: "queued",
              reasonCode: "stuck_resumed",
              claimedAt: null,
              ownerInstance: null,
              finishedAt: null,
            })
            .where(eq(discussionTurn.id, t.id));
          await line(
            "turn_resumed",
            reason === "silent"
              ? `⏱ ${botName} showed no progress for ${Math.round(STUCK_MS() / 60_000)} minutes, so Zetta restarted its turn.`
              : reason === "gone"
                ? `⏱ ${botName}'s run stopped unexpectedly, so Zetta restarted its turn.`
                : `⏱ ${botName}'s turn never started, so Zetta restarted it.`,
          );
        } else {
          await tx
            .update(discussionTurn)
            .set({ status: "failed", reasonCode: "stuck", finishedAt: new Date() })
            .where(eq(discussionTurn.id, t.id));
          await line(
            "turn_stuck",
            `⚠️ ${botName} got stuck again, so Zetta stopped its turn. Mention ${botName} in a post to try again.`,
          );
        }
        return { outcome: again ? ("failed" as const) : ("requeued" as const), turn: t, d };
      });
      if (!settled) return undefined;
      if (settled.outcome === "requeued") onEnqueue?.();
      else
        await raiseAttention(db, settled.d.ownerUserId, {
          title: `${botName} got stuck in "${settled.d.title}"`,
          detail: "Its turn was restarted once and stopped responding again.",
          nextAction: "Open the room and post a nudge mentioning the bot, or resolve it.",
          resultLink: `/rooms?id=${settled.d.id}`,
          source: "bot",
          botId: settled.turn.botId,
          sourceKey: `discussion:${settled.d.id}:stuck:${settled.turn.botId}`,
        }).catch(() => {});
      return settled;
    },
    /**
     * Approved brief: approved once for this bot in this room. Every turn of the bot that waited behind the card runs, and the gate is
     * lifted for the room (the owner can turn it back on with the member toggle).
     */
    async approveBrief(a: ActiveActor, patch: Record<string, unknown>) {
      const d = await loadOwned(a, String(patch.discussionId));
      const botId = String(patch.botId);
      const queued = await transaction(db, async (tx) => {
        const rows = await tx
          .update(discussionTurn)
          .set({ status: "queued", approvedContextVersion: d.contextVersion })
          .where(
            and(
              eq(discussionTurn.discussionId, d.id),
              eq(discussionTurn.botId, botId),
              eq(discussionTurn.status, "awaiting_approval"),
            ),
          )
          .returning();
        if (!rows.length) return rows;
        await tx
          .update(discussionMember)
          .set({ requireApproval: false })
          .where(and(eq(discussionMember.discussionId, d.id), eq(discussionMember.botId, botId)));
        return rows;
      });
      if (!queued.length) throw new AccessError("NOT_FOUND");
      onEnqueue?.();
      return queued.find((t) => t.id === String(patch.turnId)) ?? queued[0]!;
    },
    async declineBrief(a: ActiveActor, patch: Record<string, unknown>) {
      const d = await loadOwned(a, String(patch.discussionId));
      const [t] = await db
        .update(discussionTurn)
        .set({ status: "skipped", reasonCode: "declined", finishedAt: new Date() })
        .where(
          and(
            eq(discussionTurn.discussionId, d.id),
            eq(discussionTurn.botId, String(patch.botId)),
            eq(discussionTurn.status, "awaiting_approval"),
          ),
        )
        .returning();
      if (t)
        await insertMessage(db, d.conversationId, {
          ownerUserId: d.ownerUserId,
          role: "system",
          content: "🚫 The user declined to let that bot act on this brief.",
          meta: { discussionEvent: "declined" },
        });
    },
    /**
     * Boot: turns that were running go back to the queue and run again, with no card. A turn that already started `MAX_RESTART_ATTEMPTS`
     * times is interrupted instead (a crash loop), and its room stalls with a card so the owner decides.
     */
    async recover(scope?: RecoveryScope) {
      const dead = recoverable(discussionTurn.ownerInstance, scope);
      const requeued = await db
        .update(discussionTurn)
        .set({ status: "queued", reasonCode: null, claimedAt: null, ownerInstance: null })
        .where(
          and(
            eq(discussionTurn.status, "running"),
            lt(discussionTurn.attempts, MAX_RESTART_ATTEMPTS),
            dead,
          ),
        )
        .returning({ id: discussionTurn.id });
      if (requeued.length) onEnqueue?.();
      const rows = await db
        .update(discussionTurn)
        .set({ status: "interrupted", reasonCode: "restart", finishedAt: new Date() })
        .where(and(eq(discussionTurn.status, "running"), dead))
        .returning();
      for (const id of new Set(rows.map((r) => r.discussionId))) {
        const [d] = await db
          .update(discussion)
          .set({ status: "stalled", updatedAt: new Date() })
          .where(and(eq(discussion.id, id), eq(discussion.status, "open")))
          .returning();
        if (d)
          await raiseAttention(db, d.ownerUserId, {
            title: `Room "${d.title}" was interrupted`,
            detail: "The server restarted while a bot was working on it.",
            nextAction: "Check what was done, then resume or cancel it.",
            resultLink: `/rooms?id=${d.id}`,
            source: "bot",
            sourceKey: `discussion:${d.id}:interrupted`,
          }).catch(() => {});
      }
      return requeued.length + rows.length;
    },
    /** The owner opened the room: its "is waiting" card is closed, and `sweepIdle` leaves the room alone for one idle period. */
    async markSeen(a: ActiveActor, id: string) {
      const d = await loadOwned(a, id);
      await closeAttentionKey(db, d.ownerUserId, `discussion:${d.id}:idle`, "resolved");
    },
    /**
     * Open discussions with nothing queued: one card after 30 minutes, stalled after a day.
     * A room with an active routine made in it is skipped: its work runs in the routine's chat.
     * A room whose idle card was closed in the last 30 minutes is skipped, so a visit (or Resolve/Dismiss on the card) is not undone by the next sweep.
     */
    async sweepIdle(now = new Date()) {
      const idleFor = new Date(now.getTime() - 30 * 60_000);
      const idle = await db
        .select()
        .from(discussion)
        .where(
          and(
            eq(discussion.status, "open"),
            lt(discussion.updatedAt, idleFor),
            sql`not exists (select 1 from discussion_turn t where t.discussion_id = ${discussion.id} and t.status in ('queued', 'running', 'awaiting_approval'))`,
            sql`not exists (select 1 from routine r where r.origin_discussion_id = ${discussion.id} and r.archived = false and r.status not in ('paused', 'completed'))`,
            sql`not exists (select 1 from attention_item a where a.owner_user_id = ${discussion.ownerUserId} and a.source_key = 'discussion:' || ${discussion.id}::text || ':idle' and a.status in ('resolved', 'cancelled') and a.updated_at > ${idleFor})`,
          ),
        )
        .limit(50);
      for (const d of idle) {
        if (d.updatedAt.getTime() < now.getTime() - 24 * 3600_000)
          await db
            .update(discussion)
            .set({ status: "stalled", updatedAt: now })
            .where(eq(discussion.id, d.id));
        await raiseAttention(db, d.ownerUserId, {
          title: `Room "${d.title}" is waiting`,
          detail: "No bot is working on it and it is not resolved.",
          nextAction: "Post a nudge mentioning a bot, or resolve or cancel it.",
          resultLink: `/rooms?id=${d.id}`,
          source: "bot",
          sourceKey: `discussion:${d.id}:idle`,
        }).catch(() => {});
      }
      return idle.length;
    },
    /** Drops the step trace of turns that ended over 30 days ago. The turn and its message stay. */
    async purgeSteps(now = new Date()) {
      await db.delete(turnStep).where(
        and(
          lt(turnStep.updatedAt, new Date(now.getTime() - 30 * 86_400_000)),
          inArray(
            turnStep.discussionTurnId,
            db
              .select({ id: discussionTurn.id })
              .from(discussionTurn)
              .where(
                inArray(discussionTurn.status, [
                  "done",
                  "failed",
                  "skipped",
                  "interrupted",
                  "cancelled",
                ]),
              ),
          ),
        ),
      );
    },
  };

  /** Tells the owner and the team readers of a room that it changed (a bot turn moved, a message, the status). */
  async function roomChanged(id: string) {
    const [d] = await db
      .select({ owner: discussion.ownerUserId, teamId: discussion.teamId })
      .from(discussion)
      .where(eq(discussion.id, id));
    if (!d) return;
    const readers = d.teamId ? (await people.list(d.teamId)).map((p) => p.userId) : [];
    events.publish(
      [d.owner, ...readers],
      topics.discussion(id),
      topics.rooms,
      topics.conversations,
      topics.botStatus,
    );
  }
  type Method = (...args: never[]) => Promise<unknown>;
  const after = (name: string, notify: (args: unknown[], result: unknown) => unknown) => {
    const holder = store as unknown as Record<string, Method>;
    const original = holder[name]!;
    holder[name] = async function (this: unknown, ...args: never[]) {
      const result = await original.apply(this, args);
      try {
        await notify(args, result);
      } catch {
        /* the page falls back to its slow poll */
      }
      return result;
    };
  };
  // Methods that take the room id as their second argument, after the actor.
  for (const name of [
    "postAsBot",
    "wakeBot",
    "postAsOwner",
    "updateContext",
    "updateContextAsBot",
    "resolve",
    "resolveAsBot",
    "setStatus",
    "silence",
    "stopGoals",
    "remove",
    "startLoop",
    "setRequireApproval",
  ])
    after(name, (args) => roomChanged(String(args[1])));
  after("afterReply", (args) => roomChanged((args[0] as Discussion).id));
  after("claimNext", (_args, claimed) => {
    if (claimed) return roomChanged((claimed as Claimed).discussion.id);
  });
  after("finishTurn", (_args, turn) => {
    if (turn) return roomChanged((turn as DiscussionTurn).discussionId);
  });
  after("settleStuck", (_args, settled) => {
    if (settled) return roomChanged((settled as { turn: DiscussionTurn }).turn.discussionId);
  });
  for (const name of ["approveBrief", "declineBrief"])
    after(name, (_args, turn) => roomChanged((turn as DiscussionTurn).discussionId));
  // A room opened or requested: the lists change for the actor.
  for (const name of ["open", "request", "openFromProposal", "redirectMention"])
    after(name, (args) =>
      events.publish([(args[0] as ActiveActor).userId], topics.rooms, topics.conversations),
    );
  return store;
}
export type DiscussionStore = ReturnType<typeof createDiscussionStore>;
