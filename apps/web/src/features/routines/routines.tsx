import { uuidv7 } from "@zetta/core/uuid";
import { Link, useNavigate } from "@tanstack/react-router";
import { CaretRightIcon, ChatIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react";
import { RoutineCalendar } from "./routine-calendar";
import { RoutineTimeline } from "./routine-timeline";
import type { RoutinesSearch } from "./routines-search";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input, Radiobox, Select } from "@/components/ui";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { RoutineTriggers, runOrigin } from "./routine-triggers";
import { Badge, ConfirmButton, Empty, Modal, list, listItem, useList, when } from "../shared/ui";
import { relativeTime } from "../shared/relative-time";
import { summarize } from "../studio/routine-format";
import { refreshAttention, useRoutineUnreadChats } from "../attention/summary";
import {
  buildSchedule,
  describeSchedule,
  scheduleText,
  type ScheduleMode,
} from "../studio/routine-schedule";
import { Alert } from "@g4rcez/components/alert";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

export type Routine = {
  id: string;
  botId: string;
  title: string;
  prompt: string;
  timezone: string;
  dailyAt: string | null;
  /** The days a daily routine runs on (0 = Sunday); null = every day. */
  weekdays?: number[] | null;
  everyMinutes: number | null;
  kind?: "recurring" | "once";
  /** The routine's one chat (every run adds to it); null before the first run. */
  conversationId?: string | null;
  version: number;
  workflowId?: string | null;
  onceAt?: string | null;
  paused: boolean;
  status?: RoutineStatus;
  statusReason?: string | null;
  nextRunAt: string | null;
  lastRunAt?: string | null;
  statusAt?: string;
  /** When an occurrence comes while the previous run still works. */
  overlapPolicy?: "skip" | "queue" | "replace";
  /** After downtime: run once for what was missed, or skip to the next. */
  catchUp?: "run_once" | "skip";
  /** "goal": a standing goal; each run continues from the last run's report, and only the owner ends it. */
  mode?: "task" | "goal";
  /** "Skip next" is on until this instant. */
  skipUntil?: string | null;
  failures?: number;
  maxFailures?: number;
};
type RoutineStatus =
  | "paused"
  | "scheduled"
  | "running"
  | "failed"
  | "interrupted"
  | "blocked"
  | "completed";
type Summary = {
  id?: string;
  task: string;
  bot: string;
  schedule: string;
  timezone: string;
  nextRuns: string[];
  contextMode: string;
  accounts: string[];
  destination: string;
  missing: unknown[];
  version: number;
};
export type Run = {
  id: string;
  status:
    | "running"
    | "succeeded"
    | "failed"
    | "skipped"
    | "blocked"
    | "interrupted"
    | "cancelled"
    | "following";
  reasonCode: string | null;
  output: string;
  /** What the bot did in this run: the step labels of the reply it produced (older servers send none). */
  steps?: string[];
  conversationId: string | null;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  /** What started a webhook or event run (a body, a mail, a state change): outside data. */
  event?: unknown;
};
type Flow = { id: string; name: string };
const NO_RUNS: Run[] = [];

export const RUN_STATUS: Record<Run["status"], string> = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  interrupted: "Interrupted",
  cancelled: "Stopped",
  following: "Working on its tasks",
};
export const ROUTINE_STATUS: Record<
  RoutineStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }
