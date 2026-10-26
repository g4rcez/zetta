import { RoutineCalendar } from "./routine-calendar";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Input, Radiobox, Select, Textarea } from "@/components/ui";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, useList, when } from "../shared/ui";
import { refreshAttention } from "../attention/summary";
import { buildSchedule, describeSchedule, type ScheduleMode } from "./routine-schedule";

type Routine = { id: string; botId: string; title: string; prompt: string; timezone: string; dailyAt: string | null; everyMinutes: number | null; kind?: "recurring" | "once"; conversationMode?: "new" | "continue"; version: number; workflowId?: string | null; onceAt?: string | null; paused: boolean; nextRunAt: string | null };
type Summary = { id?: string; task: string; bot: string; schedule: string; timezone: string; nextRuns: string[]; contextMode: string; accounts: string[]; destination: string; missing: unknown[]; version: number };
type Run = { id: string; status: "running" | "succeeded" | "failed" | "skipped" | "blocked" | "interrupted"; reasonCode: string | null; output: string; conversationId: string | null; startedAt: string; finishedAt: string | null; trigger: string };
type Flow = { id: string; name: string };

const RUN_STATUS: Record<Run["status"], string> = { running: "Running", succeeded: "Done", failed: "Failed", skipped: "Skipped", blocked: "Blocked", interrupted: "Interrupted" };
const human = (s: string) => s.replace(/_/g, " ");
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function NextRuns({ runs }: { runs: string[] }) {
  return runs.length ? <ul className="list-disc pl-5 text-xs">{runs.map((r) => <li key={r}>{new Date(r).toLocaleString()}</li>)}</ul> : <p className="text-xs text-muted-foreground">No upcoming runs.</p>;
}

