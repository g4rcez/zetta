import { useId, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { field } from "../shared/ui";
import { RELATION, type Item, type Relation } from "./wiki-api";
import { RELATIONS, insertLink, linkCandidates, matchWikiLink } from "./wiki-links";

/**
 * The content field of an item. Typing `[[` offers the wiki's items (and `[[depends-on:` a typed link); Enter or a click writes the
 * link. A name with no item can still be linked: the link points to an item that does not exist yet. It stays a plain textarea in a
 * form (`name="content"`), so the form reads it as before.
 */
export function WikiLinkTextarea({
  title,
  defaultValue,
  items,
  self,
}: {
  title: string;
  defaultValue?: string | undefined;
  items: readonly Item[];
  self?: string | undefined;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [open, setOpen] = useState<
    { at: number; query: string; relation?: Relation } | undefined
  >();
  const [relation, setRelation] = useState<Relation>("related");
  const [index, setIndex] = useState(0);
  const found = open ? linkCandidates(items, open.query, self) : [];
  // With no match the typed name is offered as a link to a new item.
  const fresh =
    open && open.query && !found.some((i) => i.slug === open.query) ? open.query : undefined;
  const rows = [
    ...found.map((i) => ({ slug: i.slug, label: i.title })),
    ...(fresh ? [{ slug: fresh, label: `New item “${fresh}”` }] : []),
  ];
  const chosen = open?.relation ?? relation;

  const sync = () => {
    const el = ref.current;
    if (!el) return;
    setOpen(matchWikiLink(el.value, el.selectionStart));
    setIndex(0);
  };
  const pick = (slug: string) => {
    const el = ref.current;
    if (!el || !open) return;
    const next = insertLink(el.value, el.selectionStart, open.at, chosen, slug);
    el.value = next.text;
    // The form listens to input to know it has unsaved edits.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    el.setSelectionRange(next.caret, next.caret);
    setOpen(undefined);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(undefined);
    } else if (rows.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
    } else if (rows.length && e.key === "Enter") {
      e.preventDefault();
      pick(rows[index]!.slug);
    }
  };
  const listId = `${id}-list`;
  return (
    <div className="space-y-1">
      <label htmlFor={`${id}-field`} className="text-sm font-medium">
        {title}
      </label>
      {/* Plain on purpose: Markdown with its own `[[` picker for wiki links; `@` and `#` are ordinary text here. */}
      <textarea
        id={`${id}-field`}
        ref={ref}
        name="content"
        required
        rows={10}
        maxLength={20000}
        defaultValue={defaultValue}
        className={cn(field, "font-mono")}
        role="combobox"
        aria-expanded={Boolean(open)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows.length ? `${id}-row-${index}` : undefined}
        onChange={sync}
        onKeyUp={(e) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) sync();
        }}
        onClick={sync}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(undefined)}
      />
      {open && (
        <div className="rounded-lg border bg-popover p-1 text-sm">
          <div className="flex flex-wrap gap-1 px-1 pb-1" role="group" aria-label="Kind of link">
            {RELATIONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={chosen === r}
                // The textarea keeps focus: mouse down must not blur it.
                onMouseDown={(e) => {
                  e.preventDefault();
                  setRelation(r);
                }}
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  chosen === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {RELATION[r]}
              </button>
            ))}
          </div>
          <ul id={listId} role="listbox" aria-label="Wiki items to link">
            {rows.length === 0 && (
              <li className="px-2 py-1.5 text-muted-foreground" role="presentation">
                Type the name of an item.
              </li>
            )}
            {rows.map((r, n) => (
              <li
                key={r.slug}
                id={`${id}-row-${n}`}
                role="option"
                aria-selected={n === index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r.slug);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5",
                  n === index ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.slug}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
