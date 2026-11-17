import { botRole } from "@zetta/core/bot-role";
import { and, asc, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";

import type { BotInput } from "../service";
import {
  changedFields,
  createBotQuality,
  restorePatch,
  snapshotOfBot,
} from "../../bot-quality/service";
import { pick, sameValue, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

type Row = typeof bot.$inferSelect;
export const owned = (ctx: ChiefCtx): Promise<Row[]> =>
  ctx.deps.db
    .select()
    .from(bot)
    .where(and(eq(bot.ownerUserId, ctx.actor.userId), eq(bot.archived, false)))
    .orderBy(asc(bot.createdAt));

const summary = (b: Row) => ({
  id: b.id,
  name: b.name,
  kind: b.kind,
  harness: b.harness,
  model: b.model,
  visibility: b.visibility,
  computerMode: b.computerMode,
  codeAccess: b.codeAccess,
  outputStyle: b.outputStyle,
  folderId: b.folderId,
  version: b.version,
});

const FIELDS = [
  "name",
  "description",
  "role",
  "personality",
  "instructions",
  "harness",
  "model",
  "outputStyle",
  "outputStyleId",
  "visibility",
  "computerMode",
  "codeAccess",
  "commitIdentity",
  "commitEmail",
  "requiredConnections",
  "contextBytes",
  "summaryMode",
  "summaryMaxChars",
  "summaryGapBytes",
  "chatSearchLimit",
] as const;

export async function runBot(ctx: ChiefCtx, a: ChiefArgs<"bot">): Promise<Outcome> {
  const bots = await owned(ctx);
  if (a.action === "list")
    return {
      read: `bot.list:\n${JSON.stringify(bots.map((b) => ({ ...summary(b), role: botRole(b), description: b.description.slice(0, 200) })))}`,
    };
  if (a.action === "get") {
    const r = pick(bots, a.bot, (b) => b.name, "bot");
    if ("error" in r) return r;
    const b = r.hit;
    return {
      read: `bot.get:\n${JSON.stringify({ ...summary(b), role: b.role, shownAs: botRole(b), description: b.description, personality: b.personality, instructions: b.instructions, commitIdentity: b.commitIdentity, commitEmail: b.commitEmail, requiredConnections: b.requiredConnections, contextBytes: b.contextBytes, summaryMode: b.summaryMode, summaryMaxChars: b.summaryMaxChars, summaryGapBytes: b.summaryGapBytes, chatSearchLimit: b.chatSearchLimit })}`,
    };
  }
  const r = pick(bots, a.bot, (b) => b.name, "bot");
  if ("error" in r) return r;
  const target = r.hit;
  if (a.action === "stats" || a.action === "history" || a.action === "restore") {
    // Reads and the restore card need only the database and `updateBot`; the saved-test runner (which needs the chat) is not used here.
    const quality = createBotQuality(ctx.deps.db, { chat: ctx.deps.chat as never });
    if (a.action === "stats") {
      const {
        series: _series,
        days: _days,
        ...volume
      } = await quality.activity(ctx.actor, target.id);
      return {
        read: `bot.stats:\n${JSON.stringify({ ...(await quality.stats(ctx.actor, target.id, a.days ?? 7)), activity30Days: volume })}`,
      };
    }
    if (a.action === "history") {
      const h = await quality.revisions(ctx.actor, target.id);
      return {
        read: `bot.history:\n${JSON.stringify(
          h.revisions.map((v) => ({
            version: v.version,
            current: v.current,
            at: v.createdAt,
            changed: v.changed,
          })),
        )}`,
      };
    }
    const h = await quality.revisions(ctx.actor, target.id);
    const old = h.revisions.find((v) => v.version === a.version);
    if (!old) return { error: `${target.name} has no saved version ${a.version}.` };
    if (old.current) return { error: `version ${a.version} is what ${target.name} has now.` };
    const changes = restorePatch(old.config);
    const fields = changedFields(snapshotOfBot(target), changes);
    if (!fields.length) return { error: `version ${a.version} would change nothing.` };
    return {
      plan: {
        title: `Bring back version ${a.version} of ${target.name}`,
        diff: fields.map((f): DiffLine => ({
          field: f,
          from: short((snapshotOfBot(target) as Record<string, unknown>)[f]),
          to: short((changes as Record<string, unknown>)[f]),
        })),
        patch: {
          tool: "bot",
          op: "update",
          botId: target.id,
          expectedVersion: target.version,
          changes,
        },
      },
    };
  }
  if (a.action === "archive") {
    if (target.kind === "chief") return { error: "the chief cannot be archived." };
    return {
      plan: {
        title: `Archive ${target.name}`,
        diff: [{ field: "archive", from: target.name, to: "archived" }],
        patch: { tool: "bot", op: "archive", botId: target.id },
      },
    };
  }
  if (a.action === "move") {
    const spaces = await ctx.deps.chat.listFolders(ctx.actor);
    let to: { id: string; name: string } | null = null;
    if (a.folder !== null) {
      const w = pick(spaces, a.folder, (x) => x.name, "folder");
      if ("error" in w) return w;
      to = w.hit;
    }
    if ((target.folderId ?? null) === (to?.id ?? null))
      return { error: `${target.name} is already there.` };
    const from = spaces.find((s) => s.id === target.folderId)?.name ?? null;
    return {
      plan: {
        title: `Move ${target.name}`,
        diff: [
          { field: "bot", from: null, to: target.name },
          { field: "folder", from, to: to?.name ?? null },
        ],
        patch: { tool: "bot", op: "move", botId: target.id, folderId: to?.id ?? null },
      },
    };
  }
  const { action: _a, bot: _b, ...fields } = a;
  if (target.kind === "chief" && fields.visibility === "team")
    return { error: "the chief is always private." };
  const changes: Record<string, unknown> = {};
  const diff: DiffLine[] = [{ field: "bot", from: null, to: target.name }];
  for (const k of FIELDS) {
    const to = (fields as Record<string, unknown>)[k];
    if (to === undefined || sameValue(to, target[k])) continue;
    changes[k] = to;
    diff.push({ field: k, from: short(target[k]), to: short(to) });
  }
  if (!Object.keys(changes).length)
    return { error: `${target.name} already has those settings; nothing to change.` };
  return {
    plan: {
      title: `Change ${target.name}`,
      diff,
      patch: {
        tool: "bot",
        op: "update",
        botId: target.id,
        changes,
        expectedVersion: target.version,
      },
      baseVersion: target.version,
    },
  };
}

type BotPatch = {
  op: "update" | "move" | "archive";
  botId: string;
  changes?: Partial<BotInput>;
  expectedVersion?: number;
  folderId?: string | null;
  /** The key of a card stored before the rename; it must still apply. */
  workspaceId?: string | null;
};
export async function applyBot(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const v = p as unknown as BotPatch;
  const { chat } = ctx.deps;
  // A stale version makes updateBot throw NOT_FOUND, which marks the proposal stale like a form that lost a race.
  if (v.op === "update") await chat.updateBot(ctx.actor, v.botId, v.expectedVersion!, v.changes!);
  else if (v.op === "move")
    await chat.moveBot(ctx.actor, v.botId, v.folderId ?? v.workspaceId ?? null);
  else await chat.archiveBot(ctx.actor, v.botId);
}
