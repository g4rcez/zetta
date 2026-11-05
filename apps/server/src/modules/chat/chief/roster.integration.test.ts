import { uuidv7 } from "@zetta/core/uuid";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { bot } from "@zetta/db/schema/chat";
import { botSkill, skill } from "@zetta/db/schema/skills";
import { team, teamMember, teamRole } from "@zetta/db/schema/teams";
import { cleanupTestUsers } from "../../../test-support/db-cleanup";
import { loadChiefRoster } from "./roster";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const [A, B] = [`roster-a-${uuidv7()}`, `roster-b-${uuidv7()}`] as const;

suite("chief roster against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const scout = uuidv7();
  const stranger = uuidv7();
  const row = (id: string, ownerUserId: string, name: string) => ({
    id,
    ownerUserId,
    name,
    slug: `${name.toLowerCase()}-${id.slice(-6)}`,
    kind: "specialist" as const,
    visibility: "private" as const,
    harness: "claude-code" as const,
    description: "finds sources",
  });

  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(
      [A, B].map((id) => ({
        id,
        name: id,
        email: `${id}@t.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    await db.insert(bot).values([row(scout, A, "Scout"), row(stranger, B, "Stranger")]);
    const [mine, archived, theirs] = await db
      .insert(skill)
      .values([
        { ownerUserId: A, name: "web-research", description: "d", body: "b" },
        { ownerUserId: A, name: "old-skill", description: "d", body: "b", status: "archived" },
        { ownerUserId: B, name: "their-skill", description: "d", body: "b" },
      ])
      .returning({ id: skill.id });
    await db.insert(botSkill).values([
      { botId: scout, skillId: mine!.id },
      { botId: scout, skillId: archived!.id },
      { botId: stranger, skillId: theirs!.id },
    ]);
    const [role] = await db
      .insert(teamRole)
      .values({ ownerUserId: A, name: "Researcher", description: "finds facts" })
      .returning({ id: teamRole.id });
    const [launch, closed] = await db
      .insert(team)
      .values([
        { ownerUserId: A, name: "Launch" },
        { ownerUserId: A, name: "Closed", status: "archived" },
      ])
      .returning({ id: team.id });
    await db.insert(teamMember).values([
      { teamId: launch!.id, botId: scout, roleId: role!.id },
      { teamId: closed!.id, botId: scout },
    ]);
  });
  afterAll(async () => {
    await cleanupTestUsers(db, [A, B]);
    await db.$client.query("delete from team_role where owner_user_id = any($1)", [[A, B]]);
    await db.$client.end();
  });

  test("lists the active skills and active teams of the user's own bots only", async () => {
    const roster = await loadChiefRoster(db, A, [
      {
        id: scout,
        name: "Scout",
        kind: "specialist",
        harness: "claude-code",
        description: "finds sources",
      },
    ]);
    expect(roster).toBe(
      `- Scout (${scout}) claude-code: finds sources | skills: web-research | teams: Launch/Researcher`,
    );
  });
});
