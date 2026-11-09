import { ActionHint } from "@/components/action-hint";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { ARTIFACT_HTML_CSP, ARTIFACT_HTML_SANDBOX } from "@zetta/core/artifact-csp";
import { Button } from "@/components/ui";
import { formatSize } from "../artifacts/artifacts-api";
import { relativeTime } from "../shared/relative-time";
import { Badge, Empty } from "../shared/ui";
import {
  fetchOutput,
  outputUrl,
  RUNNER_LABEL,
  STATUS_LABEL,
  type PlaygroundFile,
  type Run,
  type RunOutput,
  type RunStatus,
} from "./playground-api";

const TONE: Record<RunStatus, "neutral" | "success" | "danger" | "warning" | "info"> = {
  running: "info",
  ok: "success",
  failed: "danger",
  timeout: "warning",
  cancelled: "neutral",
  interrupted: "warning",
};
export const StatusBadge = ({ status }: { status: RunStatus }) => (
  <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>
);

const frame = "h-[50vh] w-full rounded-lg border border-border bg-white";
/** Past this many characters a text file shows its start; the download has all of it. */
const SHOWN = 100_000;

const useOutputText = (runId: string, path: string) =>
  useQuery({
    queryKey: ["playground-output", runId, path],
    queryFn: async () => (await fetchOutput(runId, path)).text(),
    // A run never changes, so neither do its files.
    staleTime: Infinity,
  });

/** A page a script wrote to `out/`. It runs in an iframe with no same-origin access: no cookies, no way to call the API. */
function HtmlOutput({ runId, file }: { runId: string; file: RunOutput }) {
  const { data, isError } = useOutputText(runId, file.path);
  if (isError) return <Empty>This file is not available any more.</Empty>;
  if (data === undefined) return <div className="h-24 animate-pulse rounded-lg bg-muted" />;
  return (
    <iframe
      srcDoc={data}
      title={file.path}
      sandbox={ARTIFACT_HTML_SANDBOX}
      {...{ csp: ARTIFACT_HTML_CSP }}
      className={frame}
    />
  );
}

function TextOutput({ runId, file }: { runId: string; file: RunOutput }) {
  const { data, isError } = useOutputText(runId, file.path);
  if (isError) return <Empty>This file is not available any more.</Empty>;
  if (data === undefined) return <div className="h-12 animate-pulse rounded-lg bg-muted" />;
  return (
    <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap">
      {data.slice(0, SHOWN)}
      {data.length > SHOWN && "\n… (cut: download the file for all of it)"}
    </pre>
  );
}

function OutputFile({ runId, file }: { runId: string; file: RunOutput }) {
  const body =
    file.mimeType === "text/html" ? (
      <HtmlOutput runId={runId} file={file} />
    ) : file.mimeType.startsWith("image/") ? (
      <img
        src={outputUrl(runId, file.path)}
        alt={file.path}
        className="max-h-96 rounded-lg border"
      />
    ) : /^(text\/|application\/json)/.test(file.mimeType) ? (
      <TextOutput runId={runId} file={file} />
    ) : null;
  return (
    <li className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
        <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
        <ActionHint label={`Download ${file.path}`}>
          <a
            href={outputUrl(runId, file.path, true)}
            aria-label={`Download ${file.path}`}
            className="grid size-7 place-items-center rounded-md hover:bg-muted"
          >
            <DownloadSimpleIcon className="size-4" />
          </a>
        </ActionHint>
      </div>
      {body}
    </li>
  );
}

const Stream = ({ label, text, danger }: { label: string; text: string; danger?: boolean }) =>
  text ? (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <pre
        className={`max-h-72 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap ${danger ? "border-destructive/40 bg-destructive/5" : "bg-muted/40"}`}
      >
        {text}
      </pre>
    </div>
  ) : null;

/** What a run printed and wrote: status line, stdout, stderr and the files of `out/`. */
export function RunView({
  run,
  onRestore,
}: {
  run: Run;
  /** The owner puts the files this run used back in the editor. */
  onRestore?: ((files: PlaygroundFile[]) => void) | undefined;
}) {
  const quiet = !run.stdout && !run.stderr && run.outputs.length === 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge status={run.status} />
        <span>{RUNNER_LABEL[run.runner]}</span>
        {run.runtimeVersion && <span>{run.runtimeVersion}</span>}
        {run.exitCode !== null && <span>exit {run.exitCode}</span>}
        {run.durationMs !== null && <span>{(run.durationMs / 1000).toFixed(1)} s</span>}
        <span>{relativeTime(run.startedAt)}</span>
        {run.output === "truncated" && <Badge tone="warning">Output cut</Badge>}
        {onRestore && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => onRestore(run.files)}
          >
            Use these files
          </Button>
        )}
      </div>
      <Stream label="Output" text={run.stdout} />
      <Stream label="Errors" text={run.stderr} danger />
      {run.status === "running" && <p className="text-sm text-muted-foreground">Running…</p>}
      {run.status !== "running" && quiet && (
        <p className="text-sm text-muted-foreground">The script printed nothing.</p>
      )}
      {run.outputs.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Files in out/</h4>
          <ul className="space-y-4">
            {run.outputs.map((f) => (
              <OutputFile key={f.path} runId={run.id} file={f} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type ConsoleLine = { level: string; text: string };
const MAX_LINES = 500;

/**
 * A browser playground, built by the server into one page. The page runs in an iframe with no same-origin access; it reports its
 * console lines and errors with `postMessage`, and only messages from this iframe are shown.
 */
export function BrowserPreview({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  useEffect(() => {
    setLines([]);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; level?: string; text?: string } | null;
      if (e.source !== frameRef.current?.contentWindow || d?.source !== "zetta-playground") return;
      setLines((l) => [...l, { level: String(d.level), text: String(d.text) }].slice(-MAX_LINES));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html]);
  return (
    <div className="space-y-3">
      <iframe
        ref={frameRef}
        srcDoc={html}
        title="Preview"
        sandbox={ARTIFACT_HTML_SANDBOX}
        {...{ csp: ARTIFACT_HTML_CSP }}
        className={frame}
      />
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">Console</h4>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing was logged.</p>
        ) : (
          <pre
            aria-label="Console"
            className="max-h-60 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap"
          >
            {lines.map((l, i) => (
              <div key={i} className={l.level === "error" ? "text-destructive" : undefined}>
                {l.text}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
