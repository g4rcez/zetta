import { Alert } from "@g4rcez/components/alert";
import { TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Loading } from "../shared/ui";
import { AddSeatPanel } from "./add-seat-panel";
import { orgApi, orgQueries, type OrgPosition, type OrgView } from "./org-api";
import { OrgCanvas } from "./org-canvas";
import { useOrgEdit } from "./org-edit";
import { shiftSeat } from "./org-graph";
import { OrgList } from "./org-list";
import { OrgPalettePanel, type OrgDragItem } from "./org-palette";
import {
  ORG_SHOW,
  ORG_VIEWS,
  toOrgSearch,
  toOrgState,
  type OrgSearch,
  type OrgShow,
  type OrgViewMode,
} from "./org-search";
import { OrgStart } from "./org-start";
import type { SeatActions } from "./seat-menu";

const NO_POSITIONS: OrgPosition[] = [];
const VIEW_LABELS: Record<OrgViewMode, string> = { chart: "Chart", list: "List" };
const SHOW_LABELS: Record<OrgShow, string> = {
  everyone: "Everyone",
  people: "People",
  bots: "Bots",
};

function Choice<T extends string>({
  label,
  options,
  value,
  names,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  names: Record<T, string>;
  onPick: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((o) => (
        <Button
          key={o}
          size="sm"
          variant={value === o ? "default" : "outline"}
          aria-pressed={value === o}
          onClick={() => onPick(o)}
        >
          {names[o]}
        </Button>
      ))}
    </div>
  );
}

