import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  WaveformIcon,
  CodeIcon,
  FileIcon,
  FileImageIcon,
  FileCodeIcon,
  FileTextIcon,
  CaretDownIcon,
  FilmStripIcon,
  GlobeIcon,
  PushPinIcon,
  MagnifyingGlassIcon,
  TableIcon,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BotIdentity } from "@/components/bot-identity";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Badge, ConfirmButton, Empty, field, list, listItem } from "../shared/ui";
import {
  ago,
  ARTIFACT_KINDS,
  artifactsApi,
  artifactsQueries,
  formatSize,
  kindLabel,
  type Artifact,
  type ArtifactFilter,
  type ArtifactKind,
  type ArtifactSort,
  type ArtifactUsage,
} from "./artifacts-api";
import { groupVersions } from "./versions";
import { useTimeFormat } from "@/features/preferences/preferences";
import { formatDateTime } from "@/features/preferences/time-format";

const NO_BOTS: Bot[] = [];
const NO_ARTIFACTS: Artifact[] = [];

export const KIND_ICON: Record<ArtifactKind, PhosphorIcon> = {
  html: GlobeIcon,
  markdown: FileTextIcon,
  text: FileTextIcon,
  code: CodeIcon,
  csv: TableIcon,
  json: FileCodeIcon,
  image: FileImageIcon,
  video: FilmStripIcon,
  audio: WaveformIcon,
  pdf: FileIcon,
  zip: ArchiveIcon,
  binary: FileIcon,
};

