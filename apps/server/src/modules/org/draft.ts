import { ORG_DESCRIPTION_MAX, ORG_TITLE_MAX, ORG_UNIT_MAX, type OrgRank } from "@zetta/core/org";
import { orgTemplateByKey } from "@zetta/core/org-templates";
import type { Database } from "@zetta/db";
import { and, asc, eq, inArray } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import { team, teamMember, teamRole } from "@zetta/db/schema/teams";

/**
 * A first chart drawn from the teams the admin already has: each team is a unit, its chief is the leader seat and the other member bots
 * hold a seat under the leader. It is only a proposal. Nothing is stored until the admin confirms it (`store.applyDraft`), and the
 * admin can leave out whole teams or single bots first.
 */

/** The most seats a draft makes: the same cap as the chart (the store checks it again). */
export const ORG_DRAFT_MAX_SEATS = 300;

/** Why a bot of a team did not get a seat of its own. */
export type OrgDraftSkipReason =
  | "private"
  | "archived"
  | "chief_of_staff"
  | "already_seated"
  | "too_many";

export type OrgDraftSeat = {
  /** Position in `seats`; parents come before their children. */
  ref: number;
  parentRef: number | null;
  rank: OrgRank;
  title: string;
  description: string;
  unit: string;
  templateKey: string | null;
  team: { id: string; name: string } | null;
  holder: { botId: string; name: string } | null;
  /** Said when a seat is open although the team has somebody for it. */
  note: string | null;
  sortOrder: number;
};

export type OrgDraftSkip = {
  botId: string;
  name: string;
  teamName: string;
  reason: OrgDraftSkipReason;
};

export type OrgDraft = {
  seats: OrgDraftSeat[];
  skipped: OrgDraftSkip[];
  /** The teams of the admin that the draft started from, left out ones included. */
  teams: { id: string; name: string; botCount: number }[];
};

export type OrgDraftChoices = { skipTeamIds?: readonly string[]; skipBotIds?: readonly string[] };

const WHY: Record<OrgDraftSkipReason, string> = {
  private: "share the bot with the team first",
  archived: "the bot is archived",
  chief_of_staff: "a personal chief of staff cannot hold a seat",
  already_seated: "it already holds another seat",
  too_many: "the chart is full",
};
const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
const firstLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? "";

/** Reads the admin's active teams and builds the draft. `skip*` is what the admin unticked on the preview. */
export async function buildOrgDraft(
  db: Pick<Database, "select">,
  adminUserId: string,
  choices: OrgDraftChoices = {},
): Promise<OrgDraft> {
  const skipTeams = new Set(choices.skipTeamIds ?? []);
  const skipBots = new Set(choices.skipBotIds ?? []);
  const teams = await db
    .select({ id: team.id, name: team.name, goal: team.goal })
    .from(team)
    .where(and(eq(team.ownerUserId, adminUserId), eq(team.status, "active")))
    .orderBy(asc(team.name), asc(team.id));
  const members = teams.length
    ? await db
        .select({
          teamId: teamMember.teamId,
          botId: teamMember.botId,
          kind: teamMember.kind,
          joinedAt: teamMember.joinedAt,
          roleName: teamRole.name,
          name: bot.name,
          role: bot.role,
          visibility: bot.visibility,
          botKind: bot.kind,
          archived: bot.archived,
        })
        .from(teamMember)
        .innerJoin(bot, eq(bot.id, teamMember.botId))
        .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
        .where(
          inArray(
            teamMember.teamId,
            teams.map((t) => t.id),
          ),
        )
        .orderBy(asc(teamMember.joinedAt), asc(teamMember.botId))
    : [];

  const seats: OrgDraftSeat[] = [];
  const skipped: OrgDraftSkip[] = [];
  const ceo = orgTemplateByKey("ceo")!;
  seats.push({
    ref: 0,
    parentRef: null,
    rank: "ceo",
    title: ceo.title,
    description: ceo.description,
    unit: ceo.unit,
    templateKey: ceo.key,
    team: null,
    holder: null,
    note: null,
    sortOrder: 0,
  });
  const seated = new Set<string>();
  let teamIndex = 0;
  for (const t of teams) {
    if (skipTeams.has(t.id)) continue;
    const own = members.filter((m) => m.teamId === t.id);
    // The chief leads; the others follow in the order they joined.
    const chief = own.find((m) => m.kind === "chief");
    const rest = own.filter((m) => m !== chief);
    const why = (m: (typeof own)[number]): OrgDraftSkipReason | null =>
      m.archived
        ? "archived"
        : m.botKind !== "specialist"
          ? "chief_of_staff"
          : m.visibility !== "team"
            ? "private"
            : seated.has(m.botId)
              ? "already_seated"
              : null;
    const skip = (m: (typeof own)[number], reason: OrgDraftSkipReason) =>
      skipped.push({ botId: m.botId, name: m.name, teamName: t.name, reason });

    if (seats.length >= ORG_DRAFT_MAX_SEATS) {
      for (const m of own) skip(m, "too_many");
      continue;
    }
    const leadRef = seats.length;
    const chiefReason = chief ? (skipBots.has(chief.botId) ? "left_out" : why(chief)) : null;
    const chiefSeat = chief && chiefReason === null ? chief : undefined;
    if (chief && chiefReason && chiefReason !== "left_out") skip(chief, chiefReason);
    if (chiefSeat) seated.add(chiefSeat.botId);
    const goal = firstLine(t.goal);
    seats.push({
      ref: leadRef,
      parentRef: 0,
      rank: "lead",
      title: clip(`${t.name} lead`, ORG_TITLE_MAX),
      description: clip(goal || `Leads the ${t.name} team.`, ORG_DESCRIPTION_MAX),
      unit: clip(t.name, ORG_UNIT_MAX),
      templateKey: null,
      team: { id: t.id, name: t.name },
      holder: chiefSeat ? { botId: chiefSeat.botId, name: chiefSeat.name } : null,
      note:
        chief && !chiefSeat && chiefReason && chiefReason !== "left_out"
          ? `${chief.name} cannot hold a seat yet: ${WHY[chiefReason]}.`
          : null,
      sortOrder: teamIndex++,
    });
    let order = 0;
    for (const m of rest) {
      if (skipBots.has(m.botId)) continue;
      const reason = why(m);
      if (reason) {
        skip(m, reason);
        continue;
      }
      if (seats.length >= ORG_DRAFT_MAX_SEATS) {
        skip(m, "too_many");
        continue;
      }
      seated.add(m.botId);
      seats.push({
        ref: seats.length,
        parentRef: leadRef,
        rank: "member",
        title: clip(m.roleName?.trim() || m.role.trim() || m.name, ORG_TITLE_MAX),
        description: "",
        unit: clip(t.name, ORG_UNIT_MAX),
        templateKey: null,
        team: null,
        holder: { botId: m.botId, name: m.name },
        note: null,
        sortOrder: order++,
      });
    }
  }
  return {
    seats,
    skipped,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      botCount: members.filter((m) => m.teamId === t.id).length,
    })),
  };
}
