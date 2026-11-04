import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

export async function runPreferences(ctx: ChiefCtx, a: ChiefArgs<"preferences">): Promise<Outcome> {
  const store = ctx.deps.preferences;
  if (!store) return { error: "preferences are not available on this server." };
  const cur = await store.get(ctx.actor);
  if (a.action === "get") return { read: `preferences.get:\n${JSON.stringify(cur)}` };
  const patch: Record<string, unknown> = {};
  const diff: DiffLine[] = [];
  for (const k of ["timeFormat", "railMode"] as const)
    if (a[k] !== undefined && a[k] !== cur[k]) {
      patch[k] = a[k];
      diff.push({ field: k, from: cur[k], to: a[k] });
    }
  if (a.botOrder) {
    const bots = await owned(ctx);
    const ids: string[] = [];
    for (const q of a.botOrder) {
      const b = pick(bots, q, (x) => x.name, "bot");
      if ("error" in b) return b;
      ids.push(b.hit.id);
    }
    if (JSON.stringify(ids) !== JSON.stringify(cur.botOrder)) {
      patch.botOrder = ids;
      diff.push({ field: "botOrder", from: null, to: a.botOrder.join(", ") });
    }
  }
  if (!diff.length) return { error: "those preferences are already set." };
  return plan("Change your preferences", diff, { tool: "preferences", op: "update", patch });
}
export async function applyPreferences(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  if (!ctx.deps.preferences) throw new Error("preferences unavailable");
  await ctx.deps.preferences.update(ctx.actor, (p as { patch: never }).patch);
}

export async function runConversation(
  ctx: ChiefCtx,
  a: ChiefArgs<"conversation">,
): Promise<Outcome> {
  const { chat } = ctx.deps;
  const bots = await owned(ctx);
  if (a.action === "start" || (a.action === "list" && a.bot)) {
    const b = pick(bots, a.bot!, (x) => x.name, "bot");
    if ("error" in b) return b;
    if (a.action === "start")
      return plan(
        `Start a new chat with ${b.hit.name}`,
        [{ field: "bot", from: null, to: b.hit.name }],
        { tool: "conversation", op: "start", botId: b.hit.id },
      );
  }
  const botId = a.action === "list" && a.bot ? pick(bots, a.bot, (x) => x.name, "bot") : undefined;
  if (botId && "error" in botId) return botId;
  const archived = a.action === "list" ? (a.archived ?? false) : a.action === "unarchive";
  const rows = await chat.listConversations(
    ctx.actor,
    botId && "hit" in botId ? botId.hit.id : undefined,
    "chat",
    archived,
  );
  if (a.action === "list")
    return {
      read: `conversation.list:\n${JSON.stringify(rows.slice(0, 50).map((r) => ({ id: r.id, title: r.title, bot: bots.find((b) => b.id === r.botId)?.name ?? r.botId, pinned: r.pinned, favorite: r.favorite })))}`,
    };
  const c = pick(rows, a.conversation, (x) => x.title, "chat");
  if ("error" in c) return c;
  const title = { field: "chat", from: null as unknown, to: c.hit.title as unknown };
  if (a.action === "remove")
    return plan(
      `Delete the chat ${c.hit.title}`,
      [{ field: "delete chat", from: c.hit.title, to: "deleted with all its messages" }],
      { tool: "conversation", op: "remove", id: c.hit.id },
    );
  if (a.action === "rename")
    return plan(
      `Rename the chat ${c.hit.title}`,
      [{ field: "title", from: c.hit.title, to: a.title }],
      { tool: "conversation", op: "patch", id: c.hit.id, patch: { title: a.title } },
    );
  const set = {
    pin: { pinned: true },
    unpin: { pinned: false },
    favorite: { favorite: true },
    unfavorite: { favorite: false },
    archive: { archived: true },
    unarchive: { archived: false },
  }[a.action];
  return plan(
    `${a.action[0]!.toUpperCase()}${a.action.slice(1)} the chat ${c.hit.title}`,
    [title, { field: "do", from: null, to: a.action }],
    { tool: "conversation", op: "patch", id: c.hit.id, patch: set },
  );
}
export async function applyConversation(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const { chat } = ctx.deps;
  const v = p as { op: string; id: string; botId: string; patch: never };
  if (v.op === "start") await chat.createConversation(ctx.actor, v.botId);
  else if (v.op === "remove") await chat.deleteConversation(ctx.actor, v.id);
  else await chat.updateConversation(ctx.actor, v.id, v.patch);
}

export async function runAttention(ctx: ChiefCtx, a: ChiefArgs<"attention">): Promise<Outcome> {
  const f = ctx.deps.features;
  if (!f) return { error: "attention items are not available on this server." };
  const rows = await f.listAttention(ctx.actor);
  if (a.action === "list")
    return {
      read: `attention.list:\n${JSON.stringify(rows.slice(0, 50).map((r) => ({ id: r.id, title: r.title, status: r.status })))}`,
    };
  const r = rows.find((x) => x.id === a.item);
  if (!r) return { error: "no attention item with that id. Use attention list." };
  return plan(
    `${a.action[0]!.toUpperCase()}${a.action.slice(1)} “${r.title}”`,
    [
      { field: "item", from: r.status, to: a.action },
      { field: "title", from: null, to: r.title },
    ],
    { tool: "attention", id: r.id, action: a.action },
  );
}
export async function applyAttention(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  if (!ctx.deps.features) throw new Error("attention unavailable");
  const v = p as { id: string; action: never };
  await ctx.deps.features.attentionAction(ctx.actor, v.id, v.action);
}
