import { untrustedDoc } from "../../integrations/plugins/untrusted";
import { owned } from "./bot";
import { pick, plan, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** The user's own skill library. Installing from the GitHub marketplace stays with zetta:skills (it has its own card). */
export async function runSkillLibrary(
  ctx: ChiefCtx,
  a: ChiefArgs<"skill_library">,
): Promise<Outcome> {
  const lib = ctx.deps.skills;
  if (!lib) return { error: "the skill library is not available on this server." };
  const rows = await lib.list(ctx.actor);
  if (a.action === "list") {
    const names = new Map((await owned(ctx)).map((b) => [b.id, b.name]));
    return {
      read: `skill_library.list:\n${JSON.stringify(rows.map((s) => ({ id: s.id, name: s.name, description: s.description, version: s.version, bots: s.botIds.flatMap((id) => names.get(id) ?? []) })))}`,
    };
  }
  if (a.action === "create") {
    if (rows.some((s) => s.name === a.name))
      return { error: `a skill called "${a.name}" already exists.` };
    return plan(
      `New skill ${a.name}`,
      [
        { field: "name", from: null, to: a.name },
        { field: "description", from: null, to: a.description },
        { field: "body", from: null, to: short(a.body) },
      ],
      {
        tool: "skill_library",
        op: "create",
        fields: { name: a.name, description: a.description, body: a.body },
      },
    );
  }
  if (a.action === "restore") {
    const gone = await lib.list(ctx.actor, "mine", { status: "archived" });
    const g = pick(gone, a.skill, (x) => x.name, "deleted skill");
    if ("error" in g) return g;
    if (rows.some((x) => x.name === g.hit.name))
      return { error: `a skill called "${g.hit.name}" exists now. Rename one of them first.` };
    return plan(
      `Bring back skill ${g.hit.name}`,
      [{ field: "restore skill", from: "deleted", to: g.hit.name }],
      { tool: "skill_library", op: "restore", id: g.hit.id },
    );
  }
  const s = pick(rows, a.skill, (x) => x.name, "skill");
  if ("error" in s) return s;
  if (a.action === "read") {
    const full = await lib.get(ctx.actor, s.hit.id);
    return {
      read: untrustedDoc(
        "skill library",
        { name: full.name, description: full.description },
        full.body,
      ),
    };
  }
  if (a.action === "archive")
    return plan(
      `Delete skill ${s.hit.name}`,
      [{ field: "delete skill", from: s.hit.name, to: "deleted; bots stop loading it" }],
      { tool: "skill_library", op: "archive", id: s.hit.id },
    );
  if (a.action === "attach" || a.action === "detach") {
    const mine = await owned(ctx);
    const picked: { id: string; name: string }[] = [];
    for (const q of a.bots) {
      const b = pick(mine, q, (x) => x.name, "bot");
      if ("error" in b) return b;
      picked.push(b.hit);
    }
    const names = picked.map((b) => b.name).join(", ");
    return plan(
      a.action === "attach"
        ? `Give skill ${s.hit.name} to ${names}`
        : `Take skill ${s.hit.name} from ${names}`,
      [
        { field: "skill", from: null, to: s.hit.name },
        { field: "bots", from: null, to: names },
      ],
      { tool: "skill_library", op: a.action, id: s.hit.id, botIds: picked.map((b) => b.id) },
    );
  }
  const changes: Record<string, string> = {};
  const diff = [{ field: "skill", from: null as unknown, to: s.hit.name as unknown }];
  if (a.name !== undefined && a.name !== s.hit.name) {
    if (rows.some((x) => x.name === a.name))
      return { error: `a skill called "${a.name}" already exists.` };
    changes.name = a.name;
    diff.push({ field: "name", from: s.hit.name, to: a.name });
  }
  // The list leaves the body out, so a new body always counts as a change.
  if (a.description !== undefined && a.description !== s.hit.description) {
    changes.description = a.description;
    diff.push({ field: "description", from: short(s.hit.description), to: short(a.description) });
  }
  if (a.body !== undefined) {
    changes.body = a.body;
    diff.push({ field: "body", from: null, to: short(a.body) });
  }
  if (diff.length === 1) return { error: `"${s.hit.name}" already says that.` };
  return plan(
    `Change skill ${s.hit.name}`,
    diff,
    { tool: "skill_library", op: "update", id: s.hit.id, changes, expectedVersion: s.hit.version },
    s.hit.version,
  );
}

export async function applySkillLibrary(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const lib = ctx.deps.skills;
  if (!lib) throw new Error("skills unavailable");
  const v = p as {
    op: string;
    id: string;
    botIds: string[];
    fields: Parameters<typeof lib.create>[1];
    changes: Parameters<typeof lib.update>[3];
    expectedVersion: number;
  };
  if (v.op === "create") await lib.create(ctx.actor, v.fields);
  else if (v.op === "archive") await lib.archive(ctx.actor, v.id);
  else if (v.op === "attach") await lib.addBots(ctx.actor, v.id, v.botIds);
  else if (v.op === "detach")
    await lib.bulk(ctx.actor, { action: "detach", skillIds: [v.id], botIds: v.botIds });
  else if (v.op === "restore") await lib.restore(ctx.actor, v.id);
  else await lib.update(ctx.actor, v.id, v.expectedVersion, v.changes);
}
