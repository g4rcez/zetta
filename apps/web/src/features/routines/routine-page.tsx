import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "@zetta/core/uuid";
import { useState, type FormEvent } from "react";

import { Button, Select } from "@/components/ui";
import { useTimeFormat } from "@/features/preferences/preferences";
import { call, errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Badge, Loading, when } from "../shared/ui";
import { describeSchedule } from "../studio/routine-schedule";
import { RoutineTriggers } from "./routine-triggers";
import { EditForm, History, NextRuns, ROUTINE_STATUS, statusOf, type Routine } from "./routines";

const NO_BOTS: Bot[] = [];

const OVERLAP = [
  { value: "skip", label: "Skip it: one run at a time" },
  { value: "queue", label: "Run it when the last one ends" },
  { value: "replace", label: "Stop the last one and start this one" },
];
const CATCH_UP = [
  { value: "run_once", label: "Run once for what was missed" },
  { value: "skip", label: "Skip to the next one" },
];
const MODES = [
  { value: "task", label: "Do the prompt each time" },
  { value: "goal", label: "Standing goal: keep going until I stop it" },
];
const FAILURES = [1, 3, 5, 10].map((n) => ({ value: String(n), label: `${n} in a row` }));

/** How the routine behaves when runs overlap, after downtime, and after failures. */
function BehaviorForm({ r, onSaved }: { r: Routine; onSaved: () => void }) {
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call(`/api/routines/${r.id}`, "PATCH", {
        expectedVersion: r.version,
        overlapPolicy: f.get("overlapPolicy"),
        catchUp: f.get("catchUp"),
        maxFailures: Number(f.get("maxFailures")),
        mode: f.get("mode"),
      });
      onSaved();
    } catch (x) {
      setError(errorMessage(x));
    }
  }
  return (
    <form
      key={r.version}
      onSubmit={(e) => void submit(e)}
      className="grid gap-3 rounded-lg border bg-card p-4 text-sm sm:grid-cols-3"
    >
      <div className="sm:col-span-3">
        <Select
          title="Each run"
          name="mode"
          required={false}
          defaultValue={r.mode ?? "task"}
          options={MODES}
        />
        {(r.mode ?? "task") === "goal" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Each run picks up from the last run's report. The bot cannot pause it; only you can.
          </p>
        )}
      </div>
      <Select
        title="When the last run is still working"
        name="overlapPolicy"
        required={false}
        defaultValue={r.overlapPolicy ?? "skip"}
        options={OVERLAP}
      />
      <Select
        title="After the server was off"
        name="catchUp"
        required={false}
        defaultValue={r.catchUp ?? "run_once"}
        options={CATCH_UP}
      />
      <Select
        title="Pause it after failures"
        name="maxFailures"
        required={false}
        defaultValue={String(r.maxFailures ?? 5)}
        options={FAILURES}
      />
      {error && (
        <p role="alert" className="text-destructive sm:col-span-3">
          {error}
        </p>
      )}
      <div className="flex justify-end sm:col-span-3">
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}

/**
 * One routine on a page of its own: what it does and when, its controls (run now, pause, skip next), what runs next, every run with
 * its status, duration and chat (a running one can be stopped), how it behaves on overlap, downtime and failures, and its triggers.
 */
export function RoutinePage({ routineId }: { routineId: string }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ["routines", { state: "all" }],
    queryFn: () => call<{ routines: Routine[] }>("/api/routines").then((x) => x.routines),
    refetchInterval: 10_000,
  });
  const r = query.data?.find((x) => x.id === routineId);
  const summary = useQuery({
    queryKey: ["routines", routineId, "summary", r?.version],
    queryFn: () =>
      call<{ summary: { nextRuns: string[]; missing: string[] } }>(
        `/api/routines/${routineId}/summary`,
      ).then((x) => x.summary),
    enabled: Boolean(r),
  }).data;
  const reload = () => void qc.invalidateQueries({ queryKey: ["routines"] });
  const act = (work: () => Promise<unknown>, done: string) =>
    work()
      .then(() => {
        setError(undefined);
        setStatus(done);
        reload();
      })
      .catch((e) => setError(errorMessage(e)));
  if (query.isPending) return <Loading />;
  if (!r)
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Alert theme="danger">This routine does not exist or is not yours.</Alert>
      </div>
    );
  const st = statusOf(r);
  const bot = bots.find((b) => b.id === r.botId);
  const skipping = Boolean(r.skipUntil && r.nextRunAt && r.skipUntil >= r.nextRunAt);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl min-w-0 space-y-6 p-4 md:p-8">
        <Link
          to="/routines"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Routines
        </Link>
        <header className="space-y-2 border-b pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl text-balance">{r.title}</h1>
            <Badge tone={ROUTINE_STATUS[st].tone}>{ROUTINE_STATUS[st].label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {bot?.name ?? "A bot"} · {describeSchedule(r, tf)}
            {r.dailyAt ? "" : ` (${r.timezone})`}
            {r.statusReason ? ` · ${r.statusReason.replace(/_/g, " ")}` : ""}
          </p>
          <p className="text-sm whitespace-pre-wrap">{r.prompt}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              onClick={() =>
                void act(
                  () =>
                    call(`/api/routines/${r.id}/run`, "POST", {
                      requestKey: uuidv7(),
                      wait: "start",
                    }),
                  "Run started.",
                )
              }
            >
              Run now
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void act(
                  () => call(`/api/routines/${r.id}/paused`, "POST", { paused: !r.paused }),
                  r.paused ? "Routine switched on." : "Routine paused.",
                )
              }
            >
              {r.paused ? "Activate" : "Pause"}
            </Button>
            {!r.paused && r.nextRunAt && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void act(
                    () => call(`/api/routines/${r.id}/skip-next`, skipping ? "DELETE" : "POST"),
                    skipping ? "The next run will happen." : "The next run will be skipped.",
                  )
                }
              >
                {skipping ? "Don't skip next" : "Skip next"}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close editing" : "Edit"}
            </Button>
          </div>
          {status && (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
          {error && <Alert theme="danger">{error}</Alert>}
          {summary?.missing.length ? <Alert theme="warn">{summary.missing.join(" ")}</Alert> : null}
        </header>
        {editing && (
          <EditForm
            routine={r}
            bots={bots}
            onSaved={() => {
              setEditing(false);
              setStatus("Saved.");
              reload();
            }}
            onCancel={() => setEditing(false)}
          />
        )}
        <section aria-label="Upcoming" className="space-y-2">
          <h2 className="text-base font-semibold">Upcoming</h2>
          {r.paused ? (
            <p className="text-sm text-muted-foreground">Paused: nothing is scheduled.</p>
          ) : (
            <>
              {skipping && r.nextRunAt && (
                <p className="text-sm text-muted-foreground">
                  The run of {when(r.nextRunAt, tf)} will be skipped.
                </p>
              )}
              <NextRuns runs={summary?.nextRuns ?? []} />
            </>
          )}
        </section>
        <section aria-label="Runs" className="space-y-2">
          <h2 className="text-base font-semibold">Runs</h2>
          <History routineId={r.id} />
        </section>
        <section aria-label="Behavior" className="space-y-2">
          <h2 className="text-base font-semibold">Behavior</h2>
          <BehaviorForm r={r} onSaved={reload} />
        </section>
        <section aria-label="Triggers" className="space-y-2">
          <h2 className="text-base font-semibold">Triggers</h2>
          <RoutineTriggers routineId={r.id} paused={r.paused} />
        </section>
      </div>
    </div>
  );
}
