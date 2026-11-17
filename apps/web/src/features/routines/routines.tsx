import { uuidv7 } from "@zetta/core/uuid";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChatIcon,
  ClockCounterClockwiseIcon,
  DotsThreeIcon,
  LightningIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { RoutineCalendar } from "./routine-calendar";
import { RoutineTimeline } from "./routine-timeline";
import type { RoutinesSearch } from "./routines-search";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionHint } from "@/components/action-hint";
import { BotIdentity } from "@/components/bot-identity";
import { Button, MENU_DANGER, Menu, MenuItem, MenuSeparator, Modal } from "@/components/ui";
import { botRole } from "@zetta/core/bot-role";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { runOrigin } from "./routine-triggers";
import { Badge, Empty, list, listItem, when } from "../shared/ui";
import { relativeTime } from "../shared/relative-time";
import { summarize } from "../studio/routine-format";
import { refreshAttention, useRoutineUnreadChats } from "../attention/summary";
import { describeSchedule } from "../studio/routine-schedule";
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

const NEEDS_ATTENTION: RoutineStatus[] = ["failed", "interrupted", "blocked"];

export const statusOf = (r: Routine): RoutineStatus =>
  r.status ?? (r.paused ? "paused" : "scheduled");

/** What a row's "More actions" menu can do. The list provides them, so every action stays one click away from the row. */
type RowActions = {
  onActivate: () => void;
  onPause: () => void;
  onDelete: () => void;
};

/**
 * The one "More actions" menu of a routine row: the chat, the history, the triggers, editing, pause or activate, and delete. History,
 * Triggers and Edit are on the routine's own page; the menu takes the person there.
 */
function RoutineMenu({ r, actions }: { r: Routine; actions: RowActions }) {
  const navigate = useNavigate();
  const name = `More actions for ${r.title}`;
  const open = (hash?: string, edit?: "on") =>
    void navigate({
      to: "/routines/$routineId",
      params: { routineId: r.id },
      search: edit ? { edit } : {},
      hash,
    });
  return (
    <Menu
      asChild
      hover={false}
      title=""
      floatingClassName="w-56"
      label={
        <ActionHint label={name}>
          <button
            type="button"
            aria-label={name}
            className="flex size-8 shrink-0 touch-manipulation items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-open:bg-muted"
          >
            <DotsThreeIcon aria-hidden="true" className="size-4" />
          </button>
        </ActionHint>
      }
    >
      <MenuItem
        title="Open chat"
        disabled={!r.conversationId}
        onClick={() =>
          void navigate({
            to: "/chat/{-$chatId}",
            params: { chatId: r.conversationId ?? undefined },
          })
        }
      >
        <ChatIcon aria-hidden="true" />
        Open chat
      </MenuItem>
      <MenuItem title="History" onClick={() => open("routine-runs")}>
        <ClockCounterClockwiseIcon aria-hidden="true" />
        History
      </MenuItem>
      <MenuItem title="Triggers" onClick={() => open("routine-triggers")}>
        <LightningIcon aria-hidden="true" />
        Triggers
      </MenuItem>
      <MenuItem title="Edit" onClick={() => open(undefined, "on")}>
        <PencilSimpleIcon aria-hidden="true" />
        Edit
      </MenuItem>
      <MenuSeparator />
      {r.paused ? (
        <MenuItem title="Activate…" onClick={actions.onActivate}>
          <PlayIcon aria-hidden="true" />
          Activate…
        </MenuItem>
      ) : (
        <MenuItem title="Pause" onClick={actions.onPause}>
          <PauseIcon aria-hidden="true" />
          Pause
        </MenuItem>
      )}
      <MenuItem title="Delete" className={MENU_DANGER} onClick={actions.onDelete}>
        <TrashIcon aria-hidden="true" />
        Delete
      </MenuItem>
    </Menu>
  );
}

/** The routine's bot with its role under the name; a bot the list cannot find shows as "A bot". */
function RoutineBot({ bot }: { bot: Bot | undefined }) {
  if (!bot) return <span className="text-sm text-muted-foreground">A bot</span>;
  return <BotIdentity bot={bot} size={24} sub={botRole(bot)} />;
}

