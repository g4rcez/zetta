import { CaretDownIcon, CaretRightIcon, WarningIcon } from "@phosphor-icons/react";
import { childrenOf } from "@zetta/core/org";
import { Link } from "@tanstack/react-router";

import { ActionHint } from "@/components/action-hint";
import { IconHint } from "@/components/icon-hint";
import { cn } from "@zetta/ui/lib/utils";
import type { OrgPosition } from "./org-api";
import { RankMark, SeatHolder, problemText } from "./org-bits";
import { foldedAfterSearch } from "./org-graph";
import { filtering, matchesFilters, type OrgFilterState } from "./org-search";
import { SeatMenu, type SeatActions } from "./seat-menu";

type Shared = {
  positions: readonly OrgPosition[];
  canEdit: boolean;
  matches: ReadonlySet<string>;
  filtersOn: boolean;
  collapsed: ReadonlySet<string>;
  actions: SeatActions;
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
  return (
    <li className="min-w-0">
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border bg-card px-2 py-1.5",
          s.filtersOn && !s.matches.has(id) && "opacity-50",
          s.filtersOn && s.matches.has(id) && "ring-2 ring-primary",
        )}
      >
        {reports.length ? (
          <Fold item={item} folded={folded} onToggle={() => s.onToggle(id)} />
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
        <Link
          to="/organization/$positionId"
          params={{ positionId: id }}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
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
        </Link>
        {item.problem && (
          <IconHint label={problemText(item.problem)}>
            <WarningIcon className="size-4 shrink-0 text-warn" />
          </IconHint>
        )}
        {s.canEdit && <SeatMenu item={item} positions={s.positions} actions={s.actions} />}
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
 * keyboard and for a screen reader; it does everything the canvas does except dragging.
 */
export function OrgList({
  positions,
  canEdit,
  filters,
  collapsed,
  actions,
  onToggle,
}: {
  positions: readonly OrgPosition[];
  canEdit: boolean;
  filters: Pick<OrgFilterState, "q" | "show">;
  collapsed: ReadonlySet<string>;
  actions: SeatActions;
  onToggle: (id: string) => void;
}) {
  const root = positions.find((p) => p.parentId === null);
  if (!root) return null;
  const filtersOn = filtering(filters);
  const matches = new Set(positions.filter((p) => matchesFilters(p, filters)).map((p) => p.id));
  const shared: Shared = {
    positions,
    canEdit,
    matches,
    filtersOn,
    collapsed: filtersOn ? foldedAfterSearch(positions, collapsed, matches) : collapsed,
    actions,
    onToggle,
  };
  return (
    <ul aria-label="Organization outline" className="space-y-1.5">
      <Branch id={root.id} s={shared} />
    </ul>
  );
}