/** Asks before a seat goes away, and says what happens to the seats under it. */
function RemoveBar({
  item,
  reports,
  busy,
  onConfirm,
  onCancel,
}: {
  item: OrgPosition;
  reports: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Remove ${item.title}`}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-card p-3 text-sm"
    >
      <p className="min-w-0 flex-1 text-pretty">
        Remove <span className="font-medium">{item.title}</span>?{" "}
        {reports > 0
          ? `The ${reports} ${reports === 1 ? "seat" : "seats"} under it will report to its manager.`
          : "Nobody reports to it."}
      </p>
      <Button size="sm" variant="destructive" disabled={busy} onClick={onConfirm}>
        Remove this seat
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Keep it
      </Button>
    </div>
  );
}

/**
 * The company chart: who leads what, and who every person and bot reports to. Everyone reads it; the admin draws it, by dragging on the
 * canvas or from each seat's menu and page. The view, the search and the group live in the address, so a link shows the same chart.
 */
export function OrganizationPage({
  search,
  onSearch,
}: {
  search: OrgSearch;
  onSearch: (next: OrgSearch, opts?: { replace?: boolean }) => void;
}) {
  const navigate = useNavigate();
  const edit = useOrgEdit();
  const { data, error, isPending } = useQuery(orgQueries.get());
  const [adding, setAdding] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const state = toOrgState(search);
  const positions = data?.positions ?? NO_POSITIONS;
  const canEdit = data?.canEdit ?? false;
  const set = (patch: Partial<typeof state>, opts?: { replace?: boolean }) =>
    onSearch(toOrgSearch({ ...state, ...patch }), opts);

  const run = useCallback(
    async (work: (version: number) => Promise<OrgView>, done?: string) => {
      setBusy(true);
      try {
        return await edit(work, done);
      } finally {
        setBusy(false);
      }
    },
    [edit],
  );
  const actions: SeatActions = useMemo(
    () => ({
      open: (id) => void navigate({ to: "/organization/$positionId", params: { positionId: id } }),
      addReport: (id) => setAdding(id),
      shift: (id, delta) => {
        const to = shiftSeat(positions, id, delta);
        if (to) void run((v) => orgApi.move(v, id, to.parentId, to.index));
      },
      empty: (id) => void run((v) => orgApi.seat(v, id, { kind: "open" }), "The seat is open"),
      remove: (id) => setRemoving(id),
    }),
    [navigate, positions, run],
  );
  const toggle = useCallback(
    (id: string) =>
      setFolded((now) => {
        const next = new Set(now);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const dropItem = (item: OrgDragItem, seatId: string) =>
    void (item.type === "template"
      ? run((v) => orgApi.create(v, { parentId: seatId, templateKey: item.id }), "Seat added")
      : run(
          (v) =>
            orgApi.seat(
              v,
              seatId,
              item.type === "person"
                ? { kind: "person", userId: item.id }
                : { kind: "bot", botId: item.id },
            ),
          "Seat filled",
        ));

  const addingSeat = positions.find((p) => p.id === adding);
  const removingSeat = positions.find((p) => p.id === removing);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3 md:px-6">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        >
          <TreeStructureIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-2xl text-balance">Organization</h1>
          <p className="text-sm text-pretty text-muted-foreground">
            Who leads what, and who every person and bot reports to.
            {!canEdit && positions.length > 0 ? " Only the admin changes the chart." : ""}
          </p>
        </div>
        {positions.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <Input
              type="search"
              title="Find a seat or a person"
              hiddenLabel
              placeholder="Find a seat or a person"
              required={false}
              container="min-w-48 sm:w-64"
              value={state.q}
              onChange={(e) => set({ q: e.target.value }, { replace: true })}
            />
            <Choice
              label="Who to point out"
              options={ORG_SHOW}
              value={state.show}
              names={SHOW_LABELS}
              onPick={(show) => set({ show })}
            />
            <Choice
              label="How to draw it"
              options={ORG_VIEWS}
              value={state.view}
              names={VIEW_LABELS}
              onPick={(view) => set({ view })}
            />
          </div>
        )}
      </header>
      {(addingSeat || removingSeat) && (
        <div className="space-y-3 border-b p-4 md:px-6">
          {addingSeat && (
            <AddSeatPanel
              key={addingSeat.id}
              parent={addingSeat}
              busy={busy}
              onCancel={() => setAdding(undefined)}
              onAdd={(v) =>
                void run((version) => orgApi.create(version, v), "Seat added").then(
                  (view) => view && setAdding(undefined),
                )
              }
              onPreset={(key, parentId) =>
                void run(
                  (version) => orgApi.applyPreset(version, key, parentId),
                  "Team added",
                ).then((view) => view && setAdding(undefined))
              }
            />
          )}
          {removingSeat && (
            <RemoveBar
              item={removingSeat}
              reports={positions.filter((p) => p.parentId === removingSeat.id).length}
              busy={busy}
              onCancel={() => setRemoving(undefined)}
              onConfirm={() =>
                void run((version) => orgApi.remove(version, removingSeat.id), "Seat removed").then(
                  (view) => view && setRemoving(undefined),
                )
              }
            />
          )}
        </div>
      )}
      {error && (
        <div className="p-4 md:px-6">
          <Alert theme="danger">{errorMessage(error)}</Alert>
        </div>
      )}
      {isPending ? (
        <div className="p-4 md:px-6">
          <Loading />
        </div>
      ) : positions.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <OrgStart
            canEdit={canEdit}
            busy={busy}
            onPreset={(key) => void run((v) => orgApi.applyPreset(v, key), "Chart drawn")}
            onCeo={() => void run((v) => orgApi.create(v, { templateKey: "ceo" }), "Chart started")}
          />
        </div>
      ) : state.view === "list" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
            <OrgList
              positions={positions}
              canEdit={canEdit}
              filters={state}
              collapsed={folded}
              actions={actions}
              onToggle={toggle}
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {canEdit && data?.palette && (
            <OrgPalettePanel
              palette={data.palette}
              className="max-h-48 shrink-0 border-b md:max-h-none md:w-60 md:border-r md:border-b-0"
            />
          )}
          <main className="min-h-0 min-w-0 flex-1">
            <OrgCanvas
              positions={positions}
              canEdit={canEdit}
              filters={state}
              collapsed={folded}
              focus={state.focus}
              actions={actions}
              onToggle={toggle}
              onMoveSeat={(id, parentId) => void run((v) => orgApi.move(v, id, parentId), "Moved")}
              onDropItem={dropItem}
            />
          </main>
        </div>
      )}
    </div>
  );
}
