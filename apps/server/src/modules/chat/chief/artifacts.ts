import { pick } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

export async function runArtifacts(ctx: ChiefCtx, a: ChiefArgs<"artifacts">): Promise<Outcome> {
  const { artifacts } = ctx.deps;
  if (!artifacts) return { error: "artifacts are not available on this server." };
  const rows = await artifacts.list(ctx.actor);
  if (a.action === "list")
    return {
      read: `artifacts.list:\n${JSON.stringify(rows.slice(0, 50).map((r) => ({ id: r.id, title: r.title, kind: r.kind, pinned: r.pinnedAt !== null, size: r.size })))}`,
    };
  const r = pick(rows, a.artifact, (x) => x.title, "artifact");
  if ("error" in r) return r;
  const t = r.hit;
  if (a.action === "remove")
    return {
      plan: {
        title: `Delete artifact ${t.title}`,
        diff: [{ field: "delete artifact", from: t.title, to: "deleted for good" }],
        patch: { tool: "artifacts", op: "remove", id: t.id },
      },
    };
  const pin = a.action === "pin";
  if ((t.pinnedAt !== null) === pin)
    return { error: `"${t.title}" is already ${pin ? "pinned" : "not pinned"}.` };
  return {
    plan: {
      title: `${pin ? "Pin" : "Unpin"} artifact ${t.title}`,
      diff: [
        { field: "pinned", from: !pin ? "yes" : "no", to: pin ? "yes" : "no" },
        { field: "artifact", from: null, to: t.title },
      ],
      patch: { tool: "artifacts", op: "pin", id: t.id, pinned: pin },
    },
  };
}

export async function applyArtifacts(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { artifacts } = ctx.deps;
  if (!artifacts) throw new Error("artifacts unavailable");
  const v = p as { op: string; id: string; pinned: boolean };
  if (v.op === "remove") await artifacts.remove(ctx.actor, v.id);
  else await artifacts.setPinned(ctx.actor, v.id, v.pinned);
}
