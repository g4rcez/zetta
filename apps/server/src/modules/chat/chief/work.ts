import { pick, plan } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, Outcome } from "./types";

export async function runWorkflow(ctx: ChiefCtx, a: ChiefArgs<"workflow">): Promise<Outcome> {
  const f = ctx.deps.features;
  if (!f) return { error: "workflows are not available on this server." };
  const rows = await f.workflows.list(ctx.actor);
  if (a.action === "list")
    return {
      read: `workflow.list:\n${JSON.stringify(rows.map((w) => ({ id: w.id, name: w.name })))}`,
    };
  const w = pick(rows, a.workflow, (x) => x.name, "workflow");
  if ("error" in w) return w;
  return plan(
    `Run workflow ${w.hit.name}`,
    [
      { field: "workflow", from: null, to: w.hit.name },
      { field: "input", from: null, to: a.input || "(none)" },
      { field: "note", from: null, to: "Its steps run now and may use your bots." },
    ],
    { tool: "workflow", id: w.hit.id, input: a.input },
  );
}
export async function applyWorkflow(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  if (!ctx.deps.features) throw new Error("workflows unavailable");
  const v = p as { id: string; input: string };
  await ctx.deps.features.workflows.run(ctx.actor, v.id, v.input);
}

export async function runComputer(ctx: ChiefCtx, a: ChiefArgs<"computer">): Promise<Outcome> {
  const vms = ctx.deps.vms;
  if (!vms) return { error: "computers are not available on this server." };
  const rows = await vms.list(ctx.actor.userId);
  if (a.action === "vms")
    return {
      read: `computer.vms:\n${JSON.stringify(rows.map((v) => ({ id: v.id, name: v.name, kind: v.kind })))}`,
    };
  const v =
    a.action === "vm_start" && !a.vm
      ? ({ hit: rows.find((r) => r.kind === "default") } as const)
      : pick(rows, a.vm!, (x) => x.name, "computer");
  if ("error" in v) return v;
  if (!v.hit) return { error: "you have no default computer yet." };
  const name = v.hit.name;
  if (a.action === "keyboard")
    return plan(
      `Set the keyboard of ${name} to ${a.layout}`,
      [
        { field: "computer", from: null, to: name },
        { field: "keyboard layout", from: null, to: a.layout },
      ],
      { tool: "computer", op: "keyboard", id: v.hit.id, layout: a.layout },
    );
  const text = { vm_start: "Start", vm_stop: "Stop", vm_remove: "Delete" }[a.action as "vm_start"];
  return plan(
    `${text} the computer ${name}`,
    [
      { field: "computer", from: null, to: name },
      {
        field: "do",
        from: null,
        to: a.action === "vm_remove" ? "deleted with everything on it" : text!.toLowerCase(),
      },
    ],
    { tool: "computer", op: a.action, id: v.hit.id },
  );
}
export async function applyComputer(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const vms = ctx.deps.vms;
  if (!vms) throw new Error("computers unavailable");
  const v = p as { op: string; id: string; layout: string };
  const uid = ctx.actor.userId;
  if (v.op === "vm_start") await vms.start(uid, v.id);
  else if (v.op === "vm_stop") await vms.stop(uid, v.id);
  else if (v.op === "vm_remove") await vms.remove(uid, v.id);
  else await vms.keyboard(uid, v.id, v.layout);
}

export async function runSnapshot(ctx: ChiefCtx, a: ChiefArgs<"snapshot">): Promise<Outcome> {
  const s = ctx.deps.features?.snapshots;
  if (!s) return { error: "snapshots are not available on this server." };
  if (a.action === "list")
    return {
      read: `snapshot.list:\n${JSON.stringify((await s.list()).map((x) => ({ id: x.id, title: x.title, bot: x.botName })))}`,
    };
  if (a.action === "preview" || a.action === "publish") {
    const p = await s.preview(ctx.actor, a.conversation);
    if (a.action === "preview")
      return {
        read: `snapshot.preview:\n${JSON.stringify({ title: p.title, bot: p.botName, parts: p.parts.length })}`,
      };
    return plan(
      `Publish the chat ${p.title} to the team`,
      [
        { field: "chat", from: null, to: p.title },
        {
          field: "shared with",
          from: null,
          to: "every member of this installation, as a read-only copy",
        },
        { field: "parts", from: null, to: `${p.parts.length} messages up to now` },
      ],
      {
        tool: "snapshot",
        op: "publish",
        conversationId: a.conversation,
        previewHash: p.previewHash,
      },
    );
  }
  return plan(
    "Take a published chat back",
    [{ field: "revoke snapshot", from: a.snapshot, to: "no longer visible to others" }],
    { tool: "snapshot", op: "revoke", id: a.snapshot },
  );
}
export async function applySnapshot(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const s = ctx.deps.features?.snapshots;
  if (!s) throw new Error("snapshots unavailable");
  const v = p as { op: string; id: string; conversationId: string; previewHash: string };
  if (v.op === "publish")
    await s.publish(ctx.actor, { conversationId: v.conversationId, previewHash: v.previewHash });
  else await s.revoke(ctx.actor, v.id);
}

