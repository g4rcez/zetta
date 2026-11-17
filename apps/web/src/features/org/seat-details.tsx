import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Input, Select } from "@/components/ui";
import {
  ORG_DESCRIPTION_MAX,
  ORG_RANK_LABELS,
  ORG_TITLE_MAX,
  ORG_UNIT_MAX,
  type OrgRank,
} from "@zetta/core/org";
import { orgTemplateByKey } from "@zetta/core/org-templates";
import type { Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { MentionTextarea } from "../chat/mention";
import { orgApi, type OrgPalette, type OrgPosition } from "./org-api";
import { RoleGlyph } from "./org-bits";
import type { OrgRun } from "./org-edit";

const NO_BOTS: Bot[] = [];
const RANK_CHOICES: OrgRank[] = ["executive", "lead", "member"];

type Fields = { title: string; unit: string; description: string; rank: OrgRank };
const fieldsOf = (p: OrgPosition): Fields => ({
  title: p.title,
  unit: p.unit,
  description: p.description,
  rank: p.rank,
});

/** The words of the seat: what it is called, which unit it belongs to and what it is responsible for. */
function SeatFields({
  item,
  bots,
  busy,
  run,
}: {
  item: OrgPosition;
  bots: Bot[];
  busy: boolean;
  run: OrgRun;
}) {
  const [draft, setDraft] = useState<Fields>();
  const saved = fieldsOf(item);
  const shown = draft ?? saved;
  const dirty = JSON.stringify(shown) !== JSON.stringify(saved);
  return (
    <div className="space-y-3">
      <p className="text-xs text-pretty text-muted-foreground">
        Bots in this seat read these words before they work, so write what the seat is responsible
        for.
      </p>
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
            setDraft({ ...shown, rank: RANK_CHOICES.find((r) => r === e.target.value) ?? "member" })
          }
          options={RANK_CHOICES.map((r) => ({ value: r, label: ORG_RANK_LABELS[r] }))}
        />
      )}
      <Input
        title="Unit or department"
        required={false}
        maxLength={ORG_UNIT_MAX}
        value={shown.unit}
        onChange={(e) => setDraft({ ...shown, unit: e.target.value })}
      />
      <MentionTextarea
        title="What it is responsible for"
        bots={bots}
        rows={4}
        maxLength={ORG_DESCRIPTION_MAX}
        value={shown.description}
        onChange={(text) => setDraft({ ...shown, description: text })}
      />
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy || !shown.title.trim()}
            onClick={() =>
              void run((v) => orgApi.update(v, item.id, shown), "Seat saved").then(
                (view) => view && setDraft(undefined),
              )
            }
          >
            Save the seat
          </Button>
        </div>
      )}
    </div>
  );
}

/** The team this seat runs. Linking shows the team's name to everyone who reads the chart. */
function TeamField({
  item,
  palette,
  busy,
  run,
}: {
  item: OrgPosition;
  palette: OrgPalette;
  busy: boolean;
  run: OrgRun;
}) {
  const [draft, setDraft] = useState<string>();
  const shown = draft ?? item.team?.id ?? "";
  return (
    <div className="space-y-2">
      <Select
        title="Runs a team"
        required={false}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        options={[
          { value: "", label: "No team" },
          ...palette.teams.map((t) => ({ value: t.id, label: t.name })),
        ]}
      />
      <p className="text-xs text-pretty text-muted-foreground">
        Linking one of your teams shows its name to everyone who reads the chart. The team keeps its
        own bot chief to coordinate its rooms.
      </p>
      {shown !== (item.team?.id ?? "") && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void run((v) => orgApi.update(v, item.id, { teamId: shown || null }), "Saved").then(
              (view) => view && setDraft(undefined),
            )
          }
        >
          Save the team
        </Button>
      )}
    </div>
  );
}

/** What the role template this seat came from says it decides alone and what goes up. */
function RoleNotes({ item }: { item: OrgPosition }) {
  const tpl = item.templateKey ? orgTemplateByKey(item.templateKey) : undefined;
  if (!tpl) return null;
  return (
    <section aria-label="How this kind of seat works" className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
        <RoleGlyph icon={tpl.icon} />
        How a {tpl.title} works
      </h3>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="font-medium">Decides alone</dt>
          <dd className="text-pretty text-muted-foreground">{tpl.decides}</dd>
        </div>
        <div>
          <dt className="font-medium">Goes up to the manager</dt>
          <dd className="text-pretty text-muted-foreground">{tpl.goesUp}</dd>
        </div>
      </dl>
    </section>
  );
}

/** What the seat says about itself, read only. */
function SeatFacts({ item }: { item: OrgPosition }) {
  return (
    <dl className="space-y-2 text-sm">
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
  );
}

/**
 * The words of a seat. The admin edits them in a fold that stays closed until it is wanted (the holder and the manager come first);
 * everyone else reads them.
 */
export function SeatDetails({
  item,
  palette,
  busy,
  run,
}: {
  item: OrgPosition;
  /** Only the admin has one. */
  palette: OrgPalette | null;
  busy: boolean;
  run: OrgRun;
}) {
  const bots = useQuery(chatQueries.bots()).data ?? NO_BOTS;
  if (!palette)
    return (
      <div className="space-y-4">
        <SeatFacts item={item} />
        {item.team && <p className="text-sm">Runs the team {item.team.name}.</p>}
        <RoleNotes item={item} />
      </div>
    );
  return (
    <div className="space-y-4">
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">
          Title, level and what it is responsible for
        </summary>
        <div className="mt-3 space-y-4">
          <SeatFields item={item} bots={bots} busy={busy} run={run} />
          <TeamField item={item} palette={palette} busy={busy} run={run} />
        </div>
      </details>
      <RoleNotes item={item} />
    </div>
  );
}
