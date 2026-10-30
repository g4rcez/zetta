import { uuidv7 } from "@zetta/core/uuid";
import { Suspense, lazy, useEffect, useState, type FormEvent } from "react";
import { Button, Input, Select, Textarea } from "@/components/ui";

import { ApiError, call, errorMessage, type Bot } from "../chat/chat-client";
import { Empty, Loading, useList, when } from "../shared/ui";
import { graphToSteps, stepsToGraph, type Step } from "./workflow-steps";

// The canvas pulls in @xyflow/react: load it only when someone opens it.
const WorkflowCanvas = lazy(() =>
  import("./workflow-canvas").then((m) => ({ default: m.WorkflowCanvas })),
);
import type { ServerGraph } from "./workflow-graph";

type Flow = { id: string; name: string; version: number };
type TraceItem = {
  node: string;
  type: string;
  botId?: string;
  output?: string;
  error?: string;
  branch?: "then" | "else";
  skipped?: boolean;
};
type RunResult = { status: string; trace: TraceItem[] };
type PastRun = {
  id: string;
  status: string;
  trace: TraceItem[];
  workflowVersion: number;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  prompt: "Ask a bot",
  browse: "Read a web page",
  decision: "Decide",
  condition: "Check the answer",
  end: "Finish",
};
const STEP_TYPES: { kind: Step["kind"]; label: string }[] = [
  { kind: "prompt", label: "Ask a bot" },
  { kind: "browse", label: "Read a web page" },
  { kind: "decision", label: "Decide (Laya)" },
  { kind: "condition", label: "Check the answer" },
];
const blankStep = (kind: Step["kind"], botId: string): Step =>
  kind === "prompt"
    ? { kind, botId, template: "{{prev}}" }
    : kind === "browse"
      ? { kind, url: "https://" }
      : kind === "decision"
        ? { kind, question: "Which?", options: "yes, no", continueOn: "yes" }
        : { kind, contains: "" };
const RUN_STATUS: Record<string, string> = {
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  interrupted: "Interrupted",
  cancelled: "Stopped",
};

