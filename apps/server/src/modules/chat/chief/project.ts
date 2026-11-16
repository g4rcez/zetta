import { and, eq } from "@zetta/db/query";
import { project as projectTable } from "@zetta/db/schema/projects";

import { pick, plan, short } from "./resolve";
import type { ChiefArgs } from "./schemas";
import type { Applied, ApplyCtx, ChiefCtx, DiffLine, Outcome } from "./types";

type ProjectArgs = ChiefArgs<"project">;
const BRIEF = ["outcome", "audience", "doneWhen", "notIncluded"] as const;

/**
 * Projects: what a person does on the Projects page. Reading shows the projects the person owns or works on; every change is a card, and
 * only the owner of a project can change it (the store checks that again when the card is approved). A bot acts for the person whose turn
 * it is, never for anyone else.
 */
export async function runProject(ctx: ChiefCtx, a: ProjectArgs): Promise<Outcome> {
  const { projects } = ctx.deps;
  if (!projects) return { error: "projects are not available on this server." };
  const all = await projects.list(ctx.actor);
  if (a.action === "list")
    return {
      read: `project.list:\n${JSON.stringify(
        all.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          status: p.status,
          health: p.health.sentence,
          bots: p.bots.map((b) => b.name),
          people: p.people.map((x) => x.name),
        })),
      )}`,
    };

  const cand = await projects.candidates(ctx.actor);
  const bots = cand.bots;
  const persons = cand.people.map((p) => ({ ...p, id: p.userId }));
  const resolveBots = (qs: string[] | undefined) => {
    const out: { id: string; name: string }[] = [];
    for (const q of qs ?? []) {
      const hit = pick(bots, q, (b) => b.name, "bot of yours");
      if ("error" in hit) return hit;
      if (!out.some((x) => x.id === hit.hit.id)) out.push(hit.hit);
    }
    return { list: out };
  };
  const resolvePeople = (qs: string[] | undefined) => {
    const out: { id: string; name: string }[] = [];
    for (const q of qs ?? []) {
      const hit = pick(persons, q, (p) => p.name, "person of your teams");
      if ("error" in hit) return hit;
      if (!out.some((x) => x.id === hit.hit.id)) out.push({ id: hit.hit.id, name: hit.hit.name });
    }
    return { list: out };
  };

  if (a.action === "create") {
    if (all.some((p) => p.status !== "archived" && p.name.toLowerCase() === a.name.toLowerCase()))
      return { error: `You already have a project called "${a.name}". Use another name.` };
    const b = resolveBots(a.bots);
    if ("error" in b) return b;
    const p = resolvePeople(a.people);
    if ("error" in p) return p;
    const fields: Record<string, unknown> = { name: a.name };
    const diff: DiffLine[] = [{ field: "name", from: null, to: a.name }];
    for (const k of BRIEF)
      if (a[k]) {
        fields[k] = a[k];
        diff.push({ field: k, from: null, to: short(a[k]) });
      }
    if (a.labels?.length) {
      fields.labels = [...new Set(a.labels.map((l) => l.toLowerCase()))];
      diff.push({ field: "labels", from: null, to: (fields.labels as string[]).join(", ") });
    }
    if (a.watch) {
      fields.watch = a.watch;
      diff.push({ field: "watch", from: null, to: a.watch });
    }
    if (b.list.length)
      diff.push({ field: "bots", from: null, to: b.list.map((x) => x.name).join(", ") });
    if (p.list.length)
      diff.push({ field: "people", from: null, to: p.list.map((x) => x.name).join(", ") });
    return plan(`New project ${a.name}`, diff, {
      tool: "project",
      op: "create",
      fields,
      botIds: b.list.map((x) => x.id),
      personIds: p.list.map((x) => x.id),
    });
  }

  const found = pick(all, a.project, (x) => x.name, "project");
  if ("error" in found) return found;
  const proj = found.hit;
  if (a.action === "get") {
    const d = await projects.get(ctx.actor, proj.id);
    return {
      read: `project.get:\n${JSON.stringify({
        id: d.id,
        name: d.name,
        role: d.role,
        status: d.status,
        watch: d.watch,
        outcome: d.outcome,
        audience: d.audience,
        doneWhen: d.doneWhen,
        notIncluded: d.notIncluded,
        labels: d.labels,
        health: d.health.sentence,
        bots: d.bots,
        people: d.people,
        counts: d.counts,
        rooms: d.rooms,
        openWork: d.tasks.slice(0, 15).map((t) => ({ id: t.id, title: t.title, status: t.status })),
      })}`,
    };
  }
  if (proj.role !== "owner")
    return { error: `You can read "${proj.name}", but only its owner changes it.` };

  if (a.action === "update") {
    const fields: Record<string, unknown> = {};
    const diff: DiffLine[] = [];
    const set = (k: string, from: unknown, to: unknown) => {
      if (to === undefined || JSON.stringify(to) === JSON.stringify(from)) return;
      fields[k] = to;
      diff.push({ field: k, from: short(from), to: short(to) });
    };
    set("name", proj.name, a.name);
    for (const k of BRIEF) set(k, proj[k], a[k]);
    set("labels", proj.labels, a.labels && [...new Set(a.labels.map((l) => l.toLowerCase()))]);
    set("watch", proj.watch, a.watch);
    set("status", proj.status, a.status);
    if (!diff.length) return { error: `Nothing changes in "${proj.name}".` };
    return plan(`Change project ${proj.name}`, diff, {
      tool: "project",
      op: "update",
      id: proj.id,
      fields,
    });
  }

  if (a.action === "members") {
    const b = resolveBots(a.bots);
    if ("error" in b) return b;
    const p = resolvePeople(a.people);
    if ("error" in p) return p;
    return plan(
      `Change who works on ${proj.name}`,
      [
        { field: "project", from: null, to: proj.name },
        {
          field: "bots",
          from: proj.bots.map((x) => x.name).join(", ") || null,
          to: b.list.map((x) => x.name).join(", ") || "(none)",
        },
        {
          field: "people",
          from: proj.people.map((x) => x.name).join(", ") || null,
          to: p.list.map((x) => x.name).join(", ") || "(none)",
        },
      ],
      {
        tool: "project",
        op: "members",
        id: proj.id,
        botIds: b.list.map((x) => x.id),
        personIds: p.list.map((x) => x.id),
      },
    );
  }

  if (a.action === "rooms") {
    const ids: string[] = [];
    const names: string[] = [];
    for (const q of a.rooms) {
      const r = pick(cand.rooms, q, (x) => x.title, "room of yours");
      if ("error" in r) return r;
      if (!ids.includes(r.hit.id)) {
        ids.push(r.hit.id);
        names.push(r.hit.title);
      }
    }
    return plan(
      `Change the rooms of ${proj.name}`,
      [
        { field: "project", from: null, to: proj.name },
        { field: "rooms", from: null, to: names.join(", ") || "(none)" },
      ],
      { tool: "project", op: "rooms", id: proj.id, roomIds: ids },
    );
  }

  // add_work: the task goes to somebody who is on the project, and a bot starts on it when the card is approved.
  const target =
    a.to.kind === "bot"
      ? (() => {
          const hit = pick(
            proj.bots.map((b) => ({ id: b.id, name: b.name })),
            a.to.who,
            (b) => b.name,
            "bot on this project",
          );
          return "error" in hit ? hit : { id: hit.hit.id, name: hit.hit.name };
        })()
      : (() => {
          const hit = pick(
            proj.people.map((x) => ({ id: x.userId, name: x.name })),
            a.to.who,
            (x) => x.name,
            "person on this project",
          );
          return "error" in hit ? hit : { id: hit.hit.id, name: hit.hit.name };
        })();
  if ("error" in target) return target;
  return plan(
    `Ask ${target.name} for something in ${proj.name}`,
    [
      { field: "project", from: null, to: proj.name },
      { field: a.to.kind === "bot" ? "bot" : "person", from: null, to: target.name },
      { field: "asks", from: null, to: short(a.text) },
      {
        field: "note",
        from: null,
        to:
          a.to.kind === "bot"
            ? "The bot starts on it as soon as you approve."
            : "It lands in their Inbox.",
      },
    ],
    {
      tool: "project",
      op: "work",
      id: proj.id,
      to: { kind: a.to.kind, id: target.id },
      text: a.text,
    },
  );
}

