import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";

import { errorMessage } from "../chat/chat-client";
import { Empty, list, listItem, when } from "../shared/ui";
import { hitTarget, KIND_LABEL, searchQueries } from "./search-api";
import { useDebounced } from "./use-debounced";
import { useTimeFormat } from "@/features/preferences/preferences";

/** The snippet with the matched words in <mark>. */
const Snippet = ({ text }: { text: string }) => (
  <>
    {text.split(/(\[\[.*?\]\])/g).map((part, i) =>
      part.startsWith("[[") && part.endsWith("]]") ? (
        <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">
          {part.slice(2, -2)}
        </mark>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )}
  </>
);

/** Full-page search over the user's chats, messages, memory items (what bots remember too), artifacts and tasks (`/search?q=`). */
export function SearchPage({ initial }: { initial: string }) {
  const tf = useTimeFormat();
  const [text, setText] = useState(initial);
  const q = useDebounced(text.trim(), 250);
  // The old results stay on screen while the next ones load.
  const search = useQuery({
    ...searchQueries.hits(q, 50),
    enabled: q !== "",
    placeholderData: keepPreviousData,
  });
  const hits = q ? search.data : undefined;
  const error = search.isError ? errorMessage(search.error) : undefined;
  return (
    <section aria-label="Search" className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-xl">Search</h1>
      <input
        type="search"
        autoFocus
        value={text}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search chats, messages, memory, tasks and artifacts"
        aria-label="Search"
        className="w-full rounded-lg border bg-card px-3 py-2 text-sm"
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hits?.length === 0 && <Empty>Nothing matches.</Empty>}
      <ul className={list}>
        {hits?.map((h) => {
          const t = hitTarget(h);
          return (
            <li key={`${h.kind}-${h.id}`} className={listItem}>
              <Link
                to={t.to as never}
                params={t.params as never}
                search={(t.search ?? {}) as never}
                className="flex items-start gap-3"
              >
                <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {KIND_LABEL[h.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{h.title}</span>
                  {h.kind !== "conversation" && (
                    <span className="line-clamp-2 block break-words text-xs text-muted-foreground">
                      <Snippet text={h.snippet} />
                    </span>
                  )}
                </span>
                <time
                  dateTime={h.updatedAt}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {when(h.updatedAt, tf)}
                </time>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
