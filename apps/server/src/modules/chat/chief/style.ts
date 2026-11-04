import { pick, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

export async function runStyle(ctx: ChiefCtx, a: ChiefArgs<"output_style">): Promise<Outcome> {
  const { outputStyles } = ctx.deps;
  if (!outputStyles) return { error: "output styles are not available on this server." };
  const uid = ctx.actor.userId;
  const { builtins, styles } = await outputStyles.list(uid);
  if (a.action === "list")
    return {
      read: `output_style.list:\n${JSON.stringify({ builtins: builtins.map((b) => b.key), styles: styles.map((s) => ({ id: s.id, name: s.name, description: s.description, scope: s.scope, mine: s.mine, version: s.version })) })}`,
    };
  if (a.action === "create")
    return {
      plan: {
        title: `New output style ${a.name}`,
        diff: [
          { field: "name", from: null, to: a.name },
          { field: "description", from: null, to: a.description },
          { field: "body", from: null, to: short(a.body) },
          { field: "scope", from: null, to: a.scope ?? "private" },
        ],
        patch: {
          tool: "output_style",
          op: "create",
          fields: {
            name: a.name,
            description: a.description,
            body: a.body,
            ...(a.scope ? { scope: a.scope } : {}),
          },
        },
      },
    };
  if (a.action === "import")
    return {
      plan: {
        title: "Import an output style",
        diff: [{ field: "style file", from: null, to: short(a.markdown) }],
        patch: { tool: "output_style", op: "import", markdown: a.markdown },
      },
    };
  const s = pick(
    a.action === "export" ? styles : styles.filter((x) => x.mine),
    a.style,
    (x) => x.name,
    "output style",
  );
  if ("error" in s) return s;
  if (a.action === "export") {
    const f = await outputStyles.exportStyle(uid, s.hit.id);
    return { read: `output_style.export ${f.filename}:\n${f.markdown}` };
  }
  if (a.action === "archive")
    return {
      plan: {
        title: `Delete output style ${s.hit.name}`,
        diff: [
          {
            field: "delete style",
            from: s.hit.name,
            to: "deleted; bots that use it keep writing that way until changed",
          },
        ],
        patch: { tool: "output_style", op: "archive", id: s.hit.id },
      },
    };
  const { action: _a, style: _s, ...fields } = a;
  const changes: Record<string, unknown> = {};
  const diff: DiffLine[] = [{ field: "style", from: null, to: s.hit.name }];
  for (const k of ["name", "description", "body", "scope"] as const) {
    const to = fields[k];
    if (to === undefined || to === s.hit[k]) continue;
    changes[k] = to;
    diff.push({ field: k, from: short(s.hit[k]), to: short(to) });
  }
  if (diff.length === 1) return { error: `"${s.hit.name}" already has those values.` };
  return {
    plan: {
      title: `Change output style ${s.hit.name}`,
      diff,
      patch: {
        tool: "output_style",
        op: "update",
        id: s.hit.id,
        changes,
        expectedVersion: s.hit.version,
      },
      baseVersion: s.hit.version,
    },
  };
}

export async function applyStyle(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { outputStyles } = ctx.deps;
  if (!outputStyles) throw new Error("output styles unavailable");
  const uid = ctx.actor.userId;
  const v = p as {
    op: string;
    id: string;
    fields: Parameters<typeof outputStyles.create>[1];
    markdown: string;
    changes: Parameters<typeof outputStyles.update>[3];
    expectedVersion: number;
  };
  if (v.op === "create") await outputStyles.create(uid, v.fields);
  else if (v.op === "import") await outputStyles.importMarkdown(uid, v.markdown);
  else if (v.op === "archive") await outputStyles.archive(uid, v.id);
  else await outputStyles.update(uid, v.id, v.expectedVersion, v.changes);
}
