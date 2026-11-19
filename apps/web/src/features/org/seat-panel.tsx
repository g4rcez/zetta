import { Alert } from "@g4rcez/components/alert";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CaretRightIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { ActionHint } from "@/components/action-hint";
import { Button, Select } from "@/components/ui";
import { cn } from "@zetta/ui/lib/utils";
import { ConfirmButton } from "../shared/ui";
import { AddUnderForm } from "./add-under-form";
import { HolderPicker, type HolderChoice } from "./holder-picker";
import {
  orgApi,
  type OrgCreate,
  type OrgHolderInput,
  type OrgPalette,
  type OrgPosition,
} from "./org-api";
import { RankMark, SeatHolder, problemText } from "./org-bits";
import type { OrgRun } from "./org-edit";
import { breadcrumb, managerChoices, shiftSeat } from "./org-graph";
import { SeatDetails } from "./seat-details";

const holderOf = (p: OrgPosition): OrgHolderInput =>
  p.holder?.kind === "person"
    ? { kind: "person", userId: p.holder.userId }
    : p.holder?.kind === "bot"
      ? { kind: "bot", botId: p.holder.botId }
      : { kind: "open" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

type Shared = {
  positions: readonly OrgPosition[];
  palette: OrgPalette | null;
  busy: boolean;
  run: OrgRun;
  onSelect: (id: string) => void;
};

/** Who holds the seat. The admin picks a person or a bot from one list; a private bot stays private in the seat. */
function HeldBy({ item, s }: { item: OrgPosition; s: Shared }) {
  const [picking, setPicking] = useState(false);
  const pick = (c: HolderChoice) =>
    void s
      .run((v) => orgApi.seat(v, item.id, c.holder), "Seat updated")
      .then((view) => view && setPicking(false));
  return (
    <Section title="Held by">
      <SeatHolder item={item} size={36} />
      {item.problem && <Alert theme="warn">{problemText(item.problem)}</Alert>}
      {s.palette &&
        (picking ? (
          <div className="space-y-2">
            <HolderPicker
              palette={s.palette}
              current={holderOf(item)}
              busy={s.busy}
              allowOpen={item.seat !== "open" || !!item.problem}
              onPick={pick}
            />
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
            {item.seat === "open" ? "Assign a person or a bot" : "Change who holds it"}
          </Button>
        ))}
    </Section>
  );
}

/** Who the seat reports to, and its place among the seats that report to the same manager. The CEO reports to nobody. */
function ReportsTo({ item, s, canEdit }: { item: OrgPosition; s: Shared; canEdit: boolean }) {
  const [draft, setDraft] = useState<string>();
  const manager = s.positions.find((p) => p.id === item.parentId);
  const shown = draft ?? item.parentId ?? "";
  const earlier = shiftSeat(s.positions, item.id, -1);
  const later = shiftSeat(s.positions, item.id, 1);
  const shift = (to: { parentId: string; index: number }) =>
    void s.run((v) => orgApi.move(v, item.id, to.parentId, to.index));
  if (!manager)
    return (
      <Section title="Reports to">
        <p className="text-sm text-muted-foreground">Nobody: this is the top of the chart.</p>
      </Section>
    );
  if (!canEdit)
    return (
      <Section title="Reports to">
        <button
          type="button"
          onClick={() => s.onSelect(manager.id)}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {manager.title}
        </button>
      </Section>
    );
  return (
    <Section title="Reports to">
      <p className="text-xs text-pretty text-muted-foreground">
        Stuck and blocked work goes up this line, and bots in this seat know whom to ask.
      </p>
      <Select
        title="Manager"
        required={false}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        options={managerChoices(s.positions, item.id).map((p) => ({
          value: p.id,
          label: `${p.title}${p.holder ? ` (${p.holder.name})` : ""}`,
        }))}
      />
      <div className="flex flex-wrap gap-2">
        {shown !== item.parentId && (
          <Button
            size="sm"
            disabled={s.busy}
            onClick={() =>
              void s
                .run((v) => orgApi.move(v, item.id, shown), "Moved")
                .then((view) => view && setDraft(undefined))
            }
          >
            Move this seat
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={s.busy || !earlier}
          onClick={() => earlier && shift(earlier)}
        >
          <ArrowLeftIcon aria-hidden="true" />
          Earlier
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={s.busy || !later}
          onClick={() => later && shift(later)}
        >
          Later
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </div>
    </Section>
  );
}

/** The seats that report to this one, to open one, and the way to add another. */
function UnderThisSeat({
  item,
  s,
  canEdit,
  onAdd,
}: {
  item: OrgPosition;
  s: Shared;
  canEdit: boolean;
  onAdd: () => void;
}) {
  const reports = s.positions
    .filter((p) => p.parentId === item.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Section title={`Reports to this seat (${reports.length})`}>
      {reports.length > 0 ? (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => s.onSelect(r.id)}
                className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <RankMark rank={r.rank} />
                  </span>
                  <SeatHolder item={r} size={20} className="mt-0.5" />
                </span>
                <CaretRightIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody reports to this seat.</p>
      )}
      {canEdit && (
        <Button size="sm" variant="outline" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          Add a seat under this one
        </Button>
      )}
    </Section>
  );
}

/** Adds a seat under `parent` and selects it. A whole team selects the first seat it made. */
function seatAdder(s: Shared, parentId: string, done: () => void) {
  const created = (before: ReadonlySet<string>, view: { positions: OrgPosition[] } | undefined) => {
    if (!view) return;
    const first = view.positions.find((p) => !before.has(p.id));
    done();
    if (first) s.onSelect(first.id);
  };
  const before = () => new Set(s.positions.map((p) => p.id));
  return {
    add: (v: OrgCreate) => {
      const was = before();
      void s.run((version) => orgApi.create(version, v), "Seat added").then((r) => created(was, r));
    },
    preset: (key: string) => {
      const was = before();
      void s
        .run((version) => orgApi.applyPreset(version, key, parentId), "Team added")
        .then((r) => created(was, r));
    },
  };
}

function AddUnder({ parent, s, onDone }: { parent: OrgPosition; s: Shared; onDone: () => void }) {
  const adder = seatAdder(s, parent.id, onDone);
  if (!s.palette) return null;
  return (
    <AddUnderForm
      parent={parent}
      palette={s.palette}
      busy={s.busy}
      onAdd={adder.add}
      onPreset={(key) => adder.preset(key)}
      onCancel={onDone}
    />
  );
}

function PanelHeader({
  item,
  positions,
  onSelect,
}: {
  item: OrgPosition;
  positions: readonly OrgPosition[];
  onSelect: (id: string) => void;
}) {
  const above = breadcrumb(positions, item.id).filter((p) => p.id !== item.id);
  return (
    <header className="space-y-1 border-b px-4 py-3">
      {above.length > 0 && (
        <nav aria-label="Reporting line">
          <ol className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            {above.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="hover:text-foreground hover:underline"
                >
                  {p.title}
                </button>
                <CaretRightIcon aria-hidden="true" className="size-3" />
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-lg text-balance">{item.title}</h2>
        <RankMark rank={item.rank} />
        <ActionHint label="Close the seat" side="bottom">
          <button
            type="button"
            aria-label="Close the seat"
            onClick={() => onSelect("")}
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </ActionHint>
      </div>
    </header>
  );
}

/** One seat, open. Keyed by the seat, so a half-made choice never carries over to another seat. */
function SeatBody({ item, s, canEdit }: { item: OrgPosition; s: Shared; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const reports = s.positions.filter((p) => p.parentId === item.id).length;
  return (
    <>
      <PanelHeader item={item} positions={s.positions} onSelect={s.onSelect} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {adding ? (
          <AddUnder parent={item} s={s} onDone={() => setAdding(false)} />
        ) : (
          <>
            <HeldBy item={item} s={s} />
            <ReportsTo item={item} s={s} canEdit={canEdit} />
            <UnderThisSeat item={item} s={s} canEdit={canEdit} onAdd={() => setAdding(true)} />
            <SeatDetails item={item} palette={s.palette} busy={s.busy} run={s.run} />
            {canEdit && (
              <Section title="Remove this seat">
                <p className="text-xs text-pretty text-muted-foreground">
                  {item.parentId
                    ? reports > 0
                      ? `The ${reports} ${reports === 1 ? "seat" : "seats"} under it will report to its manager. Nobody is deleted.`
                      : "Nobody reports to it. Nobody is deleted."
                    : "The CEO can be removed only when nobody reports to it."}
                </p>
                <ConfirmButton
                  label="Remove this seat"
                  question={`Remove ${item.title}?`}
                  confirmLabel="Remove"
                  variant="destructive"
                  onConfirm={async () => {
                    const view = await s.run((v) => orgApi.remove(v, item.id), "Seat removed");
                    if (view) s.onSelect(item.parentId ?? "");
                  }}
                />
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** Nothing is selected: say what to do, and give the admin the way to add under the CEO. */
function NoSeat({ s, canEdit }: { s: Shared; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const root = s.positions.find((p) => p.parentId === null);
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {adding && root ? (
        <AddUnder parent={root} s={s} onDone={() => setAdding(false)} />
      ) : (
        <>
          <p className="text-sm text-pretty text-muted-foreground">
            {canEdit
              ? "Select a seat to see who holds it, change it, or add a seat under it."
              : "Select a seat to see who holds it and who it reports to."}
          </p>
          {canEdit && root && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden="true" />
              Add a seat under {root.title}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Everything about one seat, in one panel beside the chart: who holds it, who it reports to, who reports to it, its words, and the way to
 * add or remove seats. It replaces the menu, the palette and the separate seat page, so nothing is done by dragging or in another place.
 * Everyone reads it; the admin edits.
 */
export function SeatPanel({
  positions,
  selectedId,
  canEdit,
  palette,
  busy,
  run,
  onSelect,
  className,
}: Shared & { selectedId: string; canEdit: boolean; className?: string }) {
  const s: Shared = { positions, palette, busy, run, onSelect };
  const item = positions.find((p) => p.id === selectedId);
  return (
    <aside
      aria-label={item ? `Seat: ${item.title}` : "Seat"}
      className={cn(
        "flex min-h-0 flex-col bg-background",
        // Nothing selected: the panel is only a hint, so a phone does not spend a screen on it.
        !item && "max-md:hidden",
        className,
      )}
    >
      {item ? (
        <SeatBody key={item.id} item={item} s={s} canEdit={canEdit} />
      ) : (
        <NoSeat s={s} canEdit={canEdit} />
      )}
    </aside>
  );
}