function RoutineRow({
  r,
  bot,
  now,
  unread,
  busy,
  activating,
  actions,
  onRun,
  onCloseActivate,
  onActivated,
}: {
  r: Routine;
  bot: Bot | undefined;
  now: number;
  unread: boolean;
  busy: boolean;
  /** The "Before you activate" card is open under the row. */
  activating: boolean;
  actions: RowActions;
  onRun: () => void;
  onCloseActivate: () => void;
  onActivated: () => void;
}) {
  const tf = useTimeFormat();
  const st = statusOf(r);
  const at = r.paused ? null : r.nextRunAt;
  return (
    <li id={`routine-row-${r.id}`} className={`${listItem} @container py-4`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 @3xl:grid-cols-[minmax(0,1fr)_13rem_9.5rem_auto]">
        <div className="col-start-1 row-start-1 min-w-0">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to="/routines/$routineId"
              params={{ routineId: r.id }}
              search={{}}
              className="min-w-0 rounded break-words font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {r.title}
            </Link>
            <Badge tone={ROUTINE_STATUS[st].tone}>{ROUTINE_STATUS[st].label}</Badge>
            {unread && (
              <>
                <span aria-hidden="true" className="size-2 rounded-full bg-muted-foreground" />
                <span className="sr-only">(unread runs)</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {describeSchedule(r, tf)}
            {r.dailyAt ? "" : ` (${r.timezone})`}
          </span>
        </div>
        <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-x-8 gap-y-2 @3xl:contents">
          <div className="min-w-0 @3xl:col-start-2 @3xl:row-start-1">
            <RoutineBot bot={bot} />
          </div>
          <div className="min-w-0 tabular-nums @3xl:col-start-3 @3xl:row-start-1">
            <div className="text-xs text-muted-foreground">Next run</div>
            {at ? (
              <>
                <div className="text-sm font-medium">{relativeTime(at, now)}</div>
                <time dateTime={at} className="block text-xs text-muted-foreground">
                  {formatDateTime(at, tf)}
                </time>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {r.paused ? "Not scheduled" : "None upcoming"}
              </div>
            )}
          </div>
        </div>
        <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 @3xl:col-start-4">
          <Button size="sm" variant="outline" disabled={busy || st === "running"} onClick={onRun}>
            {busy || st === "running" ? "Running…" : "Run now"}
          </Button>
          <RoutineMenu r={r} actions={actions} />
        </div>
      </div>
      {activating && (
        <div className="mt-3 sm:pl-6">
          <ActivationCard routineId={r.id} onClose={onCloseActivate} onDone={onActivated} />
        </div>
      )}
    </li>
  );
}

/** "New routine" is a page of its own (`/routines/new`), so it is a link. */
function NewRoutineLink({ children }: { children?: ReactNode }) {
  return (
    <Button {...({ as: Link, to: "/routines/new" } as object)} size="sm">
      <PlusIcon aria-hidden="true" className="size-4" />
      {children ?? "New routine"}
    </Button>
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
  const [status, setStatus] = useState<string>();
  // The routine whose "Before you activate" card is open under its row.
  const [activating, setActivating] = useState<string>();
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
        "Run started. Open the routine to follow it.",
      );
    } finally {
      setBusy(undefined);
    }
  };
  const needs = (rows ?? []).filter((r) => NEEDS_ATTENTION.includes(statusOf(r)));
  const summary = rows ? summarize(rows, now) : "";
  const confirmDelete = async (r: Routine) => {
    const ok = await Modal.confirm<boolean>({
      title: "Delete this routine?",
      description: `"${r.title}" will be archived.`,
      confirm: { text: "Delete", theme: "danger" },
    });
    if (ok) await act(() => call(`/api/routines/${r.id}`, "DELETE"), "Routine deleted.");
  };

  return (
    <section aria-label="Routines" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="min-w-0 text-sm text-pretty text-muted-foreground">
          {summary}
        </p>
        <NewRoutineLink />
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
                  {statusOf(r) === "blocked" ? (
                    <Button size="xs" variant="ghost" onClick={() => setActivating(r.id)}>
                      Review
                    </Button>
                  ) : (
                    <Link
                      to="/routines/$routineId"
                      params={{ routineId: r.id }}
                      search={{}}
                      hash="routine-runs"
                      className="inline-flex h-6 items-center rounded-md px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      See why
                    </Link>
                  )}
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
                  <NewRoutineLink>Create your first routine</NewRoutineLink>
                </div>
              )}
              <ul className={list}>
                {rows?.map((r) => (
                  <RoutineRow
                    key={r.id}
                    r={r}
                    bot={bots.find((b) => b.id === r.botId)}
                    now={now}
                    unread={r.conversationId ? unreadChats.has(r.conversationId) : false}
                    busy={busy === r.id}
                    activating={activating === r.id}
                    onRun={() => void run(r.id)}
                    onCloseActivate={() => setActivating(undefined)}
                    onActivated={() => {
                      setActivating(undefined);
                      setStatus("Routine activated.");
                      void reload();
                    }}
                    actions={{
                      onActivate: () => setActivating(r.id),
                      onPause: () =>
                        void act(
                          () => call(`/api/routines/${r.id}/paused`, "POST", { paused: true }),
                          "Paused.",
                        ),
                      onDelete: () => void confirmDelete(r),
                    }}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
