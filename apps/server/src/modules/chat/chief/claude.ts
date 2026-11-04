import { owned } from "./bot";
import { pick, plan, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

/**
 * A Claude Code bot's own skills and sub-agents, and its effort and spending limit. What it may run (allow and deny rules) stays with
 * zetta:bot_claude, which has its own approval for permissions.
 */
export async function runClaude(ctx: ChiefCtx, a: ChiefArgs<"claude">): Promise<Outcome> {
  const store = ctx.deps.botClaude;
  if (!store) return { error: "Claude settings are not available on this server." };
  const b = pick(await owned(ctx), a.bot, (x) => x.name, "bot");
  if ("error" in b) return b;
  if (b.hit.harness !== "claude-code")
    return { error: `${b.hit.name} does not run on Claude Code, so these settings do nothing.` };
  const { config, assets } = await store.get(b.hit.id);
  const who = { field: "bot", from: null as unknown, to: b.hit.name as unknown };
  if (a.action === "list")
    return {
      read: `claude.list ${b.hit.name}:\n${JSON.stringify({ effort: config.effort, maxBudgetCents: config.maxBudgetCents, assets: assets.map((x) => ({ id: x.id, kind: x.kind, name: x.name, description: x.description, enabled: x.enabled })) })}`,
    };
  if (a.action === "limits") {
    const diff: DiffLine[] = [who];
    const next = { ...config };
    if (a.effort !== undefined && a.effort !== config.effort) {
      diff.push({ field: "effort", from: config.effort, to: a.effort });
      next.effort = a.effort;
    }
    if (a.maxBudgetCents !== undefined && a.maxBudgetCents !== config.maxBudgetCents) {
      diff.push({ field: "maxBudgetCents", from: config.maxBudgetCents, to: a.maxBudgetCents });
      next.maxBudgetCents = a.maxBudgetCents;
    }
    if (diff.length === 1) return { error: "those limits are already set." };
    return plan(`Change the limits of ${b.hit.name}`, diff, {
      tool: "claude",
      op: "limits",
      botId: b.hit.id,
      config: next,
    });
  }
  if (a.action === "add") {
    if (assets.some((x) => x.kind === a.kind && x.name === a.name))
      return { error: `${b.hit.name} already has a ${a.kind} called "${a.name}".` };
    return plan(
      `Add ${a.kind} ${a.name} to ${b.hit.name}`,
      [
        who,
        { field: "kind", from: null, to: a.kind },
        { field: "name", from: null, to: a.name },
        { field: "description", from: null, to: a.description },
        { field: "body", from: null, to: short(a.body) },
      ],
      {
        tool: "claude",
        op: "add",
        botId: b.hit.id,
        input: {
          kind: a.kind,
          name: a.name,
          description: a.description,
          body: a.body,
          tools: a.tools,
          model: a.model,
          enabled: true,
        },
      },
    );
  }
  const t = pick(assets, a.asset, (x) => x.name, "skill or agent");
  if ("error" in t) return t;
  if (a.action === "remove")
    return plan(
      `Remove ${t.hit.kind} ${t.hit.name} from ${b.hit.name}`,
      [who, { field: "remove", from: `${t.hit.kind} ${t.hit.name}`, to: "removed" }],
      { tool: "claude", op: "remove", botId: b.hit.id, id: t.hit.id },
    );
  const input = { ...t.hit } as Record<string, unknown>;
  const diff: DiffLine[] = [who, { field: t.hit.kind, from: null, to: t.hit.name }];
  for (const k of ["description", "body", "tools", "model", "enabled"] as const)
    if (a[k] !== undefined && JSON.stringify(a[k]) !== JSON.stringify(t.hit[k])) {
      input[k] = a[k];
      diff.push({ field: k, from: short(t.hit[k]), to: short(a[k]) });
    }
  if (diff.length === 2) return { error: "that asset already has those values." };
  return plan(`Change ${t.hit.kind} ${t.hit.name} of ${b.hit.name}`, diff, {
    tool: "claude",
    op: "update",
    botId: b.hit.id,
    id: t.hit.id,
    input: {
      kind: t.hit.kind,
      name: t.hit.name,
      description: input.description,
      body: input.body,
      tools: input.tools,
      model: input.model,
      enabled: input.enabled,
    },
  });
}

export async function applyClaude(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const store = ctx.deps.botClaude;
  if (!store) throw new Error("claude unavailable");
  const v = p as {
    op: string;
    botId: string;
    id: string;
    config: Parameters<typeof store.save>[1];
    input: Parameters<typeof store.addAsset>[1];
  };
  if (v.op === "limits") await store.save(v.botId, v.config);
  else if (v.op === "add") await store.addAsset(v.botId, v.input);
  else if (v.op === "remove") await store.removeAsset(v.botId, v.id);
  else await store.updateAsset(v.botId, v.id, v.input);
}