> = {
  paused: { label: "Paused", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "success" },
  running: { label: "Running", tone: "info" },
  failed: { label: "Last run failed", tone: "danger" },
  interrupted: { label: "Interrupted", tone: "warning" },
  blocked: { label: "Blocked", tone: "warning" },
  completed: { label: "Completed", tone: "neutral" },
};
const human = (s: string) => s.replace(/_/g, " ");
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function NextRuns({ runs }: { runs: string[] }) {
  const tf = useTimeFormat();
  return runs.length ? (
    <ul className="list-disc pl-5 text-xs">
      {runs.map((r) => (
        <li key={r}>{formatDateTime(r, tf)}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-muted-foreground">No upcoming runs.</p>
  );
}

/** Shows what activating would do; Activate is the only action here. */
function ActivationCard({
  routineId,
  onDone,
  onClose,
}: {
  routineId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  // Always fresh: what is missing changes while the user fixes it elsewhere.
  const query = useQuery({
    queryKey: ["routines", routineId, "summary"],
    queryFn: () =>
      call<{ summary: Summary }>(`/api/routines/${routineId}/summary`).then((r) => r.summary),
    staleTime: 0,
  });
  const summary = query.data;
  const [refused, setMissing] = useState<string[]>();
  const [actionError, setError] = useState<string>();
  const missing = refused ?? summary?.missing.map(String);
  const error = actionError ?? (query.error ? errorMessage(query.error) : undefined);
  async function activate() {
    setError(undefined);
    try {
      await call(`/api/routines/${routineId}/paused`, "POST", { paused: false });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "NOT_READY") {
        setMissing(Array.isArray(e.details.missing) ? e.details.missing.map(String) : []);
        setError(e.message);
      } else setError(errorMessage(e));
    }
  }
  return (
    <section
      aria-label="Before you activate"
      className="mt-2 space-y-2 rounded-lg border border-warn/50 p-3 text-sm"
    >
      <h3 className="font-medium">Before you activate</h3>
      {!summary && !error && <p role="status">Loading…</p>}
      {summary && (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted-foreground">Task</dt>
          <dd className="line-clamp-4 break-words" title={summary.task}>
            {summary.task}
          </dd>
          <dt className="text-muted-foreground">Bot</dt>
          <dd>{summary.bot}</dd>
          <dt className="text-muted-foreground">Schedule</dt>
          <dd>
            {summary.schedule.includes(summary.timezone)
              ? summary.schedule
              : `${summary.schedule} (${summary.timezone})`}
          </dd>
          <dt className="text-muted-foreground">Next runs</dt>
          <dd>
            <NextRuns runs={summary.nextRuns} />
          </dd>
          <dt className="text-muted-foreground">Chats</dt>
          <dd>{summary.contextMode}</dd>
          <dt className="text-muted-foreground">Accounts used</dt>
          <dd>{summary.accounts.length ? summary.accounts.join(", ") : "None"}</dd>
          <dt className="text-muted-foreground">Where results go</dt>
          <dd>{summary.destination}</dd>
        </dl>
      )}
      {missing && missing.length > 0 && (
        <div role="alert">
          <p className="font-medium text-destructive">Not ready yet. Finish these first:</p>
          <ul className="list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>{human(m)}</li>
            ))}
          </ul>
        </div>
      )}
      {error && !missing?.length && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void activate()} disabled={!summary}>
          Activate
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          Not now
        </Button>
      </div>
    </section>
  );
}

