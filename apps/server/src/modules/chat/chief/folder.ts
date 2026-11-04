import { pick } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

export async function runFolder(ctx: ChiefCtx, a: ChiefArgs<"folder">): Promise<Outcome> {
  const { chat } = ctx.deps;
  const spaces = await chat.listFolders(ctx.actor);
  if (a.action === "list")
    return {
      read: `folder.list:\n${JSON.stringify(spaces.map((s) => ({ id: s.id, name: s.name, parentId: s.parentId })))}`,
    };
  if (a.action === "create") {
    let parentId: string | null = null;
    if (a.parent) {
      const p = pick(spaces, a.parent, (s) => s.name, "folder");
      if ("error" in p) return p;
      parentId = p.hit.id;
    }
    return {
      plan: {
        title: `New folder ${a.name}`,
        diff: [
          { field: "name", from: null, to: a.name },
          ...(parentId ? [{ field: "inside", from: null, to: a.parent }] : []),
        ],
        patch: { tool: "folder", op: "create", name: a.name, parentId },
      },
    };
  }
  const w = pick(spaces, a.folder, (s) => s.name, "folder");
  if ("error" in w) return w;
  if (a.action === "rename")
    return {
      plan: {
        title: `Rename folder ${w.hit.name}`,
        diff: [{ field: "name", from: w.hit.name, to: a.name }],
        patch: { tool: "folder", op: "rename", id: w.hit.id, name: a.name },
      },
    };
  return {
    plan: {
      title: `Remove folder ${w.hit.name}`,
      // Only the group goes: its bots and inner groups move up one level.
      diff: [{ field: "remove folder", from: w.hit.name, to: "its bots move up one level" }],
      patch: { tool: "folder", op: "remove", id: w.hit.id },
    },
  };
}

export async function applyFolder(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { chat } = ctx.deps;
  const v = p as { op: string; id: string; name: string; parentId: string | null };
  if (v.op === "create") await chat.createFolder(ctx.actor, v.name, v.parentId ?? undefined);
  else if (v.op === "rename") await chat.renameFolder(ctx.actor, v.id, v.name);
  else await chat.deleteFolder(ctx.actor, v.id);
}
