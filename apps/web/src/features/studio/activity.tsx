import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui";

import { call, type Bot } from "../chat/chat-client";
import { Empty, list, listItem, when } from "../shared/ui";
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

export function Activity({ bots, onError }: { bots: Bot[]; onError: (m: string) => void }) {
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
    <section aria-label="Activity" className="space-y-4">
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
    </section>
  );
}
