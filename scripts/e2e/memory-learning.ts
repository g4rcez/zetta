// Learning from a correction with a real model: a person corrects a bot, the review runs on the bot's own engine, and the result
// must be a skill that is the bot's own (or nothing, when there is nothing worth keeping). The scenarios are the ones of
// skill-review.integration.test.ts, with the real engine instead of a canned answer.
// Costs a few small model calls on the account the Claude CLI is signed in to.
//   bun scripts/e2e/memory-learning.ts
import { uuidv7 } from "../../packages/core/src/uuid";
import { eq } from "../../packages/db/src/query";
import { user } from "../../packages/db/src/schema/auth";
import { bot, conversation, message } from "../../packages/db/src/schema/chat";
import { membership } from "../../packages/db/src/schema/identity";
import { botSkill, skill, skillReview } from "../../packages/db/src/schema/skills";
import { createSkillReview } from "../../apps/server/src/modules/memory/skill-review";
import { createSkills } from "../../apps/server/src/modules/skills/service";
import { throwawayDb } from "./db";
import { createReport } from "./report";

const report = createReport(
  "memory-learning",
  "Memory learning: a correction becomes a skill, with a real model",
);
if (!Bun.which("claude")) {
  report.skip("Claude CLI", "`claude` is not installed on this machine");
  process.exit(report.finish("the Claude CLI installed and signed in"));
}

const { db, stop } = await throwawayDb();
const A = `e2e-learn-${uuidv7()}`;
try {
  const now = new Date();
  await db.insert(user).values({
    id: A,
    name: "Ada",
    email: `${A}@example.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(membership)
    .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
  const skills = createSkills(db);
  const review = createSkillReview(db, skills); // the real engine
  let seq = 0;

  async function scenario(lines: { role: "user" | "assistant"; content: string }[]) {
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name: `Analyst ${uuidv7().slice(-6)}`,
        slug: `analyst-${uuidv7().slice(-10)}`,
        harness: "claude-code",
        model: "haiku",
        autoLearn: "auto",
      } as never)
      .returning();
    const [c] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: b!.id, title: "t" } as never)
      .returning();
    for (const l of lines)
      await db.insert(message).values({
        conversationId: c!.id,
        ownerUserId: A,
        seq: ++seq,
        role: l.role,
        content: l.content,
        status: "complete",
      } as never);
    const queued = await review.afterTurn({
      ownerUserId: A,
      conversationId: c!.id,
      startedBy: "user_message",
    });
    return { bot: b!, queued };
  }

  await report.check(
    "a clear correction is queued and the real model turns it into a skill of the bot's own",
    async () => {
      const { bot: b, queued } = await scenario([
        { role: "user", content: "Export the monthly sales numbers from the dashboard." },
        {
          role: "assistant",
          content: "I copied the numbers from the HTML table on the dashboard page.",
        },
        {
          role: "user",
          content:
            "No. Never scrape the table. Always use the CSV export button, because the table rounds the values and the CSV is exact. Check the row count against the dashboard total.",
        },
        {
          role: "assistant",
          content: "Understood, I used the CSV export and the row count matches: 1,204 rows.",
        },
      ]);
      if (queued?.reason !== "corrected")
        throw new Error(`the correction was not queued (got ${queued?.reason ?? "nothing"})`);
      const started = Date.now();
      await review.tick();
      const ms = Date.now() - started;
      const [row] = await db.select().from(skillReview).where(eq(skillReview.id, queued.id));
      const mine = await db.select().from(skill).where(eq(skill.learnedByBotId, b.id));
      if (!mine.length)
        throw new Error(
          `no skill was created; the review ended as "${row?.outcome}" (${row?.detail ?? "no detail"})`,
        );
      const s = mine[0]!;
      const links = await db.select().from(botSkill).where(eq(botSkill.skillId, s.id));
      if (!links.some((l) => l.botId === b.id))
        throw new Error("the skill is not attached to the bot");
      if (s.source !== "learned") throw new Error(`source is ${s.source}`);
      if (!/csv/i.test(`${s.description} ${s.body}`))
        throw new Error(`the skill does not mention the lesson (CSV): ${s.body.slice(0, 120)}`);
      return `review took ${(ms / 1000).toFixed(0)} s; skill "${s.name}": ${s.description.slice(0, 80)}`;
    },
  );

  await report.check("a one-off request with no lesson is not kept as a skill", async () => {
    const { bot: b, queued } = await scenario([
      { role: "user", content: "What is the capital of Portugal?" },
      { role: "assistant", content: "Lisbon." },
      { role: "user", content: "No, I meant the capital of Brazil today." },
      { role: "assistant", content: "Brasília." },
    ]);
    if (!queued) throw new Error("the review was not queued, so nothing was judged");
    await review.tick();
    const mine = await db.select().from(skill).where(eq(skill.learnedByBotId, b.id));
    if (mine.length)
      throw new Error(
        `the model kept a skill for a one-off answer: "${mine[0]!.name}": ${mine[0]!.body.slice(0, 100)}`,
      );
  });

  await report.check(
    "a lesson that contains a secret is never saved with the secret in it",
    async () => {
      const { bot: b, queued } = await scenario([
        { role: "user", content: "Deploy the site to staging." },
        { role: "assistant", content: "Deployed with the production key." },
        {
          role: "user",
          content:
            "No, use the staging flow: run `make staging` and use the key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA for it. Always do it that way.",
        },
        { role: "assistant", content: "Done, deployed with make staging." },
      ]);
      if (!queued) throw new Error("the review was not queued");
      await review.tick();
      const mine = await db.select().from(skill).where(eq(skill.learnedByBotId, b.id));
      if (mine.some((s) => /sk-ant-api03/.test(s.body)))
        throw new Error("a skill was saved with the key inside it");
      return mine.length
        ? `kept without the key: "${mine[0]!.name}"`
        : "nothing kept (the guard or the model refused)";
    },
  );
} finally {
  await stop();
}
report.note(
  "The model judges each case itself, so a different run can word the skill differently; the checks only look at what must hold (queued, attached, learned, mentions the lesson, no one-off, no secret).",
);
process.exit(
  report.finish("the Claude CLI signed in; the embedded Postgres runtime (`bun run db:runtime`)"),
);
