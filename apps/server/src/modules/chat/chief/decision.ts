import { owned } from "./bot";
import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** Browser profiles keep the sign-ins a bot's browser saved. Forgetting them is a card; a profile that is revoked cannot start again. */
export async function runBrowserProfile(
  ctx: ChiefCtx,
  a: ChiefArgs<"browser_profile">,
): Promise<Outcome> {
  const computer = ctx.deps.computer;
  if (!computer) return { error: "browsers are not available on this server." };
  const rows = await computer.profiles(ctx.actor.userId);
  if (a.action === "list")
    return {
      read: `browser_profile.list:\n${JSON.stringify(rows.map((p) => ({ name: p.name, mode: p.mode, revoked: p.revoked })))}`,
    };
  const p = pick(
    rows.map((x) => ({ ...x, id: x.name })),
    a.profile,
    (x) => x.name,
    "browser profile",
  );
  if ("error" in p) return p;
  const remove = a.action === "remove";
  return plan(
    `${remove ? "Remove" : "Reset"} the browser profile ${p.hit.name}`,
    [
      {
        field: remove ? "remove profile" : "reset profile",
        from: p.hit.name,
        to: remove
          ? "all saved sign-ins are forgotten and the profile cannot start again"
          : "all saved sign-ins are forgotten; the bot signs in again next time",
      },
    ],
    { tool: "browser_profile", op: a.action, profile: p.hit.name },
  );
}
export async function applyBrowserProfile(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const computer = ctx.deps.computer;
  if (!computer) throw new Error("browsers unavailable");
  const v = p as { op: string; profile: string };
  if (v.op === "remove") await computer.revokeProfile(ctx.actor.userId, v.profile);
  else await computer.reset(ctx.actor.userId, v.profile);
}

/** The questions a "decision" bot answers by itself (Laya or JEV picks an option; each option replies, asks, delegates or stops). */
export async function runDecision(ctx: ChiefCtx, a: ChiefArgs<"decision">): Promise<Outcome> {
  const routing = ctx.deps.routing;
  if (!routing) return { error: "decision routing is not available on this server." };
  const b = pick(await owned(ctx), a.bot, (x) => x.name, "bot");
  if ("error" in b) return b;
  if (a.action === "get")
    return {
      read: `decision.get ${b.hit.name}:\n${JSON.stringify(await routing.get(ctx.actor, b.hit.id))}`,
    };
  if (a.action === "preview")
    return {
      read: `decision.preview ${b.hit.name}:\n${JSON.stringify(await routing.preview(ctx.actor, b.hit.id, a.text))}`,
    };
  const cur = await routing.get(ctx.actor, b.hit.id);
  return plan(
    `Set how ${b.hit.name} decides`,
    [
      { field: "bot", from: null, to: b.hit.name },
      { field: "question", from: cur?.question ?? null, to: a.config.question },
      { field: "enabled", from: cur?.enabled ?? null, to: a.config.enabled },
      {
        field: "options",
        from: null,
        to: a.config.options.map((o) => `${o.label} (${o.action})`).join(", "),
      },
      {
        field: "minimum confidence",
        from: cur?.minConfidencePct ?? null,
        to: `${a.config.minConfidencePct}%`,
      },
    ],
    { tool: "decision", botId: b.hit.id, config: a.config },
  );
}
export async function applyDecision(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const routing = ctx.deps.routing;
  if (!routing) throw new Error("decision routing unavailable");
  const v = p as { botId: string; config: Parameters<typeof routing.set>[2] };
  await routing.set(ctx.actor, v.botId, v.config);
}
