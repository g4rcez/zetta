import { Alert } from "@g4rcez/components/alert";
import { ArrowLeftIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { Button, Select } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { toast } from "@/lib/notify";
import { catchUpItemSearch } from "../catch-up/catch-up-search";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { MentionField, MentionTextarea } from "../chat/mention";
import { relativeTime } from "../shared/relative-time";
import { Badge, Empty, Loading, Panel } from "../shared/ui";
import { LabelChip, StatusIcon } from "../tasks/task-badges";
import { TASK_COLUMNS, tasksApi } from "../tasks/tasks-api";
import { HealthBadge, ProjectProgress } from "./project-bits";
import { ProjectBrief, ProjectSettings } from "./project-settings";
import { workByWorker, type WorkGroup, type Worker } from "./project-work";
import {
  projectsApi,
  projectsQueries,
  type NeedsYou,
  type ProjectDetail,
  type ProjectTask,
  type WorkTarget,
} from "./projects-api";

const NO_BOTS: Bot[] = [];
type Bots = ReadonlyMap<string, Bot>;
const statusLabel = (status: ProjectTask["status"]) =>
  TASK_COLUMNS.find((c) => c.status === status)!.label;

/**
 * One project, in the order a manager asks about it: where it stands, what waits on them, who is doing what, what was finished, then
 * asking for something new. The brief and the settings come last. A person who is not the owner reads the same page without the flags
 * and without anything to change.
 */
export function ProjectPage({ id }: { id: string }) {
  const { data: project, error, isPending } = useQuery(projectsQueries.detail(id));
  const botList = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const bots = useMemo(() => new Map(botList.map((b) => [b.id, b])), [botList]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 p-4 md:p-8">
        <Link
          to="/projects"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Projects
        </Link>
        {error && <Alert theme="danger">{errorMessage(error)}</Alert>}
        {isPending && <Loading />}
        {project && <ProjectView project={project} bots={bots} botList={botList} />}
      </div>
    </div>
  );
}

function ProjectView({
  project,
  bots,
  botList,
}: {
  project: ProjectDetail;
  bots: Bots;
  botList: Bot[];
}) {
  const owner = project.role === "owner";
  const groups = workByWorker(project);
  const now = Date.now();
  return (
    <>
      <header className="space-y-2 border-b pb-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-2xl text-balance">{project.name}</h1>
          <HealthBadge health={project.health} />
          <ProjectProgress counts={project.counts} />
        </div>
        <p className="text-pretty text-muted-foreground">{project.health.sentence}</p>
        {project.labels.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {project.labels.map((l) => (
              <LabelChip key={l} label={l} />
            ))}
          </p>
        )}
      </header>
      {owner && project.needsYou.length > 0 && (
        <Panel
          title="Needs you"
          count={project.needsYou.length}
          description="Work that waits until you say something."
        >
          <ul className="divide-y">
            {project.needsYou.map((n) => (
              <NeedsYouRow key={n.taskId} item={n} bots={bots} />
            ))}
          </ul>
        </Panel>
      )}
      <Panel
        title="In progress"
        count={project.tasks.length}
        description="Everything that is not done yet, by who does it."
      >
        {groups.length ? (
          <div className="space-y-5">
            {groups.map((g) => (
              <WorkerGroup key={g.key} group={g} bots={bots} botList={botList} now={now} />
            ))}
          </div>
        ) : (
          <Empty>
            {owner
              ? "Nobody is on this project and nothing was asked for yet. Add who works on it below."
              : "Nothing is open on this project."}
          </Empty>
        )}
      </Panel>
      <Panel title="Done this week" count={project.shipped.length}>
        {project.shipped.length ? (
          <ul className="divide-y">
            {project.shipped.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                <StatusIcon status="done" />
                <TaskTitle task={t} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {relativeTime(t.updatedAt, now)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing was finished in the last 7 days.</p>
        )}
      </Panel>
      {owner && <AskBox project={project} bots={bots} botList={botList} />}
      <ProjectBrief project={project} botList={botList} />
      {owner && <MemoryPanel project={project} now={now} />}
      {owner && <ProjectSettings project={project} bots={bots} />}
    </>
  );
}

/** The name of a task: a link for whoever may open it, plain text for a colleague who may not. */
function TaskTitle({ task }: { task: Pick<ProjectTask, "id" | "title" | "canOpen"> }) {
  if (!task.canOpen) return <span className="min-w-0 truncate">{task.title}</span>;
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: task.id }}
      className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
    >
      {task.title}
    </Link>
  );
}

