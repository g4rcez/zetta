import { Alert } from "@g4rcez/components/alert";
import { TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import { Button, Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Loading } from "../shared/ui";
import { orgApi, orgQueries, type OrgPosition, type OrgView } from "./org-api";
import { OrgCanvas } from "./org-canvas";
import { useOrgEdit } from "./org-edit";
import { breadcrumb, searchOrder } from "./org-graph";
import { OrgList } from "./org-list";
import { OrgWorksList } from "./org-works-list";
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
import { SeatPanel } from "./seat-panel";

const NO_POSITIONS: OrgPosition[] = [];
const VIEW_LABELS: Record<OrgViewMode, string> = { chart: "Chart", list: "List" };
const SHOW_LABELS: Record<OrgShow, string> = {
  everyone: "Everyone",
  people: "People",
  bots: "Bots",
  links: "Works with",
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

/**
 * The company chart: who leads what, and who every person and bot reports to. Everyone reads it; the admin draws it. A seat is selected
 * by clicking it (or by searching), and everything about it is read and changed in the panel beside the chart. The view, the search, the
 * group and the selected seat live in the address, so a link shows the same chart with the same seat open.
 */
export function OrganizationPage({
  search,
  onSearch,
}: {
  search: OrgSearch;
  onSearch: (next: OrgSearch, opts?: { replace?: boolean }) => void;
}) {
  const edit = useOrgEdit();
  const { data, error, isPending } = useQuery(orgQueries.get());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const state = toOrgState(search);
  // The works-with pairs are read only while the layer is on, from the address.
  const links = useQuery({ ...orgQueries.links(), enabled: state.show === "links" });
  const linksError = links.error ? errorMessage(links.error) : undefined;
  const positions = data?.positions ?? NO_POSITIONS;
  const canEdit = data?.canEdit ?? false;
  // A seat that is gone (removed, or from an old link) is no selection at all.
  const selectedId = positions.some((p) => p.id === state.focus) ? state.focus : "";
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
  /** Selects a seat (or none, with ""): a step in the history, so Back closes it. A seat inside a folded branch opens the branch. */
  const select = (id: string) => {
    if (id)
      setFolded((now) => {
        const above = breadcrumb(positions, id).filter((p) => now.has(p.id));
        if (!above.length) return now;
        const next = new Set(now);
        for (const p of above) next.delete(p.id);
        return next;
      });
    set({ focus: id });
  };
  const toggle = useCallback(
    (id: string) =>
      setFolded((now) => {
        const next = new Set(now);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  // Enter in the search goes to the first seat it found, and then to the next one.
  const found = useMemo(() => searchOrder(positions, state), [positions, state.q, state.show]); // eslint-disable-line react-hooks/exhaustive-deps
  const at = found.indexOf(selectedId);
  const goNext = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || found.length === 0) return;
    e.preventDefault();
    select(found[(at + 1) % found.length]!);
  };

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
            Who leads what, and who every person and bot reports to. Bots read their seat, and
            escalation follows the chart.
            {!canEdit && positions.length > 0 ? " Only the admin changes the chart." : ""}
          </p>
        </div>
        {positions.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-end gap-2" onKeyDown={goNext}>
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
              {state.q && (
                <span
                  role="status"
                  className="pb-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                >
                  {found.length === 0
                    ? "No match"
                    : at >= 0
                      ? `${at + 1} of ${found.length}`
                      : `${found.length} found. Enter shows the first.`}
                </span>
              )}
            </div>
            <Choice
              label="What to show"
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
            onDraft={(choices) =>
              void run((v) => orgApi.applyDraft(v, choices), "Chart drawn from your teams")
            }
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {state.view === "list" ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
                <OrgList
                  positions={positions}
                  filters={state}
                  collapsed={folded}
                  selectedId={selectedId}
                  onSelect={select}
                  onToggle={toggle}
                />
                {state.show === "links" && (
                  <OrgWorksList links={links.data} positions={positions} error={linksError} />
                )}
              </div>
            </div>
          ) : (
            <main className="min-h-72 min-w-0 flex-1 max-md:basis-2/5">
              <OrgCanvas
                positions={positions}
                filters={state}
                collapsed={folded}
                selectedId={selectedId}
                onSelect={select}
                onToggle={toggle}
                showLinks={state.show === "links"}
                links={links.data}
                linksError={linksError}
              />
            </main>
          )}
          <SeatPanel
            positions={positions}
            selectedId={selectedId}
            canEdit={canEdit}
            palette={data?.palette ?? null}
            busy={busy}
            run={run}
            onSelect={select}
            className="border-t max-md:max-h-[60%] md:w-96 md:shrink-0 md:border-t-0 md:border-l"
          />
        </div>
      )}
    </div>
  );
}
