import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

const KIND_TEXT = {
  add_context: "adds text to what the bot reads",
  redact: "hides text matching a pattern",
  stop: "stops a message matching a pattern",
  background: "queues a background task",
} as const;

/** Hooks run on every message of a bot (add context, redact, stop, background), so adding or changing one is a card. */
export async function runHook(ctx: ChiefCtx, a: ChiefArgs<"hook">): Promise<Outcome> {
  const features = ctx.deps.features;
  if (!features) return { error: "hooks are not available on this server." };
  const b = pick(await owned(ctx), a.bot, (x) => x.name, "bot");
  if ("error" in b) return b;
  const hooks = await features.listHooks(ctx.actor, b.hit.id);
  if (a.action === "list")
    return {
      read: `hook.list ${b.hit.name}:\n${JSON.stringify(hooks.map((h) => ({ id: h.id, kind: h.kind, pattern: h.pattern, value: h.value, enabled: h.enabled, position: h.position })))}\nKinds: ${Object.entries(
        KIND_TEXT,
      )
        .map(([k, v]) => `${k} ${v}`)
        .join("; ")}.`,
    };
  if (a.action === "dry_run") {
    const r = await features.dryRunHooks(ctx.actor, b.hit.id, a.text);
    return { read: `hook.dry_run ${b.hit.name}:\n${JSON.stringify(r)}` };
  }
  const who = { field: "bot", from: null as unknown, to: b.hit.name as unknown };
  if (a.action === "add")
    return plan(
      `Add a hook to ${b.hit.name}`,
      [
        who,
        { field: "kind", from: null, to: `${a.kind}: ${KIND_TEXT[a.kind]}` },
        ...(a.pattern ? [{ field: "pattern", from: null, to: a.pattern }] : []),
        ...(a.value ? [{ field: "value", from: null, to: a.value }] : []),
      ],
      {
        tool: "hook",
        op: "add",
        botId: b.hit.id,
        fields: { kind: a.kind, pattern: a.pattern, value: a.value },
      },
    );
  const h = hooks.find((x) => x.id === a.hook);
  if (!h) return { error: `${b.hit.name} has no hook with that id. Use hook list.` };
  if (a.action === "remove")
    return plan(
      `Remove a hook from ${b.hit.name}`,
      [
        who,
        {
          field: "remove hook",
          from: `${h.kind} ${h.pattern || h.value}`.slice(0, 200),
          to: "removed",
        },
      ],
      { tool: "hook", op: "remove", id: h.id },
    );
  const changes: Record<string, unknown> = {};
  const diff: DiffLine[] = [who];
  for (const k of ["pattern", "value", "enabled", "position"] as const)
    if (a[k] !== undefined && a[k] !== h[k]) {
      changes[k] = a[k];
      diff.push({ field: k, from: h[k], to: a[k] });
    }
  if (diff.length === 1) return { error: "that hook already has those values." };
  return plan(`Change a hook of ${b.hit.name}`, diff, {
    tool: "hook",
    op: "update",
    id: h.id,
    changes,
  });
}

export async function applyHook(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const features = ctx.deps.features;
  if (!features) throw new Error("hooks unavailable");
  const v = p as {
    op: string;
    id: string;
    botId: string;
    fields: Parameters<typeof features.addHook>[2];
    changes: Parameters<typeof features.updateHook>[2];
  };
  if (v.op === "add") await features.addHook(ctx.actor, v.botId, v.fields);
  else if (v.op === "remove") await features.deleteHook(ctx.actor, v.id);
  else await features.updateHook(ctx.actor, v.id, v.changes);
}
