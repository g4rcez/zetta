import type { Database } from "@zetta/db";
import { and, asc, eq } from "@zetta/db/query";
import { botSkill, skill } from "@zetta/db/schema/skills";
import { team, teamMember, teamRole } from "@zetta/db/schema/teams";

/** What the Chief sees about each of the user's bots when it plans a team: engine, what it is good at, its skills and teams. */
export type RosterBot = {
  id: string;
  name: string;
  kind: "chief" | "specialist";
  harness: string;
  description: string;
};
export type RosterSkill = { botId: string; name: string };
export type RosterTeam = { botId: string; team: string; role: string };

const MAX_BOTS = 40;
const MAX_SKILLS = 5;
const MAX_TEAMS = 3;
const DESCRIPTION_CHARS = 90;

const short = (text: string) => {
  const clean = text.replace(/`/g, "'").replace(/\s+/g, " ").trim();
  return clean.length > DESCRIPTION_CHARS ? `${clean.slice(0, DESCRIPTION_CHARS - 1)}…` : clean;
};
const some = (items: string[], max: number) =>
  items.length > max
    ? `${items.slice(0, max).join(", ")} +${items.length - max}`
    : items.join(", ");

/** One line per specialist bot, kept short: it is in every Chief turn. The Chief itself is not listed. */
export function chiefRoster(bots: RosterBot[], skills: RosterSkill[], teams: RosterTeam[]): string {
  const specialists = bots.filter((b) => b.kind !== "chief");
  const lines = specialists.slice(0, MAX_BOTS).map((b) => {
    const description = short(b.description);
    const own = skills.filter((s) => s.botId === b.id).map((s) => s.name);
    const member = teams
      .filter((t) => t.botId === b.id)
      .map((t) => (t.role ? `${t.team}/${t.role}` : t.team));
    return [
      `- ${b.name} (${b.id}) ${b.harness}${description ? `: ${description}` : ""}`,
      own.length ? `skills: ${some(own, MAX_SKILLS)}` : "",
      member.length ? `teams: ${some(member, MAX_TEAMS)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
  if (specialists.length > MAX_BOTS)
    lines.push(`…${specialists.length - MAX_BOTS} more: use zetta:bot list`);
  return lines.join("\n");
}

/** Reads the skills and teams of the user's bots, then renders the roster. Owner-scoped: only the user's own active skills and teams. */
export async function loadChiefRoster(
  db: Pick<Database, "select">,
  userId: string,
  bots: RosterBot[],
): Promise<string> {
  const [skills, teams] = await Promise.all([
    db
      .select({ botId: botSkill.botId, name: skill.name })
      .from(botSkill)
      .innerJoin(skill, eq(skill.id, botSkill.skillId))
      .where(and(eq(skill.ownerUserId, userId), eq(skill.status, "active")))
      .orderBy(asc(skill.name)),
    db
      .select({ botId: teamMember.botId, team: team.name, role: teamRole.name })
      .from(teamMember)
      .innerJoin(team, eq(team.id, teamMember.teamId))
      .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
      .where(and(eq(team.ownerUserId, userId), eq(team.status, "active")))
      .orderBy(asc(teamMember.joinedAt)),
  ]);
  return chiefRoster(
    bots,
    skills,
    teams.map((t) => ({ ...t, role: t.role ?? "" })),
  );
}
