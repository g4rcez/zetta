import { createHash } from "node:crypto";
import type { Database } from "@zetta/db";
import { and, asc, desc, eq, inArray, isNull } from "@zetta/db/query";
import { bot, conversation, message } from "@zetta/db/schema/chat";
import { attachment, reaction, snapshot } from "@zetta/db/schema/features";
import { AccessError, type ActiveActor } from "../identity/access";
import { parseTools } from "../chat/tools";

export class SnapshotError extends Error { constructor(readonly code: "EMPTY" | "UNSAFE" | "PREVIEW_MISMATCH" | "BUSY", readonly detail?: string) { super(code); } }
const first = <T>(rows: T[]): T => { if (!rows[0]) throw new AccessError("NOT_FOUND"); return rows[0]; };

export type SnapshotPart = { seq: number; role: string; author?: string; content: string; thread?: number; attachments?: string[]; reactions?: Record<string, number> };
const SECRETISH = /(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,})/;

/**
 * Builds the safe, team-readable representation of a conversation at a cutoff: text only. Tool fences are stripped, attachments are
 * listed by name (their content is NOT copied), file/browse source text embedded by the prompt is not part of stored messages, reaction
 * counts and thread links are kept, failed/running messages are omitted. If any message still looks like it contains a credential,
 * publication is blocked with a clear reason instead of silently omitting it.
 */
export function createSnapshots(db: Database) {
  async function build(a: ActiveActor, conversationId: string, cutoffSeq?: number) {
    const [c] = await db.select().from(conversation).where(and(eq(conversation.id, conversationId), eq(conversation.ownerUserId, a.userId)));
    const conv = first(c ? [c] : []);
    const [b] = await db.select().from(bot).where(eq(bot.id, conv.botId));
    const rows = (await db.select().from(message).where(eq(message.conversationId, conv.id)).orderBy(asc(message.seq)))
      .filter((m) => (cutoffSeq === undefined || m.seq <= cutoffSeq) && (m.status === "complete") && m.role !== "system");
    if (rows.length === 0) throw new SnapshotError("EMPTY");
    const used = rows.find((m) => m.role === "user" && ((m.meta as { fileRefs?: string[]; browse?: boolean } | null)?.fileRefs?.length || (m.meta as { browse?: boolean } | null)?.browse));
    if (used) throw new SnapshotError("UNSAFE", `Message ${used.seq} used a server file or a web page. Their content cannot be republished; publish a chat without them.`);
    const ids = rows.map((m) => m.id);
    const atts = await db.select({ name: attachment.name, messageId: attachment.messageId, content: attachment.content }).from(attachment).where(and(eq(attachment.ownerUserId, a.userId), inArray(attachment.messageId, ids)));
    const reacts = await db.select({ messageId: reaction.messageId, emoji: reaction.emoji }).from(reaction).where(inArray(reaction.messageId, ids));
    const bySeq = new Map(rows.map((m) => [m.id, m.seq]));
    const botNames = new Map((await db.select({ id: bot.id, name: bot.name }).from(bot)).map((x) => [x.id, x.name]));
    // Bots may quote attachments in their answers: every line of an attachment (8+ chars) is removed from the published text.
    const attachmentLines = atts.flatMap((x) => x.content.split("\n").map((l) => l.trim()).filter((l) => l.length >= 8));
    const scrub = (t: string) => attachmentLines.reduce((acc, l) => acc.split(l).join("[attachment content omitted]"), t);
    const parts: SnapshotPart[] = rows.map((m) => {
      const cleaned = scrub(parseTools(m.content).text);
      const counts: Record<string, number> = {};
      for (const r of reacts.filter((x) => x.messageId === m.id)) counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
      return { seq: m.seq, role: m.role, ...(m.role === "assistant" ? { author: botNames.get(m.botId ?? "") ?? b?.name ?? "Bot" } : {}), content: cleaned,
        ...(m.parentMessageId && bySeq.has(m.parentMessageId) ? { thread: bySeq.get(m.parentMessageId)! } : {}),
        ...(atts.some((x) => x.messageId === m.id) ? { attachments: atts.filter((x) => x.messageId === m.id).map((x) => x.name) } : {}), ...(Object.keys(counts).length ? { reactions: counts } : {}) };
    });
    const bad = parts.find((p) => SECRETISH.test(p.content));
    if (bad) throw new SnapshotError("UNSAFE", `Message ${bad.seq} looks like it contains a credential. Remove it from the chat or publish a different chat.`);
    const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    return { conv, botName: b?.name ?? "Bot", parts, hash, cutoffSeq: rows.at(-1)!.seq };
  }
  return {
    /** What would be published, with a hash the confirmation must echo (publication shows exactly this). */
    async preview(a: ActiveActor, conversationId: string) { const s = await build(a, conversationId); return { title: s.conv.title, botName: s.botName, parts: s.parts, previewHash: s.hash, cutoffSeq: s.cutoffSeq }; },
    /** Publishes the previewed content. The hash proves the person confirmed what is stored; later messages are never included. */
    async publish(a: ActiveActor, v: { conversationId: string; previewHash: string; requestKey?: string }) {
      if (v.requestKey) { const [prior] = await db.select().from(snapshot).where(and(eq(snapshot.ownerUserId, a.userId), eq(snapshot.requestKey, v.requestKey))); if (prior) return prior; }
      const s = await build(a, v.conversationId);
      if (s.hash !== v.previewHash) throw new SnapshotError("PREVIEW_MISMATCH");
      const [row] = await db.insert(snapshot).values({ ownerUserId: a.userId, title: s.conv.title, botName: s.botName, content: s.parts, contentHash: s.hash, requestKey: v.requestKey ?? null, sourceConversationId: s.conv.id }).onConflictDoNothing().returning();
      if (!row) return first(await db.select().from(snapshot).where(and(eq(snapshot.ownerUserId, a.userId), eq(snapshot.requestKey, v.requestKey!))));
      return row;
    },
    /** Team list: every active member sees published snapshots (not revoked) with owner and time; never the source conversation. */
    list: () => db.select({ id: snapshot.id, title: snapshot.title, botName: snapshot.botName, createdAt: snapshot.createdAt, ownerUserId: snapshot.ownerUserId }).from(snapshot).where(isNull(snapshot.revokedAt)).orderBy(desc(snapshot.createdAt)).limit(100),
    /** A revoked snapshot answers as unavailable (404) to everyone but its owner, who sees the revoked state. */
    async get(viewerId: string, id: string) {
      const [row] = await db.select().from(snapshot).where(eq(snapshot.id, id));
      if (!row || (row.revokedAt && row.ownerUserId !== viewerId)) throw new AccessError("NOT_FOUND");
      return { id: row.id, title: row.title, botName: row.botName, content: row.content, ownerUserId: row.ownerUserId, createdAt: row.createdAt, revokedAt: row.revokedAt };
    },
    async revoke(a: ActiveActor, id: string) { return first(await db.update(snapshot).set({ revokedAt: new Date() }).where(and(eq(snapshot.id, id), eq(snapshot.ownerUserId, a.userId))).returning({ id: snapshot.id, revokedAt: snapshot.revokedAt })); },
  };
}
export type Snapshots = ReturnType<typeof createSnapshots>;