const WHY: Record<NeedsYou["why"], string> = {
  card: "Waiting for your answer",
  blocked: "Blocked",
  review: "Ready for you to look at",
};

function NeedsYouRow({ item, bots }: { item: NeedsYou; bots: Bots }) {
  const bot = item.botId ? bots.get(item.botId) : undefined;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3 text-sm">
      <div className="min-w-0 flex-1 basis-72 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <TaskTitle task={{ id: item.taskId, title: item.title, canOpen: true }} />
          <Badge tone="warning">{WHY[item.why]}</Badge>
        </p>
        {item.text && <p className="line-clamp-3 text-pretty text-muted-foreground">{item.text}</p>}
        <p className="text-xs text-muted-foreground">
          {item.assigneeName
            ? `With ${item.assigneeName}`
            : bot
              ? `With ${bot.name}`
              : "Nobody is on it"}
        </p>
      </div>
      {item.cardId ? (
        <Link
          to="/catch-up"
          search={catchUpItemSearch(`card:${item.cardId}`)}
          className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
        >
          Answer in the Inbox
        </Link>
      ) : (
        <Link
          to="/tasks/$taskId"
          params={{ taskId: item.taskId }}
          className="shrink-0 font-medium text-primary underline-offset-4 hover:underline"
        >
          Open the task
        </Link>
      )}
    </li>
  );
}

function WorkerFace({ worker, bots }: { worker: Worker; bots: Bots }) {
  if (worker.kind === "bot")
    return (
      <BotIdentity
        bot={bots.get(worker.id) ?? { id: worker.id, name: worker.name }}
        size={24}
        className="flex-none"
      />
    );
  if (worker.kind === "person")
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <UserAvatar name={worker.name} size={24} />
        <span className="truncate text-sm font-medium">{worker.name}</span>
      </span>
    );
  return <span className="text-sm font-medium text-muted-foreground">Nobody yet</span>;
}

/**
 * "Tell them…": the manager writes about one task to whoever does it, without opening a chat. A bot reads it at once; a person gets
 * it in their Inbox. The box opens under the row and closes when the words are sent.
 */
