import { CaretLeftIcon, PlayIcon, StopIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { Loading } from "../shared/ui";
import { CodeEditor } from "./code-editor";
import { pathProblem, renameFile } from "./files";
import { collectInputs, withDefaults, type FieldValue } from "./inputs";
import {
  playgroundApi,
  playgroundQueries,
  RUNNER_LABEL,
  type Playground,
  type PlaygroundDraft,
  type PlaygroundLanguage,
  type PlaygroundRunner,
} from "./playground-api";
import { control, FileTabs, History, InputsPanel, tab, Tool } from "./playground-parts";
import type { PlaygroundSearch } from "./playground-search";
import { BrowserPreview, RunView } from "./run-output";

const toDraft = (p: Playground): PlaygroundDraft => ({
  title: p.title,
  language: p.language,
  runner: p.runner,
  entry: p.entry,
  files: p.files.map(({ path, content }) => ({ path, content })),
  inputs: p.inputs,
  visibility: p.visibility,
});

/** The keys that run the playground: Cmd+Enter or Ctrl+Enter, and F9. */
export const isRunKey = (e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">) =>
  e.key === "F9" || ((e.metaKey || e.ctrlKey) && e.key === "Enter");
const MAC = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
const RUN_HINT = `${MAC ? "⌘" : "Ctrl"}+Enter or F9`;

type Panel = "output" | "inputs" | "runs";

/**
 * One playground, laid out as an editor: a toolbar on top, the files in the left pane, and what a run printed, the inputs and the runs in
 * the right pane. The owner edits and saves; anyone who can read a shared playground runs it and forks it. The open file, the run on
 * screen and the tab of the right pane are in the address (`search`). Cmd/Ctrl+Enter and F9 run it.
 */
export function PlaygroundPage({
  id,
  search,
  setSearch,
  onOpen,
  onLeave,
}: {
  id: string;
  search: PlaygroundSearch;
  setSearch: (
    patch: Partial<Record<keyof PlaygroundSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  /** Opens another playground (a fork). */
  onOpen: (id: string) => void;
  /** Back to the list. */
  onLeave: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery(playgroundQueries.detail(id));
  const languages = useQuery(playgroundQueries.languages());
  const runsQuery = useQuery(playgroundQueries.runs(id));
  const pg = detail.data;
  const serverDraft = useMemo(() => (pg ? toDraft(pg) : undefined), [pg]);
  /** What the owner changed and did not save. Absent: the screen shows the saved playground. */
  const [edits, setEdits] = useState<PlaygroundDraft>();
  /** The saved version the edits started from. A newer one means someone else saved in the meantime. */
  const [from, setFrom] = useState<number>();
  const [fields, setFields] = useState<Record<string, FieldValue>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [page, setPage] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  // The keys are taken on the window, in the capture phase: the editor never sees Cmd+Enter (it would add a line).
  const runRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isRunKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) runRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const runs = runsQuery.data ?? [];
  const selectedRun = search.run ?? runs[0]?.id;
  const runQuery = useQuery({
    ...playgroundQueries.run(selectedRun ?? ""),
    enabled: Boolean(selectedRun),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });

  const draft = edits ?? serverDraft;
  if (detail.isLoading || !pg || !draft) {
    return detail.error ? (
      <div className="mx-auto max-w-3xl space-y-3 p-8">
        <Alert theme="danger">{errorMessage(detail.error)}</Alert>
        <Tool onClick={onLeave}>Back to playgrounds</Tool>
      </div>
    ) : (
      <Loading />
    );
  }

  const canEdit = pg.mine;
  const unsaved = canEdit && (edits !== undefined || Object.keys(fields).length > 0);
  const changedElsewhere = edits !== undefined && from !== undefined && pg.version !== from;
  const edit = (patch: Partial<PlaygroundDraft>) => {
    if (edits === undefined) setFrom(pg.version);
    setEdits({ ...draft, ...patch });
  };
  const discard = () => {
    setEdits(undefined);
    setFrom(undefined);
    setFields({});
  };
  const openPath = draft.files.some((f) => f.path === search.file) ? search.file! : draft.entry;
  const info = languages.data?.find((l) => l.id === draft.language);
  const allowed = (info?.runners ?? [draft.runner]).filter(
    (r) =>
      r === draft.runner ||
      r === "browser" ||
      (r === "host" && info?.hostVersion) ||
      (r === "container" && info?.container),
  );
  const running = runQuery.data?.status === "running";
  const browser = draft.runner === "browser";
  const panel: Panel = search.panel ?? "output";
  const showPanel = (p: Panel) =>
    setSearch({ panel: p === "output" ? undefined : p }, { replace: true });

  async function save(): Promise<boolean> {
    setBusy("Saving");
    setError(undefined);
    try {
      const saved = await playgroundApi.update(id, pg!.version, {
        ...draft!,
        inputs: withDefaults(draft!.inputs, fields),
      });
      qc.setQueryData(playgroundQueries.detail(id).queryKey, saved);
      void qc.invalidateQueries({ queryKey: ["playground", "list"] });
      discard();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  async function run() {
    if (busy !== undefined || running) return;
    setError(undefined);
    let values: Record<string, unknown>;
    try {
      values = collectInputs(draft!.inputs, fields);
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    // The server runs and builds what is saved, so a change to the files or settings is saved first. New input values are only for this run.
    if (canEdit && edits !== undefined && !(await save())) return;
    setBusy(browser ? "Building" : "Starting");
    try {
      if (browser) {
        setPage(
          await playgroundApi.build(id, {
            files: draft!.files,
            entry: draft!.entry,
            inputs: values,
          }),
        );
        setSearch({ panel: undefined }, { replace: true });
      } else {
        const started = await playgroundApi.run(id, values);
        setSearch({ run: started.id, panel: undefined });
        void qc.invalidateQueries({ queryKey: ["playground", "runs", id] });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }
  runRef.current = () => void run();

  async function attempt(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  }

  const tabs: { id: Panel; label: string }[] = [
    { id: "output", label: browser ? "Preview" : "Output" },
    { id: "inputs", label: `Inputs${draft.inputs.length ? ` ${draft.inputs.length}` : ""}` },
    ...(browser
      ? []
      : [{ id: "runs" as const, label: `Runs${runs.length ? ` ${runs.length}` : ""}` }]),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Tool look="ghost" aria-label="All playgrounds" onClick={onLeave} className="px-2">
          <CaretLeftIcon className="size-4" />
        </Tool>
        {running && selectedRun ? (
          <Tool
            look="danger"
            onClick={() => void attempt("Stopping", () => playgroundApi.cancel(selectedRun))}
          >
            <StopIcon className="size-4" /> Stop
          </Tool>
        ) : (
          <Tool
            look="primary"
            title={`Run (${RUN_HINT})`}
            aria-keyshortcuts="Control+Enter Meta+Enter F9"
            disabled={busy !== undefined}
            onClick={() => void run()}
          >
            <PlayIcon className="size-4" weight="fill" /> {browser ? "Preview" : "Run"}
          </Tool>
        )}
        {canEdit ? (
          <input
            aria-label="Title"
            maxLength={120}
            value={draft.title}
            onChange={(e) => edit({ title: e.target.value })}
            className={`${control} w-64 max-w-full font-medium`}
          />
        ) : (
          <h1 className="min-w-0 truncate text-base">{pg.title}</h1>
        )}
        <span className="hidden text-xs text-muted-foreground md:inline">
          {canEdit ? "Yours" : `Shared by ${pg.ownerName}`} · v{pg.version}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              <select
                aria-label="Language"
                value={draft.language}
                onChange={(e) => {
                  const language = e.target.value as PlaygroundLanguage;
                  const runners = languages.data?.find((l) => l.id === language)?.runners ?? [];
                  edit({
                    language,
                    ...(runners.includes(draft.runner) ? {} : { runner: runners[0] ?? "host" }),
                  });
                }}
                className={control}
              >
                {(languages.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Runs on"
                value={draft.runner}
                onChange={(e) => edit({ runner: e.target.value as PlaygroundRunner })}
                className={control}
              >
                {allowed.map((r) => (
                  <option key={r} value={r}>
                    {RUNNER_LABEL[r]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Who can see it"
                value={draft.visibility}
                onChange={(e) => edit({ visibility: e.target.value as "private" | "team" })}
                className={control}
              >
                <option value="private">Only me</option>
                <option value="team">The team</option>
              </select>
              <Tool disabled={!unsaved || busy !== undefined} onClick={() => void save()}>
                Save
              </Tool>
              {confirming ? (
                <span
                  role="group"
                  aria-label={`Archive "${pg.title}"? It leaves your list; its runs are kept.`}
                  className="inline-flex items-center gap-1"
                >
                  <Tool
                    look="danger"
                    onClick={() =>
                      void attempt("Archiving", async () => {
                        await playgroundApi.archive(id);
                        void qc.invalidateQueries({ queryKey: ["playground", "list"] });
                        onLeave();
                      })
                    }
                  >
                    Archive it
                  </Tool>
                  <Tool look="ghost" onClick={() => setConfirming(false)}>
                    Keep
                  </Tool>
                </span>
              ) : (
                <Tool look="ghost" onClick={() => setConfirming(true)}>
                  Archive
                </Tool>
              )}
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                {info?.label} · {RUNNER_LABEL[draft.runner]}
              </span>
              <Tool
                disabled={busy !== undefined}
                onClick={() =>
                  void attempt("Forking", async () => onOpen((await playgroundApi.fork(id)).id))
                }
              >
                Fork to edit
              </Tool>
            </>
          )}
        </div>
      </div>
      {(error || changedElsewhere || (draft.runner === "host" && info && !info.hostVersion)) && (
        <div className="space-y-2 border-b px-3 py-2">
          {error && <Alert theme="danger">{error}</Alert>}
          {changedElsewhere && (
            <Alert theme="warn">
              This playground changed since you started editing (version {pg.version}). Saving will
              be refused.
              <Tool className="ml-2" onClick={discard}>
                Discard my changes
              </Tool>
            </Alert>
          )}
          {draft.runner === "host" && info && !info.hostVersion && (
            <Alert theme="warn">
              {info.label} is not installed on the server host. Choose another runner.
            </Alert>
          )}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-2 lg:grid-rows-1">
        <section aria-label="Files" className="flex min-h-0 min-w-0 flex-col lg:border-r">
          <FileTabs
            files={draft.files}
            entry={draft.entry}
            open={openPath}
            canEdit={canEdit}
            onOpen={(path) => setSearch({ file: path === draft.entry ? undefined : path })}
            onAdd={(path) => {
              const why = pathProblem(path, draft.files);
              if (why) return why;
              edit({ files: [...draft.files, { path, content: "" }] });
              setSearch({ file: path });
              return undefined;
            }}
            onRemove={(path) => {
              edit({ files: draft.files.filter((f) => f.path !== path) });
              if (openPath === path) setSearch({ file: undefined });
            }}
            onEntry={(path) => edit({ entry: path })}
            onRename={(from, to) => {
              const renamed = renameFile(draft, from, to);
              if ("problem" in renamed) return renamed.problem;
              edit(renamed);
              setSearch({ file: draft.entry === from ? undefined : to });
              return undefined;
            }}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeEditor
              path={openPath}
              value={draft.files.find((f) => f.path === openPath)?.content ?? ""}
              readOnly={!canEdit}
              onChange={(content) =>
                edit({
                  files: draft.files.map((f) => (f.path === openPath ? { ...f, content } : f)),
                })
              }
            />
          </div>
        </section>
        <section
          aria-label="Result"
          className="flex min-h-0 min-w-0 flex-col border-t lg:border-t-0"
        >
          <div
            role="group"
            aria-label="Result panel"
            className="flex min-h-11 items-center gap-1 border-b px-2 py-1.5"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={panel === t.id}
                onClick={() => showPanel(t.id)}
                className={tab}
              >
                {t.label}
              </button>
            ))}
            <span className="ml-auto hidden px-2 text-xs text-muted-foreground xl:inline">
              {RUN_HINT} to run
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {panel === "inputs" ? (
              <InputsPanel
                specs={draft.inputs}
                fields={fields}
                canEdit={canEdit}
                onField={(name, value) => setFields((f) => ({ ...f, [name]: value }))}
                onSpecs={(inputs) => edit({ inputs })}
              />
            ) : panel === "runs" && !browser ? (
              <History
                runs={runs}
                selected={selectedRun}
                onSelect={(run) => setSearch({ run, panel: undefined })}
              />
            ) : browser ? (
              page ? (
                <BrowserPreview html={page} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Press Preview ({RUN_HINT}) to build the page and run it here.
                </p>
              )
            ) : runQuery.data ? (
              <RunView
                run={runQuery.data}
                onRestore={
                  canEdit
                    ? (files) => {
                        edit({ files });
                        setSearch({ file: undefined });
                      }
                    : undefined
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {selectedRun
                  ? "Loading the run…"
                  : `Press Run (${RUN_HINT}) to see the result here.`}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
