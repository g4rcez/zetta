import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { ago } from "../artifacts/artifacts-api";
import { Badge, list } from "../shared/ui";
import { splitPassage } from "./wiki-passage";
import { TYPE, type Bot, type Item } from "./wiki-api";

/** Who wrote the last version. A bot shows its avatar and name; a person shows an initial in a circle, as DESIGN.md "Shapes" says. */
function Author({ item, bots, sub }: { item: Item; bots: Bot[] | undefined; sub: ReactNode }) {
  const bot = item.by === "bot" ? bots?.find((b) => b.id === item.botId) : undefined;
  if (bot) return <BotIdentity bot={bot} size={24} sub={sub} />;
  const name =
    item.access === "shared"
      ? (item.ownerName ?? "Someone")
      : item.by === "bot"
        ? "A bot"
        : item.by === "system"
          ? "Source check"
          : "You";
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
    </span>
  );
}

const RELATION_ARROW = { out: "→", in: "←" } as const;

/** Why a search result matched: the rankings that found it, the passage with the matching words marked, and the items next to it. */
function Why({ item }: { item: Item }) {
  const why = item.why!;
  const passage = splitPassage(why.passage);
  return (
    <div className="mt-1.5 space-y-1 text-xs">
      <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        Matched on
        {why.keyword && <Badge tone="info">words</Badge>}
        {why.tags.map((t) => (
          <Badge key={t} tone="info">
            tag {t}
          </Badge>
        ))}
        {why.meaning && <Badge tone="info">meaning</Badge>}
      </p>
      {passage.length > 0 && (
        <p className="line-clamp-3 break-words rounded-md bg-muted/40 px-2 py-1 text-muted-foreground">
          {passage.map((p, n) =>
            p.hit ? (
              <mark key={n} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
                {p.text}
              </mark>
            ) : (
              <span key={n}>{p.text}</span>
            ),
          )}
        </p>
      )}
      {item.neighbors && item.neighbors.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          Linked
          {item.neighbors.map((n) => (
            <Link
              key={`${n.direction}${n.relation}${n.slug}`}
              to="/wiki/$slug"
              params={{ slug: n.slug }}
              className="relative z-10 hover:underline"
            >
              {RELATION_ARROW[n.direction]} {n.title}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

/** The items that match the filters, one row each. The whole row opens the item; a tag in a row adds that tag to the filter. */
export function Results({
  items,
  bots,
  when,
  onTag,
}: {
  items: Item[];
  bots: Bot[] | undefined;
  when: (iso: string) => string;
  onTag: (tag: string) => void;
}) {
  return (
    <ul className={list} aria-label="Wiki items">
      {items.map((i) => (
        <li
          key={i.id}
          className="relative flex min-w-0 flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 text-sm hover:bg-muted/50 focus-within:bg-muted/50"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                to="/wiki/$slug"
                params={{ slug: i.slug }}
                className="font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
              >
                {i.title}
              </Link>
              {i.type !== "owner" && (
                <Badge tone={i.type === "all" ? "info" : "neutral"}>{TYPE[i.type]}</Badge>
              )}
              {i.status === "stale" && <Badge tone="warning">Stale</Badge>}
              {i.status === "archived" && <Badge>Archived</Badge>}
            </div>
            {i.howto && <p className="line-clamp-2 break-words text-muted-foreground">{i.howto}</p>}
            {i.why && <Why item={i} />}
            {i.tags.length > 0 && (
              <ul className="relative z-10 flex flex-wrap gap-1 pt-0.5" aria-label="Tags">
                {i.tags.map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => onTag(t)}
                      className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`Filter by tag ${t}`}
                    >
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-w-0 sm:w-48 sm:shrink-0">
            <Author
              item={i}
              bots={bots}
              sub={
                <>
                  <time dateTime={i.updatedAt} title={when(i.updatedAt)}>
                    {ago(i.updatedAt)}
                  </time>
                  <span className="tabular-nums"> · score {i.score}</span>
                </>
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
