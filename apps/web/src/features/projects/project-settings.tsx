import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Checkbox, Input, Radiobox } from "@/components/ui";
import { toast } from "@/lib/notify";
import { errorMessage, type Bot } from "../chat/chat-client";
import { Markdown } from "../chat/markdown";
import { MentionTextarea } from "../chat/mention";
import { ConfirmButton, Panel } from "../shared/ui";
import { LabelsEditor } from "../tasks/task-labels";
import { MemberPicker } from "./member-picker";
import {
  BRIEF_FIELDS,
  BRIEF_MAX,
  PROJECT_WATCH,
  projectsApi,
  projectsQueries,
  type Brief,
  type Candidates,
  type ProjectDetail,
  type ProjectPatch,
  type ProjectStatus,
} from "./projects-api";

const NO_CANDIDATES: Candidates = { bots: [], people: [], rooms: [] };
const briefOf = (p: Brief): Brief => ({
  outcome: p.outcome,
  audience: p.audience,
  doneWhen: p.doneWhen,
  notIncluded: p.notIncluded,
});
const same = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

/** Saves a change and puts the fresh project in the cache, so every section of the page shows it at once. */
function useSave(id: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function save(work: () => Promise<ProjectDetail>, done?: string) {
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(projectsQueries.detail(id).queryKey, await work());
      void qc.invalidateQueries({ queryKey: ["projects"] });
      if (done) toast.success(done);
      return true;
    } catch (x) {
      setError(errorMessage(x));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}

/**
 * The four answers everyone on the project reads. The owner edits them in place; anyone else reads them. An answer nobody wrote is left
 * out for a reader and shown as an empty box for the owner.
 */
export function ProjectBrief({ project, botList }: { project: ProjectDetail; botList: Bot[] }) {
  const { busy, error, save } = useSave(project.id);
  const [draft, setDraft] = useState<Brief>();
  const saved = briefOf(project);
  const shown = draft ?? saved;
  const dirty = BRIEF_FIELDS.some((f) => shown[f.key] !== saved[f.key]);
  if (project.role !== "owner") {
    const written = BRIEF_FIELDS.filter((f) => saved[f.key].trim());
    return (
      <Panel title="The brief">
        {written.length ? (
          <dl className="space-y-3 text-sm">
            {written.map((f) => (
              <div key={f.key}>
                <dt className="font-medium">{f.question}</dt>
                <dd className="text-pretty text-muted-foreground">
                  <Markdown source={saved[f.key]} />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing is written yet.</p>
        )}
      </Panel>
    );
  }
  return (
    <Panel
      title="The brief"
      description="Every bot on the project reads this before it works. Keep it short and plain."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {BRIEF_FIELDS.map((f) => (
          <MentionTextarea
            key={f.key}
            title={f.question}
            bots={botList}
            rows={2}
            maxLength={BRIEF_MAX}
            placeholder={f.placeholder}
            value={shown[f.key]}
            onChange={(text) => setDraft({ ...shown, [f.key]: text })}
          />
        ))}
      </div>
      {error && <Alert theme="danger">{error}</Alert>}
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save(() => projectsApi.update(project.id, shown), "Brief saved").then(
                (ok) => ok && setDraft(undefined),
              )
            }
          >
            Save the brief
          </Button>
        </div>
      )}
    </Panel>
  );
}

const STATUS_CHOICES: { status: ProjectStatus; label: string; hint: string }[] = [
  { status: "active", label: "Active", hint: "Work goes on." },
  { status: "paused", label: "On hold", hint: "New work stops joining it by itself." },
  { status: "done", label: "Done", hint: "It reached its result." },
];

/** What only the owner changes: who is on the project, its rooms, its name and labels, how closely it is watched and whether it goes on. */
export function ProjectSettings({
  project,
  bots,
}: {
  project: ProjectDetail;
  bots: ReadonlyMap<string, Bot>;
}) {
  const candidates = useQuery(projectsQueries.candidates()).data ?? NO_CANDIDATES;
  return (
    <>
      <MembersPanel project={project} candidates={candidates} bots={bots} />
      <RoomsPanel project={project} candidates={candidates} />
      <DetailsPanel project={project} />
    </>
  );
}

function MembersPanel({
  project,
  candidates,
  bots,
}: {
  project: ProjectDetail;
  candidates: Candidates;
  bots: ReadonlyMap<string, Bot>;
}) {
  const { busy, error, save } = useSave(project.id);
  const savedBots = project.bots.map((b) => b.id);
  const savedPeople = project.people.map((p) => p.userId);
  const [draft, setDraft] = useState<{ bots: string[]; people: string[] }>();
  const shown = draft ?? { bots: savedBots, people: savedPeople };
  const dirty = !same(shown.bots, savedBots) || !same(shown.people, savedPeople);
  return (
    <Panel
      title="Who works on it"
      description="Bots on the project read the brief before they work. People on it can be asked for things and can read this page, without what waits on you."
    >
      <MemberPicker
        candidates={candidates}
        identities={bots}
        bots={shown.bots}
        people={shown.people}
        onBots={(ids) => setDraft({ ...shown, bots: ids })}
        onPeople={(ids) => setDraft({ ...shown, people: ids })}
      />
      {error && <Alert theme="danger">{error}</Alert>}
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void save(() => projectsApi.setMembers(project.id, shown), "Saved").then(
                (ok) => ok && setDraft(undefined),
              )
            }
          >
            Save who works on it
          </Button>
        </div>
      )}
    </Panel>
  );
}

