import { Alert } from "@g4rcez/components/alert";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Checkbox } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Loading } from "../shared/ui";
import {
  orgQueries,
  type OrgDraft,
  type OrgDraftChoices,
  type OrgDraftSeat,
  type OrgDraftSkipReason,
} from "./org-api";

const SKIP_WORDS: Record<OrgDraftSkipReason, string> = {
  private: "it is private: share it with the team first",
  archived: "it is archived",
  chief_of_staff: "a personal chief of staff cannot hold a seat",
  already_seated: "it already has a seat under another team",
  too_many: "the chart is full",
};

/** What the draft would save after the admin's choices: the seats that stay, for the count on the button. */
export function keptSeats(
  draft: OrgDraft,
  skipTeams: ReadonlySet<string>,
  skipBots: ReadonlySet<string>,
) {
  const lead = new Map(draft.seats.map((s) => [s.ref, s]));
  return draft.seats.filter((s) => {
    if (s.parentRef === null) return true;
    if (s.team && skipTeams.has(s.team.id)) return false;
    const parent = lead.get(s.parentRef)!;
    if (parent.team && skipTeams.has(parent.team.id)) return false;
    // A leader whose bot was left out stays as an open seat; a member whose bot was left out goes.
    return s.rank === "lead" || !s.holder || !skipBots.has(s.holder.botId);
  }).length;
}

const createLabel = (n: number) => `Create ${n} ${n === 1 ? "seat" : "seats"}`;

function Line({
  seat,
  checked,
  disabled,
  onChange,
}: {
  seat: OrgDraftSeat;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const who = seat.holder?.name;
  return (
    <div className="space-y-0.5">
      <Checkbox checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)}>
        <span className="font-medium">{seat.title}</span>
        <span className="text-muted-foreground">
          {" · "}
          {who ?? "open seat"}
        </span>
      </Checkbox>
      {seat.note && <p className="pl-7 text-xs text-muted-foreground">{seat.note}</p>}
    </div>
  );
}

function DraftTree({
  draft,
  skipTeams,
  skipBots,
  onTeam,
  onBot,
}: {
  draft: OrgDraft;
  skipTeams: ReadonlySet<string>;
  skipBots: ReadonlySet<string>;
  onTeam: (id: string, keep: boolean) => void;
  onBot: (id: string, keep: boolean) => void;
}) {
  const ceo = draft.seats[0];
  const leads = draft.seats.filter((s) => s.rank === "lead");
  return (
    <ul aria-label="Seats that will be created" className="space-y-3 text-sm">
      <li>
        <p>
          <span className="font-medium">{ceo?.title ?? "CEO"}</span>
          <span className="text-muted-foreground"> · open seat, you can put a person in it</span>
        </p>
        <ul className="mt-2 ml-3 space-y-3 border-l pl-4">
          {leads.map((lead) => {
            const teamOff = !!lead.team && skipTeams.has(lead.team.id);
            const under = draft.seats.filter((s) => s.parentRef === lead.ref);
            return (
              <li key={lead.ref} className="space-y-1.5">
                <Line
                  seat={lead}
                  checked={!teamOff}
                  disabled={false}
                  onChange={(keep) => lead.team && onTeam(lead.team.id, keep)}
                />
                {under.length > 0 && (
                  <ul className="ml-3 space-y-1.5 border-l pl-4">
                    {under.map((s) => (
                      <li key={s.ref}>
                        <Line
                          seat={s}
                          checked={!teamOff && !(s.holder && skipBots.has(s.holder.botId))}
                          disabled={teamOff}
                          onChange={(keep) => s.holder && onBot(s.holder.botId, keep)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </li>
    </ul>
  );
}

/**
 * The preview of "Draw it from my teams": each team becomes a unit with its chief as the leader and its bots under it. Nothing is saved
 * here. The admin unticks what should not be in the chart, then confirms; the chart can be changed freely afterwards.
 */
export function OrgDraftPreview({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: (choices: OrgDraftChoices) => void;
  onCancel: () => void;
}) {
  const { data, error, isPending } = useQuery(orgQueries.draft());
  const [skipTeams, setSkipTeams] = useState<ReadonlySet<string>>(new Set());
  const [skipBots, setSkipBots] = useState<ReadonlySet<string>>(new Set());
  const flip = (set: ReadonlySet<string>, id: string, keep: boolean) => {
    const next = new Set(set);
    if (keep) next.delete(id);
    else next.add(id);
    return next;
  };
  return (
    <section
      aria-label="Draw it from my teams"
      className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-8"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-balance">Your teams as a chart</h2>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Each team becomes a unit. Its chief leads it and its bots take a seat under the chief.
          Nothing is saved until you create the seats. Untick what should stay out; you can rename
          and move seats afterwards.
        </p>
      </div>
      {error && <Alert theme="danger">{errorMessage(error)}</Alert>}
      {isPending && <Loading />}
      {data && data.teams.length === 0 && (
        <p className="text-sm text-muted-foreground">
          You have no teams yet. Create a team of bots first, or start from a structure.
        </p>
      )}
      {data && data.teams.length > 0 && (
        <>
          <DraftTree
            draft={data}
            skipTeams={skipTeams}
            skipBots={skipBots}
            onTeam={(id, keep) => setSkipTeams((s) => flip(s, id, keep))}
            onBot={(id, keep) => setSkipBots((s) => flip(s, id, keep))}
          />
          {data.skipped.length > 0 && (
            <div className="space-y-1 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Without a seat of their own</p>
              <ul className="space-y-0.5">
                {data.skipped.map((s) => (
                  <li key={`${s.teamName}|${s.botId}`}>
                    {s.name} ({s.teamName}): {SKIP_WORDS[s.reason]}.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button
          disabled={busy || !data || data.teams.length === 0}
          onClick={() => onConfirm({ skipTeamIds: [...skipTeams], skipBotIds: [...skipBots] })}
        >
          {data && data.teams.length > 0
            ? createLabel(keptSeats(data, skipTeams, skipBots))
            : "Create these seats"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Back
        </Button>
      </div>
    </section>
  );
}
