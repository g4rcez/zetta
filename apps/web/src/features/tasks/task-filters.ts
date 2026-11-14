import {
  TASK_COLUMNS,
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "./tasks-api";
import { isUuid } from "../shared/search-params";

/** Value in `botIds` for tasks that no bot owns (`botId === null`). */
export const NO_BOT = "none";
/** Value in `botIds` for the tasks assigned to the person who looks at the page. */
export const FOR_ME = "me";
/** Value in `botIds` for the tasks of any bot: every task a bot owns for itself, not the ones it asked of a person. */
export const ANY_BOT = "bots";

export type TimeWindow = "any" | "day" | "week" | "month";
export type ThreadFilter = "any" | "with" | "without";
/** `open` is every task that is not Done yet (backlog, in progress, blocked and review); `done` is the Done column only. */
export type StageFilter = "any" | "open" | "done";
export type TaskSort = "default" | "updated" | "created" | "title";

export type TaskFilters = {
  query: string;
  /** Bot ids, `NO_BOT` and `FOR_ME`. Empty means every bot. */
  botIds: string[];
  /** Columns to keep. Empty means every column. */
  statuses: TaskStatus[];
  stage: StageFilter;
  /** Priorities to keep. Empty means every priority. */
  priorities: TaskPriority[];
  /** A task passes when it has at least one of these labels. Empty means every task. */
  labels: string[];
  thread: ThreadFilter;
  updated: TimeWindow;
  created: TimeWindow;
  sort: TaskSort;
};

export const DEFAULT_FILTERS: TaskFilters = {
  query: "",
  botIds: [],
  statuses: [],
  stage: "any",
  priorities: [],
  labels: [],
  thread: "any",
  updated: "any",
  created: "any",
  sort: "default",
};

export const WINDOW_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];
export const STAGE_OPTIONS: { value: StageFilter; label: string }[] = [
  { value: "any", label: "All" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
];
export const THREAD_OPTIONS: { value: ThreadFilter; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "with", label: "Has a thread" },
  { value: "without", label: "No thread" },
];
export const SORT_OPTIONS: { value: TaskSort; label: string }[] = [
  { value: "default", label: "Default order" },
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Recently created" },
  { value: "title", label: "Title, A to Z" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS: Record<Exclude<TimeWindow, "any">, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

const inStage = (status: TaskStatus, stage: StageFilter) =>
  stage === "any" || (stage === "done") === (status === "done");

const within = (iso: string, window: TimeWindow, now: number) =>
  window === "any" || Date.parse(iso) >= now - WINDOW_MS[window];

/** Number of active filters. Each filter counts once, and the sort order is not a filter. */
export function activeCount(f: TaskFilters): number {
  return [
    f.query.trim() !== "",
    f.botIds.length > 0,
    f.statuses.length > 0,
    f.stage !== "any",
    f.priorities.length > 0,
    f.labels.length > 0,
    f.thread !== "any",
    f.updated !== "any",
    f.created !== "any",
  ].filter(Boolean).length;
}

/** Keeps the tasks that pass every filter, then orders them. Never changes the input array. `viewerId` is who looks at the page (for `FOR_ME`). */
export function applyFilters(tasks: Task[], f: TaskFilters, now: number, viewerId = ""): Task[] {
  const query = f.query.trim().toLowerCase();
  const kept = tasks.filter(
    (t) =>
      (query === "" ||
        t.title.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)) &&
      (f.botIds.length === 0 ||
        f.botIds.includes(t.botId ?? NO_BOT) ||
        (f.botIds.includes(ANY_BOT) && t.assignee === "bot" && t.botId !== null) ||
        (f.botIds.includes(FOR_ME) && t.assignee === "person" && t.assigneeUserId === viewerId)) &&
      (f.statuses.length === 0 || f.statuses.includes(t.status)) &&
      inStage(t.status, f.stage) &&
      (f.priorities.length === 0 || f.priorities.includes(t.priority)) &&
      (f.labels.length === 0 || t.labels.some((l) => f.labels.includes(l))) &&
      (f.thread === "any" || (f.thread === "with") === (t.conversationId !== null)) &&
      within(t.updatedAt, f.updated, now) &&
      within(t.createdAt, f.created, now),
  );
  if (f.sort === "updated")
    return kept.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (f.sort === "created")
    return kept.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (f.sort === "title") return kept.sort((a, b) => a.title.localeCompare(b.title));
  return kept;
}

export type TaskLayout = "board" | "list";
export type GroupBy = "status" | "assignee";
/** Everything the tasks page keeps in the URL: the filters, how to show them, and the task open in the side panel. */
export type TaskState = TaskFilters & { view: TaskLayout; groupBy: GroupBy; task?: string };
/** The URL form of `TaskState`: only what differs from the defaults. */
export type TaskSearch = Partial<TaskState>;

export const DEFAULT_STATE: TaskState = { ...DEFAULT_FILTERS, view: "board", groupBy: "status" };

/** "Work in progress": the open tasks of every bot, one lane per bot. Done tasks leave it on their own. */
export const WORK_IN_PROGRESS: Pick<TaskState, "stage" | "botIds" | "groupBy"> = {
  stage: "open",
  botIds: [ANY_BOT],
  groupBy: "assignee",
};
/** Whether the page shows exactly that view (the button that opens it is pressed). */
export const isWorkInProgress = (s: TaskState) =>
  s.stage === WORK_IN_PROGRESS.stage &&
  s.groupBy === WORK_IN_PROGRESS.groupBy &&
  s.botIds.length === 1 &&
  s.botIds[0] === ANY_BOT;

export type TaskGroup = { key: string; label: string; tasks: Task[] };
type BotName = { id: string; name: string };

/** Splits the tasks into the board columns (status) or one group per person, then per bot (assignee). Never changes the input. */
export function groupTasks(
  tasks: Task[],
  groupBy: GroupBy,
  bots: BotName[],
  statuses: TaskStatus[],
  stage: StageFilter = "any",
): TaskGroup[] {
  if (groupBy === "status") {
    // The columns the stage rules out stay off the board: "open" has no Done column, "done" has only that one.
    return TASK_COLUMNS.filter(
      (c) => (statuses.length === 0 || statuses.includes(c.status)) && inStage(c.status, stage),
    ).map((c) => ({
      key: c.status,
      label: c.label,
      tasks: tasks.filter((t) => t.status === c.status),
    }));
  }
  const known = new Set(bots.map((b) => b.id));
  const owner = (t: Task) =>
    t.assignee === "person"
      ? `person:${t.assigneeUserId}`
      : t.botId && known.has(t.botId)
        ? t.botId
        : NO_BOT;
  const people = new Map(
    tasks
      .filter((t) => t.assignee === "person")
      .map((t) => [`person:${t.assigneeUserId}`, t.assigneeName ?? "A person"]),
  );
  return [
    ...[...people].map(([key, label]) => ({ key, label })),
    ...bots.map((b) => ({ key: b.id, label: b.name })),
    { key: NO_BOT, label: "Unassigned" },
  ]
    .map((g) => ({ ...g, tasks: tasks.filter((t) => owner(t) === g.key) }))
    .filter((g) => g.tasks.length > 0);
}

const THREADS = THREAD_OPTIONS.map((o) => o.value);
const STAGES = STAGE_OPTIONS.map((o) => o.value);
const WINDOWS = WINDOW_OPTIONS.map((o) => o.value);
const SORTS = SORT_OPTIONS.map((o) => o.value);
const STATUSES: string[] = TASK_COLUMNS.map((c) => c.status);
const PRIORITIES: string[] = TASK_PRIORITIES.map((p) => p.priority);

const text = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : undefined;
/** A list from the URL: one value or many, numbers turned into text, empty values dropped. */
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map(text).filter((x): x is string => !!x);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** Leaves out every value that equals its default, so links stay short. */
export function toTaskSearch(state: TaskState): TaskSearch {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_STATE) as (keyof TaskState)[]) {
    const value = state[key];
    const same = Array.isArray(value) ? value.length === 0 : value === DEFAULT_STATE[key];
    if (!same) out[key] = value;
  }
  if (state.task) out.task = state.task;
  return out as TaskSearch;
}

/** Reads the URL search of the tasks page. Anything invalid falls back to its default. */
export function parseTaskSearch(raw: Record<string, unknown>): TaskSearch {
  const task = text(raw.task);
  return toTaskSearch({
    query: text(raw.query) ?? "",
    botIds: list(raw.botIds),
    statuses: list(raw.statuses).filter((s): s is TaskStatus => STATUSES.includes(s)),
    stage: pick(raw.stage, STAGES, "any"),
    priorities: list(raw.priorities).filter((p): p is TaskPriority => PRIORITIES.includes(p)),
    labels: list(raw.labels),
    thread: pick(raw.thread, THREADS, "any"),
    updated: pick(raw.updated, WINDOWS, "any"),
    created: pick(raw.created, WINDOWS, "any"),
    sort: pick(raw.sort, SORTS, "default"),
    view: pick(raw.view, ["board", "list"], "board"),
    groupBy: pick(raw.groupBy, ["status", "assignee"], "status"),
    task: isUuid(task) ? task : undefined,
  });
}