function RoomsPanel({ project, candidates }: { project: ProjectDetail; candidates: Candidates }) {
  const { busy, error, save } = useSave(project.id);
  const mine = project.rooms.map((r) => r.id);
  // Rooms of this project that are closed are not candidates any more, but they stay listed until taken off.
  const rooms = [
    ...project.rooms.map((r) => ({ id: r.id, title: r.title, projectId: project.id })),
    ...candidates.rooms.filter((r) => !mine.includes(r.id)),
  ];
  const toggle = (id: string) =>
    void save(() =>
      projectsApi.setRooms(
        project.id,
        mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id],
      ),
    );
  return (
    <Panel
      title="Rooms"
      description="A room on the project works for it: its bots read the brief, and a task made there joins the project."
    >
      {rooms.length ? (
        <ul className="grid gap-1.5 md:grid-cols-2">
          {rooms.map((r) => {
            const room = project.rooms.find((x) => x.id === r.id);
            return (
              <li key={r.id}>
                <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/[0.06]">
                  <Checkbox
                    checked={mine.includes(r.id)}
                    disabled={busy}
                    onChange={() => toggle(r.id)}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                  {room?.progressPercent != null && (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {room.progressPercent}%
                    </span>
                  )}
                  {r.projectId && r.projectId !== project.id && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      On another project
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">You have no open rooms.</p>
      )}
      {error && <Alert theme="danger">{error}</Alert>}
    </Panel>
  );
}

function DetailsPanel({ project }: { project: ProjectDetail }) {
  const { busy, error, save } = useSave(project.id);
  const [name, setName] = useState<string>();
  const patch = (v: ProjectPatch, done?: string) =>
    save(() => projectsApi.update(project.id, v), done);
  const archived = project.status === "archived";
  return (
    <Panel title="Settings">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const next = (name ?? project.name).trim();
          if (next && next !== project.name)
            void patch({ name: next }, "Renamed").then((ok) => ok && setName(undefined));
        }}
      >
        <Input
          title="Name"
          maxLength={120}
          container="min-w-48 flex-1 sm:max-w-md"
          value={name ?? project.name}
          onChange={(e) => setName(e.target.value)}
        />
        {name !== undefined && name.trim() !== project.name && (
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            Rename
          </Button>
        )}
      </form>
      <div className="space-y-1">
        <p className="text-sm font-medium">Labels</p>
        <LabelsEditor
          labels={project.labels}
          known={[]}
          onChange={(labels) => void patch({ labels })}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How closely to watch</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {PROJECT_WATCH.map((w) => (
            <div key={w.watch} className="text-sm">
              <Radiobox
                name="project-watch"
                checked={project.watch === w.watch}
                disabled={busy}
                onChange={() => void patch({ watch: w.watch })}
              >
                {w.label}
              </Radiobox>
              <p className="pl-6 text-pretty text-muted-foreground">{w.hint}</p>
            </div>
          ))}
        </div>
      </fieldset>
      {!archived && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Where it is</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {STATUS_CHOICES.map((s) => (
              <div key={s.status} className="text-sm">
                <Radiobox
                  name="project-status"
                  checked={project.status === s.status}
                  disabled={busy}
                  onChange={() => void patch({ status: s.status })}
                >
                  {s.label}
                </Radiobox>
                <p className="pl-6 text-pretty text-muted-foreground">{s.hint}</p>
              </div>
            ))}
          </div>
        </fieldset>
      )}
      {error && <Alert theme="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        {archived ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void patch({ status: "active" }, "The project is back")}
          >
            Bring it back
          </Button>
        ) : (
          <ConfirmButton
            label="Archive the project"
            question="Archive it? Its tasks, rooms and memory stay, and you can bring it back."
            confirmLabel="Archive"
            onConfirm={() => void patch({ status: "archived" }, "Archived")}
          />
        )}
        <p className="text-sm text-muted-foreground">
          A project is never deleted: archiving hides it from the list.
        </p>
      </div>
    </Panel>
  );
}
