import { ORG_RANK_LABELS, canMove, childrenOf, type OrgRank } from "@zetta/core/org";
import { orgPresetByKey, orgTemplateByKey, presetRows } from "@zetta/core/org-templates";

import type { OrgPositionView } from "../../org/store";
import { adminBotMay } from "./kinds";
import { pick, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

const NOT_ADMIN = "only an administrator can change the company chart.";
const seatName = (p: OrgPositionView) =>
  `${p.title}${p.unit ? ` (${p.unit})` : ""}${p.holder ? `: ${p.holder.name}` : ""}`;

/**
 * The company chart. Reading is open to everyone; every change is a card the user approves, and only an administrator can ask for one,
 * because the chart is shared and the server checks the same thing again when the change is applied.
 */
export async function runOrg(ctx: ChiefCtx, a: ChiefArgs<"org">): Promise<Outcome> {
  const { org } = ctx.deps;
  if (!org) return { error: "the company chart is not available on this server." };
  // The service checks this before it gets here; saying it again keeps the tool safe if it is ever called from somewhere else.
  if (ctx.who.kind !== "chief" && !adminBotMay("org", ctx.who, ctx.actor))
    return { error: "only the administrator's own bots can use the company chart." };
  const view = await org.get(ctx.actor);
  const seats = view.positions;
  if (a.action === "list")
    return {
      read: `org.list (version ${view.chart.version}):\n${JSON.stringify(
        seats.map((p) => ({
          id: p.id,
          title: p.title,
          level: ORG_RANK_LABELS[p.rank],
          unit: p.unit,
          reportsTo: seats.find((x) => x.id === p.parentId)?.title ?? null,
          heldBy: p.holder ? { kind: p.holder.kind, name: p.holder.name } : null,
          team: p.team?.name ?? null,
        })),
      )}`,
    };
  if (!ctx.actor.isAdmin) return { error: NOT_ADMIN };

  if (a.action === "apply_template") {
    const preset = orgPresetByKey(a.template);
    if (!preset)
      return {
        error: `no chart template called "${a.template}". Use one of: small-startup, solo-founder, agency, product-team, support-desk.`,
      };
    if (preset.scope === "company" && seats.length)
      return {
        error:
          "a whole company template needs an empty chart. Use a team template under a seat instead.",
      };
    let under: OrgPositionView | undefined;
    if (preset.scope === "department" && seats.length) {
      if (!a.under) return { error: "say which seat this team reports to (under)." };
      const hit = pick(seats, a.under, (p) => p.title, "seat");
      if ("error" in hit) return hit;
      under = hit.hit;
    }
    const rows = presetRows(preset);
    return {
      plan: {
        title: `Add ${preset.title} to the company chart`,
        diff: [
          { field: "template", from: null, to: preset.title },
          { field: "seats", from: null, to: `${rows.length} seats, from ${rows[0]?.title ?? ""}` },
          ...(under ? [{ field: "reports to", from: null, to: under.title }] : []),
        ],
        patch: {
          tool: "org",
          op: "preset",
          presetKey: preset.key,
          underPositionId: under?.id ?? null,
        },
      },
    };
  }

  if (a.action === "add_seat") {
    const tpl = a.template ? orgTemplateByKey(a.template) : undefined;
    if (a.template && !tpl) return { error: `no role template called "${a.template}".` };
    const title = (a.title ?? tpl?.title ?? "").trim();
    if (!title) return { error: "give the seat a template or a title." };
    let parent: OrgPositionView | undefined;
    if (seats.length) {
      if (!a.under) return { error: "say which seat the new one reports to (under)." };
      const hit = pick(seats, a.under, (p) => p.title, "seat");
      if ("error" in hit) return hit;
      parent = hit.hit;
    }
    const rank: OrgRank = a.rank ?? tpl?.rank ?? (seats.length ? "member" : "ceo");
    if (!seats.length && rank !== "ceo") return { error: "start the chart with the CEO." };
    if (seats.length && rank === "ceo") return { error: "there can be only one CEO." };
    return {
      plan: {
        title: `Add the seat ${title}`,
        diff: [
          { field: "seat", from: null, to: title },
          { field: "level", from: null, to: ORG_RANK_LABELS[rank] },
          ...(a.unit ? [{ field: "unit", from: null, to: a.unit }] : []),
          ...(a.description
            ? [{ field: "responsible for", from: null, to: short(a.description) }]
            : []),
          ...(parent ? [{ field: "reports to", from: null, to: parent.title }] : []),
        ],
        patch: {
          tool: "org",
          op: "create",
          parentId: parent?.id ?? null,
          templateKey: tpl?.key ?? null,
          // Not `title`: the service puts the card's own title there.
          seatTitle: title,
          rank,
          ...(a.unit !== undefined ? { unit: a.unit } : {}),
          ...(a.description !== undefined ? { description: a.description } : {}),
        },
      },
    };
  }

  const hit = pick(seats, a.seat, (p) => p.title, "seat");
  if ("error" in hit) return hit;
  const seat = hit.hit;

  if (a.action === "update") {
    if (a.rank !== undefined && seat.rank === "ceo" && a.rank !== "ceo")
      return { error: "The CEO seat stays the CEO." };
    if (a.rank !== undefined && seat.rank !== "ceo" && a.rank === "ceo")
      return { error: "There can be only one CEO." };
    let team: { id: string; name: string } | null | undefined;
    if (a.team === null) team = null;
    else if (a.team !== undefined) {
      const t = pick(view.palette?.teams ?? [], a.team, (x) => x.name, "team of yours");
      if ("error" in t) return t;
      team = t.hit;
    }
    const diff: DiffLine[] = [];
    const fields: Record<string, unknown> = {};
    if (a.title !== undefined && a.title !== seat.title) {
      diff.push({ field: "title", from: seat.title, to: a.title });
      fields.title = a.title;
    }
    if (a.rank !== undefined && a.rank !== seat.rank) {
      diff.push({ field: "level", from: ORG_RANK_LABELS[seat.rank], to: ORG_RANK_LABELS[a.rank] });
      fields.rank = a.rank;
    }
    if (a.unit !== undefined && a.unit !== seat.unit) {
      diff.push({ field: "unit", from: seat.unit, to: a.unit });
      fields.unit = a.unit;
    }
    if (a.description !== undefined && a.description !== seat.description) {
      diff.push({
        field: "responsible for",
        from: short(seat.description),
        to: short(a.description),
      });
      fields.description = a.description;
    }
    if (team !== undefined && (team?.id ?? null) !== (seat.team?.id ?? null)) {
      diff.push({ field: "team it runs", from: seat.team?.name ?? null, to: team?.name ?? null });
      fields.teamId = team?.id ?? null;
    }
    if (!diff.length) return { error: "the seat already looks like that." };
    return {
      plan: {
        title: `Change the seat ${seat.title}`,
        diff,
        patch: { tool: "org", op: "update", id: seat.id, fields },
      },
    };
  }

  if (a.action === "move") {
    const to = a.under ? pick(seats, a.under, (p) => p.title, "seat") : undefined;
    if (to && "error" in to) return to;
    const parent = to?.hit ?? seats.find((p) => p.id === seat.parentId);
    if (!parent) return { error: "The CEO is the top of the chart and does not report to anyone." };
    const problem = canMove(seats, seat.id, parent.id);
    if (problem) return { error: problem.message };
    const siblings = childrenOf(seats, seat.parentId).length;
    const diff: DiffLine[] = [];
    if (parent.id !== seat.parentId)
      diff.push({
        field: "reports to",
        from: seats.find((p) => p.id === seat.parentId)?.title ?? null,
        to: parent.title,
      });
    if (a.index !== undefined)
      diff.push({
        field: "place among its siblings",
        from: parent.id === seat.parentId ? `${siblings} in the row` : null,
        to: `number ${a.index + 1}`,
      });
    return {
      plan: {
        title:
          parent.id === seat.parentId
            ? `Reorder ${seat.title}`
            : `Move ${seat.title} under ${parent.title}`,
        diff,
        patch: {
          tool: "org",
          op: "move",
          id: seat.id,
          parentId: parent.id,
          ...(a.index !== undefined ? { index: a.index } : {}),
        },
      },
    };
  }

  if (a.action === "remove")
    return {
      plan: {
        title: `Remove the seat ${seat.title}`,
        diff: [
          {
            field: "remove seat",
            from: seatName(seat),
            to: seat.parentId ? "the seats under it report to its manager" : "the chart is empty",
          },
        ],
        patch: { tool: "org", op: "remove", id: seat.id },
      },
    };

  // seat: a person, a bot, or nobody
  const diff: DiffLine[] = [{ field: "held by", from: seat.holder?.name ?? null, to: null }];
  let holder:
    | { kind: "open" }
    | { kind: "person"; userId: string }
    | { kind: "bot"; botId: string };
  if (a.holder.kind === "open") {
    holder = { kind: "open" };
    diff[0]!.to = "nobody";
  } else if (a.holder.kind === "person") {
    const who = pick(
      (view.palette?.people ?? []).map((p) => ({ ...p, id: p.userId })),
      a.holder.who,
      (p) => p.name,
      "person",
    );
    if ("error" in who) return who;
    holder = { kind: "person", userId: who.hit.userId };
    diff[0]!.to = who.hit.name;
  } else {
    const who = pick(
      view.palette?.bots ?? [],
      a.holder.who,
      (b) => b.name,
      "bot shared with the team",
    );
    if ("error" in who) return who;
    holder = { kind: "bot", botId: who.hit.id };
    diff[0]!.to = who.hit.name;
  }
  return {
    plan: {
      title: `Put ${String(diff[0]!.to)} in the seat ${seat.title}`,
      diff: [{ field: "seat", from: null, to: seat.title }, ...diff],
      patch: { tool: "org", op: "seat", id: seat.id, holder },
    },
  };
}

export async function applyOrg(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { org } = ctx.deps;
  if (!org) throw new Error("the company chart is not available");
  const v = p as {
    op: string;
    id?: string;
    parentId?: string | null;
    templateKey?: string | null;
    seatTitle?: string;
    unit?: string;
    description?: string;
    index?: number;
    fields?: {
      title?: string;
      description?: string;
      unit?: string;
      rank?: OrgRank;
      teamId?: string | null;
    };
    rank?: OrgRank;
    holder?: { kind: "open" } | { kind: "person"; userId: string } | { kind: "bot"; botId: string };
    presetKey?: string;
    underPositionId?: string | null;
  };
  // The store checks this too; saying it here gives the plain message and stops before anything is read.
  if (!ctx.actor.isAdmin) throw new Error(NOT_ADMIN);
  // The version is read now: the plan holds resolved seats, and the chart refuses a seat that is gone.
  const version = (await org.get(ctx.actor)).chart.version;
  if (v.op === "create")
    await org.create(ctx.actor, version, {
      parentId: v.parentId ?? null,
      ...(v.templateKey ? { templateKey: v.templateKey } : {}),
      ...(v.seatTitle ? { title: v.seatTitle } : {}),
      ...(v.rank ? { rank: v.rank } : {}),
      ...(v.unit !== undefined ? { unit: v.unit } : {}),
      ...(v.description !== undefined ? { description: v.description } : {}),
    });
  else if (v.op === "update") await org.update(ctx.actor, version, v.id!, v.fields ?? {});
  else if (v.op === "move") await org.move(ctx.actor, version, v.id!, v.parentId!, v.index);
  else if (v.op === "remove") await org.remove(ctx.actor, version, v.id!);
  else if (v.op === "seat") await org.seat(ctx.actor, version, v.id!, v.holder!);
  else if (v.op === "preset")
    await org.applyPreset(ctx.actor, version, v.presetKey!, v.underPositionId ?? undefined);
  else throw new Error(`unknown org change ${v.op}`);
}