function TellBox({
  task,
  worker,
  botList,
}: {
  task: Pick<ProjectTask, "id" | "title">;
  worker: Exclude<Worker, { kind: "nobody" }>;
  botList: Bot[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const label = worker.kind === "bot" ? "Tell it…" : `Tell ${worker.name.split(" ")[0]}…`;
  async function send() {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { done } = await tasksApi.tell(task.id, words);
      setText("");
      setOpen(false);
      toast.success(done);
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="basis-full space-y-2 rounded-lg border bg-muted/30 p-3">
      <MentionField
        aria-label={`What to tell ${worker.name} about ${task.title}`}
        bots={botList}
        rows={2}
        autoFocus
        maxLength={4000}
        disabled={busy}
        placeholder={
          worker.kind === "bot"
            ? "What should it do? It reads this now and goes on from there."
            : "Your message goes to their Inbox. The answer comes back to you."
        }
        wrapperClassName="rounded-lg border bg-background px-3 py-2"
        value={text}
        onChange={setText}
        onKeyDown={(e) => {
          // Ctrl or Cmd with Enter sends; Enter alone adds a line.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !text.trim()} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function WorkerGroup({
  group,
  bots,
  botList,
  now,
}: {
  group: WorkGroup;
  bots: Bots;
  botList: Bot[];
  now: number;
}) {
  return (
    <section aria-label={group.worker.kind === "nobody" ? "Nobody yet" : group.worker.name}>
      <WorkerFace worker={group.worker} bots={bots} />
      {group.tasks.length ? (
        <ul className="mt-2 divide-y border-l-2 pl-3">
          {group.tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <StatusIcon status={t.status} />
              <TaskTitle task={t} />
              <span className="text-xs text-muted-foreground">{statusLabel(t.status)}</span>
              {t.stepsTotal > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t.stepsDone} of {t.stepsTotal} steps
                </span>
              )}
              {t.followUp === "paused" && <Badge tone="warning">Stopped</Badge>}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {relativeTime(t.updatedAt, now)}
              </span>
              {t.canTell && group.worker.kind !== "nobody" && (
                <TellBox task={t} worker={group.worker} botList={botList} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 pl-3 text-sm text-muted-foreground">Nothing open.</p>
      )}
    </section>
  );
}

/** What the bots of the project wrote down for each other. The owner reads it here and corrects it on the Memory page. */
function MemoryPanel({ project, now }: { project: ProjectDetail; now: number }) {
  const { items, total } = project.memory;
  return (
    <Panel
      title="Project memory"
      count={total}
      description="Notes and decisions the bots keep for this project. You can read and correct them."
      action={
        total > 0 && (
          <Link
            to="/memory"
            search={{ project: project.id }}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            See all in Memory
          </Link>
        )
      }
    >
      {items.length ? (
        <ul className="divide-y">
          {items.map((n) => (
            <li key={n.slug} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <Link
                to="/memory/$slug"
                params={{ slug: n.slug }}
                className="font-medium underline-offset-4 hover:underline"
              >
                {n.title}
              </Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{n.howto}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {relativeTime(n.updatedAt, now)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          Nothing yet. The bots on this project add to it as they learn things the others need.
        </p>
      )}
    </Panel>
  );
}

/**
 * The manager asks for something without leaving the page: who, and what in their own words. The task appears in the list above as soon
 * as it is sent; a bot is told in its chat, a person gets it in their Inbox.
 */
function AskBox({
  project,
  bots,
  botList,
}: {
  project: ProjectDetail;
  bots: Bots;
  botList: Bot[];
}) {
  const qc = useQueryClient();
  const options = [
    ...project.bots.map((b) => ({ value: `bot:${b.id}`, label: bots.get(b.id)?.name ?? b.name })),
    ...project.people.map((p) => ({ value: `person:${p.userId}`, label: p.name })),
  ];
  const [to, setTo] = useState(options[0]?.value ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Someone who left the project is no longer a choice: fall back to the first one who is.
  const chosen = options.some((o) => o.value === to) ? to : (options[0]?.value ?? "");
  async function send() {
    const what = text.trim();
    if (!what || !chosen || busy) return;
    const [kind, ...rest] = chosen.split(":");
    const target: WorkTarget = { kind: kind as WorkTarget["kind"], id: rest.join(":") };
    setBusy(true);
    setError(undefined);
    try {
      await projectsApi.ask(project.id, target, what);
      setText("");
      await qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(
        target.kind === "bot" ? "Sent. The bot is on it." : "Sent. It is in their Inbox now.",
      );
    } catch (x) {
      setError(errorMessage(x));
    } finally {
      setBusy(false);
    }
  }
  if (!options.length)
    return (
      <Panel title="Ask for something">
        <p className="text-sm text-pretty text-muted-foreground">
          Add a bot or a person to this project under “Who works on it” below. Then you can ask them
          for things from here.
        </p>
      </Panel>
    );
  return (
    <Panel
      title="Ask for something"
      description="Say what you want in your own words. It becomes a task on this project."
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          title="Who"
          required={false}
          container="w-56 max-w-full"
          value={chosen}
          options={options}
          onChange={(e) => setTo(e.target.value)}
        />
        <MentionTextarea
          title="What do you want?"
          className="min-w-0 flex-1 basis-80"
          bots={botList}
          rows={2}
          maxLength={4000}
          placeholder="Write the welcome email for new customers. Keep it under 150 words."
          value={text}
          onChange={setText}
          onKeyDown={(e) => {
            // Ctrl or Cmd with Enter sends; Enter alone adds a line.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button disabled={busy || !text.trim()} onClick={() => void send()}>
          <PaperPlaneRightIcon aria-hidden="true" className="size-4" />
          {busy ? "Sending…" : "Ask"}
        </Button>
      </div>
      {error && <Alert theme="danger">{error}</Alert>}
    </Panel>
  );
}
