import { useMemo, useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { RELATION, type Item, type Relation } from "./wiki-api";
import { RELATIONS, formatLink, linkCandidates } from "./wiki-links";

/** Links the item to another one: pick the item and the kind of link, and the `[[…]]` line is added to the content when saved. */
export function AddLinkPanel({
  items,
  self,
  linked,
  onAdd,
  onClose,
}: {
  items: readonly Item[];
  self: string;
  /** Slugs the item already links to with this relation are offered once. */
  linked: ReadonlySet<string>;
  onAdd: (relation: Relation, slug: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState<string>();
  const [relation, setRelation] = useState<Relation>("related");
  const candidates = useMemo(
    () => linkCandidates(items, query, self, linked),
    [items, query, self, linked],
  );
  return (
    <section aria-label="Add link" className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-sm font-medium">Add link</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          title="Find the item to link"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setSlug(undefined);
          }}
          placeholder="Title or name"
        />
        <Select
          title="Kind of link"
          required={false}
          value={relation}
          onChange={(e) => setRelation(e.target.value as Relation)}
          options={RELATIONS.map((r) => ({ value: r, label: RELATION[r] }))}
        />
      </div>
      <ul role="listbox" aria-label="Items to link" className="max-h-56 space-y-1 overflow-y-auto">
        {candidates.length === 0 && (
          <li className="text-sm text-muted-foreground">No other item matches.</li>
        )}
        {candidates.map((i) => (
          <li key={i.id} role="option" aria-selected={slug === i.slug}>
            <button
              type="button"
              onClick={() => setSlug(i.slug)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                slug === i.slug ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="truncate">{i.title}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{i.slug}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {slug ? (
          <>
            Adds <code>{formatLink(relation, slug)}</code> to the end of the content.
          </>
        ) : (
          "Pick an item."
        )}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={!slug} onClick={() => slug && void onAdd(relation, slug)}>
          Add link
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
