import { uuidv7 } from "@zetta/core/uuid";
import { Link } from "@tanstack/react-router";
import { CaretRightIcon, PlusIcon, WarningIcon } from "@phosphor-icons/react";
import { RoutineCalendar } from "./routine-calendar";
import { RoutineTimeline } from "./routine-timeline";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Input, Radiobox, Select, Textarea } from "@/components/ui";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, Modal, list, listItem, useList, when } from "../shared/ui";
import { relativeTime, summarize } from "./routine-format";
import { refreshAttention } from "../attention/summary";
import { buildSchedule, describeSchedule, type ScheduleMode } from "./routine-schedule";
import { Alert } from "@g4rcez/components/alert";

type Routine = {
  id: string;
  botId: string;
  title: string;
  prompt: string;
  timezone: string;
  dailyAt: string | null;
  everyMinutes: number | null;
  kind?: "recurring" | "once";
  conversationMode?: "new" | "continue";
  version: number;
  workflowId?: string | null;
  onceAt?: string | null;
  paused: boolean;
  status?: RoutineStatus;
  statusReason?: string | null;
  nextRunAt: string | null;
  lastRunAt?: string | null;
  statusAt?: string;
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
type Run = {
  id: string;
  status: "running" | "succeeded" | "failed" | "skipped" | "blocked" | "interrupted";
  reasonCode: string | null;
  output: string;
  conversationId: string | null;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
};
type Flow = { id: string; name: string };

const RUN_STATUS: Record<Run["status"], string> = {
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  skipped: "Skipped",
  blocked: "Blocked",
  interrupted: "Interrupted",
};
const ROUTINE_STATUS: Record<
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

function NextRuns({ runs }: { runs: string[] }) {
  return runs.length ? (
    <ul className="list-disc pl-5 text-xs">
      {runs.map((r) => (
        <li key={r}>{new Date(r).toLocaleString()}</li>
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
  const [summary, setSummary] = useState<Summary>();
  const [missing, setMissing] = useState<string[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call<{ summary: Summary }>(`/api/routines/${routineId}/summary`).then(
      (r) => {
        setSummary(r.summary);
        setMissing(r.summary.missing.map(String));
      },
      (e) => setError(errorMessage(e)),
    );
  }, [routineId]);
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

function History({ routineId }: { routineId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(
    (before?: string) =>
      call<{ runs: Run[]; nextBefore: string | null }>(
        `/api/routines/${routineId}/runs${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      ).then(
        (r) => {
          setRuns((l) => (before ? [...l, ...r.runs] : r.runs));
          setNext(r.nextBefore);
          setLoaded(true);
        },
        (e) => setError(errorMessage(e)),
      ),
    [routineId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section aria-label="Run history" className="mt-2 space-y-1 text-sm">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {loaded && runs.length === 0 && <Empty>No runs yet.</Empty>}
      <ul className="space-y-1">
        {runs.map((r) => (
          <li key={r.id} className="min-w-0 rounded-md border bg-card p-3">
            <p>
              <strong>{RUN_STATUS[r.status]}</strong>
              {r.reasonCode ? ` (${human(r.reasonCode)})` : ""} ·{" "}
              {r.trigger === "manual" ? "started by you" : "scheduled"} · {when(r.startedAt)}
            </p>
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
      {next && (
        <Button size="sm" variant="outline" onClick={() => void load(next)}>
          Load older
        </Button>
      )}
    </section>
  );
}

function EditForm({
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
      conversationMode: f.get("conversationMode"),
    };
    if (routine.dailyAt) body.dailyAt = f.get("dailyAt");
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
      <Textarea
        title="What should it do?"
        container="sm:col-span-2"
        name="prompt"
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
      <Input title="Timezone" name="timezone" defaultValue={routine.timezone} required />
      <Select
        title="Chats"
        required={false}
        name="conversationMode"
        defaultValue={routine.conversationMode ?? "new"}
        options={[
          { value: "new", label: "Start a new chat each run" },
          { value: "continue", label: "Continue the same chat" },
        ]}
      />
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
type View = "history" | "edit" | "activate";
const statusOf = (r: Routine): RoutineStatus => r.status ?? (r.paused ? "paused" : "scheduled");

/** Creating a routine is one focused task, so it gets its own dialog instead of sitting above the list. */
function NewRoutineForm({
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
  const [mode, setMode] = useState<ScheduleMode>("daily");
  const [nextRuns, setNextRuns] = useState<string[]>();
  const [formError, setFormError] = useState<string>();
  const schedule = (f: FormData) =>
    buildSchedule({
      mode,
      timezone: String(f.get("timezone") ?? "") || localTz(),
      dailyAt: String(f.get("dailyAt") ?? ""),
      everyMinutes: String(f.get("everyMinutes") ?? ""),
      onceLocal: String(f.get("onceLocal") ?? ""),
    });
  async function preview(form: HTMLFormElement) {
    setFormError(undefined);
    setNextRuns(undefined);
    const s = schedule(new FormData(form));
    if (!s.ok) return setFormError(s.problem);
    try {
      setNextRuns(
        (await call<{ nextRuns: string[] }>("/api/routines/preview", "POST", s.value)).nextRuns,
      );
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
        conversationMode: f.get("conversationMode"),
        ...s.value,
        ...(workflowId ? { workflowId } : {}),
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
      <Textarea
        title="What should it do?"
        container="sm:col-span-2"
        name="prompt"
        required
        rows={3}
      />
      <fieldset className="sm:col-span-2">
        <legend className="text-sm">When</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(
            [
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
              }}
            >
              {l}
            </Radiobox>
          ))}
        </div>
      </fieldset>
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
        title="Chats"
        required={false}
        name="conversationMode"
        defaultValue="new"
        options={[
          { value: "new", label: "Start a new chat each run" },
          { value: "continue", label: "Continue the same chat" },
        ]}
      />
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
        New routines start paused. You review them, then activate.
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

function RoutineRow({
  r,
  botName,
  now,
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
  const st = statusOf(r);
  const expanded = open !== undefined;
  const panel = `routine-${r.id}`;
  const timing = r.paused
    ? "Not scheduled"
    : r.nextRunAt
      ? `Next run ${relativeTime(r.nextRunAt, now)}, ${new Date(r.nextRunAt).toLocaleString()}`
      : "No upcoming run";
  return (
    <li className={`${listItem} py-4`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panel}
          onClick={() => onOpen(expanded ? "closed" : r.paused ? "activate" : "history")}
          className="flex min-w-0 flex-1 touch-manipulation items-start gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
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
            <span className="mt-0.5 block text-muted-foreground">
              {botName} · {describeSchedule(r)}
              {r.dailyAt ? "" : ` (${r.timezone})`}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
              {timing}
              {r.lastRunAt ? ` · Last run ${relativeTime(r.lastRunAt, now)}` : ""}
            </span>
          </span>
        </button>
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
      {expanded && (
        <div id={panel} className="mt-3 space-y-3 sm:pl-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Show" className="flex gap-1">
              {(
                [
                  ["history", "History"],
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
        </div>
      )}
    </li>
  );
}

export function Routines({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const [rows, reload] = useList<Routine>("/api/routines", "routines", onError);
  const [flows] = useList<Flow>("/api/workflows", "workflows", onError);
  const [status, setStatus] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; view: View }>();
  const [busy, setBusy] = useState<string>();
  const [tab, setTab] = useState<"overview" | "calendar">("overview");
  const [now, setNow] = useState(() => Date.now());
  // Statuses change while the page is open (runs start, fail, finish), so the list keeps itself fresh.
  useEffect(() => {
    // Hidden tabs skip the refresh and catch up when they become visible.
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      void reload();
    };
    const t = setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);
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
    await act(
      () => call(`/api/routines/${id}/run`, "POST", { requestKey: uuidv7() }),
      "Run finished. Open History to see the result.",
    );
    setBusy(undefined);
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
          <RoutineCalendar refreshKey={rows?.length ?? 0} />
        ) : (
          <>
            <RoutineTimeline refreshKey={rows?.length ?? 0} />
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
              setTab("overview");
              setView(created.id, "activate");
              setStatus("Routine created, but it is paused. Review it below, then activate it.");
              void reload();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