export async function runSource(ctx: ChiefCtx, a: ChiefArgs<"source">): Promise<Outcome> {
  const sources = ctx.deps.sources;
  if (!sources) return { error: "sources are not available on this server." };
  const rows = await sources.list(ctx.actor);
  if (a.action === "list")
    return {
      read: `source.list:\n${JSON.stringify(rows.map((s) => ({ id: s.id, kind: s.kind, label: s.label })))}`,
    };
  if (a.action === "add")
    return plan(
      `Add the ${a.kind} source ${a.label}`,
      [
        { field: "kind", from: null, to: a.kind },
        { field: "label", from: null, to: a.label },
        { field: "address", from: null, to: a.url },
      ],
      { tool: "source", op: "add", kind: a.kind, url: a.url, label: a.label },
    );
  if (a.action === "add_login")
    return {
      card: {
        form: "source_login",
        botId: null,
        botName: null,
        prefill: { kind: a.kind, label: a.label ?? "" },
      },
      text: `A form is now shown to the user to enter their ${a.kind === "email" ? "mailbox login" : "X token"}. You never see it; do not say the source is added until they confirm.`,
    };
  if (a.action === "briefing") {
    const ids: string[] = [];
    for (const q of a.sources ?? []) {
      const s = pick(rows, q, (x) => x.label, "source");
      if ("error" in s) return s;
      ids.push(s.hit.id);
    }
    return plan(
      "Read the sources now",
      [{ field: "sources", from: null, to: ids.length ? `${ids.length} chosen` : "all" }],
      {
        tool: "source",
        op: "briefing",
        ids,
      },
    );
  }
  const s = pick(rows, a.source, (x) => x.label, "source");
  if ("error" in s) return s;
  return plan(
    `Remove the source ${s.hit.label}`,
    [{ field: "remove source", from: s.hit.label, to: "removed" }],
    {
      tool: "source",
      op: "remove",
      id: s.hit.id,
    },
  );
}
export async function applySource(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const sources = ctx.deps.sources;
  if (!sources) throw new Error("sources unavailable");
  const v = p as {
    op: string;
    id: string;
    ids: string[];
    kind: "rss" | "web";
    url: string;
    label: string;
  };
  if (v.op === "add") await sources.add(ctx.actor, { kind: v.kind, url: v.url, label: v.label });
  else if (v.op === "remove") await sources.remove(ctx.actor, v.id);
  else await sources.briefing(ctx.actor, v.ids.length ? v.ids : undefined);
}

export async function runCompanyDocs(
  ctx: ChiefCtx,
  a: ChiefArgs<"company_docs">,
): Promise<Outcome> {
  const k = ctx.deps.knowledge;
  if (!k) return { error: "company documents are not available on this server." };
  if (a.action === "status")
    return { read: `company_docs.status:\n${JSON.stringify(await k.status(ctx.actor))}` };
  const text = {
    enable: ["Turn on company documents", "Your bots can search the Drive documents you may read."],
    disable: ["Turn off company documents", "Every indexed copy is deleted."],
    sync: ["Update company documents now", "Reads your Drive again."],
  }[a.action];
  return plan(text[0]!, [{ field: "company documents", from: null, to: text[1] }], {
    tool: "company_docs",
    op: a.action,
  });
}
export async function applyCompanyDocs(
  ctx: ApplyCtx,
  p: Record<string, unknown>,
): Promise<Applied> {
  const k = ctx.deps.knowledge;
  if (!k) throw new Error("knowledge unavailable");
  const op = (p as { op: string }).op;
  if (op === "enable") await k.enable(ctx.actor);
  else if (op === "disable") await k.disable(ctx.actor);
  else await k.syncUser(ctx.actor);
}

export async function runWikiAdmin(ctx: ChiefCtx, a: ChiefArgs<"wiki_admin">): Promise<Outcome> {
  const wiki = ctx.deps.wiki;
  if (!wiki) return { error: "memory is not available on this server." };
  if (a.action === "suggestions")
    return {
      read: `memory_admin.suggestions:\n${JSON.stringify(await wiki.suggestions(ctx.actor.userId))}`,
    };
  if (a.action === "decide_suggestion")
    return plan(
      `${a.accept ? "Accept" : "Reject"} a memory suggestion`,
      [
        { field: "suggestion", from: null, to: a.suggestion },
        { field: "decision", from: null, to: a.accept ? "accept" : "reject" },
      ],
      {
        tool: "wiki_admin",
        op: "decide",
        id: a.suggestion,
        decision: a.accept ? "accept" : "reject",
      },
    );
  if (a.action === "restore")
    return plan(
      `Restore memory item ${a.slug} to version ${a.version}`,
      [
        { field: "item", from: null, to: a.slug },
        { field: "version", from: null, to: a.version },
      ],
      { tool: "wiki_admin", op: "restore", slug: a.slug, version: a.version },
    );
  return plan(
    `Bring back memory item ${a.slug}`,
    [
      { field: "item", from: "archived", to: "current" },
      { field: "slug", from: null, to: a.slug },
    ],
    {
      tool: "wiki_admin",
      op: "unarchive",
      slug: a.slug,
    },
  );
}
export async function applyWikiAdmin(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const wiki = ctx.deps.wiki;
  if (!wiki) throw new Error("memory unavailable");
  const v = p as {
    op: string;
    id: string;
    decision: "accept" | "reject";
    slug: string;
    version: number;
  };
  const uid = ctx.actor.userId;
  if (v.op === "decide") await wiki.decide(uid, v.id, v.decision);
  else if (v.op === "restore")
    await wiki.restore(uid, v.slug, v.version, { kind: "user", userId: uid } as never);
  else await wiki.setStatus(uid, v.slug, "current", { kind: "user", userId: uid } as never);
}
