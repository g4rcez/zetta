import type { Database } from "@zetta/db";
import { and, asc, eq } from "@zetta/db/query";
import { botSkill, skill } from "@zetta/db/schema/skills";
import { withBuiltinSkills } from "../bot-claude/profile";
import { skillsOf, type BotClaude } from "../bot-claude/store";
import { HERMES_SKILLS_BUDGET } from "../chat/harness";

/**
 * Every skill a bot has, from every place, with the facts a person needs to manage them: where each comes from, how big it is, which
 * library skill a bot's own skill of the same name hides, and (for Hermes, which puts skills in the prompt) how much of the size budget
 * they use and which no longer fit and are silently left out.
 */
export type SkillOverviewRow = {
  name: string;
  description: string;
  /** `library`: from the owner's library. `bot`: written for this bot. `builtin`: Zetta's. `host`: from the server user's home. */
  source: "library" | "bot" | "builtin" | "host";
  /** The library skill, to open or detach it. */
  skillId: string | null;
  /** Size of the text; null for a host skill, which is read when the bot runs. */
  bytes: number | null;
  /** A library skill attached to the bot that a skill of the bot's own with the same name hides. */
  hiddenBy: "bot" | null;
  /** The library skill is attached but cannot be used (its text no longer passes the checks). */
  unusable: boolean;
  /** Hermes only: false when the budget leaves it out of the prompt. Null on other harnesses. */
  fits: boolean | null;
};
export type SkillOverview = {
  harness: string;
  /** Hermes only. `dropped` skills are left out of every prompt. */
  budget: { used: number; limit: number; dropped: number } | null;
  skills: SkillOverviewRow[];
};

/** The size one skill takes in a Hermes prompt: keep in step with `hermesPrompt` in chat/harness.ts (overview.test.ts checks they agree). */
export const hermesCost = (k: { name: string; description: string; body: string }) =>
  `## Skill: ${k.name}\nUse when: ${k.description}\n${k.body}`.length + 32;

export async function botSkillOverview(
  db: Database,
  claude: BotClaude,
  b: { id: string; harness: string },
): Promise<SkillOverview> {
  const own = b.harness === "claude-code" || b.harness === "hermes";
  const [config, attached, listed] = await Promise.all([
    claude.get(b.id),
    db
      .select({ id: skill.id, name: skill.name, description: skill.description, body: skill.body })
      .from(botSkill)
      .innerJoin(skill, eq(skill.id, botSkill.skillId))
      .where(and(eq(botSkill.botId, b.id), eq(skill.status, "active")))
      .orderBy(asc(skill.name)),
    skillsOf(claude, b),
  ]);
  const ownNames = new Set(config.assets.filter((a) => a.kind === "skill").map((a) => a.name));
  const library = new Map(attached.map((r) => [r.name, r]));
  const rows: SkillOverviewRow[] = [];

  if (own) {
    const profile = withBuiltinSkills(await claude.profile(b.id));
    const inRun = new Set(profile.skills.map((k) => k.name));
    let used = 0;
    let dropped = 0;
    for (const k of profile.skills) {
      const lib = ownNames.has(k.name) ? undefined : library.get(k.name);
      const fits =
        b.harness === "hermes"
          ? (() => {
              const n = hermesCost(k);
              if (used + n > HERMES_SKILLS_BUDGET) {
                dropped++;
                return false;
              }
              used += n;
              return true;
            })()
          : null;
      rows.push({
        name: k.name,
        description: k.description,
        source: ownNames.has(k.name) ? "bot" : lib ? "library" : "builtin",
        skillId: lib?.id ?? null,
        bytes: Buffer.byteLength(k.body),
        hiddenBy: null,
        unusable: false,
        fits,
      });
    }
    // Attached library skills that are not in the run: hidden by a skill of the bot's own, or no longer valid.
    for (const r of attached) {
      if (inRun.has(r.name) && !ownNames.has(r.name)) continue;
      rows.push({
        name: r.name,
        description: r.description,
        source: "library",
        skillId: r.id,
        bytes: Buffer.byteLength(r.body),
        hiddenBy: ownNames.has(r.name) ? "bot" : null,
        unusable: !ownNames.has(r.name),
        fits: b.harness === "hermes" ? false : null,
      });
    }
    return {
      harness: b.harness,
      budget: b.harness === "hermes" ? { used, limit: HERMES_SKILLS_BUDGET, dropped } : null,
      skills: [...rows, ...host(listed)],
    };
  }
  return { harness: b.harness, budget: null, skills: host(listed) };
}

const host = (listed: Awaited<ReturnType<typeof skillsOf>>): SkillOverviewRow[] =>
  listed
    .filter((k) => k.source === "host")
    .map((k) => ({
      name: k.name,
      description: k.description,
      source: "host" as const,
      skillId: null,
      bytes: null,
      hiddenBy: null,
      unusable: false,
      fits: null,
    }));
