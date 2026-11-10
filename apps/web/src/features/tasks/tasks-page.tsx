import { ActionHint } from "@/components/action-hint";
import { mentionsAsText } from "@zetta/core/mentions";
import { Link } from "@tanstack/react-router";
import {
  ChatIcon,
  DotsThreeIcon,
  KanbanIcon,
  ListIcon,
  PlusIcon,
  TrashIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type DragEvent } from "react";
import { toast } from "@/lib/notify";
import { Button, Input, MENU_DANGER, Menu, MenuItem } from "@/components/ui";
import { BotAvatar } from "@/components/bot-avatar";
import { authClient } from "@/lib/auth-client";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { relativeTime } from "../shared/relative-time";
import { FollowUpChip, LabelChips, PriorityIcon, StepChip } from "./task-badges";
import { GROUP_OPTIONS, Segmented, TaskFilterBar } from "./task-filter-bar";
import {
  activeCount,
  applyFilters,
  DEFAULT_STATE,
  groupTasks,
  parseTaskSearch,
  toTaskSearch,
  type TaskLayout,
  type TaskSearch,
  type TaskState,
} from "./task-filters";
import { GroupIcon, openOnClick, TaskList, TaskTitleLink } from "./task-list";
import { TaskPeek } from "./task-peek";
import { stepCounts, type StepCount } from "./task-steps";
import { TASK_COLUMNS, tasksApi, tasksQueries, type Task, type TaskStatus } from "./tasks-api";
import { useTimeFormat } from "../preferences/preferences";
import { formatDateTime } from "../preferences/time-format";

const NO_TASKS: Task[] = [];
const NO_COUNTS = new Map<string, StepCount>();
const NO_BOTS: Bot[] = [];

const LAYOUTS: { value: TaskLayout; label: string; icon: React.ReactNode }[] = [
  { value: "board", label: "Board", icon: <KanbanIcon aria-hidden className="size-4" /> },
  { value: "list", label: "List", icon: <ListIcon aria-hidden className="size-4" /> },
];

