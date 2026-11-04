import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

/** API-key accounts. The key is typed in a form card and sealed in the browser: the chief and the model never see it. */
export async function runConnection(ctx: ChiefCtx, a: ChiefArgs<"connection">): Promise<Outcome> {
  const c = ctx.deps.connections;
  if (!c?.configured())
    return { error: "accounts are turned off on this server (no encryption key)." };
  if (a.action === "add")
    return {
      card: {
        form: "connection",
        botId: null,
        botName: null,
        prefill: { provider: a.provider, label: a.label ?? a.provider },
      },
      text: `A form is now shown to the user to paste their ${a.provider} key. You never see the key. Tell them to fill it in; do not say it is saved.`,
    };
  const rows = (await c.list(ctx.actor)).filter((x) => x.provider !== "plugin");
  if (a.action === "list")
    return {
      read: `connection.list:\n${JSON.stringify(rows.map((x) => ({ id: x.id, provider: x.provider, label: x.label })))}`,
    };
  const r = pick(rows, a.connection, (x) => x.label, "account");
  if ("error" in r) return r;
  return plan(
    `Revoke the ${r.hit.provider} account ${r.hit.label}`,
    [
      {
        field: "revoke account",
        from: r.hit.label,
        to: "revoked; bots that use it stop working with it",
      },
    ],
    { tool: "connection", id: r.hit.id, revision: r.hit.revision },
    r.hit.revision,
  );
}
export async function applyConnection(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  if (!ctx.deps.connections) throw new Error("connections unavailable");
  const v = p as { id: string; revision: number };
  await ctx.deps.connections.revoke(ctx.actor, v.id, v.revision);
}

export async function runAgendaSync(_ctx: ChiefCtx, a: ChiefArgs<"agenda_sync">): Promise<Outcome> {
  if (a.action === "sync_now")
    return plan(
      "Sync the agenda with Google now",
      [{ field: "sync", from: null, to: "reads and writes your Google calendar" }],
      {
        tool: "agenda_sync",
        op: "now",
      },
    );
  const { action: _a, ...fields } = a;
  return plan(
    "Change the agenda sync",
    Object.entries(fields).map(([field, to]) => ({ field, from: null, to })),
    { tool: "agenda_sync", op: "settings", fields },
  );
}
export async function applyAgendaSync(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const v = p as { op: string; fields: never };
  if (v.op === "now") {
    if (!ctx.deps.agendaScheduler) throw new Error("agenda sync unavailable");
    await ctx.deps.agendaScheduler.syncUser(ctx.actor);
  } else {
    if (!ctx.deps.agenda) throw new Error("agenda unavailable");
    await ctx.deps.agenda.setSyncSettings(ctx.actor, v.fields);
  }
}
