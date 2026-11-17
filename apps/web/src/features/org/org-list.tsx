import { CaretDownIcon, CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { childrenOf } from "@zetta/core/org";

import { ActionHint } from "@/components/action-hint";
import { IconHint } from "@/components/icon-hint";
import { cn } from "@zetta/ui/lib/utils";
import type { OrgPosition } from "./org-api";
import { RankMark, SeatHolder, problemText } from "./org-bits";
import { foldedAfterSearch } from "./org-graph";
import { filtering, matchesFilters, type OrgFilterState } from "./org-search";

type Shared = {
  positions: readonly OrgPosition[];
  matches: ReadonlySet<string>;
  filtersOn: boolean;
  collapsed: ReadonlySet<string>;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
};

function Fold({
  item,
  folded,
  onToggle,
}: {
  item: OrgPosition;
  folded: boolean;
  onToggle: () => void;
}) {
  const label = `${folded ? "Show" : "Hide"} what is under ${item.title}`;
  return (
    <ActionHint label={label}>
      <button
        type="button"
        aria-expanded={!folded}
        aria-label={label}
        onClick={onToggle}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {folded ? (
          <CaretRightIcon aria-hidden="true" className="size-4" />
        ) : (
          <CaretDownIcon aria-hidden="true" className="size-4" />
        )}
      </button>
    </ActionHint>
  );
}

function Branch({ id, s }: { id: string; s: Shared }) {
  const item = s.positions.find((p) => p.id === id)!;
  const reports = childrenOf(s.positions, id);
  const folded = s.collapsed.has(id);
  const row = useRef<HTMLDivElement>(null);
  const selected = s.selectedId === id;
  // The panel opens beside or under the list: a selected seat that scrolled out of sight (a search, a link) is brought back.
  useEffect(() => {
    if (selected) row.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return (
    <li className="min-w-0">
      <div
        ref={row}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5",
          s.filtersOn && !s.matches.has(id) && "opacity-50",
          s.filtersOn && s.matches.has(id) && "ring-2 ring-primary/60",
          s.selectedId === id && "border-primary ring-2 ring-primary",
        )}
      >
        {reports.length ? (
          <Fold item={item} folded={folded} onToggle={() => s.onToggle(id)} />
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
        <button
          type="button"
          aria-current={s.selectedId === id ? "true" : undefined}
          onClick={() => s.onSelect(id)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="min-w-0 basis-52">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{item.title}</span>
              <RankMark rank={item.rank} />
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {[item.unit, item.team ? `Leads ${item.team.name}` : ""].filter(Boolean).join(" · ")}
            </span>
          </span>
          <SeatHolder item={item} size={24} className="min-w-0 flex-1 basis-48" />
        </button>
        {item.problem && (
          <IconHint label={problemText(item.problem)}>
            <WarningIcon className="size-4 shrink-0 text-warn" />
          </IconHint>
        )}
      </div>
      {reports.length > 0 && !folded && (
        <ul className="mt-1.5 ml-3 space-y-1.5 border-l pl-3 md:ml-5 md:pl-4">
          {reports.map((r) => (
            <Branch key={r.id} id={r.id} s={s} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The chart as an outline: each seat under the one it reports to, with a fold button for a branch. It is the view for a phone, for the
 * keyboard and for a screen reader; every seat is selected and changed in the panel beside it, as on the canvas.
 */
export function OrgList({
  positions,
  filters,
  collapsed,
  selectedId,
  onSelect,
  onToggle,
}: {
  positions: readonly OrgPosition[];
  filters: Pick<OrgFilterState, "q" | "show">;
  collapsed: ReadonlySet<string>;
  selectedId: string;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const root = positions.find((p) => p.parentId === null);
  if (!root) return null;
  const filtersOn = filtering(filters);
  const matches = new Set(positions.filter((p) => matchesFilters(p, filters)).map((p) => p.id));
  const shared: Shared = {
    positions,
    matches,
    filtersOn,
    collapsed: filtersOn ? foldedAfterSearch(positions, collapsed, matches) : collapsed,
    selectedId,
    onSelect,
    onToggle,
  };
  return (
    <ul aria-label="Organization outline" className="space-y-1.5">
      <Branch id={root.id} s={shared} />
    </ul>
  );
}
