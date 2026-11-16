import { Alert } from "@g4rcez/components/alert";
import { FolderSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Empty, Loading, list, listItem } from "../shared/ui";
import { LabelChip } from "../tasks/task-badges";
import { Faces, HealthBadge, ProjectProgress } from "./project-bits";
import {
  applyProjectFilters,
  projectLabels,
  toProjectSearch,
  toProjectState,
  type ProjectSearch,
  type ProjectShow,
} from "./project-filters";
import { projectsQueries, type Project, type Unfiled } from "./projects-api";

const NO_BOTS: Bot[] = [];
const SHOWS: { show: ProjectShow; label: string }[] = [
  { show: "current", label: "Current" },
  { show: "done", label: "Done" },
  { show: "archived", label: "Archived" },
  { show: "all", label: "All" },
];
const tasks = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

/**
 * Every project the person owns or works on, with where each one stands. What needs them comes first. The work that is in no project has
 * its own row at the end, so this page never hides anything.
 */
export function ProjectsPage({
  search,
  onSearch,
}: {
  search: ProjectSearch;
  onSearch: (next: ProjectSearch, opts?: { replace?: boolean }) => void;
}) {
  const navigate = useNavigate();
  const { data, error, isPending } = useQuery(projectsQueries.list());
  const botList = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const bots = useMemo(() => new Map(botList.map((b) => [b.id, b])), [botList]);
  const state = toProjectState(search);
  const all = data?.projects ?? [];
  const shown = applyProjectFilters(all, state);
  const labels = projectLabels(all);
  const set = (patch: Partial<typeof state>, opts?: { replace?: boolean }) =>
    onSearch(toProjectSearch({ ...state, ...patch }), opts);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <FolderSimpleIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-2xl text-balance">Projects</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              A project gathers the work, the people and the bots for one result, and tells you
              where it stands.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => void navigate({ to: "/projects/new" })}
          >
            <PlusIcon aria-hidden="true" className="size-4" />
            New project
          </Button>
        </header>
        {error && <Alert theme="danger">{errorMessage(error)}</Alert>}
        {isPending ? (
          <Loading />
        ) : !all.length ? (
          <FirstProject
            unfiled={data?.unfiled}
            onCreate={() => void navigate({ to: "/projects/new" })}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                type="search"
                title="Find a project"
                hiddenLabel
                placeholder="Find a project"
                required={false}
                container="min-w-48 flex-1 sm:max-w-xs"
                value={state.query}
                onChange={(e) => set({ query: e.target.value }, { replace: true })}
              />
              <div role="group" aria-label="Which projects" className="flex gap-1">
                {SHOWS.map((s) => (
                  <Button
                    key={s.show}
                    size="sm"
                    variant={state.show === s.show ? "default" : "outline"}
                    aria-pressed={state.show === s.show}
                    onClick={() => set({ show: s.show })}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
              {labels.length > 0 && (
                <div role="group" aria-label="Label" className="flex flex-wrap gap-1">
                  {labels.map((l) => (
                    <Button
                      key={l}
                      size="xs"
                      variant={state.label === l ? "secondary" : "ghost"}
                      aria-pressed={state.label === l}
                      onClick={() => set({ label: state.label === l ? "" : l })}
                    >
                      {l}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {shown.length ? (
              <ul className={list}>
                {shown.map((p) => (
                  <ProjectRow key={p.id} project={p} bots={bots} />
                ))}
              </ul>
            ) : (
              <Empty>No project matches. Change the search or pick another group above.</Empty>
            )}
            <UnfiledRow unfiled={data?.unfiled} />
          </>
        )}
      </div>
    </div>
  );
}

function ProjectRow({ project, bots }: { project: Project; bots: ReadonlyMap<string, Bot> }) {
  return (
    <li className={listItem}>
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="-mx-4 -my-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 flex-1 basis-64">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{project.name}</span>
            <HealthBadge health={project.health} />
          </span>
          <span className="mt-0.5 block text-pretty text-muted-foreground">
            {project.health.sentence}
          </span>
        </span>
        {project.labels.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {project.labels.map((l) => (
              <LabelChip key={l} label={l} />
            ))}
          </span>
        )}
        <ProjectProgress counts={project.counts} />
        <Faces project={project} bots={bots} />
      </Link>
    </li>
  );
}

/** The work that belongs to no project. It links to the board, filtered to exactly that work. */
function UnfiledRow({ unfiled }: { unfiled: Unfiled | undefined }) {
  if (!unfiled?.open) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <Link
        to="/tasks"
        search={{ project: "none", stage: "open" }}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        Not in a project: {tasks(unfiled.open)} still open
      </Link>
      . Open a task to file it under a project.
    </p>
  );
}

function FirstProject({
  unfiled,
  onCreate,
}: {
  unfiled: Unfiled | undefined;
  onCreate: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed px-4 py-8 text-center">
        <p className="mx-auto max-w-prose text-sm text-pretty text-muted-foreground">
          You have no project yet. Start one for a result you want, such as a launch or a report:
          say what you want in one sentence, pick who works on it, and follow it here.
        </p>
        <Button className="mt-4" onClick={onCreate}>
          Create your first project
        </Button>
      </div>
      <UnfiledRow unfiled={unfiled} />
    </div>
  );
}
