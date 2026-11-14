import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui";

import { call, errorMessage, type Bot } from "../chat/chat-client";
import { Empty, list, listItem, when } from "../shared/ui";
import type { ActivityView } from "./activity-view";
import { useLoadError } from "./studio-queries";
import { useTimeFormat } from "@/features/preferences/preferences";

type Event = {
  id: string;
  kind: string;
  outcome: string;
  botId: string | null;
  subjectId: string | null;
  detail: string | null;
  createdAt: string;
};

const KIND: Record<string, string> = {
  harness_run: "A bot answered",
  tool_call: "A bot used a tool",
  approval: "A proposal was decided",
  browser_action: "The browser was used",
  routine_run: "A routine ran",
  workflow_run: "A workflow ran",
  decision: "A decision was made",
  connection: "An account changed",
};
const OUTCOME: Record<string, string> = {
  ok: "worked",
  failed: "failed",
  denied: "was not allowed",
  cancelled: "was stopped",
  timeout: "took too long",
  busy: "was busy",
  auth_required: "needs a sign-in",
  not_installed: "needs a tool that is not installed",
};
export const describeEvent = (e: Pick<Event, "kind" | "outcome">) =>
  `${KIND[e.kind] ?? e.kind.replace(/_/g, " ")} and ${OUTCOME[e.outcome] ?? e.outcome.replace(/_/g, " ")}`;

type UpdateCard = {
  id: string;
  title: string;
  detail: string;
  resultLink: string | null;
  botId: string | null;
  occurrences: number;
  updatedAt: string;
};
const UPDATES_PAGE = 50;

/** Things that happened and ask nothing of the person: a background task's result, a room gone quiet, a memory change. */
function Updates({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const tf = useTimeFormat();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const { data, error, fetchNextPage, isFetching } = useInfiniteQuery({
    queryKey: ["attention-updates"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call<{ items: UpdateCard[] }>(
        `/api/attention?category=fyi&state=live&limit=${UPDATES_PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (last) =>
      last.items.length === UPDATES_PAGE ? last.items.at(-1)!.updatedAt : undefined,
  });
  useLoadError(error, onError);
  const items = data?.pages.flatMap((p) => p.items);
  const more = (data?.pages.at(-1)?.items.length ?? 0) === UPDATES_PAGE;
  async function dismiss(id: string) {
    setBusy(id);
    try {
      await call(`/api/attention/${id}/action`, "POST", { action: "cancel" });
      await qc.invalidateQueries({ queryKey: ["attention-updates"] });
    } catch (e) {
      onError(errorMessage(e, "Could not dismiss it."));
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        What happened that does not need a decision from you. Anything that does is under Inbox.
      </p>
      {items?.length === 0 && <Empty>No updates.</Empty>}
      <ul className={list}>
        {items?.map((u) => (
          <li key={u.id} className={`${listItem} flex items-start gap-3`}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="break-words">
                {u.title}
                {u.botId ? ` · ${bots.find((b) => b.id === u.botId)?.name ?? "a bot"}` : ""}
              </p>
              {u.detail && (
                <p className="line-clamp-3 break-words text-xs text-muted-foreground">{u.detail}</p>
              )}
              {u.resultLink && (
                <Link to={u.resultLink as never} className="text-xs underline underline-offset-2">
                  Open
                </Link>
              )}
            </div>
            <time
              dateTime={u.updatedAt}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {when(u.updatedAt, tf)}
            </time>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === u.id}
              onClick={() => void dismiss(u.id)}
            >
              Dismiss
            </Button>
          </li>
        ))}
      </ul>
      {more && (
        <Button
          size="sm"
          variant="outline"
          disabled={isFetching}
          onClick={() => void fetchNextPage()}
        >
          Load older
        </Button>
      )}
    </div>
  );
}

function ViewSwitch({ view, onView }: { view: ActivityView; onView: (v: ActivityView) => void }) {
  return (
    <div role="group" aria-label="Activity view" className="flex gap-2">
      <Button
        size="sm"
        variant={view === "trail" ? "default" : "outline"}
        aria-pressed={view === "trail"}
        onClick={() => onView("trail")}
      >
        Trail
      </Button>
      <Button
        size="sm"
        variant={view === "updates" ? "default" : "outline"}
        aria-pressed={view === "updates"}
        onClick={() => onView("updates")}
      >
        Updates
      </Button>
    </div>
  );
}

export function Activity({
  bots,
  onError,
  view,
  onView,
}: {
  bots: Bot[];
  onError: (m: string) => void;
  view: ActivityView;
  onView: (v: ActivityView) => void;
}) {
  return (
    <section aria-label="Activity" className="space-y-4">
      <ViewSwitch view={view} onView={onView} />
      {view === "updates" ? (
        <Updates bots={bots} onError={onError} />
      ) : (
        <Trail bots={bots} onError={onError} />
      )}
    </section>
  );
}

function Trail({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
  const tf = useTimeFormat();
  const { data, error, fetchNextPage, isFetching } = useInfiniteQuery({
    queryKey: ["activity"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call<{ events: Event[]; nextBefore: string | null }>(
        `/api/activity?limit=50${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  useLoadError(error, onError);
  const events = data?.pages.flatMap((p) => p.events);
  const next = data?.pages.at(-1)?.nextBefore ?? null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A private record of what your bots did. It never includes what you wrote or what they
        answered.
      </p>
      {events?.length === 0 && <Empty>Nothing has happened yet.</Empty>}
      <ul className={list}>
        {events?.map((e) => (
          <li key={e.id} className={`${listItem} flex items-start gap-3`}>
            <span
              aria-hidden
              className={`mt-1.5 size-2 shrink-0 rounded-full ${e.outcome === "ok" ? "bg-success" : "bg-destructive"}`}
            />
            <div className="min-w-0 flex-1">
              <p className={`break-words ${e.outcome === "ok" ? "" : "text-destructive"}`}>
                {describeEvent(e)}
                {e.botId ? ` · ${bots.find((b) => b.id === e.botId)?.name ?? "a bot"}` : ""}
              </p>
              {e.detail && <p className="break-words text-xs text-muted-foreground">{e.detail}</p>}
            </div>
            <time
              dateTime={e.createdAt}
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
            >
              {when(e.createdAt, tf)}
            </time>
          </li>
        ))}
      </ul>
      {next && (
        <Button
          size="sm"
          variant="outline"
          disabled={isFetching}
          onClick={() => void fetchNextPage()}
        >
          Load older
        </Button>
      )}
    </div>
  );
}