function traceState(t: TraceItem): { icon: string; text: string; tone: string } {
  if (t.error)
    return {
      icon: "✗",
      text: `Failed${t.error ? ` (${t.error.replace(/_/g, " ")})` : ""}`,
      tone: "text-destructive",
    };
  if (t.skipped) return { icon: "–", text: "Skipped", tone: "text-muted-foreground" };
  if (t.branch)
    return {
      icon: "↳",
      text: t.branch === "then" ? "Matched, so it continued" : "Did not match, so it stopped",
      tone: "",
    };
  return { icon: "✓", text: "Done", tone: "" };
}
export function TraceView({ run }: { run: RunResult }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">Result: {RUN_STATUS[run.status] ?? run.status}</p>
      <ol aria-label="Steps that ran" className="space-y-1">
        {run.trace.map((t, i) => {
          const s = traceState(t);
          return (
            <li key={i} className="min-w-0 rounded-md border bg-card p-2 text-xs">
              <span className={s.tone}>
                <span aria-hidden>{s.icon} </span>
                {TYPE_LABEL[t.type] ?? t.type}{" "}
                <span className="text-muted-foreground">({t.node})</span>: {s.text}
              </span>
              {t.output && (
                <details>
                  <summary className="cursor-pointer">Output</summary>
                  <pre className="max-w-full whitespace-pre-wrap break-words">
                    {t.output.slice(0, 2000)}
                  </pre>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RunPanel({ flow }: { flow: Flow }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ run: RunResult; output: string; replayed: boolean }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<PastRun[]>();
  const loadPast = () =>
    call<{ runs: PastRun[] }>(`/api/workflows/${flow.id}/runs`).then(
      (r) => setPast(r.runs),
      () => setPast([]),
    );
  useEffect(() => {
    void loadPast();
  }, [flow.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      setResult(
        await call(`/api/workflows/${flow.id}/run`, "POST", { input, requestKey: uuidv7() }),
      );
      void loadPast();
    } catch (x) {
      setError(
        x instanceof ApiError && x.code === "BOT_NOT_READY"
          ? `${x.message} Open Chat to finish setting that bot up.`
          : errorMessage(x),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-card p-3">
      <form onSubmit={(e) => void run(e)} className="space-y-1">
        <Textarea
          title={`Input for ${flow.name} (optional)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={2}
        />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Running…" : "Run"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-1 text-sm">
          {result.replayed && (
            <p className="text-xs">
              This repeated an earlier request, so the saved result is shown.
            </p>
          )}
          <TraceView run={result.run} />
          {result.output && (
            <div>
              <p className="font-medium">Final answer</p>
              <pre className="max-w-full whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">
                {result.output}
              </pre>
            </div>
          )}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Run history ({past?.length ?? "…"})</summary>
        <ul className="mt-1 space-y-1">
          {past?.map((r) => (
            <li key={r.id} className="rounded-md border bg-card p-2 text-sm">
              <details>
                <summary className="cursor-pointer">
                  {RUN_STATUS[r.status] ?? r.status} · {when(r.createdAt)} · version{" "}
                  {r.workflowVersion}
                </summary>
                <TraceView run={r} />
              </details>
            </li>
          ))}
          {past?.length === 0 && (
            <li>
              <Empty>No runs yet.</Empty>
            </li>
          )}
        </ul>
      </details>
    </div>
  );
}

function Editor({
  bots,
  initial,
  onSaved,
  onCancel,
}: {
  bots: Bot[];
  initial?: { id: string; name: string; version: number; graph: unknown };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const fromGraph = initial ? graphToSteps(initial.graph) : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [steps, setSteps] = useState<Step[]>(fromGraph ?? [blankStep("prompt", bots[0]?.id ?? "")]);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const readOnly = !!initial && !fromGraph;
  const patch = (i: number, p: Partial<Step>) =>
    setSteps((s) => s.map((x, k) => (k === i ? ({ ...x, ...p } as Step) : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s],
        j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const nameOf = (id: string) => bots.find((b) => b.id === id)?.name ?? "bot";
  const describe = (s: Step) =>
    s.kind === "prompt"
      ? `Ask ${nameOf(s.botId)}`
      : s.kind === "browse"
        ? "Read page"
        : s.kind === "decision"
          ? "Decide"
          : `If answer has “${s.contains || "…"}”`;
  const problem = (r: unknown) =>
    (r as { ok: boolean; problems?: unknown[] }).problems
      ?.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .join(" ");

  async function validate() {
    setError(undefined);
    setStatus(undefined);
    try {
      const r = await call<{ ok: boolean; problems?: unknown[] }>(
        "/api/workflows/validate",
        "POST",
        { graph: stepsToGraph(steps) },
      );
      if (r.ok) setStatus("This workflow looks valid.");
      else setError(problem(r) || "The workflow is not valid.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setStatus(undefined);
    try {
      await call("/api/workflows", "POST", {
        name: name.trim(),
        graph: stepsToGraph(steps),
        ...(initial ? { id: initial.id, expectedVersion: initial.version } : {}),
      });
      onSaved();
    } catch (x) {
      setError(
        x instanceof ApiError && x.code === "STALE_VERSION"
          ? "This workflow was changed somewhere else. Cancel and open it again to see the latest version."
          : errorMessage(x),
      );
    }
  }
  if (readOnly) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-4" aria-label="Workflow (read-only)">
        <p className="text-sm">
          This workflow has a shape the step builder cannot edit, so it is shown read-only.
        </p>
        <pre className="max-h-80 max-w-full overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(initial.graph, null, 2)}
        </pre>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => void save(e)}
      className="space-y-2 rounded-lg border bg-card p-4"
      aria-label={initial ? `Edit ${initial.name}` : "New workflow"}
    >
      <Input
        title="Workflow name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={120}
      />
      <ol aria-label="Flow" className="flex flex-wrap items-center gap-1 text-xs">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="rounded-lg border px-2 py-0.5">
              {i + 1}. {describe(s)}
            </span>
            <span aria-hidden>→</span>
          </li>
        ))}
        <li className="rounded-lg border px-2 py-0.5">done</li>
      </ol>
      {steps.map((s, i) => (
        <fieldset
          key={i}
          className="grid min-w-0 gap-2 rounded-md border bg-card p-3 sm:grid-cols-[10rem_1fr]"
        >
          <legend className="px-1 text-xs">Step {i + 1}</legend>
          <Select
            title={`Step ${i + 1} type`}
            hiddenLabel
            required={false}
            value={s.kind}
            onChange={(e) =>
              setSteps(
                steps.map((x, k) =>
                  k === i ? blankStep(e.target.value as Step["kind"], bots[0]?.id ?? "") : x,
                ),
              )
            }
            options={STEP_TYPES.map((t) => ({ value: t.kind, label: t.label }))}
          />
          {s.kind === "prompt" && (
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <Select
                title={`Step ${i + 1} bot`}
                hiddenLabel
                required={false}
                value={s.botId}
                onChange={(e) => patch(i, { botId: e.target.value })}
                options={bots.map((b) => ({ value: b.id, label: b.name }))}
              />
              <Input
                title={`Step ${i + 1} prompt`}
                hiddenLabel
                value={s.template}
                onChange={(e) => patch(i, { template: e.target.value })}
              />
            </div>
          )}
          {s.kind === "browse" && (
            <Input
              title={`Step ${i + 1} address`}
              hiddenLabel
              value={s.url}
              onChange={(e) => patch(i, { url: e.target.value })}
            />
          )}
          {s.kind === "decision" && (
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                title={`Step ${i + 1} question`}
                hiddenLabel
                placeholder="Question"
                value={s.question}
                onChange={(e) => patch(i, { question: e.target.value })}
              />
              <Input
                title={`Step ${i + 1} options`}
                hiddenLabel
                placeholder="Options, comma separated"
                value={s.options}
                onChange={(e) => patch(i, { options: e.target.value })}
              />
              <Input
                title={`Step ${i + 1} continue when`}
                hiddenLabel
                placeholder="Continue when it picks"
                value={s.continueOn}
                onChange={(e) => patch(i, { continueOn: e.target.value })}
              />
            </div>
          )}
          {s.kind === "condition" && (
            <div className="space-y-1">
              <Input
                title={`Step ${i + 1} text to look for`}
                hiddenLabel
                placeholder="Text to look for"
                value={s.contains}
                onChange={(e) => patch(i, { contains: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                If the previous answer contains this text, continue. Otherwise, stop.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-1 sm:col-span-2">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label={`Move step ${i + 1} up`}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={i === steps.length - 1}
              onClick={() => move(i, 1)}
              aria-label={`Move step ${i + 1} down`}
            >
              ↓
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={steps.length <= 1}
              onClick={() => setSteps(steps.filter((_, k) => k !== i))}
            >
              Remove step {i + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">
        Use {"{{input}}"} for the run input and {"{{prev}}"} for the previous step's output. A
        decision continues only when Laya picks the “continue when” option.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={steps.length >= 15}
          onClick={() => setSteps([...steps, blankStep("prompt", bots[0]?.id ?? "")])}
        >
          Add step
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void validate()}>
          Check workflow
        </Button>
        <Button type="submit" size="sm">
          {initial ? "Save new version" : "Save workflow"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p role="status" className="text-sm empty:hidden">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export function Workflows({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const [rows, reload] = useList<Flow>("/api/workflows", "workflows", onError);
  const [editor, setEditor] = useState<
    { id?: string; name: string; version: number; graph: unknown } | "new"
  >();
  const [canvas, setCanvas] = useState<
    { id: string; name: string; version: number; graph: ServerGraph } | "new"
  >();
  async function editCanvas(id: string) {
    try {
      const r = await call<{
        workflow: { id: string; name: string; graph: ServerGraph; version: number };
      }>(`/api/workflows/${id}`);
      setCanvas(r.workflow);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  const [running, setRunning] = useState<string>();
  async function edit(id: string) {
    try {
      const r = await call<{
        workflow: { id: string; name: string; graph: unknown; version: number };
      }>(`/api/workflows/${id}`);
      setEditor(r.workflow);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <section aria-label="Workflows" className="space-y-3">
      {canvas ? (
        <div className="space-y-2">
          <Button size="sm" variant="outline" onClick={() => setCanvas(undefined)}>
            Close canvas
          </Button>
          <Suspense fallback={<Loading />}>
            <WorkflowCanvas
              key={canvas === "new" ? "new" : `${canvas.id}-${canvas.version}`}
              bots={bots}
              {...(canvas === "new"
                ? {}
                : {
                    initial: canvas.graph,
                    workflow: { id: canvas.id, name: canvas.name, version: canvas.version },
                  })}
              onError={onError}
              onSaved={() => {
                setCanvas(undefined);
                void reload();
              }}
            />
          </Suspense>
        </div>
      ) : editor ? (
        <Editor
          key={editor === "new" ? "new" : `${editor.id}-${editor.version}`}
          bots={bots}
          {...(editor === "new"
            ? {}
            : {
                initial: {
                  id: editor.id!,
                  name: editor.name,
                  version: editor.version,
                  graph: editor.graph,
                },
              })}
          onCancel={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            void reload();
          }}
        />
      ) : (
        <span className="flex gap-2">
          <Button size="sm" onClick={() => setEditor("new")}>
            New workflow (steps)
          </Button>
          {!canvas && (
            <Button size="sm" variant="outline" onClick={() => setCanvas("new")}>
              New workflow (canvas)
            </Button>
          )}
        </span>
      )}
      {rows?.length === 0 && <Empty>No workflows yet.</Empty>}
      <ul className="space-y-1">
        {rows?.map((w) => (
          <li key={w.id} className="min-w-0 rounded-md border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words font-medium">
                {w.name}{" "}
                <span className="font-normal text-muted-foreground">(version {w.version})</span>
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => void edit(w.id)}>
                  Edit<span className="sr-only"> {w.name}</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => void editCanvas(w.id)}>
                  Canvas<span className="sr-only"> for {w.name}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={running === w.id}
                  onClick={() => setRunning(running === w.id ? undefined : w.id)}
                >
                  Run<span className="sr-only"> {w.name}</span>
                </Button>
              </span>
            </div>
            {running === w.id && <RunPanel flow={w} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
