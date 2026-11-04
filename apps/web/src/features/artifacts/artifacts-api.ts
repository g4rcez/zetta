import { queryOptions } from "@tanstack/react-query";

import { ENV } from "../../env";
import { call } from "../chat/chat-client";

export const ARTIFACT_KINDS = [
  { kind: "html", label: "Page" },
  { kind: "markdown", label: "Markdown" },
  { kind: "text", label: "Text" },
  { kind: "code", label: "Code" },
  { kind: "csv", label: "Table" },
  { kind: "json", label: "JSON" },
  { kind: "image", label: "Image" },
  { kind: "video", label: "Video" },
  { kind: "audio", label: "Audio" },
  { kind: "pdf", label: "PDF" },
  { kind: "zip", label: "Zip" },
  { kind: "binary", label: "File" },
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]["kind"];
export const kindLabel = (k: ArtifactKind) =>
  ARTIFACT_KINDS.find((x) => x.kind === k)?.label ?? "File";

export type Artifact = {
  id: string;
  title: string;
  description: string;
  fileName: string;
  mimeType: string;
  kind: ArtifactKind;
  size: number;
  botId: string | null;
  conversationId: string | null;
  routineRunId: string | null;
  pinnedAt: string | null;
  createdAt: string;
};
export type ArtifactSort = "recent" | "oldest" | "largest";
export type ArtifactFilter = {
  bot?: string | undefined;
  kind?: ArtifactKind | undefined;
  q?: string | undefined;
  /** Newest first when absent. */
  sort?: Exclude<ArtifactSort, "recent"> | undefined;
};
export type ArtifactUsage = { used: number; quota: number };

export const artifactsApi = {
  list: (f: ArtifactFilter = {}) => {
    const p = new URLSearchParams();
    if (f.bot) p.set("botId", f.bot);
    if (f.kind) p.set("kind", f.kind);
    if (f.q) p.set("q", f.q);
    if (f.sort) p.set("sort", f.sort);
    return call<{ artifacts: Artifact[] }>(`/api/artifacts?${p}`).then((r) => r.artifacts);
  },
  get: (id: string) => call<{ artifact: Artifact }>(`/api/artifacts/${id}`).then((r) => r.artifact),
  remove: (id: string) => call(`/api/artifacts/${id}`, "DELETE"),
  pin: (id: string, pinned: boolean) =>
    call<{ artifact: Artifact }>(`/api/artifacts/${id}`, "PATCH", { pinned }).then(
      (r) => r.artifact,
    ),
  usage: () => call<ArtifactUsage>("/api/artifacts/usage"),
};

/** Every key starts with "artifacts": one invalidation after a pin or a delete refreshes the list, the item and the usage. */
export const artifactsQueries = {
  list: (f: ArtifactFilter) =>
    queryOptions({
      queryKey: [
        "artifacts",
        "list",
        { bot: f.bot ?? null, kind: f.kind ?? null, q: f.q ?? "", sort: f.sort ?? null },
      ],
      queryFn: () => artifactsApi.list(f),
    }),
  detail: (id: string) =>
    queryOptions({ queryKey: ["artifacts", id], queryFn: () => artifactsApi.get(id) }),
  usage: () =>
    queryOptions({ queryKey: ["artifacts", "usage"], queryFn: () => artifactsApi.usage() }),
};

/** The file itself. `download` makes the server answer with an attachment. */
export const contentUrl = (id: string, download = false) =>
  new URL(`/api/artifacts/${id}/content${download ? "?download=1" : ""}`, ENV.VITE_SERVER_URL).href;
export const fetchContent = async (id: string) => {
  const r = await fetch(contentUrl(id), { credentials: "include" });
  if (!r.ok) throw new Error("unavailable");
  return r;
};

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
] as const;
/** "3 hours ago", "yesterday"; falls back to "just now" under a minute. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const step = STEPS.find(([, sec]) => Math.abs(s) >= sec);
  return step ? RELATIVE.format(Math.round(s / step[1]), step[0]) : "just now";
}
