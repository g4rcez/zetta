import { FunnelSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { Drawer } from "@/components/drawer";
import { Button } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { field } from "../shared/ui";
import {
  BOT_ACCESS,
  STATUS,
  TYPE,
  type Bot,
  type BotAccess,
  type Status,
  type TeamName,
  type MemoryType,
} from "./memory-api";
import { SORTS, SINCE, type MemoryFilter, type MemorySearch } from "./memory-filters";

const SORT_LABEL = {
  relevance: "Best match",
  updated: "Recently updated",
  created: "Recently created",
  score: "Most important",
  title: "Title",
} as const;
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
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const toggle = <T extends string>(list: readonly T[], value: T) =>
  (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]).join(",") ||
  undefined;

const ACCESS = { own: "Mine", shared: "Shared by others" } as const;
const AUTHOR = { user: "You", bot: "A bot", system: "The source check" } as const;

type Applied = { key: string; label: string; patch: Record<string, unknown> };

/** One entry per value set in the address, so each can be taken off alone. */
function appliedFilters(f: MemoryFilter, bots: Bot[] | undefined, teams: TeamName[] | undefined) {
  const bot = (id: string) => bots?.find((b) => b.id === id)?.name ?? "A bot";
  const out: Applied[] = [
    ...f.types.map((t) => ({
      key: `type:${t}`,
      label: `Who can read it: ${TYPE[t]}`,
      patch: { type: toggle(f.types, t) },
    })),
    ...f.statuses.map((s) => ({
      key: `status:${s}`,
      label: `Status: ${STATUS[s]}`,
      patch: { status: toggle(f.statuses, s) },
    })),
    ...f.botAccess.map((a) => ({
      key: `botAccess:${a}`,
      label: `Bots can: ${BOT_ACCESS[a].toLowerCase()}`,
      patch: { botAccess: toggle(f.botAccess, a) },
    })),
    ...f.tags.map((t) => ({
      key: `tag:${t}`,
      label: `Tag: ${t}`,
      patch: { tag: toggle(f.tags, t) },
    })),
  ];
  if (f.access)
    out.push({ key: "access", label: `Whose: ${ACCESS[f.access]}`, patch: { access: undefined } });
  if (f.by)
    out.push({
      key: "by",
      label: `Last written by: ${AUTHOR[f.by]}`,
      patch: { by: undefined, bot: undefined },
    });
  if (f.bot) out.push({ key: "bot", label: `Bot: ${bot(f.bot)}`, patch: { bot: undefined } });
  if (f.createdBy)
    out.push({
      key: "createdBy",
      label: `Created by: ${bot(f.createdBy)}`,
      patch: { createdBy: undefined },
    });
  if (f.team)
    out.push({
      key: "team",
      label: `Team: ${teams?.find((t) => t.id === f.team)?.name ?? "A team"}`,
      patch: { team: undefined },
    });
  if (f.since)
    out.push({
      key: "since",
      label: `Updated: last ${SINCE[f.since]} days`,
      patch: { since: undefined },
    });
  if (f.min !== undefined || f.max !== undefined)
    out.push({
      key: "score",
      label: `Score: ${f.min ?? 0}–${f.max ?? 100}`,
      patch: { min: undefined, max: undefined },
    });
  return out;
}

/** The search box, sort and a Filters button. Every other facet lives in a drawer; what is set shows as removable chips. The address holds the state, so a filtered list can be shared and reloaded. */
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
  search: MemorySearch;
  filter: MemoryFilter;
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
  const [open, setOpen] = useState(false);
  // The text reaches the address after a pause, so typing does not rewrite history on every key.
  useEffect(() => {
    if (text === (search.q ?? "")) return;
    const id = setTimeout(() => set({ q: text }), 250);
    return () => clearTimeout(id);
  }, [text, search.q, set]);
  useEffect(() => setText(search.q ?? ""), [search.q]);
  const applied = appliedFilters(filter, bots, teams);
  return (
    <section aria-label="Filters" className="space-y-2">
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
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={cn(
            control,
            "inline-flex w-auto cursor-pointer items-center gap-2 font-medium hover:bg-accent",
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
        <p
          role="status"
          aria-live="polite"
          className="ml-auto text-sm tabular-nums text-muted-foreground"
        >
          {total === undefined
            ? ""
            : shown === total
              ? `${total} ${total === 1 ? "item" : "items"}`
              : `${shown} of ${total} items`}
        </p>
      </div>
      {applied.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
          {applied.map((a) => (
            <li key={a.key}>
              {/* No hint: it shows the filter label. */}
              <button
                type="button"
                aria-label={`Remove ${a.label}`}
                onClick={() => set(a.patch)}
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {a.label}
                <XIcon aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
          <li>
            <Button size="xs" variant="ghost" onClick={clear}>
              Clear all
            </Button>
          </li>
        </ul>
      )}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        footer={
          <div className="flex items-center justify-between gap-2">
            {active > 0 ? (
              <Button variant="ghost" onClick={clear}>
                Clear all
              </Button>
            ) : (
              <span />
            )}
            <Button onClick={() => setOpen(false)}>
              Show {shown} {shown === 1 ? "item" : "items"}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
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
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Who can read it</legend>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TYPE) as MemoryType[]).map((t) => (
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
            <legend className="text-xs font-medium text-muted-foreground">Bots can</legend>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(BOT_ACCESS) as BotAccess[]).map((a) => (
                <Chip
                  key={a}
                  pressed={filter.botAccess.includes(a)}
                  onClick={() => set({ botAccess: toggle(filter.botAccess, a) })}
                >
                  {BOT_ACCESS[a]}
                </Chip>
              ))}
            </div>
          </fieldset>
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
          <Facet label="Created by">
            <select
              name="createdBy"
              value={filter.createdBy ?? ""}
              onChange={(e) => set({ createdBy: e.target.value })}
              className={control}
            >
              <option value="">Anyone</option>
              {(bots ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Facet>
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
          <div className="grid grid-cols-2 gap-3">
            <Facet label="Score from">
              <input
                type="number"
                min={0}
                max={100}
                name="min"
                placeholder="0"
                value={filter.min ?? ""}
                onChange={(e) => set({ min: e.currentTarget.value })}
                className={control}
              />
            </Facet>
            <Facet label="Score to">
              <input
                type="number"
                min={0}
                max={100}
                name="max"
                placeholder="100"
                value={filter.max ?? ""}
                onChange={(e) => set({ max: e.currentTarget.value })}
                className={control}
              />
            </Facet>
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
                {tags.map(({ tag, count }) => (
                  <Chip
                    key={tag}
                    pressed={filter.tags.includes(tag)}
                    onClick={() => set({ tag: toggle(filter.tags, tag) })}
                  >
                    {tag} <span className="font-normal tabular-nums">{count}</span>
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      </Drawer>
    </section>
  );
}
