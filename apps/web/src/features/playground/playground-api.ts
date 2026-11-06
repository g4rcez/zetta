import { queryOptions } from "@tanstack/react-query";

import { ENV } from "../../env";
import { call } from "../chat/chat-client";

export type PlaygroundLanguage = "typescript" | "javascript" | "python" | "bash" | "html";
export type PlaygroundRunner = "host" | "container" | "browser";
export type PlaygroundVisibility = "private" | "team";
export type InputType = "string" | "number" | "boolean" | "json";
export type InputSpec = { name: string; label?: string; type: InputType; default?: unknown };
export type PlaygroundFile = { path: string; content: string };
export type RunStatus = "running" | "ok" | "failed" | "timeout" | "cancelled" | "interrupted";

export type PlaygroundSummary = {
  id: string;
  title: string;
  language: PlaygroundLanguage;
  runner: PlaygroundRunner;
  visibility: PlaygroundVisibility;
  ownerUserId: string;
  ownerName: string;
  createdByBotId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type Playground = PlaygroundSummary & {
  entry: string;
  inputs: InputSpec[];
  /** The caller owns it: only the owner edits. */
  mine: boolean;
  files: (PlaygroundFile & { size: number })[];
};
export type RunSummary = {
  id: string;
  playgroundId: string;
  actorUserId: string;
  botId: string | null;
  runner: PlaygroundRunner;
  status: RunStatus;
  runtimeVersion: string;
  entry: string;
  inputs: Record<string, unknown>;
  exitCode: number | null;
  output: "complete" | "truncated";
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
};
export type RunOutput = { path: string; mimeType: string; size: number };
export type Run = RunSummary & {
  stdout: string;
  stderr: string;
  files: PlaygroundFile[];
  outputs: RunOutput[];
};
export type LanguageInfo = {
  id: PlaygroundLanguage;
  label: string;
  defaultEntry: string;
  runners: PlaygroundRunner[];
  /** The version line of the CLI on the server host, or null when it is not installed. */
  hostVersion: string | null;
  /** The server has a container engine and this language can use it. */
  container: boolean;
};
export type PlaygroundDraft = {
  title: string;
  language: PlaygroundLanguage;
  runner: PlaygroundRunner;
  entry: string;
  files: PlaygroundFile[];
  inputs: InputSpec[];
  visibility: PlaygroundVisibility;
};

export const playgroundApi = {
  languages: () =>
    call<{ languages: LanguageInfo[] }>("/api/playgrounds/languages").then((r) => r.languages),
  list: (scope: "mine" | "team", q?: string) =>
    call<{ playgrounds: PlaygroundSummary[] }>(
      `/api/playgrounds?${new URLSearchParams({ scope, ...(q ? { q } : {}) })}`,
    ).then((r) => r.playgrounds),
  get: (id: string) =>
    call<{ playground: Playground }>(`/api/playgrounds/${id}`).then((r) => r.playground),
  create: (
    draft: Partial<PlaygroundDraft> & Pick<PlaygroundDraft, "title" | "language" | "files">,
  ) =>
    call<{ playground: Playground }>("/api/playgrounds", "POST", draft).then((r) => r.playground),
  update: (id: string, expectedVersion: number, draft: Partial<PlaygroundDraft>) =>
    call<{ playground: Playground }>(`/api/playgrounds/${id}`, "PATCH", {
      expectedVersion,
      ...draft,
    }).then((r) => r.playground),
  archive: (id: string) => call(`/api/playgrounds/${id}`, "DELETE"),
  fork: (id: string) =>
    call<{ playground: Playground }>(`/api/playgrounds/${id}/fork`, "POST").then(
      (r) => r.playground,
    ),
  run: (id: string, inputs: Record<string, unknown>) =>
    call<{ run: RunSummary }>(`/api/playgrounds/${id}/runs`, "POST", { inputs }).then((r) => r.run),
  runs: (id: string) =>
    call<{ runs: RunSummary[] }>(`/api/playgrounds/${id}/runs`).then((r) => r.runs),
  getRun: (runId: string) => call<{ run: Run }>(`/api/playground-runs/${runId}`).then((r) => r.run),
  cancel: (runId: string) => call(`/api/playground-runs/${runId}/cancel`, "POST"),
  /** The page of a browser playground, built from the files on screen. */
  build: (
    id: string,
    draft: { files: PlaygroundFile[]; entry: string; inputs: Record<string, unknown> },
  ) => call<{ html: string }>(`/api/playgrounds/${id}/build`, "POST", draft).then((r) => r.html),
};

export const outputUrl = (runId: string, path: string, download = false) =>
  new URL(
    `/api/playground-runs/${runId}/outputs/${path.split("/").map(encodeURIComponent).join("/")}${download ? "?download=1" : ""}`,
    ENV.VITE_SERVER_URL,
  ).href;
export const fetchOutput = async (runId: string, path: string) => {
  const r = await fetch(outputUrl(runId, path), { credentials: "include" });
  if (!r.ok) throw new Error("unavailable");
  return r;
};

/** Keys nest under `["playground"]`: the live topic of a playground refetches them all. */
export const playgroundQueries = {
  languages: () =>
    queryOptions({
      queryKey: ["playground", "languages"],
      queryFn: () => playgroundApi.languages(),
      staleTime: 60_000,
    }),
  list: (scope: "mine" | "team", q?: string) =>
    queryOptions({
      queryKey: ["playground", "list", scope, q ?? ""],
      queryFn: () => playgroundApi.list(scope, q),
    }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["playground", "detail", id], queryFn: () => playgroundApi.get(id) }),
  runs: (id: string) =>
    queryOptions({ queryKey: ["playground", "runs", id], queryFn: () => playgroundApi.runs(id) }),
  run: (runId: string) =>
    queryOptions({
      queryKey: ["playground", "run", runId],
      queryFn: () => playgroundApi.getRun(runId),
    }),
};

export const RUNNER_LABEL: Record<PlaygroundRunner, string> = {
  host: "Server host",
  container: "Container",
  browser: "Browser",
};
export const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  ok: "Succeeded",
  failed: "Failed",
  timeout: "Timed out",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

/** The CodeMirror language of a file, from its extension. Markdown and unknown files stay plain text. */
export function languageOfFile(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    mjs: "javascript",
    jsx: "jsx",
    py: "python",
    sh: "bash",
    bash: "bash",
    html: "html",
    css: "css",
    json: "json",
    sql: "sql",
    yaml: "yaml",
    yml: "yaml",
  };
  return ext ? map[ext] : undefined;
}

/** A first file for a new playground, so it runs at once. */
export const STARTER: Record<PlaygroundLanguage, string> = {
  typescript:
    'const inputs = await Bun.file("inputs.json").json();\nconsole.log("hello", inputs);\n',
  javascript:
    'const inputs = await Bun.file("inputs.json").json();\nconsole.log("hello", inputs);\n',
  python:
    'import json\n\nwith open("inputs.json") as f:\n    inputs = json.load(f)\nprint("hello", inputs)\n',
  bash: 'echo "hello $ZETTA_INPUTS"\n',
  html: '<!doctype html>\n<html>\n  <body>\n    <h1>Hello</h1>\n    <script>\n      console.log("inputs", window.ZETTA_INPUTS);\n    </script>\n  </body>\n</html>\n',
};
