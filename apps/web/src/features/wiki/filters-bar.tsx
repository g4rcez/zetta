import { FunnelSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { field } from "../shared/ui";
import { STATUS, TYPE, type Bot, type Status, type TeamName, type WikiType } from "./wiki-api";
import { SORTS, SINCE, type WikiFilter, type WikiSearch } from "./wiki-filters";

const SORT_LABEL = {
  relevance: "Best match",
  updated: "Recently updated",
  created: "Recently created",
  score: "Most important",
  title: "Title",
} as const;
const TAGS_SHOWN = 12;
// The component library sets `input, select { font-size: 16px }` outside any layer, so only an important utility keeps these at 14px.
const control = cn(field, "h-8 py-0 text-sm!");

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        pressed
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Facet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const toggle = <T extends string>(list: readonly T[], value: T) =>
  (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]).join(",") ||
  undefined;

/** The search box, sort, view and every facet. The address holds the state, so a filtered list can be shared and reloaded. */
export function FiltersBar({
  search,
  filter,
  set,
  clear,
  active,
  tags,
  bots,
  teams,
  shown,
  total,
}: {
  search: WikiSearch;
  filter: WikiFilter;
  set: (next: Record<string, unknown>) => void;
  clear: () => void;
  active: number;
  tags: { tag: string; count: number }[];
  bots: Bot[] | undefined;
  teams: TeamName[] | undefined;
  shown: number;
  total: number | undefined;
}) {
  const [text, setText] = useState(search.q ?? "");
  // The facets stay out of the way until the person asks for them, or until a link arrives with some already set.
  const [open, setOpen] = useState(active > 0);
  // The text reaches the address after a pause, so typing does not rewrite history on every key.
  useEffect(() => {
    if (text === (search.q ?? "")) return;
    const id = setTimeout(() => set({ q: text }), 250);
    return () => clearTimeout(id);
  }, [text, search.q, set]);
  useEffect(() => setText(search.q ?? ""), [search.q]);
  const [moreTags, setMoreTags] = useState(false);
  const visibleTags = moreTags ? tags : tags.slice(0, TAGS_SHOWN);
  return (
    <section aria-label="Filters" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1 sm:max-w-xs">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            name="q"
            aria-label="Find an item"
            placeholder="Find by title, tag or how-to…"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            className={cn(control, "pl-9")}
          />
        </div>
        <select
          aria-label="Sort by"
          name="sort"
          value={filter.sort}
          onChange={(e) => set({ sort: e.target.value })}
          className={cn(control, "w-auto")}
        >
          {SORTS.filter((s) => s !== "relevance" || search.q).map((s) => (
            <option key={s} value={s}>
              Sort: {SORT_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="memory-facets"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            control,
            "inline-flex w-auto cursor-pointer items-center gap-2 font-medium hover:bg-accent",
            open && "bg-accent",
          )}
        >
          <FunnelSimpleIcon aria-hidden="true" className="size-4" />
          Filters
          {active > 0 && (
            <span className="rounded-sm bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
              {active}
              <span className="sr-only"> active</span>
            </span>
          )}
        </button>
        {active > 0 && (
          <Button variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <p
            role="status"
            aria-live="polite"
            className="text-sm tabular-nums text-muted-foreground"
          >
            {total === undefined
              ? ""
              : shown === total
                ? `${total} ${total === 1 ? "item" : "items"}`
                : `${shown} of ${total} items`}
          </p>
        </div>
      </div>
      {open && (
        <div id="memory-facets" className="space-y-4 border-t pt-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground">Who can read it</legend>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(TYPE) as WikiType[]).map((t) => (
                  <Chip
                    key={t}
                    pressed={filter.types.includes(t)}
                    onClick={() => set({ type: toggle(filter.types, t) })}
                  >
                    {TYPE[t]}
                  </Chip>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground">Status</legend>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STATUS) as Status[]).map((s) => (
                  <Chip
                    key={s}
                    pressed={filter.statuses.includes(s)}
                    onClick={() => set({ status: toggle(filter.statuses, s) })}
                  >
                    {STATUS[s]}
                  </Chip>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Facet label="Whose">
              <select
                name="access"
                value={filter.access ?? ""}
                onChange={(e) => set({ access: e.target.value })}
                className={control}
              >
                <option value="">Mine and shared</option>
                <option value="own">Mine</option>
                <option value="shared">Shared by others</option>
              </select>
            </Facet>
            <Facet label="Last written by">
              <select
                name="by"
                value={filter.by ?? ""}
                onChange={(e) => set({ by: e.target.value, bot: undefined })}
                className={control}
              >
                <option value="">Anyone</option>
                <option value="user">You</option>
                <option value="bot">A bot</option>
                <option value="system">The source check</option>
              </select>
            </Facet>
            {filter.by === "bot" && (
              <Facet label="Which bot">
                <select
                  name="bot"
                  value={filter.bot ?? ""}
                  onChange={(e) => set({ bot: e.target.value })}
                  className={control}
                >
                  <option value="">Any bot</option>
                  {(bots ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Facet>
            )}
            <Facet label="Team">
              <select
                name="team"
                value={filter.team ?? ""}
                onChange={(e) => set({ team: e.target.value })}
                className={control}
              >
                <option value="">Any team</option>
                {(teams ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Facet>
            <Facet label="Updated">
              <select
                name="since"
                value={filter.since ?? ""}
                onChange={(e) => set({ since: e.target.value })}
                className={control}
              >
                <option value="">Any time</option>
                {(Object.keys(SINCE) as (keyof typeof SINCE)[]).map((k) => (
                  <option key={k} value={k}>
                    Last {SINCE[k]} days
                  </option>
                ))}
              </select>
            </Facet>
            <div className="grid grid-cols-2 gap-2">
              <Facet label="Score from">
                <input
                  type="number"
                  min={0}
                  max={100}
                  name="min"
                  value={filter.min ?? ""}
                  onChange={(e) => set({ min: e.currentTarget.value })}
                  className={control}
                />
              </Facet>
              <Facet label="to">
                <input
                  type="number"
                  min={0}
                  max={100}
                  name="max"
                  value={filter.max ?? ""}
                  onChange={(e) => set({ max: e.currentTarget.value })}
                  className={control}
                />
              </Facet>
            </div>
          </div>
          {tags.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
                Tags
                {filter.tags.length > 1 && (
                  <Chip
                    pressed={filter.tagMode === "all"}
                    onClick={() => set({ tagMode: filter.tagMode === "all" ? undefined : "all" })}
                  >
                    Must have all
                  </Chip>
                )}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {visibleTags.map(({ tag, count }) => (
                  <Chip
                    key={tag}
                    pressed={filter.tags.includes(tag)}
                    onClick={() => set({ tag: toggle(filter.tags, tag) })}
                  >
                    {tag} <span className="font-normal tabular-nums">{count}</span>
                  </Chip>
                ))}
                {tags.length > TAGS_SHOWN && (
                  <Button size="xs" variant="ghost" onClick={() => setMoreTags((m) => !m)}>
                    {moreTags ? "Fewer tags" : `All ${tags.length} tags`}
                  </Button>
                )}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </section>
  );
}