/** Shows what activating would do; Activate is the only action here. */
function ActivationCard({ routineId, onDone, onClose }: { routineId: string; onDone: () => void; onClose: () => void }) {
  const [summary, setSummary] = useState<Summary>();
  const [missing, setMissing] = useState<string[]>();
  const [error, setError] = useState<string>();
  useEffect(() => { call<{ summary: Summary }>(`/api/routines/${routineId}/summary`).then((r) => { setSummary(r.summary); setMissing(r.summary.missing.map(String)); }, (e) => setError(errorMessage(e))); }, [routineId]);
  async function activate() {
    setError(undefined);
    try { await call(`/api/routines/${routineId}/paused`, "POST", { paused: false }); onDone(); }
    catch (e) { if (e instanceof ApiError && e.code === "NOT_READY") { setMissing(Array.isArray(e.details.missing) ? e.details.missing.map(String) : []); setError(e.message); } else setError(errorMessage(e)); }
  }
  return (
    <section aria-label="Before you activate" className="mt-2 space-y-2 rounded-lg border border-yellow-600/50 p-3 text-sm">
      <h3 className="font-medium">Before you activate</h3>
      {!summary && !error && <p role="status">Loading…</p>}
      {summary && (
        <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted-foreground">Task</dt><dd className="break-words">{summary.task}</dd>
          <dt className="text-muted-foreground">Bot</dt><dd>{summary.bot}</dd>
          <dt className="text-muted-foreground">Schedule</dt><dd>{summary.schedule} ({summary.timezone})</dd>
          <dt className="text-muted-foreground">Next runs</dt><dd><NextRuns runs={summary.nextRuns} /></dd>
          <dt className="text-muted-foreground">Chats</dt><dd>{summary.contextMode}</dd>
          <dt className="text-muted-foreground">Accounts used</dt><dd>{summary.accounts.length ? summary.accounts.join(", ") : "None"}</dd>
          <dt className="text-muted-foreground">Where results go</dt><dd>{summary.destination}</dd>
        </dl>)}
      {missing && missing.length > 0 && <div role="alert"><p className="font-medium text-destructive">Not ready yet. Finish these first:</p><ul className="list-disc pl-5">{missing.map((m) => <li key={m}>{human(m)}</li>)}</ul></div>}
      {error && !missing?.length && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-2"><Button size="sm" onClick={() => void activate()} disabled={!summary}>Activate</Button><Button size="sm" variant="outline" onClick={onClose}>Not now</Button></div>
    </section>
  );
}

function History({ routineId }: { routineId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback((before?: string) => call<{ runs: Run[]; nextBefore: string | null }>(`/api/routines/${routineId}/runs${before ? `?before=${encodeURIComponent(before)}` : ""}`).then((r) => { setRuns((l) => (before ? [...l, ...r.runs] : r.runs)); setNext(r.nextBefore); setLoaded(true); }, (e) => setError(errorMessage(e))), [routineId]);
  useEffect(() => { void load(); }, [load]);
  return (
    <section aria-label="Run history" className="mt-2 space-y-1 text-sm">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {loaded && runs.length === 0 && <Empty>No runs yet.</Empty>}
      <ul className="space-y-1">{runs.map((r) => (
        <li key={r.id} className="min-w-0 rounded-md border bg-card p-3">
          <p><strong>{RUN_STATUS[r.status]}</strong>{r.reasonCode ? ` (${human(r.reasonCode)})` : ""} · {r.trigger === "manual" ? "started by you" : "scheduled"} · {when(r.startedAt)}</p>
          {r.output && <details><summary className="cursor-pointer text-xs">Output</summary><pre className="max-w-full whitespace-pre-wrap break-words text-xs">{r.output.slice(0, 2000)}</pre></details>}
          {r.conversationId && <a className="text-xs underline" href={`/chat/${r.conversationId}`}>Open the chat</a>}
        </li>))}</ul>
      {next && <Button size="sm" variant="outline" onClick={() => void load(next)}>Load older</Button>}
    </section>
  );
}

function EditForm({ routine, bots, onSaved, onCancel }: { routine: Routine; bots: Bot[]; onSaved: () => void; onCancel: () => void }) {
  const [error, setError] = useState<string>();
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setError(undefined);
    const body: Record<string, unknown> = { expectedVersion: routine.version, botId: f.get("botId"), title: f.get("title"), prompt: f.get("prompt"), timezone: f.get("timezone"), conversationMode: f.get("conversationMode") };
    if (routine.dailyAt) body.dailyAt = f.get("dailyAt"); else if (routine.everyMinutes) body.everyMinutes = Number(f.get("everyMinutes"));
    try { await call(`/api/routines/${routine.id}`, "PATCH", body); onSaved(); }
    catch (x) { setError(x instanceof ApiError && x.code === "STALE_VERSION" ? "This routine was changed somewhere else. Close this form to reload, then try again." : errorMessage(x)); }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="mt-2 grid gap-2 rounded-lg border bg-card p-4 sm:grid-cols-2" aria-label={`Edit ${routine.title}`}>
      <Select title="Bot" required={false} name="botId" defaultValue={routine.botId} options={bots.map((b) => ({ value: b.id, label: b.name }))} />
      <Input title="Title" name="title" defaultValue={routine.title} required maxLength={120} />
      <Textarea title="What should it do?" container="sm:col-span-2" name="prompt" defaultValue={routine.prompt} required rows={2} />
      {routine.dailyAt && <Input title="Time of day" name="dailyAt" type="time" defaultValue={routine.dailyAt} required />}
      {!routine.dailyAt && routine.everyMinutes && <Input title="Every how many minutes" name="everyMinutes" type="number" min={5} max={10080} defaultValue={routine.everyMinutes} required />}
      <Input title="Timezone" name="timezone" defaultValue={routine.timezone} required />
      <Select title="Chats" required={false} name="conversationMode" defaultValue={routine.conversationMode ?? "new"} options={[{ value: "new", label: "Start a new chat each run" }, { value: "continue", label: "Continue the same chat" }]} />
      {routine.kind === "once" && <p className="text-xs text-muted-foreground sm:col-span-2">The date of a one-time routine cannot be changed. Create a new routine for another date.</p>}
      {error && <p role="alert" className="text-destructive sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="sm">Save changes</Button><Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

export function Routines({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const [rows, reload] = useList<Routine>("/api/routines", "routines", onError);
  const [flows] = useList<Flow>("/api/workflows", "workflows", onError);
  const [mode, setMode] = useState<ScheduleMode>("daily");
  const [nextRuns, setNextRuns] = useState<string[]>();
  const [status, setStatus] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [card, setCard] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; what: "edit" | "history" }>();
  const schedule = (f: FormData) => buildSchedule({ mode, timezone: String(f.get("timezone") ?? "") || localTz(), dailyAt: String(f.get("dailyAt") ?? ""), everyMinutes: String(f.get("everyMinutes") ?? ""), onceLocal: String(f.get("onceLocal") ?? "") });

  async function preview(form: HTMLFormElement) {
    setFormError(undefined); setNextRuns(undefined);
    const s = schedule(new FormData(form));
    if (!s.ok) return setFormError(s.problem);
    try { setNextRuns((await call<{ nextRuns: string[] }>("/api/routines/preview", "POST", s.value)).nextRuns); } catch (e) { setFormError(errorMessage(e)); }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setFormError(undefined);
    const form = e.currentTarget, f = new FormData(form), s = schedule(f);
    if (!s.ok) return setFormError(s.problem);
    const workflowId = String(f.get("workflowId") ?? "");
    try {
      const r = await call<{ routine: Routine }>("/api/routines", "POST", { botId: f.get("botId"), title: f.get("title"), prompt: f.get("prompt"), conversationMode: f.get("conversationMode"), ...s.value, ...(workflowId ? { workflowId } : {}) });
      form.reset(); setNextRuns(undefined); setCreating(false); setCard(r.routine.id); setStatus("Routine created, but it is paused. Review it below, then activate it."); void reload();
    } catch (x) { setFormError(errorMessage(x)); }
  }
  const act = async (work: () => Promise<unknown>, done?: string) => { try { await work(); if (done) setStatus(done); void reload(); void refreshAttention(); } catch (e) { onError(errorMessage(e)); } };
  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? "A bot";

  return (
    <section aria-label="Routines" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold tracking-tight">Your routines{rows && <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{rows.length}</span>}</h3>
        <Button size="sm" variant={creating ? "outline" : "default"} aria-expanded={creating} aria-controls="new-routine" onClick={() => setCreating(!creating)}>{creating ? "Close" : "New routine"}</Button>
      </div>
      {creating && <form id="new-routine" onSubmit={(e) => void create(e)} className="grid gap-3 rounded-xl border bg-card p-5 sm:grid-cols-2" aria-label="New routine">
        <Select title="Bot" name="botId" required options={bots.map((b) => ({ value: b.id, label: b.name }))} />
        <Input title="Title" name="title" required maxLength={120} />
        <Textarea title="What should it do?" container="sm:col-span-2" name="prompt" required rows={2} />
        <fieldset className="sm:col-span-2"><legend className="text-sm">When</legend>
          <div className="flex flex-wrap gap-3 text-sm">{([["daily", "Every day"], ["interval", "Every few minutes"], ["once", "Once"]] as const).map(([v, l]) => <Radiobox key={v} name="mode" checked={mode === v} onChange={() => { setMode(v); setNextRuns(undefined); }}>{l}</Radiobox>)}</div>
        </fieldset>
        {mode === "daily" && <Input title="Time of day" name="dailyAt" type="time" required />}
        {mode === "interval" && <Input title="Every how many minutes (5 or more)" name="everyMinutes" type="number" min={5} max={10080} defaultValue={60} required />}
        {mode === "once" && <Input title="Date and time" name="onceLocal" type="datetime-local" required />}
        <Input title="Timezone" name="timezone" defaultValue={localTz()} />
        <Select title="Chats" required={false} name="conversationMode" defaultValue="new" options={[{ value: "new", label: "Start a new chat each run" }, { value: "continue", label: "Continue the same chat" }]} />
        <Select title="Run a workflow instead (optional)" required={false} name="workflowId" options={[{ value: "", label: "No, just ask the bot" }, ...(flows ?? []).map((w) => ({ value: w.id, label: w.name }))]} />
        {nextRuns && <div className="sm:col-span-2" role="status"><p className="text-xs font-medium">Next runs</p><NextRuns runs={nextRuns} /></div>}
        {formError && <p role="alert" className="text-destructive sm:col-span-2">{formError}</p>}
        <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="button" size="sm" variant="outline" onClick={(e) => void preview(e.currentTarget.form!)}>Preview schedule</Button><Button type="submit" size="sm">Create routine (paused)</Button></div>
      </form>}
      <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm empty:hidden">{status}</p>
      {rows?.length === 0 && <Empty>No routines yet. Choose New routine, then activate it once the bot is ready.</Empty>}
      <ul className={list}>{rows?.map((r) => (
        <li key={r.id} className={`${listItem} py-4`}>
          <div className="flex flex-wrap items-center gap-2"><p className="min-w-0 break-words font-medium">{r.title}</p>{r.paused ? <Badge>Paused</Badge> : <Badge tone="success">Active</Badge>}</div>
          <p className="mt-0.5 text-muted-foreground">{botName(r.botId)} · {describeSchedule(r)}{r.dailyAt ? "" : ` (${r.timezone})`}{!r.paused && <> · Next run <span className="tabular-nums">{r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : "-"}</span></>}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {r.paused ? <Button size="sm" variant="outline" onClick={() => setCard(card === r.id ? undefined : r.id)} aria-expanded={card === r.id}>Activate…</Button> : <Button size="sm" variant="outline" onClick={() => void act(() => call(`/api/routines/${r.id}/paused`, "POST", { paused: true }), "Paused.")}>Pause</Button>}
            <Button size="sm" variant="outline" onClick={() => void act(() => call(`/api/routines/${r.id}/run`, "POST", { requestKey: crypto.randomUUID() }), "Started a run. Check the history for the result.")}>Run now</Button>
            <Button size="sm" variant="outline" aria-expanded={open?.id === r.id && open.what === "edit"} onClick={() => setOpen(open?.id === r.id && open.what === "edit" ? undefined : { id: r.id, what: "edit" })}>Edit</Button>
            <Button size="sm" variant="outline" aria-expanded={open?.id === r.id && open.what === "history"} onClick={() => setOpen(open?.id === r.id && open.what === "history" ? undefined : { id: r.id, what: "history" })}>History</Button>
            <ConfirmButton label="Delete" question="Delete this routine? It will be archived." confirmLabel="Delete" onConfirm={() => act(() => call(`/api/routines/${r.id}`, "DELETE"), "Routine deleted.")} />
          </div>
          {card === r.id && <ActivationCard routineId={r.id} onClose={() => setCard(undefined)} onDone={() => { setCard(undefined); setStatus("Routine activated."); void reload(); }} />}
          {open?.id === r.id && open.what === "edit" && <EditForm routine={r} bots={bots} onCancel={() => { setOpen(undefined); void reload(); }} onSaved={() => { setOpen(undefined); setStatus("Changes saved."); void reload(); }} />}
          {open?.id === r.id && open.what === "history" && <History routineId={r.id} />}
        </li>))}</ul>
      <RoutineCalendar refreshKey={rows?.length ?? 0} />
    </section>
  );
}
