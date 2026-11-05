import { Link } from "@tanstack/react-router";

import { BotIdentity } from "@/components/bot-identity";
import { relativeTime } from "../shared/relative-time";
import { Badge } from "../shared/ui";
import { splitPassage } from "./memory-passage";
import { TYPE, type Bot, type Item } from "./memory-api";

/** Who wrote the last version, small and inline. A bot shows its avatar and name; a person shows a name. */
function Author({ item, bots }: { item: Item; bots: Bot[] | undefined }) {
  const bot = item.by === "bot" ? bots?.find((b) => b.id === item.botId) : undefined;
  if (bot) return <BotIdentity bot={bot} size={16} className="w-auto flex-none gap-1.5" />;
  return (
    <span className="truncate font-medium text-foreground">
      {item.access === "shared"
        ? (item.ownerName ?? "Someone")
        : item.by === "bot"
          ? "A bot"
          : item.by === "system"
            ? "Source check"
            : "You"}
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
              to="/memory/$slug"
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
    <ul className="divide-y border-y" aria-label="Memory items">
      {items.map((i) => (
        <li
          key={i.id}
          className="relative min-w-0 space-y-1 px-2 py-3 text-sm hover:bg-muted/50 focus-within:bg-muted/50"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to="/memory/$slug"
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
          {i.howto && <p className="line-clamp-1 break-words text-muted-foreground">{i.howto}</p>}
          {i.why && <Why item={i} />}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Author item={i} bots={bots} />
            <time dateTime={i.updatedAt} title={when(i.updatedAt)}>
              {relativeTime(i.updatedAt)}
            </time>
            {i.tags.length > 0 && (
              <ul className="relative z-10 flex flex-wrap gap-1" aria-label="Tags">
                {i.tags.map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => onTag(t)}
                      className="rounded-sm bg-muted px-1.5 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={`Filter by tag ${t}`}
                    >
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