export function TasksPage({
  search,
  onSearch,
}: {
  search: TaskSearch;
  onSearch: (next: TaskSearch) => void;
}) {
  const qc = useQueryClient();
  const tasksQuery = useQuery(tasksQueries.list());
  const botsQuery = useQuery(chatQueries.bots());
  const tasks = tasksQuery.data ?? NO_TASKS;
  const counts = useQuery({ ...tasksQueries.list(), select: stepCounts }).data ?? NO_COUNTS;
  const cached = () => qc.getQueryData<Task[]>(tasksQueries.list().queryKey) ?? tasks;
  const bots = botsQuery.data ?? NO_BOTS;
  const loaded = !tasksQuery.isPending;
  const setTasks = (next: (all: Task[]) => Task[]) =>
    qc.setQueryData<Task[]>(tasksQueries.list().queryKey, (all) => next(all ?? []));
  const [title, setTitle] = useState("");
  const [over, setOver] = useState<TaskStatus>();
  const [adding, setAdding] = useState<TaskStatus>();
  const viewerId = authClient.useSession().data?.user.id;
  const state: TaskState = { ...DEFAULT_STATE, ...parseTaskSearch(search) };
  const setState = (next: TaskState) => onSearch(toTaskSearch(next));
  const now = Date.now();
  const visible = applyFilters(tasks, state, now, viewerId);
  const groups = groupTasks(visible, state.groupBy, bots, state.statuses);
  const byStatus = state.groupBy === "status";
  const knownLabels = [...new Set(tasks.flatMap((t) => t.labels))].sort();
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const loadError = tasksQuery.error;
  useEffect(() => {
    if (loadError) toast.error(errorMessage(loadError), { id: "tasks-load" });
  }, [loadError]);
  const settled = () => void qc.invalidateQueries({ queryKey: ["tasks"] });

  const move = (id: string, status: TaskStatus) => {
    const before = cached();
    if (before.find((t) => t.id === id)?.status === status) return;
    setTasks((all) => all.map((t) => (t.id === id ? { ...t, status } : t)));
    tasksApi
      .move(id, status)
      .catch((e) => {
        setTasks(() => before);
        fail(e);
      })
      .finally(settled);
  };
  const remove = (id: string) => {
    const before = cached();
    setTasks((all) => all.filter((t) => t.id !== id));
    tasksApi
      .remove(id)
      .catch((e) => {
        setTasks(() => before);
        fail(e);
      })
      .finally(settled);
  };
  const replace = (saved: Task) =>
    setTasks((all) => all.map((t) => (t.id === saved.id ? saved : t)));
  const open = (id: string | undefined) => setState({ ...state, task: id });
  const clear = () =>
    setState({ ...DEFAULT_STATE, view: state.view, groupBy: state.groupBy, task: state.task });
  const add = (value: string, status?: TaskStatus) => {
    value = value.trim();
    if (!value) return;
    tasksApi
      .create(value, status)
      .then((t) => setTasks((all) => [t, ...all]), fail)
      .finally(settled);
  };
  const drop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setOver(undefined);
    const id = e.dataTransfer.getData("text/plain");
    if (id) move(id, status);
  };

  return (
    <div className="flex h-full min-h-0">
      <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl">Tasks</h1>
          <Segmented
            label="View"
            value={state.view}
            options={LAYOUTS}
            onChange={(view) => setState({ ...state, view })}
          />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">
              {visible.length} of {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </p>
            <Segmented
              label="Group by"
              value={state.groupBy}
              options={GROUP_OPTIONS}
              onChange={(groupBy) => setState({ ...state, groupBy })}
            />
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add(title);
                setTitle("");
              }}
            >
              <Input
                hiddenLabel
                title="New task"
                placeholder="New task"
                value={title}
                maxLength={200}
                container="w-56"
                onChange={(e) => setTitle(e.target.value)}
              />
              {/* No hint: it shows the text Add. */}
              <Button type="submit" aria-label="Add task">
                <PlusIcon /> Add
              </Button>
            </form>
          </div>
        </header>
        <TaskFilterBar state={state} onChange={setState} bots={bots} labels={knownLabels} />
        {loaded && tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tasks yet. Add one, or ask a bot to turn a request into a task.
          </p>
        )}
        {loaded && tasks.length > 0 && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No tasks match these filters ({activeCount(state)} active).{" "}
            <button
              type="button"
              onClick={clear}
              className="underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              Clear filters
            </button>
          </p>
        )}
        {state.view === "list" ? (
          <TaskList
            groups={groups}
            groupBy={state.groupBy}
            bots={bots}
            now={now}
            steps={counts}
            openId={state.task}
            onOpen={open}
          />
        ) : (
          <div className="grid min-h-0 flex-1 grid-flow-col auto-cols-[minmax(16rem,1fr)] gap-3 overflow-x-auto">
            {groups.map((group) => {
              const status = group.key as TaskStatus;
              return (
                <section
                  key={group.key}
                  aria-label={group.label}
                  onDragOver={
                    byStatus
                      ? (e) => {
                          e.preventDefault();
                          setOver(status);
                        }
                      : undefined
                  }
                  onDragLeave={
                    byStatus
                      ? (e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                            setOver(undefined);
                        }
                      : undefined
                  }
                  onDrop={byStatus ? (e) => drop(e, status) : undefined}
                  className={`flex min-h-0 flex-col gap-2 rounded-xl bg-muted/40 p-2 transition-colors ${byStatus && over === status ? "bg-muted ring-2 ring-ring/60" : ""}`}
                >
                  <header className="flex items-center gap-2 px-1 py-1">
                    <GroupIcon group={group} groupBy={state.groupBy} bots={bots} />
                    <h2 className="text-sm font-medium">{group.label}</h2>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {group.tasks.length}
                    </span>
                    {byStatus && (
                      <ActionHint label={`Add task to ${group.label}`}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Add task to ${group.label}`}
                          onClick={() => setAdding(status)}
                          className="ml-auto"
                        >
                          <PlusIcon className="size-4" />
                        </Button>
                      </ActionHint>
                    )}
                  </header>
                  {byStatus && adding === status && (
                    <Input
                      autoFocus
                      hiddenLabel
                      title={`New task in ${group.label}`}
                      size="small"
                      placeholder="Task title, Enter to add"
                      maxLength={200}
                      container="w-full"
                      onBlur={() => setAdding(undefined)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setAdding(undefined);
                        if (e.key !== "Enter") return;
                        add(e.currentTarget.value, status);
                        setAdding(undefined);
                      }}
                    />
                  )}
                  <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                    {group.tasks.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        now={now}
                        steps={counts.get(t.id)}
                        bot={bots.find((b) => b.id === t.botId)}
                        viewerId={viewerId}
                        draggable={byStatus}
                        selected={t.id === state.task}
                        onOpen={() => open(t.id)}
                        onMove={(to) => move(t.id, to)}
                        onDelete={() => remove(t.id)}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
      {state.task && (
        <TaskPeek
          taskId={state.task}
          tasks={groups.flatMap((g) => g.tasks)}
          knownLabels={knownLabels}
          onOpen={open}
          onClose={() => open(undefined)}
          onChange={replace}
          onDeleted={(id) => {
            setTasks((all) => all.filter((t) => t.id !== id));
            open(undefined);
          }}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  now,
  steps,
  bot,
  viewerId,
  draggable,
  selected,
  onOpen,
  onMove,
  onDelete,
}: {
  task: Task;
  now: number;
  steps: StepCount | undefined;
  bot: Bot | undefined;
  /** Who looks at the board. Only the owner deletes a task; a person it is assigned to moves it. */
  viewerId: string | undefined;
  /** Only on the status board: dropping on a column changes the status. */
  draggable: boolean;
  selected: boolean;
  onOpen: () => void;
  onMove: (to: TaskStatus) => void;
  onDelete: () => void;
}) {
  const tf = useTimeFormat();
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
      onClick={openOnClick(onOpen)}
      className={`flex cursor-pointer flex-col gap-2 rounded-lg bg-background p-3 text-sm shadow-sm ring-1 transition-shadow hover:shadow-md ${draggable ? "active:cursor-grabbing" : ""} ${selected ? "ring-2 ring-ring" : "ring-border/60"}`}
    >
      <div className="flex items-start gap-2">
        <TaskTitleLink
          task={task}
          className="min-w-0 flex-1 break-words font-medium hover:underline"
        />
        {task.assignee === "person" && (
          <span
            title={`Assigned to ${task.assigneeUserId === viewerId ? "you" : (task.assigneeName ?? "a person")}`}
            className="shrink-0"
          >
            <UserCircleIcon aria-hidden className="size-5 text-attention" />
          </span>
        )}
        {bot && (
          <span title={bot.name} className="shrink-0">
            <BotAvatar bot={bot} size={20} square />
          </span>
        )}
        <Menu
          asChild
          hover={false}
          restoreFocus
          title=""
          floatingClassName="w-44"
          label={
            <ActionHint label={`${task.title} menu`}>
              <button
                type="button"
                aria-label={`${task.title} menu`}
                className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-open:bg-muted"
              >
                <DotsThreeIcon aria-hidden="true" className="size-4" />
              </button>
            </ActionHint>
          }
        >
          {TASK_COLUMNS.filter((c) => c.status !== task.status).map((c) => (
            <MenuItem key={c.status} title={`Move to ${c.label}`} onClick={() => onMove(c.status)}>
              Move to {c.label}
            </MenuItem>
          ))}
          {(!viewerId || task.ownerUserId === viewerId) && (
            <MenuItem title="Delete" className={MENU_DANGER} onClick={onDelete}>
              <TrashIcon /> Delete
            </MenuItem>
          )}
        </Menu>
      </div>
      {task.description && (
        <p className="line-clamp-2 break-words text-xs text-muted-foreground">
          {mentionsAsText(task.description)}
        </p>
      )}
      {(task.priority !== "none" || task.labels.length > 0 || steps || task.followUp !== "off") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {task.priority !== "none" && <PriorityIcon priority={task.priority} />}
          {steps && <StepChip count={steps} />}
          <FollowUpChip task={task} />
          <LabelChips labels={task.labels} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span title={formatDateTime(task.createdAt, tf)}>
          Created {relativeTime(task.createdAt, now)}
        </span>
        <span title={formatDateTime(task.updatedAt, tf)}>
          Updated {relativeTime(task.updatedAt, now)}
        </span>
        {task.conversationId && (
          <Link
            to="/chat/{-$chatId}"
            params={{ chatId: task.conversationId }}
            className="ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-muted"
          >
            <ChatIcon className="size-3" /> Thread
          </Link>
        )}
      </div>
    </li>
  );
}