/** Everything the bots delivered. The list never loads file content: a row opens the preview page. */
export function ArtifactsPage({ filter }: { filter: ArtifactFilter }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState(filter.q ?? "");
  const [manage, setManage] = useState(Boolean(filter.sort));
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { bot, kind, sort } = filter;
  const search = filter.q ?? "";

  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const listQuery = useQuery({
    ...artifactsQueries.list({ bot, kind, q: search, sort }),
    // A new filter keeps the old rows on screen until the new ones arrive.
    placeholderData: keepPreviousData,
  });
  const rows = listQuery.data ?? (listQuery.isError ? NO_ARTIFACTS : undefined);
  const listError = listQuery.error;
  useEffect(() => {
    if (listError) toast.error(errorMessage(listError), { id: "artifacts-load" });
  }, [listError]);
  const usage = useQuery(artifactsQueries.usage()).data;
  const listKey = artifactsQueries.list({ bot, kind, q: search, sort }).queryKey;

  const set = (next: ArtifactFilter) =>
    void navigate({ to: "/artifacts", search: { ...filter, ...next }, replace: true });
  // The search box waits for a pause in typing before it asks the server.
  useEffect(() => {
    if (q.trim() === search) return;
    const t = setTimeout(() => set({ q: q.trim() || undefined }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const pin = (a: Artifact) =>
    artifactsApi.pin(a.id, !a.pinnedAt).then(
      (u) => {
        qc.setQueryData<Artifact[]>(listKey, (all) => all?.map((x) => (x.id === u.id ? u : x)));
        void qc.invalidateQueries({ queryKey: ["artifacts"] });
      },
      (e) => void toast.error(errorMessage(e)),
    );
  const remove = (a: Artifact) =>
    artifactsApi.remove(a.id).then(
      () => {
        qc.setQueryData<Artifact[]>(listKey, (all) => all?.filter((x) => x.id !== a.id));
        void qc.invalidateQueries({ queryKey: ["artifacts"] });
      },
      (e) => void toast.error(errorMessage(e)),
    );
  const toggleManage = () => {
    setManage(!manage);
    // Leaving the cleanup view goes back to newest first.
    if (manage && sort) set({ sort: undefined });
  };
  // Versions are only folded in the default view; cleanup lists every file on its own.
  const groups = useMemo(
    () =>
      manage
        ? (rows ?? []).map((head) => ({ head, older: [] as Artifact[] }))
        : groupVersions(rows ?? []),
    [rows, manage],
  );
  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const filtered = Boolean(bot || kind || search);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="space-y-1">
            <h1>Artifacts</h1>
            <p className="text-sm text-muted-foreground">
              Reports, files and presentations your bots and routines delivered.
            </p>
          </div>
          {usage && (
            <UsageBar usage={usage} manage={manage} sort={sort} onSort={(v) => set({ sort: v })} />
          )}
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-xs">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              aria-label="Search artifacts"
              placeholder="Search by title"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${field} pl-9`}
            />
          </div>
          <select
            aria-label="Filter by bot"
            value={bot ?? ""}
            onChange={(e) => set({ bot: e.target.value || undefined })}
            className={`${field} w-44`}
          >
            <option value="">All bots</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            value={kind ?? ""}
            onChange={(e) =>
              set({ kind: (e.target.value || undefined) as ArtifactKind | undefined })
            }
            className={`${field} w-36`}
          >
            <option value="">All types</option>
            {ARTIFACT_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-pressed={manage}
            onClick={toggleManage}
            className="ml-auto rounded-md border px-3 py-2 text-sm hover:bg-muted aria-pressed:bg-muted"
          >
            Free space
          </button>
        </div>
        <div>
          {rows === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <Empty>
              {filtered
                ? "No artifact matches these filters."
                : "No artifacts yet. When a bot or a routine delivers a report, a file or a presentation, it shows up here."}
            </Empty>
          ) : (
            <ul className={list}>
              {groups.map(({ head, older }) => (
                <li key={head.id}>
                  <Row a={head} byId={byId} manage={manage} onPin={pin} onRemove={remove}>
                    {older.length > 0 && (
                      <button
                        type="button"
                        aria-expanded={open.has(head.id)}
                        onClick={() =>
                          setOpen((s) => {
                            const next = new Set(s);
                            if (!next.delete(head.id)) next.add(head.id);
                            return next;
                          })
                        }
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        {older.length} older
                        <CaretDownIcon
                          aria-hidden="true"
                          className={`size-3.5 transition-transform ${open.has(head.id) ? "rotate-180" : ""}`}
                        />
                      </button>
                    )}
                  </Row>
                  {open.has(head.id) && (
                    <ul className="divide-y border-t bg-muted/30">
                      {older.map((a) => (
                        <li key={a.id} className="pl-6">
                          <Row a={a} byId={byId} manage={manage} onPin={pin} onRemove={remove} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const SORTS: { value: ArtifactSort; label: string }[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "largest", label: "Largest first" },
];

/** What the user keeps against their limit. In the cleanup view it also offers the orders that find what to delete. */
function UsageBar({
  usage,
  manage,
  sort,
  onSort,
}: {
  usage: ArtifactUsage;
  manage: boolean;
  sort: ArtifactFilter["sort"];
  onSort: (s: ArtifactFilter["sort"]) => void;
}) {
  const pct = Math.min(100, Math.round((usage.used / usage.quota) * 100));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
      <div
        role="progressbar"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span>
        {formatSize(usage.used)} of {formatSize(usage.quota)} used
        {pct >= 90 && " · bots cannot publish when it is full"}
      </span>
      {manage && (
        <select
          aria-label="Order"
          value={sort ?? "recent"}
          onChange={(e) =>
            onSort(
              e.target.value === "recent" ? undefined : (e.target.value as ArtifactFilter["sort"]),
            )
          }
          className={`${field} w-40`}
        >
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Row({
  a,
  byId,
  manage,
  onPin,
  onRemove,
  children,
}: {
  a: Artifact;
  byId: ReadonlyMap<string, Bot>;
  manage: boolean;
  onPin: (a: Artifact) => void;
  onRemove: (a: Artifact) => void;
  children?: React.ReactNode;
}) {
  const tf = useTimeFormat();
  const Icon = KIND_ICON[a.kind];
  const author = a.botId ? (byId.get(a.botId) ?? { id: a.botId, name: "Deleted bot" }) : undefined;
  return (
    <div className="flex items-center gap-2 pr-3 hover:bg-muted/50">
      <Link
        to="/artifacts/$artifactId"
        params={{ artifactId: a.id }}
        className={`${listItem} flex flex-1 items-center gap-3 focus-visible:bg-muted/50 focus-visible:outline-none`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{a.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {a.description || a.fileName}
          </span>
        </span>
        {a.routineRunId && <Badge tone="info">Routine</Badge>}
        <Badge>{kindLabel(a.kind)}</Badge>
        {author && <BotIdentity bot={author} size={24} className="hidden w-40 shrink-0 md:flex" />}
        <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
          {formatSize(a.size)}
        </span>
        <time
          dateTime={a.createdAt}
          title={formatDateTime(a.createdAt, tf)}
          className="w-24 shrink-0 text-right text-xs text-muted-foreground"
        >
          {ago(a.createdAt)}
        </time>
      </Link>
      {children}
      <button
        type="button"
        aria-pressed={Boolean(a.pinnedAt)}
        aria-label={a.pinnedAt ? `Unpin ${a.title}` : `Pin ${a.title}`}
        onClick={() => onPin(a)}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:text-primary"
      >
        <PushPinIcon
          aria-hidden="true"
          weight={a.pinnedAt ? "fill" : "regular"}
          className="size-4"
        />
      </button>
      {manage && (
        <ConfirmButton
          label="Delete"
          question="Delete this file for good?"
          confirmLabel="Delete"
          variant="destructive"
          size="xs"
          onConfirm={() => onRemove(a)}
        />
      )}
    </div>
  );
}
