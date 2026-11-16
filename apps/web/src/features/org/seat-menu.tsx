import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DotsThreeIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  TrashIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";

import { ActionHint } from "@/components/action-hint";
import { MENU_DANGER, Menu, MenuItem, MenuSeparator } from "@/components/ui";
import type { OrgPosition } from "./org-api";
import { shiftSeat } from "./org-graph";

/** What the menu of a seat can do. The page that owns the chart provides them, so the canvas and the outline share one set. */
export type SeatActions = {
  open: (id: string) => void;
  addReport: (id: string) => void;
  /** Earlier or later among the seats that report to the same manager. */
  shift: (id: string, delta: -1 | 1) => void;
  empty: (id: string) => void;
  /** Asks first; the page shows the question. */
  remove: (id: string) => void;
};

/** The "…" menu of a seat, for the admin. Everyone else opens the seat by clicking it. */
export function SeatMenu({
  item,
  positions,
  actions,
}: {
  item: OrgPosition;
  positions: readonly OrgPosition[];
  actions: SeatActions;
}) {
  const name = `Actions for ${item.title}`;
  return (
    <Menu
      asChild
      hover={false}
      title=""
      floatingClassName="w-56"
      label={
        <ActionHint label={name}>
          <button
            type="button"
            aria-label={name}
            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-open:bg-muted"
          >
            <DotsThreeIcon aria-hidden="true" className="size-4" />
          </button>
        </ActionHint>
      }
    >
      <MenuItem title="Open seat" onClick={() => actions.open(item.id)}>
        <SlidersHorizontalIcon aria-hidden="true" />
        Open seat
      </MenuItem>
      <MenuItem title="Add a seat under this one" onClick={() => actions.addReport(item.id)}>
        <PlusIcon aria-hidden="true" />
        Add a seat under this one
      </MenuItem>
      <MenuItem
        title="Move earlier"
        disabled={!shiftSeat(positions, item.id, -1)}
        onClick={() => actions.shift(item.id, -1)}
      >
        <ArrowLeftIcon aria-hidden="true" />
        Move earlier
      </MenuItem>
      <MenuItem
        title="Move later"
        disabled={!shiftSeat(positions, item.id, 1)}
        onClick={() => actions.shift(item.id, 1)}
      >
        <ArrowRightIcon aria-hidden="true" />
        Move later
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        title="Leave the seat open"
        disabled={item.seat === "open" && !item.problem}
        onClick={() => actions.empty(item.id)}
      >
        <UserMinusIcon aria-hidden="true" />
        Leave the seat open
      </MenuItem>
      <MenuItem
        title="Remove this seat"
        className={MENU_DANGER}
        onClick={() => actions.remove(item.id)}
      >
        <TrashIcon aria-hidden="true" />
        Remove this seat
      </MenuItem>
    </Menu>
  );
}