/** How long a run took, or has been going: "4m", "1h 12m", "35s". */
export function duration(startedAt: string, finishedAt: string | null, now = Date.now()) {
  const ms = Math.max(0, (finishedAt ? Date.parse(finishedAt) : now) - Date.parse(startedAt));
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function History({ routineId }: { routineId: string }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const [stopError, setStopError] = useState<string>();
  const stop = (runId: string) =>
    call(`/api/routine-runs/${runId}/stop`, "POST")
      .then(() => qc.invalidateQueries({ queryKey: ["routines"] }))
      .catch((e) => setStopError(errorMessage(e)));
  const query = useInfiniteQuery({
    queryKey: ["routines", routineId, "runs"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call<{ runs: Run[]; nextBefore: string | null }>(
        `/api/routines/${routineId}/runs${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const runs = query.data?.pages.flatMap((p) => p.runs) ?? NO_RUNS;
  const loaded = query.isSuccess;
  const error = query.error ? errorMessage(query.error) : undefined;
  return (
    <section aria-label="Run history" className="mt-2 space-y-1 text-sm">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {loaded && runs.length === 0 && <Empty>No runs yet.</Empty>}
      {stopError && (
        <p role="alert" className="text-destructive">
          {stopError}
        </p>
      )}
      <ul className="space-y-1">
        {runs.map((r) => (
          <li key={r.id} className="min-w-0 rounded-md border bg-card p-3">
            <p className="flex flex-wrap items-center gap-x-2">
              <span>
                <strong>{RUN_STATUS[r.status]}</strong>
                {r.reasonCode ? ` (${human(r.reasonCode)})` : ""} · {runOrigin(r)} ·{" "}
                {when(r.startedAt, tf)} · {duration(r.startedAt, r.finishedAt)}
              </span>
              {(r.status === "running" || r.status === "following") && (
                <Button size="xs" variant="outline" onClick={() => void stop(r.id)}>
                  Stop
                </Button>
              )}
            </p>
            {r.event != null && (
              <details>
                <summary className="cursor-pointer text-xs">Event</summary>
                <pre className="max-w-full whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(r.event, null, 2).slice(0, 2000)}
                </pre>
              </details>
            )}
            {r.steps && r.steps.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs">Steps ({r.steps.length})</summary>
                <ol className="ml-4 list-decimal text-xs text-muted-foreground">
                  {r.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </details>
            )}
            {r.output && (
              <details>
                <summary className="cursor-pointer text-xs">Output</summary>
                <pre className="max-w-full whitespace-pre-wrap break-words text-xs">
                  {r.output.slice(0, 2000)}
                </pre>
              </details>
            )}
            {r.conversationId && (
              <Link
                className="text-xs underline"
                to="/chat/{-$chatId}"
                params={{ chatId: r.conversationId }}
              >
                Open the chat
              </Link>
            )}
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load older
        </Button>
      )}
    </section>
  );
}

export function EditForm({
  routine,
  bots,
  onSaved,
  onCancel,
}: {
  routine: Routine;
  bots: Bot[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string>();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(undefined);
    const body: Record<string, unknown> = {
      expectedVersion: routine.version,
      botId: f.get("botId"),
      title: f.get("title"),
      prompt: f.get("prompt"),
      timezone: f.get("timezone"),
    };
    // A schedule written in words replaces the time fields; the server reads it in the timezone sent with it.
    const when = String(f.get("when") ?? "").trim();
    if (when) body.when = when;
    else if (routine.dailyAt) body.dailyAt = f.get("dailyAt");
    else if (routine.everyMinutes) body.everyMinutes = Number(f.get("everyMinutes"));
    try {
      await call(`/api/routines/${routine.id}`, "PATCH", body);
      onSaved();
    } catch (x) {
      setError(
        x instanceof ApiError && x.code === "STALE_VERSION"
          ? "This routine was changed somewhere else. Close this form to reload, then try again."
          : errorMessage(x),
      );
    }
  }
  return (
    <form
      onSubmit={(e) => void save(e)}
      className="mt-2 grid gap-2 rounded-lg border bg-card p-4 sm:grid-cols-2"
      aria-label={`Edit ${routine.title}`}
    >
      <Select
        title="Bot"
        required={false}
        name="botId"
        defaultValue={routine.botId}
        options={bots.map((b) => ({ value: b.id, label: b.name }))}
      />
      <Input title="Title" name="title" defaultValue={routine.title} required maxLength={120} />
      <MentionTextarea
        title="What should it do?"
        className="sm:col-span-2"
        name="prompt"
        bots={bots}
        defaultValue={routine.prompt}
        required
        rows={2}
      />
      {routine.dailyAt && (
        <Input
          title="Time of day"
          name="dailyAt"
          type="time"
          defaultValue={routine.dailyAt}
          required
        />
      )}
      {!routine.dailyAt && routine.everyMinutes && (
        <Input
          title="Every how many minutes"
          name="everyMinutes"
          type="number"
          min={5}
          max={10080}
          defaultValue={routine.everyMinutes}
          required
        />
      )}
      {routine.kind !== "once" && (
        <Input
          title="Or describe a new schedule (optional)"
          name="when"
          autoComplete="off"
          placeholder={scheduleText(routine) || WHEN_EXAMPLES}
          container="sm:col-span-2"
          required={false}
        />
      )}
      <Input title="Timezone" name="timezone" defaultValue={routine.timezone} required />
      {routine.kind === "once" && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          The date of a one-time routine cannot be changed. Create a new routine for another date.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm">
          Save changes
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const NEEDS_ATTENTION: RoutineStatus[] = ["failed", "interrupted", "blocked"];
type View = "history" | "triggers" | "edit" | "activate";
const WHEN_EXAMPLES = "Monday to Friday at 8:30 · every 15 minutes · tomorrow at 5pm · 0 9 * * 1-5";

export const statusOf = (r: Routine): RoutineStatus =>
  r.status ?? (r.paused ? "paused" : "scheduled");

/** Creating a routine is one focused task, so it gets its own dialog instead of sitting above the list. */
export function NewRoutineForm({
  bots,
  flows,
  onCreated,
  onClose,
}: {
  bots: Bot[];
  flows: Flow[];
  onCreated: (r: Routine) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ScheduleMode>("text");
  const [nextRuns, setNextRuns] = useState<string[]>();
  // What the server understood the written schedule as, and anything it had to assume, shown next to the next runs.
  const [understood, setUnderstood] = useState<{ text: string; assumed: string | null }>();
  const [formError, setFormError] = useState<string>();
  const schedule = (f: FormData) =>
    buildSchedule({
      mode,
      timezone: String(f.get("timezone") ?? "") || localTz(),
      dailyAt: String(f.get("dailyAt") ?? ""),
      everyMinutes: String(f.get("everyMinutes") ?? ""),
      onceLocal: String(f.get("onceLocal") ?? ""),
      text: String(f.get("scheduleText") ?? ""),
    });
  async function preview(form: HTMLFormElement) {
    setFormError(undefined);
    setNextRuns(undefined);
    setUnderstood(undefined);
    const s = schedule(new FormData(form));
    if (!s.ok) return setFormError(s.problem);
    try {
      const r = await call<{ nextRuns: string[]; understood?: string; assumed?: string | null }>(
        "/api/routines/preview",
        "POST",
        s.value,
      );
      setNextRuns(r.nextRuns);
      if (r.understood) setUnderstood({ text: r.understood, assumed: r.assumed ?? null });
    } catch (e) {
      setFormError(errorMessage(e));
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(undefined);
    const f = new FormData(e.currentTarget),
      s = schedule(f);
    if (!s.ok) return setFormError(s.problem);
    const workflowId = String(f.get("workflowId") ?? "");
    try {
      const r = await call<{ routine: Routine }>("/api/routines", "POST", {
        botId: f.get("botId"),
        title: f.get("title"),
        prompt: f.get("prompt"),
        ...s.value,
        ...(workflowId ? { workflowId } : {}),
        // Switched on at once: a routine left paused runs only when "Run now" is pressed, which reads as "it ran once and stopped".
        activate: "on",
      });
      onCreated(r.routine);
    } catch (x) {
      setFormError(errorMessage(x));
    }
  }
  return (
    <form
      onSubmit={(e) => void create(e)}
      className="grid gap-3 sm:grid-cols-2"
      aria-label="New routine"
    >
      <Select
        title="Bot"
        name="botId"
        required
        options={bots.map((b) => ({ value: b.id, label: b.name }))}
      />
      <Input title="Title" name="title" required maxLength={120} />
      <MentionTextarea
        title="What should it do?"
        className="sm:col-span-2"
        name="prompt"
        bots={bots}
        required
        rows={3}
      />
      <fieldset className="sm:col-span-2">
        <legend className="text-sm">When</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ["text", "Describe it"],
              ["daily", "Every day"],
              ["interval", "Every few minutes"],
              ["once", "Once"],
            ] as const
          ).map(([v, l]) => (
            <Radiobox
              key={v}
              name="mode"
              checked={mode === v}
              onChange={() => {
                setMode(v);
                setNextRuns(undefined);
                setUnderstood(undefined);
              }}
            >
              {l}
            </Radiobox>
          ))}
        </div>
      </fieldset>
      {mode === "text" && (
        <div className="sm:col-span-2">
          <Input
            title="When should it run?"
            name="scheduleText"
            autoComplete="off"
            required
            maxLength={200}
            placeholder="Monday to Friday at 8:30"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Say it in words or write a cron. For example: {WHEN_EXAMPLES}
          </p>
        </div>
      )}
      {mode === "daily" && <Input title="Time of day" name="dailyAt" type="time" required />}
      {mode === "interval" && (
        <Input
          title="Every how many minutes (5 or more)"
          name="everyMinutes"
          type="number"
          min={5}
          max={10080}
          defaultValue={60}
          required
        />
      )}
      {mode === "once" && (
        <Input title="Date and time" name="onceLocal" type="datetime-local" required />
      )}
      <Input title="Timezone" name="timezone" defaultValue={localTz()} />
      <Select
        title="Run a workflow instead (optional)"
        required={false}
        name="workflowId"
        options={[
          { value: "", label: "No, just ask the bot" },
          ...flows.map((w) => ({ value: w.id, label: w.name })),
        ]}
      />
      {nextRuns && (
        <div className="sm:col-span-2" role="status">
          {understood && (
            <p className="mb-1 text-sm">
              Understood as <span className="font-medium">{understood.text}</span>
              {understood.assumed && (
                <span className="block text-xs text-muted-foreground">{understood.assumed}</span>
              )}
            </p>
          )}
          <p className="text-xs font-medium">Next runs</p>
          <NextRuns runs={nextRuns} />
        </div>
      )}
      {formError && (
        <p role="alert" className="text-destructive sm:col-span-2">
          {formError}
        </p>
      )}
      <p className="text-xs text-muted-foreground sm:col-span-2">
        The routine is switched on when you create it. You can pause it at any time.
      </p>
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(e) => void preview(e.currentTarget.form!)}
        >
          Preview schedule
        </Button>
        <Button type="submit" size="sm">
          Create routine
        </Button>
      </div>
    </form>
  );
}

/** The routine's one chat: always visible on the row, with a dot when runs in it are not opened yet. */
function RoutineChatLink({
  conversationId,
  unread,
}: {
  conversationId: string | null | undefined;
  unread: boolean;
}) {
  if (!conversationId) return <span className="text-xs text-muted-foreground">No chat yet</span>;
  return (
    <Link
      to="/chat/{-$chatId}"
      params={{ chatId: conversationId }}
      className="inline-flex items-center gap-1.5 rounded text-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ChatIcon aria-hidden="true" className="size-4 shrink-0" />
      Open chat
      {unread && (
        <>
          <span aria-hidden="true" className="size-2 rounded-full bg-muted-foreground" />
          <span className="sr-only">(unread runs)</span>
        </>
      )}
    </Link>
  );
}
function RoutineRow({
  r,
  botName,
  now,
  unread,
  open,
  busy,
  bots,
  onOpen,
  onRun,
  onPause,
  onDelete,
  onChanged,
  onStatus,
}: {
  r: Routine;
  botName: string;
  now: number;
  unread: boolean;
  open: View | undefined;
  busy: boolean;
  bots: Bot[];
  onOpen: (v: View | "closed") => void;
  onRun: () => void;
  onPause: () => void;
  onDelete: () => Promise<void>;
  onChanged: () => void;
  onStatus: (m: string) => void;
}) {
  const tf = useTimeFormat();
  const st = statusOf(r);
  const expanded = open !== undefined;
  const panel = `routine-${r.id}`;
  const runs = [
    {
      label: "Last run",
      at: r.lastRunAt ?? null,
      empty: "Never",
      col: "@3xl:col-start-2",
    },
    {
      label: "Next run",
      at: r.paused ? null : r.nextRunAt,
      empty: r.paused ? "Not scheduled" : "None upcoming",
      col: "@3xl:col-start-3",
    },
  ];
  return (
    <li id={`routine-row-${r.id}`} className={`${listItem} @container py-4`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 @3xl:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem_13rem]">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panel}
          onClick={() => onOpen(expanded ? "closed" : r.paused ? "activate" : "history")}
          className="col-start-1 row-start-1 flex min-w-0 touch-manipulation items-start gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <CaretRightIcon
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out ${expanded ? "rotate-90" : ""}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words font-medium">{r.title}</span>
              <Badge tone={ROUTINE_STATUS[st].tone}>{ROUTINE_STATUS[st].label}</Badge>
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {botName} · {describeSchedule(r, tf)}
              {r.dailyAt ? "" : ` (${r.timezone})`}
            </span>
          </span>
        </button>
        <div className="col-span-2 row-start-2 flex gap-8 pl-6 tabular-nums @3xl:contents">
          {runs.map(({ label, at, empty, col }) => (
            <div key={label} className={`min-w-0 @3xl:row-start-1 ${col}`}>
              <div className="text-xs text-muted-foreground">{label}</div>
              {at ? (
                <>
                  <div className="text-sm font-medium">{relativeTime(at, now)}</div>
                  <time dateTime={at} className="block text-xs text-muted-foreground">
                    {formatDateTime(at, tf)}
                  </time>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">{empty}</div>
              )}
            </div>
          ))}
        </div>
        <div className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-3 @3xl:col-start-4">
          <RoutineChatLink conversationId={r.conversationId} unread={unread} />
          <Link
            to="/routines/$routineId"
            params={{ routineId: r.id }}
            className="text-sm underline hover:text-foreground"
          >
            Open
          </Link>
          {r.paused ? (
            <Button size="sm" variant="outline" onClick={() => onOpen("activate")}>
              Activate…
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy || st === "running"} onClick={onRun}>
              {busy || st === "running" ? "Running…" : "Run now"}
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div id={panel} className="mt-3 space-y-3 sm:pl-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Show" className="flex gap-1">
              {(
                [
                  ["history", "History"],
                  ["triggers", "Triggers"],
                  ["edit", "Edit"],
                ] as const
              ).map(([v, l]) => (
                <Button
                  key={v}
                  size="xs"
                  variant={open === v ? "secondary" : "ghost"}
                  aria-pressed={open === v}
                  onClick={() => onOpen(v)}
                >
                  {l}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!r.paused && (
                <Button size="xs" variant="outline" onClick={onPause}>
                  Pause
                </Button>
              )}
              {r.paused && open !== "activate" && (
                <Button size="xs" onClick={() => onOpen("activate")}>
                  Activate…
                </Button>
              )}
              <ConfirmButton
                label="Delete"
                question="Delete this routine? It will be archived."
                confirmLabel="Delete"
                size="xs"
                onConfirm={onDelete}
              />
            </div>
          </div>
          {open === "activate" && (
            <ActivationCard
              routineId={r.id}
              onClose={() => onOpen("closed")}
              onDone={() => {
                onOpen("closed");
                onStatus("Routine activated.");
                onChanged();
              }}
            />
          )}
          {open === "edit" && (
            <EditForm
              routine={r}
              bots={bots}
              onCancel={() => {
                onOpen("closed");
                onChanged();
              }}
              onSaved={() => {
                onOpen("closed");
                onStatus("Changes saved.");
                onChanged();
              }}
            />
          )}
          {open === "history" && <History routineId={r.id} />}
          {open === "triggers" && <RoutineTriggers routineId={r.id} paused={r.paused} />}
        </div>
      )}
    </li>
  );
}

export function Routines({
  bots,
  onError,
  search,
  setSearch,
}: {
  bots: Bot[];
  onError: (m: string) => void;
  /** The page's view from the address (see routines-search.ts). */
  search: RoutinesSearch;
  setSearch: (next: Partial<RoutinesSearch>, history?: "push" | "replace") => void;
}) {
  const focusId = search.routine;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rowsQuery = useQuery({
    queryKey: ["routines", { state: "all" }],
    queryFn: () => call<{ routines: Routine[] }>("/api/routines").then((r) => r.routines),
    // Statuses change while the page is open (runs start, fail, finish), so the list keeps itself fresh.
    refetchInterval: 10_000,
  });
  const rows = rowsQuery.data;
  const loadError = rowsQuery.error;
  useEffect(() => {
    if (loadError) onError(errorMessage(loadError));
    // `onError` is an inline function; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError]);
  // The whole ["routines"] prefix: the sidebar rows, the calendar, the timeline and every history read the same data.
  const reload = () => qc.invalidateQueries({ queryKey: ["routines"] });
  const [flows] = useList<Flow>("/api/workflows", "workflows", onError);
  const [status, setStatus] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; view: View } | undefined>(
    focusId ? { id: focusId, view: "history" } : undefined,
  );
  const unreadChats = useRoutineUnreadChats();
  const focused = useRef(false);
  const [busy, setBusy] = useState<string>();
  const tab = search.view === "calendar" ? "calendar" : "overview";
  const setTab = (v: "overview" | "calendar") =>
    setSearch({ view: v === "calendar" ? "calendar" : undefined });
  const [now, setNow] = useState(() => Date.now());
  // Relative times ("5m ago") move on with every answer.
  useEffect(() => {
    if (rowsQuery.dataUpdatedAt) setNow(rowsQuery.dataUpdatedAt);
  }, [rowsQuery.dataUpdatedAt]);
  useEffect(() => {
    if (!focusId || !rows || focused.current) return;
    focused.current = true;
    document.getElementById(`routine-row-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId, rows]);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(undefined), 6000);
    return () => clearTimeout(t);
  }, [status]);

  const act = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) setStatus(done);
      void reload();
      void refreshAttention();
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  const run = async (id: string) => {
    setBusy(id);
    try {
      await act(
        // "start": the answer comes when the run is claimed, not when the bot is done (a run can take minutes).
        () => call(`/api/routines/${id}/run`, "POST", { requestKey: uuidv7(), wait: "start" }),
        "Run started. Open History to follow it.",
      );
    } finally {
      setBusy(undefined);
    }
  };
  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? "A bot";
  const needs = (rows ?? []).filter((r) => NEEDS_ATTENTION.includes(statusOf(r)));
  const summary = rows ? summarize(rows, now) : "";
  const setView = (id: string, v: View | "closed") =>
    setOpen(v === "closed" ? undefined : { id, view: v });

  return (
    <section aria-label="Routines" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="min-w-0 text-sm text-pretty text-muted-foreground">
          {summary}
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" className="size-4" />
          New routine
        </Button>
      </div>
      {status && <Alert theme="info">{status}</Alert>}

      {needs.length > 0 && (
        <section
          aria-label="Needs attention"
          className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <WarningIcon aria-hidden="true" className="size-4 text-destructive" />
            Needs attention
          </h3>
          <ul className="space-y-1.5 text-sm">
            {needs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  <strong className="font-medium">{r.title}</strong>
                  <span className="text-muted-foreground">
                    {" "}
                    · {ROUTINE_STATUS[statusOf(r)].label.toLowerCase()}
                    {r.statusReason ? ` (${human(r.statusReason)})` : ""}
                    {r.statusAt ? `, ${relativeTime(r.statusAt, now)}` : ""}
                  </span>
                </span>
                <span className="flex gap-2">
                  {statusOf(r) !== "blocked" && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => void run(r.id)}
                    >
                      Run again
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setTab("overview");
                      setView(r.id, statusOf(r) === "blocked" ? "activate" : "history");
                    }}
                  >
                    {statusOf(r) === "blocked" ? "Review" : "See why"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div role="tablist" aria-label="Routines view" className="flex gap-1 border-b">
        {(
          [
            ["overview", "Overview"],
            ["calendar", "Calendar"],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            id={`routines-tab-${v}`}
            role="tab"
            type="button"
            aria-selected={tab === v}
            aria-controls="routines-view"
            tabIndex={tab === v ? 0 : -1}
            onClick={() => setTab(v)}
            className={`-mb-px touch-manipulation border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring ${tab === v ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div
        id="routines-view"
        role="tabpanel"
        aria-labelledby={`routines-tab-${tab}`}
        className="min-w-0 space-y-5"
      >
        {tab === "calendar" ? (
          <RoutineCalendar />
        ) : (
          <>
            <RoutineTimeline
              hours={search.hours ?? 3}
              onHours={(h) => setSearch({ hours: h === 3 ? undefined : h }, "replace")}
            />
            <div className="space-y-2">
              <h3 className="text-base font-semibold tracking-tight">
                All routines
                {rows && (
                  <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                    {rows.length}
                  </span>
                )}
              </h3>
              {rows?.length === 0 && (
                <div className="space-y-3 rounded-lg border border-dashed px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No routines yet. A routine asks a bot to do something on a schedule and keeps
                    the result in a chat you can open.
                  </p>
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Create your first routine
                  </Button>
                </div>
              )}
              <ul className={list}>
                {rows?.map((r) => (
                  <RoutineRow
                    key={r.id}
                    r={r}
                    bots={bots}
                    botName={botName(r.botId)}
                    now={now}
                    unread={r.conversationId ? unreadChats.has(r.conversationId) : false}
                    open={open?.id === r.id ? open.view : undefined}
                    busy={busy === r.id}
                    onOpen={(v) => setView(r.id, v)}
                    onRun={() => void run(r.id)}
                    onPause={() =>
                      void act(
                        () => call(`/api/routines/${r.id}/paused`, "POST", { paused: true }),
                        "Paused.",
                      )
                    }
                    onDelete={() =>
                      act(() => call(`/api/routines/${r.id}`, "DELETE"), "Routine deleted.")
                    }
                    onChanged={() => void reload()}
                    onStatus={setStatus}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {creating && (
        <Modal title="New routine" onClose={() => setCreating(false)}>
          <NewRoutineForm
            bots={bots}
            flows={flows ?? []}
            onClose={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false);
              // The new routine opens on its own page: its controls, what runs next and its runs.
              void navigate({ to: "/routines/$routineId", params: { routineId: created.id } });
              setTab("overview");
              // A routine is switched on when it is created; one whose bot is not ready stays paused and shows what is missing.
              setView(created.id, created.paused ? "activate" : "history");
              setStatus(
                created.paused
                  ? "Routine created, but it is paused: something is missing. See below, then activate it."
                  : "Routine created and switched on.",
              );
              void reload();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
