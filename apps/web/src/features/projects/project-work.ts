import type { ProjectDetail, ProjectTask } from "./projects-api";

/** Who does a piece of work: a bot, a person, or nobody yet. */
export type Worker =
  | { kind: "bot"; id: string; name: string }
  | { kind: "person"; id: string; name: string }
  | { kind: "nobody" };
export type WorkGroup = { key: string; worker: Worker; tasks: ProjectTask[] };

const ORDER = { blocked: 0, review: 1, in_progress: 2, backlog: 3, done: 4 } as const;

/**
 * The open work of a project by who does it: what is stuck first inside each group, then what moves, then what waits. People and bots of
 * the project with nothing open still get a group, so the page shows who is free.
 */
export function workByWorker(
  project: Pick<ProjectDetail, "tasks" | "bots" | "people">,
): WorkGroup[] {
  const groups = new Map<string, WorkGroup>();
  const group = (key: string, worker: Worker) => {
    const have = groups.get(key);
    if (have) return have;
    const made = { key, worker, tasks: [] };
    groups.set(key, made);
    return made;
  };
  const botName = new Map(project.bots.map((b) => [b.id, b.name]));
  for (const b of project.bots) group(`bot:${b.id}`, { kind: "bot", ...b });
  for (const p of project.people)
    group(`person:${p.userId}`, { kind: "person", id: p.userId, name: p.name });
  for (const t of project.tasks) {
    const g =
      t.assignee === "person" && t.assigneeUserId
        ? group(`person:${t.assigneeUserId}`, {
            kind: "person",
            id: t.assigneeUserId,
            name: t.assigneeName ?? "A person",
          })
        : t.botId
          ? group(`bot:${t.botId}`, {
              kind: "bot",
              id: t.botId,
              name: botName.get(t.botId) ?? "A bot",
            })
          : group("nobody", { kind: "nobody" });
    g.tasks.push(t);
  }
  for (const g of groups.values())
    g.tasks.sort(
      (a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt),
    );
  // Whoever has work comes before whoever is free; "nobody" is always last.
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.worker.kind === "nobody") - Number(b.worker.kind === "nobody") ||
      Number(!a.tasks.length) - Number(!b.tasks.length),
  );
}