export async function applyProject(ctx: ApplyCtx, p: Record<string, unknown>): Promise<Applied> {
  const { projects, projectWork, db } = ctx.deps;
  if (!projects) throw new Error("projects unavailable");
  const v = p as {
    op: string;
    id: string;
    fields: Record<string, never>;
    botIds: string[];
    personIds: string[];
    roomIds: string[];
    to: { kind: "bot" | "person"; id: string };
    text: string;
  };
  if (v.op === "create")
    await projects.create(ctx.actor, {
      ...(v.fields as unknown as { name: string }),
      bots: v.botIds,
      people: v.personIds,
    });
  else if (v.op === "update") await projects.update(ctx.actor, v.id, v.fields);
  else if (v.op === "members")
    await projects.setMembers(ctx.actor, v.id, { bots: v.botIds, people: v.personIds });
  else if (v.op === "rooms") await projects.setRooms(ctx.actor, v.id, v.roomIds);
  else if (v.op === "work") {
    if (!projectWork) throw new Error("project work unavailable");
    // The store checks that the person owns it; this only keeps a stale card from reaching a deleted project.
    const [own] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(and(eq(projectTable.id, v.id), eq(projectTable.ownerUserId, ctx.actor.userId)));
    if (!own) throw new Error("project not found");
    await projectWork(ctx.actor, v.id, { to: v.to, text: v.text });
  } else throw new Error(`unknown project change ${v.op}`);
}
