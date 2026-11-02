import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui";
import { Badge, list, listItem } from "../shared/ui";
import { RELATION, SOURCE, type Detail, type Link as WikiLink, type Version } from "./wiki-api";

const heading = "text-sm font-medium";

/** The edges of the graph around an item, grouped by relation: what it points to and what points to it. */
export function LinkLists({ links, linkedFrom }: { links: WikiLink[]; linkedFrom: WikiLink[] }) {
  const group = (title: string, rows: WikiLink[]) =>
    rows.length > 0 && (
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <ul className="space-y-1 text-sm">
          {rows.map((l) => (
            <li key={`${l.relation}:${l.slug}`} className="flex flex-wrap items-center gap-2">
              <Badge>{RELATION[l.relation]}</Badge>
              <Link to="/wiki/$slug" params={{ slug: l.slug }} className="hover:underline">
                {l.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section aria-labelledby="wiki-links" className="space-y-3">
      <h2 id="wiki-links" className={heading}>
        Links
      </h2>
      {links.length === 0 && linkedFrom.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Not linked yet. Write [[another-item]] in the content, or use Add link.
        </p>
      ) : (
        <>
          {group("Links to", links)}
          {group("Linked from", linkedFrom)}
        </>
      )}
    </section>
  );
}

export function SourceList({
  sources,
}: {
  sources: Extract<Detail, { access: "own" }>["sources"];
}) {
  return (
    <section aria-labelledby="wiki-sources" className="space-y-2">
      <h2 id="wiki-sources" className={heading}>
        Sources
      </h2>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sources. A bot links the task, document or artifact an item came from; when one
          changes, the item is marked stale.
        </p>
      ) : (
        <ul className={list}>
          {sources.map((s) => (
            <li
              key={`${s.kind}:${s.ref}`}
              className={`${listItem} flex flex-wrap items-center gap-2`}
            >
              <Badge>{SOURCE[s.kind]}</Badge>
              {s.kind === "url" ? (
                <a
                  href={s.ref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all hover:underline"
                >
                  {s.label}
                </a>
              ) : (
                <span className="break-words">{s.label}</span>
              )}
              {s.status !== "current" && (
                <Badge tone="warning">{s.status === "gone" ? "Gone" : "Changed"}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function VersionList({
  history,
  current,
  who,
  when,
  onRestore,
}: {
  history: Version[];
  current: number;
  who: (by: Version["author"], botId: string | null) => string;
  when: (iso: string) => string;
  onRestore: (version: number) => void;
}) {
  return (
    <section aria-labelledby="wiki-versions" className="space-y-2">
      <h2 id="wiki-versions" className={heading}>
        Versions
      </h2>
      <ul className={list}>
        {history.map((h) => (
          <li
            key={h.version}
            className={`${listItem} flex flex-wrap items-center justify-between gap-2`}
          >
            <span>
              Version {h.version} · {who(h.author, h.botId)} · {when(h.createdAt)}
              {h.status !== "current" && (
                <span className="ml-2">
                  <Badge>{h.status}</Badge>
                </span>
              )}
            </span>
            {h.version !== current && (
              <Button size="xs" variant="outline" onClick={() => onRestore(h.version)}>
                Restore<span className="sr-only"> version {h.version}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
