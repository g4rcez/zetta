import { Alert } from "@g4rcez/components/alert";
import { CaretRightIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { BotIdentity } from "@/components/bot-identity";
import { Button, Input, Radiobox, Select } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import {
  ORG_DESCRIPTION_MAX,
  ORG_RANK_LABELS,
  ORG_TITLE_MAX,
  ORG_UNIT_MAX,
  type OrgRank,
} from "@zetta/core/org";
import { orgTemplateByKey } from "@zetta/core/org-templates";
import { chatQueries } from "../chat/chat-queries";
import type { Bot } from "../chat/chat-client";
import { MentionTextarea } from "../chat/mention";
import { ConfirmButton, Empty, Loading, Panel } from "../shared/ui";
import { AddSeatPanel } from "./add-seat-panel";
import {
  orgApi,
  orgQueries,
  type OrgHolderInput,
  type OrgPalette,
  type OrgPosition,
} from "./org-api";
import { RankMark, RoleGlyph, SeatHolder, problemText } from "./org-bits";
import { useOrgEdit } from "./org-edit";
import { breadcrumb, managerChoices } from "./org-graph";

const NO_BOTS: Bot[] = [];
const RANK_CHOICES: OrgRank[] = ["executive", "lead", "member"];

/** Saves one change of the chart and says whether it worked. Each panel has its own, so a busy button never freezes the others. */
function useSeatSave() {
  const edit = useOrgEdit();
  const [busy, setBusy] = useState(false);
  const save = async (work: Parameters<typeof edit>[0], done = "Saved") => {
    setBusy(true);
    try {
      return !!(await edit(work, done));
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

type Fields = { title: string; unit: string; description: string; rank: OrgRank };
const fieldsOf = (p: OrgPosition): Fields => ({
  title: p.title,
  unit: p.unit,
  description: p.description,
  rank: p.rank,
});

/** The words of the seat: what it is called, which unit it belongs to and what it is responsible for. The admin edits them; others read. */
function SeatFields({ item, canEdit, bots }: { item: OrgPosition; canEdit: boolean; bots: Bot[] }) {
  const { busy, save } = useSeatSave();
  const [draft, setDraft] = useState<Fields>();
  const saved = fieldsOf(item);
  const shown = draft ?? saved;
  const dirty = JSON.stringify(shown) !== JSON.stringify(saved);
  if (!canEdit)
    return (
      <Panel title="The seat">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">Level</dt>
            <dd className="text-muted-foreground">{ORG_RANK_LABELS[item.rank]}</dd>
          </div>
          {item.unit && (
            <div>
              <dt className="font-medium">Unit</dt>
              <dd className="text-muted-foreground">{item.unit}</dd>
            </div>
          )}
          <div>
            <dt className="font-medium">What it is responsible for</dt>
            <dd className="text-pretty whitespace-pre-line text-muted-foreground">
              {item.description || "Nothing is written yet."}
            </dd>
          </div>
        </dl>
      </Panel>
    );
  return (
    <Panel
      title="The seat"
      description="Bots in this seat read these words before they work, so write what the seat is responsible for."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          title="Title"
          required
          maxLength={ORG_TITLE_MAX}
          value={shown.title}
          onChange={(e) => setDraft({ ...shown, title: e.target.value })}
        />
        {item.rank === "ceo" ? (
          <Input title="Level" required={false} readOnly value="CEO" />
        ) : (
          <Select
            title="Level"
            required={false}
            value={shown.rank}
            onChange={(e) =>
              setDraft({
                ...shown,
                rank: RANK_CHOICES.find((r) => r === e.target.value) ?? "member",
              })
            }
            options={RANK_CHOICES.map((r) => ({ value: r, label: ORG_RANK_LABELS[r] }))}
          />
        )}
        <Input
          title="Unit or department"
          required={false}
          maxLength={ORG_UNIT_MAX}
          container="sm:col-span-2"
          value={shown.unit}
          onChange={(e) => setDraft({ ...shown, unit: e.target.value })}
        />
        <MentionTextarea
          title="What it is responsible for"
          bots={bots}
          rows={4}
          maxLength={ORG_DESCRIPTION_MAX}
          className="sm:col-span-2"
          value={shown.description}
          onChange={(text) => setDraft({ ...shown, description: text })}
        />
      </div>
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy || !shown.title.trim()}
            onClick={() =>
              void save((v) => orgApi.update(v, item.id, shown), "Seat saved").then(
                (ok) => ok && setDraft(undefined),
              )
            }
          >
            Save the seat
          </Button>
        </div>
      )}
    </Panel>
  );
}

const sameHolder = (a: OrgHolderInput, b: OrgHolderInput) =>
  a.kind === b.kind &&
  (a.kind === "open" ||
    (a.kind === "person" && b.kind === "person" && a.userId === b.userId) ||
    (a.kind === "bot" && b.kind === "bot" && a.botId === b.botId));
const holderOf = (p: OrgPosition): OrgHolderInput =>
  p.holder?.kind === "person"
    ? { kind: "person", userId: p.holder.userId }
    : p.holder?.kind === "bot"
      ? { kind: "bot", botId: p.holder.botId }
      : { kind: "open" };

/** Who holds the seat. The admin picks a person or a bot by face, or leaves it open. */
function HolderPanel({
  item,
  palette,
}: {
  item: OrgPosition;
  /** Only the admin has one. */
  palette: OrgPalette | null;
}) {
  const { busy, save } = useSeatSave();
  const [draft, setDraft] = useState<OrgHolderInput>();
  const saved = holderOf(item);
  const shown = draft ?? saved;
  return (
    <Panel title="Who holds it" description="A person, or a bot that is shared with the team.">
      <SeatHolder item={item} size={36} />
      {item.problem && <Alert theme="warn">{problemText(item.problem)}</Alert>}
      {palette && (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Change who holds it</legend>
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              <div className="text-sm">
                <Radiobox
                  name="holder"
                  checked={shown.kind === "open"}
                  disabled={busy}
                  onChange={() => setDraft({ kind: "open" })}
                >
                  Nobody yet
                </Radiobox>
              </div>
              {palette.people.map((p) => (
                <div key={p.userId} className="text-sm">
                  <Radiobox
                    name="holder"
                    checked={shown.kind === "person" && shown.userId === p.userId}
                    disabled={busy}
                    onChange={() => setDraft({ kind: "person", userId: p.userId })}
                  >
                    <span className="inline-flex items-center gap-2">
                      <UserAvatar name={p.name} avatar={p.avatar} size={24} />
                      {p.name}
                    </span>
                  </Radiobox>
                </div>
              ))}
              {palette.bots.map((b) => (
                <div key={b.id} className="text-sm">
                  <Radiobox
                    name="holder"
                    checked={shown.kind === "bot" && shown.botId === b.id}
                    disabled={busy}
                    onChange={() => setDraft({ kind: "bot", botId: b.id })}
                  >
                    <BotIdentity bot={b} size={24} className="inline-flex" />
                  </Radiobox>
                </div>
              ))}
            </div>
            {palette.bots.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No bot is shared with the team yet. Share a bot from its settings to put it in a
                seat.
              </p>
            )}
          </fieldset>
          {!sameHolder(shown, saved) && (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
                Discard
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void save((v) => orgApi.seat(v, item.id, shown), "Seat updated").then(
                    (ok) => ok && setDraft(undefined),
                  )
                }
              >
                Save who holds it
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Who the seat reports to. The CEO reports to nobody. */
function ReportsToPanel({
  item,
  positions,
  canEdit,
}: {
  item: OrgPosition;
  positions: readonly OrgPosition[];
  canEdit: boolean;
}) {
  const { busy, save } = useSeatSave();
  const [draft, setDraft] = useState<string>();
  const manager = positions.find((p) => p.id === item.parentId);
  const shown = draft ?? item.parentId ?? "";
  if (!manager)
    return (
      <Panel title="Reports to">
        <p className="text-sm text-muted-foreground">Nobody: this is the top of the chart.</p>
      </Panel>
    );
  return (
    <Panel
      title="Reports to"
      description="Stuck and blocked work goes up this line, and bots in this seat know whom to ask."
    >
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            title="Manager"
            required={false}
            container="min-w-64 flex-1"
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            options={managerChoices(positions, item.id).map((p) => ({
              value: p.id,
              label: `${p.title}${p.holder ? ` (${p.holder.name})` : ""}`,
            }))}
          />
          <Button
            size="sm"
            disabled={busy || shown === item.parentId}
            onClick={() =>
              void save((v) => orgApi.move(v, item.id, shown), "Moved").then(
                (ok) => ok && setDraft(undefined),
              )
            }
          >
            Move this seat
          </Button>
        </div>
      ) : (
        <Link
          to="/organization/$positionId"
          params={{ positionId: manager.id }}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          {manager.title}
        </Link>
      )}
    </Panel>
  );
}

/** The team this seat runs. Linking shows the team's name to everyone who reads the chart. */
function TeamPanel({ item, palette }: { item: OrgPosition; palette: OrgPalette | null }) {
  const { busy, save } = useSeatSave();
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? item.team?.id ?? "";
  if (!palette)
    return item.team ? (
      <Panel title="Runs a team">
        <p className="text-sm">{item.team.name}</p>
      </Panel>
    ) : null;
  return (
    <Panel
      title="Runs a team"
      description="Link one of your teams to this seat. The team keeps its own bot chief to coordinate its rooms. Linking shows the team's name to everyone who reads the chart."
    >
      <div className="flex flex-wrap items-end gap-3">
        <Select
          title="Team"
          required={false}
          container="min-w-64 flex-1"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          options={[
            { value: "", label: "No team" },
            ...palette.teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <Button
          size="sm"
          disabled={busy || shown === (item.team?.id ?? "")}
          onClick={() =>
            void save((v) => orgApi.update(v, item.id, { teamId: shown || null }), "Saved").then(
              (ok) => ok && setDraft(undefined),
            )
          }
        >
          Save the team
        </Button>
      </div>
    </Panel>
  );
}

/** What the role template this seat came from says it decides alone and what goes up. */
function RoleNotes({ item }: { item: OrgPosition }) {
  const tpl = item.templateKey ? orgTemplateByKey(item.templateKey) : undefined;
  if (!tpl) return null;
  return (
    <Panel
      title="How this kind of seat works"
      description={`It started from the ${tpl.title} template.`}
    >
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="flex items-center gap-1.5 font-medium">
            <RoleGlyph icon={tpl.icon} className="text-muted-foreground" />
            Decides alone
          </dt>
          <dd className="text-pretty text-muted-foreground">{tpl.decides}</dd>
        </div>
        <div>
          <dt className="font-medium">Goes up to the manager</dt>
          <dd className="text-pretty text-muted-foreground">{tpl.goesUp}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function ReportsPanel({
  item,
  positions,
  canEdit,
}: {
  item: OrgPosition;
  positions: readonly OrgPosition[];
  canEdit: boolean;
}) {
  const { busy, save } = useSeatSave();
  const [adding, setAdding] = useState(false);
  const reports = positions
    .filter((p) => p.parentId === item.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <Panel
      title="Reports to this seat"
      count={reports.length}
      action={
        canEdit && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add a seat under this one
          </Button>
        ) : undefined
      }
    >
      {adding && (
        <AddSeatPanel
          parent={item}
          busy={busy}
          onCancel={() => setAdding(false)}
          onAdd={(v) =>
            void save((version) => orgApi.create(version, v), "Seat added").then(
              (ok) => ok && setAdding(false),
            )
          }
          onPreset={(key, parentId) =>
            void save((version) => orgApi.applyPreset(version, key, parentId), "Team added").then(
              (ok) => ok && setAdding(false),
            )
          }
        />
      )}
      {reports.length ? (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {reports.map((r) => (
            <li key={r.id}>
              <Link
                to="/organization/$positionId"
                params={{ positionId: r.id }}
                className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="flex min-w-0 basis-48 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{r.title}</span>
                  <RankMark rank={r.rank} />
                </span>
                <SeatHolder item={r} size={24} className="min-w-0 flex-1 basis-48" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nobody reports to this seat.</Empty>
      )}
    </Panel>
  );
}

/** One seat of the company chart: its words, who holds it, who it reports to and who reports to it. */
export function PositionPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const edit = useOrgEdit();
  const { data, isPending } = useQuery(orgQueries.get());
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  const positions = data?.positions ?? [];
  const item = positions.find((p) => p.id === id);
  const canEdit = data?.canEdit ?? false;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl min-w-0 space-y-6 p-4 md:p-8">
        {isPending ? (
          <Loading />
        ) : !item ? (
          <div className="space-y-3">
            <Empty>This seat is not in the chart any more.</Empty>
            <Link to="/organization" className="text-sm font-medium underline underline-offset-4">
              Back to the organization
            </Link>
          </div>
        ) : (
          <>
            <header className="space-y-3 border-b pb-5">
              <nav aria-label="Reporting line">
                <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                  <li>
                    <Link to="/organization" className="hover:text-foreground">
                      Organization
                    </Link>
                  </li>
                  {breadcrumb(positions, id).map((p) => (
                    <li key={p.id} className="flex items-center gap-1">
                      <CaretRightIcon aria-hidden="true" className="size-3" />
                      {p.id === id ? (
                        <span aria-current="page" className="text-foreground">
                          {p.title}
                        </span>
                      ) : (
                        <Link
                          to="/organization/$positionId"
                          params={{ positionId: p.id }}
                          className="hover:text-foreground"
                        >
                          {p.title}
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="min-w-0 flex-1 text-2xl text-balance">
                  <span className="inline-flex items-center gap-2">
                    {item.title}
                    <RankMark rank={item.rank} />
                  </span>
                </h1>
                <Link
                  to="/organization"
                  search={{ focus: item.id }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  <TreeStructureIcon aria-hidden="true" className="size-4" />
                  Show in the chart
                </Link>
              </div>
            </header>
            {/* One key per seat: a half-written draft never carries over to another seat. */}
            <div key={item.id} className="space-y-6">
              <SeatFields item={item} canEdit={canEdit} bots={bots} />
              <HolderPanel item={item} palette={data?.palette ?? null} />
              <ReportsToPanel item={item} positions={positions} canEdit={canEdit} />
              <TeamPanel item={item} palette={data?.palette ?? null} />
              <ReportsPanel item={item} positions={positions} canEdit={canEdit} />
              <RoleNotes item={item} />
            </div>
            {canEdit && (
              <Panel
                title="Remove this seat"
                description={
                  item.parentId
                    ? "The seats under it will report to its manager. Nobody is deleted."
                    : "The CEO can be removed only when nobody reports to it."
                }
              >
                <ConfirmButton
                  label="Remove this seat"
                  question={`Remove ${item.title}?`}
                  confirmLabel="Remove"
                  variant="destructive"
                  onConfirm={async () => {
                    const view = await edit((v) => orgApi.remove(v, id), "Seat removed");
                    if (view) void navigate({ to: "/organization" });
                  }}
                />
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}
